'use strict';
const {tableOperation}=require('./table-service.cjs');
const {loadedTransaction}=require('./loaded-transaction.cjs');
const LIVE=new Set(['play','call','declare','fold','team-signal','tick','chat','mute']);
// No wallets or historical matches are loaded by this path. Any transition
// requiring accounting is retried atomically by the existing ledger operation.
function liveUpdate(match,parameters){
 if(match&&match.code!==parameters.code)return null;
 if(match&&['settled','refunded'].includes(match.status)&&parameters.command.kind==='tick'){
  if(parameters.expectedMatchId&&parameters.expectedMatchId!==match.id)return null;
  if(!Object.values(match.players||{}).some(person=>person?.uid===parameters.uid))return null;
  return structuredClone(match);
 }
 if(!match||match.status!=='reserved'||!['started','revealing','timed-out'].includes(match.session?.room?.status))return null;
 const {code}=parameters;
 const ledger={tables:{[code]:match.id},matches:{[match.id]:match}};
 try{
  const next=tableOperation(ledger,parameters),saved=next.matches[match.id];
  if(saved.status!=='reserved'||['complete','closed'].includes(saved.session.room.status))return null;
  return saved;
 }catch{return null;}
}
async function tryLiveAction(db,parameters){
 if(!LIVE.has(parameters.command.kind))return null;
 const expected=parameters.expectedMatchId;
 if(expected!=null&&(typeof expected!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(expected)))return null;
 const id=expected||(await db.ref('creditEconomy/tables/'+parameters.code).once('value')).val();
 if(typeof id!=='string')return null;
 let unchanged=false,limited=false;
 const result=await loadedTransaction(db.ref('creditEconomy/matches/'+id),current=>{
  unchanged=false;limited=false;const next=liveUpdate(current,parameters);if(!next)return undefined;
  unchanged=JSON.stringify(next)===JSON.stringify(current);
  if(!unchanged&&parameters.enforceRateLimit){
   const bucket=parameters.command.kind==='tick'?'ticks':'actions',limit=bucket==='ticks'?60:120;
   const previous=current.actionLimits?.[parameters.uid]?.[bucket];
   const record=previous&&parameters.now-previous.start<60000?{...previous}:{start:parameters.now,count:0};
   if(record.count>=limit){limited=true;return undefined;}
   record.count++;next.actionLimits??={};next.actionLimits[parameters.uid]??={};next.actionLimits[parameters.uid][bucket]=record;
  }
  return unchanged?undefined:next;
 });
 if(limited){const error=new Error('Demasiadas acciones. Esperá un momento.');error.code='resource-exhausted';throw error;}
 if(!result.committed&&!unchanged)return null;
 return {tables:{[parameters.code]:id},matches:{[id]:result.snapshot.val()},liveUnchanged:unchanged};
}
module.exports={liveUpdate,tryLiveAction};
