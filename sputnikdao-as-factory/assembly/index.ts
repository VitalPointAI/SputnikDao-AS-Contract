import { ContractPromiseBatch, PersistentSet, Context, base58, u128, env } from 'near-sdk-as'
import { AccountId } from './types'
import { SputnikDAOFactory } from './models'

const CODE = includeBytes('../../sputnikdao-as/out/sputnikdao-as.wasm')

/// This gas spent on the call & account creation, the rest goes to the `new` call.
const CREATE_CALL_GAS: u64 = 40000000000000

let contract: SputnikDAOFactory

export function init(): void {
  contract.daos = new PersistentSet<AccountId>('d')
}

export function getDaoList(): Array<AccountId> {
  return contract.daos.values()
}

export function create(
  name: AccountId,
  args: Uint8Array, // base64 vector
  public_key: string = '', //base58 publickey string
): void {
  let accountId = name + '.' + Context.contractName
  assert(!contract.daos.has(accountId), 'Dao name already exists')
  contract.daos.add(accountId)
  let promise = ContractPromiseBatch.create(accountId)
    .create_account()
    .deploy_contract(Uint8Array.wrap(changetype<ArrayBuffer>(CODE)))
    .transfer(Context.attachedDeposit)
    if(public_key) {
      promise = promise.add_full_access_key(base58.decode(public_key))
    }
  promise.function_call(
    'init',
    args,
    u128.Zero,
    env.prepaid_gas() - CREATE_CALL_GAS
  )
}