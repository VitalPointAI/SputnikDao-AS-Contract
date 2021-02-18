import { ContractPromiseBatch, PersistentSet, Context, base58, u128, env, PersistentVector, PersistentMap, logging } from 'near-sdk-as'
import { AccountId, Balance, Duration } from './types'
import { Vote, NumOrRatio, SputnikDao, Proposal, ProposalInput, PolicyItem, ProposalStatus, ProposalKind } from './models'

const MAX_DESCRIPTION_LENGTH: u32 = 280

let dao: SputnikDao

export function init(
  purpose: string,
  bond: Balance,
  council: Array<AccountId>,
  vote_period: Duration,
  grace_period: Duration
): SputnikDao {
  let councilSet = new PersistentSet<AccountId>('c')
  let i: i32 = 0
  while (i < council.length) {
    councilSet.add(council[i])
    i++
  }

  let proposalVec = new PersistentVector<Proposal>('p')

  let policyIt = new PolicyItem(u128.Zero, NumOrRatio.Ratio, 0, 1, 2)
  let policyVec = new PersistentVector<PolicyItem>('i')
  policyVec.push(policyIt)

  dao = new SputnikDao (
    purpose,
    bond,
    vote_period,
    grace_period,
    policyVec,
    councilSet,
    proposalVec
  )
  return dao
}

export function add_proposal(
  proposal: ProposalInput,
  policy: Array<PolicyItem>,
  payout: Balance, 
  vote_period: Duration, 
  bond: Balance,
  description: string ): u64 {
  // TODO: add also extra storage cost for the proposal itself.
  assert(u128.ge(Context.attachedDeposit, dao.bond), 'Not enough deposit')
  assert(<u32>(proposal.description.length) < MAX_DESCRIPTION_LENGTH, 'Description length is too long')

  //Input verification.
  switch(proposal.kind) {
    case ProposalKind.ChangePolicy: 
      assert(policy.length != 0, 'Policy should not be empty')
      let i: i32 = 0
      while (i < policy.length) {
        assert(u128.gt(policy[i].max_amount, policy[i-1].max_amount), 'Policy must be sorted, item' + i.toString() + 'is wrong')
      i++
      }
      let last_ratio_numerator = policy[policy.length - 1].numerator
      let last_ratio_denominator = policy[policy.length -1].denominator
      assert(last_ratio_numerator > 0, 'Last item in policy must have a numerator for the ratio')
      assert(last_ratio_denominator > 0, 'Last item in policy must have a denominator not equal to zero')
      assert(last_ratio_numerator * 2 / last_ratio_denominator >= 1, 'Last item in policy must be equal or above 1/2 ratio')
    break
  }

  let p = new Proposal (
    ProposalStatus.Vote,
    Context.predecessor,
    proposal.target,
    proposal.description,
    proposal.kind,
    u128.Zero,
    u128.add(u128.from(Context.blockTimestamp), dao.vote_period),
    0,
    0,
    new PersistentMap<string, Vote>('v'),
    policy[policy.length - 1],
    u128.Zero,
    u128.Zero,
    ''
  )
  dao.proposals.push(p)
  return dao.proposals.length - 1
}

export function is_finalized(proposal: Proposal): bool {
  return (proposal.status != ProposalStatus.Vote && proposal.status != ProposalStatus.Delay)
}

export function vote(id: i32, vote: Vote): void {
  assert(dao.council.has(Context.predecessor), 'Only council can vote')
  assert(!isNull(dao.proposals[id]), 'No proposal with such id')
  let proposal = dao.proposals[id]
  assert(proposal.status == ProposalStatus.Vote, 'Proposal already finalized')
  if(u128.lt(proposal.vote_period_end, u128.from(Context.blockTimestamp))){
    logging.log('Voting period expired, finalizing the proposal')
    finalize(id)
    return
  }
  assert(!proposal.votes.contains(Context.predecessor), 'Already voted')
  switch(vote) {
    case Vote.Yes:
      proposal.vote_yes += 1
      break
    case Vote.No:
      proposal.vote_no +=1
      break
    default:
      break
  }
  proposal.votes.set(Context.predecessor, vote)
  let post_status = vote_status(proposal, dao.policy, dao.council.size)
  // If just changed from vote to Delay, adjust the expiration date to grace period.
  if (!(post_status == ProposalStatus.Vote || post_status == ProposalStatus.Delay) && post_status != proposal.status) {
    proposal.vote_period_end = u128.add(u128.from(Context.blockTimestamp), dao.grace_period)
    proposal.status = post_status
  }
  dao.proposals.replace(id, proposal)
  //Finalize if this vote is done.
  if (post_status == ProposalStatus.Vote || post_status == ProposalStatus.Delay){
    finalize(id)
  }
}


