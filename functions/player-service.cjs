'use strict';
const {tableOperation}=require('./table-service.cjs');
const {hasStartedMatch}=require('./match-start.cjs');
function reservationAlerts(ledger,now){
 const alerts=[];
 for(const [uid,w] of Object.entries(ledger.wallets||{})){
  if(!(w.locked>0))continue;
  const matches=Object.values(ledger.matches||{}).filter(m=>[m.player1,m.player2].includes(uid)&&['waiting','reserved'].includes(m.status));
  const current=matches.filter(m=>ledger.tables?.[m.code]===m.id&&!m.closedAt);
  if(!current.length)alerts.push({uid,locked:w.locked,reason:'Reserva sin una partida activa. Requiere revisión antes de modificar el saldo.',repairable:false});
  else for(const m of current){
   const expired=m.status==='waiting'&&now-m.createdAt>=600000;
   const complete=['complete','closed'].includes(m.session?.room?.status);
   if(expired||complete)alerts.push({uid,locked:w.locked,code:m.code,id:m.id,reason:expired?'Mesa vencida sin rival.':'Partida finalizada pendiente de liquidación.',repairable:true});
   else if(w.locked!==m.stake)alerts.push({uid,locked:w.locked,code:m.code,id:m.id,reason:'La reserva no coincide con la apuesta.',repairable:false});
  }
 }
 return alerts;
}
function repairReservation(ledger,{uid,now}){
 const alerts=reservationAlerts(ledger,now).filter(a=>a.uid===uid&&a.repairable);
 if(!alerts.length)throw new Error('No hay una reserva que pueda resolverse automáticamente.');
 let next=ledger;
 for(const a of alerts)next=tableOperation(next,{code:a.code,uid,command:{kind:'tick'},now});
 return next;
}
function personalHistory(ledger,uid){
 const wallet=ledger.wallets?.[uid]||{balance:0,locked:0};
 let peak=Number(ledger.peaks?.[uid]?.balance)||0;
 const matches=Object.values(ledger.matches||{}).filter(m=>[m.player1,m.player2].includes(uid)&&hasStartedMatch(m)).map(m=>{
  const player=m.player1===uid?'player1':'player2';
  const history=Object.values(ledger.history?.[m.id]||{});
  for(const e of history)for(const c of e.changes||[])if(c.uid===uid)peak=Math.max(peak,c.before||0,c.after||0);
  const delta=m.status==='settled'?(m.winner===uid?m.stake:-m.stake):0;
  return {id:m.id,code:m.code,matchNumber:m.matchNumber||1,players:Object.values(m.players||{}).map(p=>p.name),stake:m.stake,status:m.status,scores:m.session?.room?.scores||null,delta,winner:m.winner===uid,createdAt:m.createdAt||null,finishedAt:m.settledAt||m.refundedAt||m.closedAt||null,reason:m.session?.room?.matchResult?.reason||m.closeReason||null,history:history.map(e=>({at:e.at,changes:(e.changes||[]).filter(c=>c.uid===uid)})),player};
 }).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
 return {movements:Object.values(ledger.walletMovements?.[uid]||{}).sort((a,b)=>b.at-a.at),balance:wallet.balance,locked:wallet.locked,peak:Math.max(peak,wallet.balance||0),peakSince:ledger.peaks?.[uid]?.startedAt||null,matches};
}
module.exports={reservationAlerts,repairReservation,personalHistory};
