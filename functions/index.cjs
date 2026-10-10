'use strict';
const crypto=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createTable,joinTable,tableOperation,publicTable,passwordHash,tableFor}=require('./table-service.cjs');
initializeApp();const db=getDatabase();
const options={region:'us-central1',maxInstances:5,timeoutSeconds:30};
async function identity(request){
 const auth=request.auth,provider=auth?.token?.firebase?.sign_in_provider;
 if(!auth||!['google.com','apple.com'].includes(provider))throw new HttpsError('unauthenticated','Iniciá sesión con Google o Apple.');
 const snap=await db.ref('profiles/'+auth.uid+'/name').get();const name=snap.val();
 if(typeof name!=='string'||!name)throw new HttpsError('failed-precondition','Guardá tu nombre de usuario primero.');return {uid:auth.uid,name};
}
async function rateLimit(uid,limit=15,bucket='tables'){const now=Date.now();const r=await db.ref('creditRateLimits/'+uid+'/'+bucket).transaction(current=>{if(!current||now-current.start>=60000)return {start:now,count:1};if(current.count>=limit)return undefined;return {...current,count:current.count+1};});if(!r.committed)throw new HttpsError('resource-exhausted','Esperá un minuto antes de volver a intentar.');}
async function mutate(update){
 let failure=null;
 try{
  const result=await db.ref('creditEconomy').transaction(current=>{
   failure=null;if(current===null)return null;
   try{return update(current);}catch(error){failure=error;return undefined;}
  });
  if(!result.committed||!result.snapshot.val())throw failure||new Error('No hay créditos disponibles.');
  return result.snapshot.val();
 }catch(error){throw new HttpsError('failed-precondition',error.message||'La mesa cambió. Volvé a intentar.');}
}
async function publish(ledger,code){
 const m=tableFor(ledger,code),room=publicTable(m);
 let collision=false;
 const published=await db.ref('rooms/'+code+'/public').transaction(current=>{
  collision=!!(current&&!current.managedCredits);if(collision)return undefined;
  if(current?.managedCredits&&Number(current.revision)>m.revision)return undefined;
  return {...room,...(current?.connectionPresence?{connectionPresence:current.connectionPresence}:{})};
 });
 if(collision&&!published.committed)throw new Error('Ese código ya está en uso.');
 await Promise.all(Object.entries(m.players).map(async([player,person])=>{
  if(!person)return;
  const data={creditMatchId:m.id,revision:m.revision,handNumber:room.handNumber||1,hand:m.session?.hands?.[player]||[]};
  await db.ref('hands/'+code+'/'+person.uid).transaction(current=>Number(current?.revision)>m.revision?undefined:data);
 }));
 return {code,room,player1:m.player1,player2:m.player2};
}
exports.creditCreateTable=onCall(options,async request=>{
 const user=await identity(request);await rateLimit(user.uid);
 const {stake,targetPoints,visibility,password}=request.data||{};
 if(!['public','password'].includes(visibility))throw new HttpsError('invalid-argument','Elegí mesa pública o con clave.');
 let secret;try{secret=visibility==='password'?passwordHash(password):null;}catch(e){throw new HttpsError('invalid-argument',e.message);}
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from({length:5},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');
 if((await db.ref('rooms/'+code+'/public').get()).exists())throw new HttpsError('aborted','Volvé a intentar crear la mesa.');
 const id=crypto.randomUUID(),now=Date.now();
 const ledger=await mutate(current=>createTable(current,{...user,code,id,stake,targetPoints,secret,now}));
 try{return await publish(ledger,code);}catch(error){
  // Recover a reservation if a legacy room claimed the same code before publish.
  // Retain the receipt and let a later create choose a different code.
  if(error.message==='Ese código ya está en uso.')await mutate(current=>{
   const record=current.matches?.[id];if(!record||record.status!=='waiting')return current;
   const refunded=tableOperation(current,{code,uid:user.uid,command:{kind:'cancel'},now:Date.now()});
   delete refunded.tables[code];return refunded;
  });
  throw new HttpsError('aborted','No pudimos confirmar la mesa. Revisá el lobby antes de volver a intentar.');
 }
});
exports.creditJoinTable=onCall(options,async request=>{
 const user=await identity(request);await rateLimit(user.uid);const {code,password}=request.data||{};const now=Date.now();
 const ledger=await mutate(current=>joinTable(current,{...user,code,password,now}));return publish(ledger,code);
});
exports.creditTableAction=onCall(options,async request=>{
 const user=await identity(request);await rateLimit(user.uid,120,'actions');const {code,command,requestId,expectedMatchId}=request.data||{};
 if(!command||typeof command.kind!=='string'||!requestId||['__proto__','constructor','prototype'].includes(requestId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId))throw new HttpsError('invalid-argument','Jugada inválida.');
 if(command.kind==='tick'){
  const snapshot=await db.ref('creditEconomy').get(),current=snapshot.val();
  if(!current)throw new HttpsError('failed-precondition','La mesa no está disponible.');
  let m;try{m=tableFor(current,code);if(![m.player1,m.player2].includes(user.uid))throw new Error('No pertenecés a esta mesa.');}catch(e){throw new HttpsError('permission-denied',e.message);}
 }
 const now=Date.now();const presence=(await db.ref('rooms/'+code+'/public/connectionPresence').get()).val();
 const ledger=await mutate(current=>tableOperation(current,{code,uid:user.uid,command,requestId:command.kind==='tick'?null:requestId,expectedMatchId,presence,now}));return publish(ledger,code);
});
exports.creditExpireTables=onSchedule({schedule:'every 1 minutes',region:'us-central1',maxInstances:1},async()=>{
 const now=Date.now();let changed=[];
 const rooms=(await db.ref('rooms').get()).val()||{};
 const r=await db.ref('creditEconomy').transaction(current=>{
  if(!current)return null;let next=current;changed=[];
  for(const code of Object.keys(current.tables||{})){
   const old=tableFor(next,code);if(!['waiting','reserved'].includes(old.status))continue;
   const before=JSON.stringify(old);next=tableOperation(next,{code,uid:old.player1,command:{kind:'tick'},presence:rooms[code]?.public?.connectionPresence,now});if(before!==JSON.stringify(tableFor(next,code)))changed.push(code);
  }return next;
 });
 if(r.committed&&r.snapshot.val())await Promise.all(changed.map(code=>publish(r.snapshot.val(),code)));
});