export function vote_requirement(policy: PolicyItem, num_council: u64, amount: Balance): u64 {
  if(amount){
      //ToDo: replace with binary search.
      if (u128.gt(policy.max_amount, amount)) {
          return policy.get_num_votes(num_council)
      }
  }
  return policy.get_num_votes(num_council)
}

 /// Compute new vote status given council size and current timestamp.
 export function vote_status(proposal: Proposal, policy: PersistentVector<PolicyItem> , num_council: u64): ProposalStatus{
  let amount = proposal.get_amount()
  let votes_required = vote_requirement(policy[policy.length -1], num_council, amount)
  let max_votes = policy[policy.length -1].get_num_votes(num_council)
  if ((proposal.vote_yes >= votes_required) && proposal.vote_no == 0){
    if (u128.gt(u128.from(Context.blockTimestamp), proposal.vote_period_end)) {
      return ProposalStatus.Success
    } else {
      return ProposalStatus.Delay
    }
  } else if (proposal.vote_no >= max_votes) {
    return ProposalStatus.Reject
  } else if (u128.gt(u128.from(Context.blockTimestamp), proposal.vote_period_end) || proposal.vote_yes + proposal.vote_no == num_council) {
    return ProposalStatus.Fail
  } else {
    return ProposalStatus.Vote
  }
}

export function finalize(id: i32): void {
  assert(!isNull(dao.proposals[id]), 'No proposal with such id')
  let proposal = dao.proposals[id]
  assert(!is_finalized(proposal), 'Proposal already finalized')
  proposal.status = vote_status(proposal, dao.policy, dao.council.size)
  switch(proposal.status) {
    case ProposalStatus.Success:
      logging.log('Vote succeeded')
      let target = proposal.target
      let promise = ContractPromiseBatch.create(proposal.proposer).transfer(dao.bond)
        switch(proposal.kind){
          case ProposalKind.NewCouncil:
            dao.council.add(proposal.target)
            break
          case ProposalKind.RemoveCouncil:
            dao.council.delete(proposal.target)
            break
          case ProposalKind.Payout:
            let promise = ContractPromiseBatch.create(proposal.target).transfer(proposal.get_amount())
            break
          case ProposalKind.ChangeVotePeriod:
            if(proposal.vote_period != u128.Zero) {
              dao.vote_period = proposal.vote_period
            }
            break
          case ProposalKind.ChangeBond:
            if(proposal.bond != u128.Zero) {
              dao.bond = proposal.bond
            }
            break
          case ProposalKind.ChangePolicy:
            dao.policy.push(proposal.policy)
            break
          case ProposalKind.ChangePurpose:
            if(proposal.purpose != '') { 
              dao.purpose = proposal.purpose
            }
            break
        }
      break
    case ProposalStatus.Reject:
      logging.log('Proposal rejected')
      break
    case ProposalStatus.Vote || ProposalStatus.Delay:
      logging.log('voting period has not expired and no majority vote yet')
      env.panic()
      break
  }
  dao.proposals.replace(id, proposal)
}


/******************/
/* View Functions */
/******************/

export function get_vote_period(): Duration {
  return dao.vote_period
}

export function get_bond(): Balance {
  return dao.bond
}

export function get_council(): Array<AccountId> {
  return dao.council.values()
}

export function get_num_proposals(): u64 {
  return dao.proposals.length as u64
}

export function get_proposals(from_index: i32, limit: i32): Array<Proposal> {
  let i = from_index
  let propArray = new Array<Proposal>()
  while (i < min(limit, dao.proposals.length)){
    propArray.push(dao.proposals[i])
    i++
  }
  return propArray
}

export function get_proposals_by_status(
  status: ProposalStatus,
  from_index: i32,
  limit: i32,
): Array<Proposal> {
  let filtered_proposal_ids = new Array<Proposal>()
  let i: i32 = from_index
  while (i < min(i + limit, dao.proposals.length)){
    if(dao.proposals[i].status == status){
      filtered_proposal_ids.push(dao.proposals[i])
    }
    i++
  }
  return filtered_proposal_ids
}

export function get_proposals_by_statuses(
  statuses: Array<ProposalStatus>,
  from_index: i32,
  limit: i32
): Array<Proposal> {
  let filtered_proposal_ids = new Array<Proposal>()
  let i: i32 = from_index
  while (i < min(i + limit, dao.proposals.length)){
    if(statuses.includes(dao.proposals[i].status)){
      filtered_proposal_ids.push(dao.proposals[i])
    }
    i++
  }
  return filtered_proposal_ids
}

export function get_proposal(id: i32): Proposal {
  assert(!isNull(dao.proposals[id]), 'Proposal not found')
  return dao.proposals[id]
}

export function get_purpose(): string {
  return dao.purpose
}