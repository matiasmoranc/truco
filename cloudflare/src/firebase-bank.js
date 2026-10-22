// Credits kept in Firebase (CREDITS_BACKEND=firebase): every accounting step is
// one Realtime Database transaction over the whole creditEconomy node.
import {applyLedgerOp} from './ledger-ops.js';

export function createFirebaseBank(db){
 return {
  // Started early by the table so the transaction can skip its own read.
  prefetch(){return db.read('creditEconomy');},
  async apply(spec,{initial}={}){
   let result=null;
   await db.transaction('creditEconomy',economy=>{
    const r=applyLedgerOp(economy,spec);
    if(r.closedBy){result=r;return undefined;}
    result=r;return r.ledger;
   },{initial});
   return {full:result.full||null,closedBy:result.closedBy||null};
  }
 };
}
