'use strict';
const {refundCanceledMatch}=require('./credit-ledger.cjs');
const {tableFor,tableOperation}=require('./table-service.cjs');
const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
function requireAdmin(auth,enabled){if(!auth?.uid||enabled!==true)throw new Error('Solo administradores.');}
function adminLedgerChange(ledger,{actor,action,uid,balance,expectedBalance,code,requestId,reason,now}){
 if(!validKey(actor)||!validKey(requestId)||typeof reason!=='string'||reason.trim().length<3||reason.length>200)throw new Error('Completá el motivo del cambio.');
 let next=structuredClone(ledger||{});next.adminAudit??={};
 const old=next.adminAudit[requestId];
 if(old){if(old.actor!==actor||old.action!==action||old.uid!==(uid||null)||old.code!==(code||null)||old.after!==(action==='credits'?balance:null)||old.reason!==reason.trim())throw new Error('Solicitud reutilizada.');return next;}
 let before=null,after=null;
 if(action==='credits'){
  if(!validKey(uid)||!Number.isSafeInteger(balance)||balance<0||balance>1000000000)throw new Error('Saldo inválido.');
  next.wallets??={};const wallet=next.wallets[uid]||{balance:0,locked:0};
  if(wallet.balance!==expectedBalance)throw new Error('El saldo cambió. Actualizá antes de guardar.');
  before=wallet.balance;after=balance;next.wallets[uid]={...wallet,balance};
 }else if(action==='close-table'){
  const m=tableFor(next,code);
  if(m.status==='waiting')next=tableOperation(next,{code,uid:m.player1,command:{kind:'cancel'},now});
  else if(m.status==='reserved')next=refundCanceledMatch(next,{id:m.id,now});
  const updated=tableFor(next,code);updated.closedAt=now;updated.closeReason='admin';updated.revision++;
  if(updated.session)updated.session.room.status='closed';
 }else throw new Error('Acción inválida.');
 next.adminAudit??={};next.adminAudit[requestId]={actor,action,uid:uid||null,code:code||null,before,after,reason:reason.trim(),at:now};
 return next;
}
module.exports={requireAdmin,adminLedgerChange,validKey};
