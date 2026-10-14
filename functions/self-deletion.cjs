'use strict';
const {prepareUserDeletion,validKey}=require('./admin-service.cjs');
function prepareSelfDeletion(root,{uid,requestId,now}){
 for(const entry of Object.values(root?.rooms||{}))if(entry?.public?.table?.uid===uid&&require('./admin-service.cjs').legacyTableActive(entry.public,now))throw new Error('Cerrá tu mesa antes de eliminar tu cuenta.');
 return prepareUserDeletion(root,{uid,actor:uid,self:true,requestId,confirmName:root?.profiles?.[uid]?.name||uid,reason:'Eliminación solicitada por el jugador',now});
}
function prepareAdminPrivacyDeletion(root,{anonymousId,...request}){
 if(!validKey(request.uid)||!validKey(request.actor)||!validKey(request.requestId))throw new Error('Usuario o solicitud inválidos.');
 if(request.uid===request.actor||root?.administrators?.[request.uid]===true)throw new Error('No podés eliminar administradores.');
 const existing=root?.accountDeletionJobs?.[request.uid];
 if(existing){
  if(existing.requestId!==request.requestId)throw new Error('Ya hay otra eliminación en proceso.');
  return structuredClone(root);
 }
 if(root?.userAccess?.[request.uid]?.deletionRequestId===request.requestId)return structuredClone(root);
 for(const entry of Object.values(root?.rooms||{}))if(entry?.public?.table?.uid===request.uid&&require('./admin-service.cjs').legacyTableActive(entry.public,request.now))throw new Error('El usuario tiene una mesa activa. Cerrala primero.');
 if(!/^deleted_[a-zA-Z0-9-]+$/.test(anonymousId||''))throw new Error('Identificador de anonimización inválido.');
 const next=prepareUserDeletion(root,{...request,self:false});
 next.accountDeletionJobs??={};
 next.accountDeletionJobs[request.uid]={anonymousId,requestId:request.requestId,at:request.now};
 return next;
}
function erasePlayerData(root,{uid,anonymousId,now}){
 const next=structuredClone(root||{}),name=next.profiles?.[uid]?.name;
 for(const [key,owner] of Object.entries(next.usernames||{}))if(owner===uid)delete next.usernames[key];
 for(const branch of ['profiles','administrators','creditRateLimits'])if(next[branch])delete next[branch][uid];
 if(next.userBlocks){delete next.userBlocks[uid];for(const blocks of Object.values(next.userBlocks))if(blocks&&typeof blocks==='object')delete blocks[uid];}
 if(next.adminMetrics?.presence)delete next.adminMetrics.presence[uid];
 for(const day of Object.values(next.adminMetrics?.days||{}))if(day.users)delete day.users[uid];
 for(const [id,report] of Object.entries(next.problemReports||{}))if(report.uid===uid)delete next.problemReports[id];
 for(const [code,entry] of Object.entries(next.rooms||{})){
  if(Object.values(entry?.public?.players||{}).some(p=>p?.uid===uid)||entry?.public?.table?.uid===uid){delete next.rooms[code];if(next.hands)delete next.hands[code];}
 }
 for(const hands of Object.values(next.hands||{}))if(hands&&typeof hands==='object')delete hands[uid];
 for(const match of Object.values(next.creditEconomy?.matches||{}))if([match.player1,match.player2].includes(uid))delete match.session;
 // Preserve credit totals and opponents' results with an unrelated identifier.
 const scrub=value=>{
  if(typeof value==='string')return value===uid?anonymousId:name&&value===name?'Jugador eliminado':value;
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k.split(uid).join(anonymousId),scrub(v)]));
  return value;
 };
 for(const branch of ['creditEconomy','creditAccountingAudit','adminUserAudit'])if(next[branch])next[branch]=scrub(next[branch]);
 if(next.creditEconomy?.wallets?.[anonymousId])Object.assign(next.creditEconomy.wallets[anonymousId],{balance:0,locked:0,deletedAt:now});
 // A security tombstone prevents delayed writes from restoring the old wallet.
 next.userAccess??={};next.userAccess[uid]={blocked:true,deletedAt:now};
 return next;
}
module.exports={prepareSelfDeletion,prepareAdminPrivacyDeletion,erasePlayerData};
