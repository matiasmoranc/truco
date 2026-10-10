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
  if(wallet.deleting||wallet.deletedAt)throw new Error('La cuenta está siendo eliminada o ya fue eliminada.');
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

function prepareUserDeletion(root,{uid,actor,requestId,confirmName,reason,now}){
 if(!validKey(uid)||!validKey(actor)||!validKey(requestId)||typeof reason!=='string'||reason.trim().length<3||reason.length>200)throw new Error('Usuario o motivo inválido.');
 const next=structuredClone(root||{});
 if(uid===actor||next.administrators?.[uid]===true)throw new Error('No podés eliminar administradores.');
 const existing=next.adminUserAudit?.[requestId];
 if(existing){if(existing.action!=='delete'||existing.uid!==uid||existing.actor!==actor||existing.confirmName!==confirmName)throw new Error('Solicitud reutilizada.');return next;}
 const expected=next.profiles?.[uid]?.name||uid;
 if(confirmName!==expected)throw new Error('Escribí el nombre del usuario exactamente para confirmar.');
 if((next.creditEconomy?.wallets?.[uid]?.locked||0)>0)throw new Error('Cerrá primero la mesa y devolvé los créditos reservados.');
 for(const id of Object.values(next.creditEconomy?.tables||{})){
  const m=next.creditEconomy.matches?.[id];
  if(m&&[m.player1,m.player2].includes(uid)&&!m.closedAt&&['waiting','reserved'].includes(m.status))throw new Error('El usuario tiene una mesa activa. Cerrala primero.');
 }
 for(const entry of Object.values(next.rooms||{})){const room=entry?.public;if(room&&!room.managedCredits&&['waiting','drawing','started','revealing','timed-out'].includes(room.status)&&Object.values(room.players||{}).some(p=>p?.uid===uid))throw new Error('El usuario tiene una mesa activa. Cerrala primero.');}
 next.userAccess??={};next.userAccess[uid]={blocked:true,deleting:true};
 next.creditEconomy??={};next.creditEconomy.wallets??={};next.creditEconomy.wallets[uid]={...(next.creditEconomy.wallets[uid]||{balance:0,locked:0}),deleting:true};
 next.adminUserAudit??={};next.adminUserAudit[requestId]={actor,uid,action:'delete',confirmName,reason:reason.trim(),at:now,status:'pending',before:next.creditEconomy.wallets[uid].balance,after:0};
 return next;
}
function finishUserDeletion(root,{uid,requestId,now}){
 const next=structuredClone(root||{}),receipt=next.adminUserAudit?.[requestId];
 if(!receipt||receipt.uid!==uid||receipt.action!=='delete')throw new Error('Eliminación no preparada.');
 if(receipt.status==='complete')return next;
 const name=next.profiles?.[uid]?.name,key=name?.toLowerCase().replaceAll('.','%2E');
 if(key&&next.usernames?.[key]===uid)delete next.usernames[key];
 if(next.profiles)delete next.profiles[uid];
 if(next.adminMetrics?.presence)delete next.adminMetrics.presence[uid];
 next.userAccess[uid]={blocked:true,deletedAt:now};
 if(next.creditEconomy?.wallets?.[uid]){next.creditEconomy.wallets[uid].balance=0;next.creditEconomy.wallets[uid].deletedAt=now;}
 Object.assign(receipt,{status:'complete',completedAt:now});
 return next;
}
module.exports.prepareUserDeletion=prepareUserDeletion;
module.exports.finishUserDeletion=finishUserDeletion;
