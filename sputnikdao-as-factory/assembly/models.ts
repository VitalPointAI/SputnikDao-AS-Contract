import { PersistentSet } from "near-sdk-as";
import { AccountId } from './types'

@nearBindgen
export class SputnikDAOFactory {
    daos: PersistentSet<AccountId>;

    constructor(
        daos: PersistentSet<AccountId>,
    ) {
        daos = this.daos
    }
}