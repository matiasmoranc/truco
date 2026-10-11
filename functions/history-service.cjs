'use strict';
// Executed inside the accounting transaction: retries cannot duplicate receipts.
function recordHistory(before,after,now){
 if(!after)return after;
 const next=structuredClone(after);next.history??={};
 for(const [id,m] of Object.entries(next.matches||{})){
  const old=before?.matches?.[id];
  if(old&&JSON.stringify(old)===JSON.stringify(m))continue;
  const changes=[];
  for(const uid of [m.player1,m.player2].filter(Boolean)){
   const a=before?.wallets?.[uid]||{balance:0,locked:0},b=next.wallets?.[uid];
   if(b&&(a.balance!==b.balance||a.locked!==b.locked))changes.push({uid,before:a.balance,after:b.balance,reservedBefore:a.locked,reservedAfter:b.locked});
  }
  const oldFeed=new Set((old?.session?.room?.feed||[]).map(e=>JSON.stringify(e)));
  const messages=(m.session?.room?.feed||[]).filter(e=>!oldFeed.has(JSON.stringify(e)));
  next.history[id]??={};
  next.history[id][String(m.revision||0)+'_'+now]={at:now,status:m.status,closedAt:m.closedAt||null,reason:m.session?.room?.matchResult?.reason||m.closeReason||null,changes,messages,scores:m.session?.room?.scores||null,turn:m.session?.room?.turn||null,handNumber:m.session?.room?.handNumber||null,trickCards:m.session?.room?.trickCards||[],pendingBet:m.session?.room?.pendingBet||null};
 }
 return next;
}
module.exports={recordHistory};
