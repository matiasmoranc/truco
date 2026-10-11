'use strict';
// Reject malformed output BEFORE handing it to the SDK transaction machinery.
function validateAccounting(before,after){
 if(!after||typeof after!=='object')throw new Error('Se bloqueó un intento de vaciar los créditos.');
 const visit=(value,path)=>{
  if(value===undefined)throw new Error('Dato contable indefinido: '+path);
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Número contable inválido: '+path);
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))visit(item,path+'.'+key);
 };visit(after,'creditEconomy');
 for(const branch of ['wallets','matches','history','walletMovements','peaks','adminAudit']){
  for(const key of Object.keys(before?.[branch]||{})){
   if(!Object.hasOwn(after[branch]||{},key))throw new Error('Se bloqueó la eliminación contable: '+branch+'/'+key);
  }
 }
 for(const [uid,wallet] of Object.entries(after.wallets||{})){
  for(const field of ['balance','locked'])if(!Number.isSafeInteger(wallet[field])||wallet[field]<0)throw new Error('Saldo inválido: '+uid+'/'+field);
 }
 return after;
}
module.exports={validateAccounting};
