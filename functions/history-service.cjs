'use strict';
// Executed inside the accounting transaction: retries cannot duplicate receipts.
function recordHistory(before,after,now){
 if(!after)return after;
 const next=structuredClone(after);next.history??={};
 // Compact older entries during accounting writes; retain financial evidence.
 for(const entries of Object.values(next.history))for(const [key,event] of Object.entries(entries)){
  if(!event.changes?.length){delete entries[key];continue;}
  for(const field of ['messages','scores','turn','handNumber','trickCards','pendingBet'])delete event[field];
 }
 for(const [id,m] of Object.entries(next.matches||{})){
  const old=before?.matches?.[id];
  if(old&&JSON.stringify(old)===JSON.stringify(m))continue;
  const changes=[];
  for(const uid of [m.player1,m.player2].filter(Boolean)){
   const a=before?.wallets?.[uid]||{balance:0,locked:0},b=next.wallets?.[uid];
   if(b&&(a.balance!==b.balance||a.locked!==b.locked))changes.push({uid,before:a.balance,after:b.balance,reservedBefore:a.locked,reservedAfter:b.locked});
  }
  if(!changes.length)continue;
  next.history[id]??={};
  next.history[id][String(m.revision||0)+'_'+now]={at:now,status:m.status,closedAt:m.closedAt||null,reason:m.session?.room?.matchResult?.reason||m.closeReason||null,changes};
 }
 return next;
}
module.exports={recordHistory};
