import { PersistentSet, PersistentVector, PersistentMap, u128 } from "near-sdk-as";
import { AccountId, Balance, Duration } from './types'

export enum Vote {
    Yes,
    No
}

export enum ProposalStatus {
     /// Proposal is in active voting stage.
     Vote,
     /// Proposal has successfully passed.
     Success,
     /// Proposal was rejected by the vote.
     Reject,
     /// Vote for proposal has failed due (not enuough votes).
     Fail,
     /// Given voting policy, the uncontested minimum of votes was acquired.
     /// Delaying the finalization of the proposal to check that there is no contenders (who would vote against).
     Delay,
}

export enum ProposalKind {
    NewCouncil,
    RemoveCouncil,
    Payout,
    ChangeVotePeriod,
    ChangeBond,
    ChangePolicy,
    ChangePurpose
}

@nearBindgen
export class Proposal {
    status: ProposalStatus;
    proposer: AccountId;
    target: AccountId;
    description: string;
    kind: ProposalKind;
    payout: Balance;
    vote_period_end: Duration;
    vote_yes: u64;
    vote_no: u64;
    votes: PersistentMap<AccountId, Vote>;
    policy: PolicyItem;
    vote_period: Duration;
    bond: Balance;
    purpose: string;

    constructor(
        status: ProposalStatus,
        proposer: AccountId,
        target: AccountId,
        description: string,
        kind: ProposalKind,
        payout: Balance,
        vote_period_end: Duration,
        vote_yes: u64,
        vote_no: u64,
        votes: PersistentMap<AccountId, Vote>,
        policy: PolicyItem,
        vote_period: Duration = u128.Zero,
        bond: Balance = u128.Zero,
        purpose: string = ''
    ) {
        status = this.status;
        proposer = this.proposer;
        target = this.target;
        description = this.description;
        kind = this.kind;
        payout = this.payout;
        vote_period_end = this.vote_period_end;
        vote_yes = this.vote_yes;
        vote_no = this.vote_no;
        votes = this.votes;
        policy = this.policy;
        vote_period = this.vote_period;
        bond = this.bond;
        purpose = this.purpose;
    }

    get_amount(): Balance {
        return this.payout
    }
  
}

@nearBindgen
export class ProposalInput {
    target: AccountId;
    description: string;
    kind: ProposalKind;

    constructor(
        target: AccountId,
        description: string,
        kind: ProposalKind
    ) {
        target = this.target;
        description = this.description;
        kind = this.kind;
    }
}

@nearBindgen
export class SputnikDao {
    purpose: string;
    bond: Balance;
    vote_period: Duration;
    grace_period: Duration;
    policy: PersistentVector<PolicyItem>;
    council: PersistentSet<AccountId>;
    proposals: PersistentVector<Proposal>

    constructor(
        purpose: string,
        bond: Balance,
        vote_period: Duration,
        grace_period: Duration,
        policy: PersistentVector<PolicyItem>,
        council: PersistentSet<AccountId>,
        proposals: PersistentVector<Proposal>
    ) {
        purpose = this.purpose;
        bond = this.bond;
        vote_period = this.vote_period;
        grace_period = this.grace_period;
        policy = this.policy;
        council = this.council;
        proposals = this.proposals;
    }

}

export enum NumOrRatio {
    Number,
    Ratio
}


@nearBindgen
export class PolicyItem {
    max_amount: Balance;
    votes: NumOrRatio;
    num_votes: u64;
    numerator: u64;
    denominator: u64;

    constructor(
        max_amount: Balance,
        votes: NumOrRatio,
        num_votes: u64,
        numerator: u64,
        denominator: u64
    ) {
        max_amount = this.max_amount;
        votes = this.votes;
        num_votes = this.num_votes;
        numerator = this.numerator;
        denominator = this.denominator;
    }

    get_num_votes(num_council: u64): u64 {
        switch(this.votes) {
            case NumOrRatio.Number: // Number
                return this.num_votes
                break
            case NumOrRatio.Ratio:
                return (min(num_council * this.numerator / this.denominator + 1, num_council))
                break
            default:
                break
        }
        return this.num_votes
    }
}

