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
 if((await db.ref('userAccess/'+auth.uid+'/blocked').get()).val()===true)throw new HttpsError('permission-denied','Tu cuenta está bloqueada.');
 const snap=await db.ref('profiles/'+auth.uid+'/name').get();const name=snap.val();
 if(typeof name!=='string'||!name)throw new HttpsError('failed-precondition','Guardá tu nombre de usuario primero.');return {uid:auth.uid,name};
}
async function rateLimit(uid,limit=15,bucket='tables'){const now=Date.now();const r=await db.ref('creditRateLimits/'+uid+'/'+bucket).transaction(current=>{if(!current||now-current.start>=60000)return {start:now,count:1};if(current.count>=limit)return undefined;return {...current,count:current.count+1};});if(!r.committed)throw new HttpsError('resource-exhausted','Esperá un minuto antes de volver a intentar.');}
async function mutate(update,allowEmpty=false){
 let failure=null;
 try{
  const result=await db.ref('creditEconomy').transaction(current=>{
   failure=null;if(current===null&&!allowEmpty)return null;
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

// Admin permissions are server-only. Clients cannot write administrators.
const {getAuth}=require('firebase-admin/auth');
const {requireAdmin,adminLedgerChange,validKey,prepareUserDeletion,finishUserDeletion,legacyTableActive,closeLegacyTable}=require('./admin-service.cjs');
async function adminIdentity(request){
 const uid=request.auth?.uid;
 if(!uid)throw new HttpsError('unauthenticated','Iniciá sesión primero.');
 const [role,user]=await Promise.all([db.ref('administrators/'+uid).get(),getAuth().getUser(uid)]);
 try{requireAdmin(request.auth,role.val()===true&&!user.disabled);}catch{throw new HttpsError('permission-denied','Tu cuenta no tiene acceso de administrador.');}
 await rateLimit(uid,60,'admin');return uid;
}
exports.adminConsole=onCall(options,async request=>{
 const actor=await adminIdentity(request),data=request.data||{},action=data.action;
 if(action==='metrics'){
  const registeredUids=[];let token;
  do{const page=await getAuth().listUsers(1000,token);registeredUids.push(...page.users.filter(u=>u.providerData.some(p=>['google.com','apple.com'].includes(p.providerId))).map(u=>u.uid));token=page.pageToken;}while(token);
  const now=Date.now(),cutoff=uruguayDate(now-29*86400000).day;
  const [days,presence,start]=await Promise.all([db.ref('adminMetrics/days').orderByKey().startAt(cutoff).get(),db.ref('adminMetrics/presence').get(),db.ref('adminMetrics/startedAt').get()]);
  return activitySummary({registeredUids,now,metrics:{days:days.val()||{},presence:presence.val()||{},startedAt:start.val()}});
 }
 if(action==='delete'){
  let failure;
  const prepared=await db.ref().transaction(root=>{
   failure=null;if(!root)return null;try{return prepareUserDeletion(root,{...data,actor,now:Date.now()});}catch(e){failure=e.message;return undefined;}
  });
  if(!prepared.committed)throw new HttpsError('failed-precondition',failure||'No se pudo preparar la eliminación.');
  try{await getAuth().deleteUser(data.uid);}catch(e){if(e.code!=='auth/user-not-found')throw new HttpsError('internal','No se pudo eliminar la cuenta. Reintentá el mismo cambio.');}
  const done=await db.ref().transaction(root=>{
   failure=null;if(!root)return null;try{return finishUserDeletion(root,{uid:data.uid,requestId:data.requestId,now:Date.now()});}catch(e){failure=e.message;return undefined;}
  });
  if(!done.committed)throw new HttpsError('internal','La cuenta fue eliminada pero falta limpiar el perfil. Reintentá el mismo cambio.');return {ok:true};
 }
 if(action==='users'){
  let page;
  if(data.scope&&data.scope!=='all'){
   if(!['active','today'].includes(data.scope))throw new HttpsError('invalid-argument','Filtro inválido.');
   const now=Date.now(),scope=data.scope;
   const snapshot=await db.ref(scope==='active'?'adminMetrics/presence':'adminMetrics/days/'+uruguayDate(now).day+'/users').get();
   const metrics=scope==='active'?{presence:snapshot.val()||{}}:{days:{[uruguayDate(now).day]:{users:snapshot.val()||{}}}};
   const ids=require('./activity-service.cjs').activityUserIds({scope,metrics,now});
   const offset=data.pageToken?Number(data.pageToken):0;
   if(!Number.isSafeInteger(offset)||offset<0)throw new HttpsError('invalid-argument','Página inválida.');
   const batch=ids.slice(offset,offset+100);
   const result=batch.length?await getAuth().getUsers(batch.map(uid=>({uid}))):{users:[]};
   page={users:result.users,pageToken:offset+100<ids.length?String(offset+100):null};
  }else page=await getAuth().listUsers(100,data.pageToken||undefined);
  const users=await Promise.all(page.users.filter(u=>!u.providerData.every(p=>!['google.com','apple.com'].includes(p.providerId))).map(async u=>{
   const [profile,wallet]=await Promise.all([db.ref('profiles/'+u.uid).get(),db.ref('creditEconomy/wallets/'+u.uid).get()]);
   return {uid:u.uid,email:u.email||'',name:profile.val()?.name||'',disabled:u.disabled,createdAt:u.metadata.creationTime,balance:wallet.val()?.balance??0,locked:wallet.val()?.locked??0};
  }));
  return {users,pageToken:page.pageToken||null};
 }
 if(action==='tables'){
  const ledger=(await db.ref('creditEconomy').get()).val()||{};
  const userAudit=(await db.ref('adminUserAudit').get()).val()||{};
  const rooms=(await db.ref('rooms').get()).val()||{};
  const legacy=Object.entries(rooms).filter(([code,entry])=>!ledger.tables?.[code]&&legacyTableActive(entry?.public,Date.now())).map(([code,{public:room}])=>({code,status:room.status,stake:0,targetPoints:room.targetPoints||30,players:Object.values(room.players||{}).map(p=>p.name||p.uid)}));
  return {tables:[...legacy,...Object.entries(ledger.tables||{}).map(([code])=>{const m=tableFor(ledger,code);return {code,status:m.closedAt?'closed':m.status,stake:m.stake,targetPoints:m.targetPoints,players:Object.values(m.players||{}).map(p=>p.name)};}).filter(m=>['waiting','reserved','settled'].includes(m.status))],
   audit:[...Object.values(ledger.adminAudit||{}),...Object.values(userAudit)].sort((a,b)=>b.at-a.at).slice(0,100)};
 }
 if(action==='close-table'&&!validKey(data.code))throw new HttpsError('invalid-argument','Mesa inválida.');
 if(action==='close-table'&&!(await db.ref('creditEconomy/tables/'+String(data.code)).get()).exists()){
  let failure;const result=await db.ref().transaction(root=>{failure=null;try{return closeLegacyTable(root,{...data,actor,now:Date.now()});}catch(error){failure=error.message;return undefined;}});
  if(!result.committed)throw new HttpsError('failed-precondition',failure||'No se pudo cerrar la mesa.');
  return {ok:true};
 }
 if(['credits','close-table'].includes(action)){
  if(action==='credits'){if(!validKey(data.uid))throw new HttpsError('invalid-argument','Usuario inválido.');await getAuth().getUser(data.uid);}
  const ledger=await mutate(current=>adminLedgerChange(current,{...data,actor,now:Date.now()}),true);
  if(action==='close-table')await publish(ledger,data.code);
  return {ok:true};
 }
 if(action==='rename'){
  if(!validKey(data.uid)||!validKey(data.requestId)||typeof data.name!=='string'||!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9._-]{1,18}$/.test(data.name)||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>200)throw new HttpsError('invalid-argument','Nombre o motivo inválido.');
  if((await db.ref('userAccess/'+data.uid).get()).val()?.deleting)throw new HttpsError('failed-precondition','La cuenta está siendo eliminada.');await getAuth().getUser(data.uid);let failure;
  const r=await db.ref().transaction(root=>{
   failure=null;if(!root)return null;
   const receipt=root.adminUserAudit?.[data.requestId];
   if(receipt){if(receipt.actor!==actor||receipt.uid!==data.uid||receipt.after!==data.name)failure='Solicitud reutilizada.';return failure?undefined:root;}
   const key=data.name.toLowerCase().replaceAll('.','%2E'),owner=root.usernames?.[key];
   if(owner&&owner!==data.uid){failure='Ese nombre ya está en uso.';return undefined;}
   if(root.userAccess?.[data.uid]?.deleting||root.userAccess?.[data.uid]?.deletedAt){failure='La cuenta está siendo eliminada.';return undefined;}
   const old=root.profiles?.[data.uid]?.name;
   root.profiles??={};root.profiles[data.uid]={name:data.name};root.usernames??={};root.usernames[key]=data.uid;
   if(old){const oldKey=old.toLowerCase().replaceAll('.','%2E');if(oldKey!==key&&root.usernames[oldKey]===data.uid)delete root.usernames[oldKey];}
   root.adminUserAudit??={};root.adminUserAudit[data.requestId]={actor,uid:data.uid,action:'rename',before:old||null,after:data.name,reason:data.reason,at:Date.now()};return root;
  });
  if(!r.committed)throw new HttpsError('failed-precondition',failure||'No se pudo cambiar el nombre.');return {ok:true};
 }
 if(action==='block'){
  if(!validKey(data.uid)||typeof data.disabled!=='boolean'||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>200||!validKey(data.requestId))throw new HttpsError('invalid-argument','Usuario o motivo inválido.');
  if(data.uid===actor||(await db.ref('administrators/'+data.uid).get()).val()===true)throw new HttpsError('failed-precondition','No podés bloquear una cuenta administradora.');
  if((await db.ref('userAccess/'+data.uid).get()).val()?.deleting)throw new HttpsError('failed-precondition','La cuenta está siendo eliminada.');
  const updateAccess=async blocked=>{const changed=await db.ref('userAccess/'+data.uid).transaction(current=>current?.deleting||current?.deletedAt?undefined:{...current,blocked});if(!changed.committed)throw new HttpsError('failed-precondition','La cuenta está siendo eliminada.');};
  if(data.disabled)await updateAccess(true);
  await getAuth().updateUser(data.uid,{disabled:data.disabled});
  if(!data.disabled)await updateAccess(false);
  if(data.disabled)await getAuth().revokeRefreshTokens(data.uid);
  await db.ref('adminUserAudit/'+data.requestId).set({actor,uid:data.uid,action:'block',after:data.disabled,reason:data.reason,at:Date.now()});return {ok:true};
 }
 throw new HttpsError('invalid-argument','Acción inválida.');
});

const {uruguayDate,activityUpdates,activitySummary}=require('./activity-service.cjs');
exports.playerActivity=onCall({...options,maxInstances:3},async request=>{
 const user=await identity(request);await rateLimit(user.uid,10,'activity');
 const now=Date.now();let updates;
 try{updates=activityUpdates({uid:user.uid,sessionId:request.data?.sessionId,visible:request.data?.visible,now});}catch(e){throw new HttpsError('invalid-argument',e.message);}
 await db.ref('adminMetrics').update(updates);
 await db.ref('adminMetrics/startedAt').transaction(current=>current||now);
 return {ok:true};
});
exports.activityCleanup=onSchedule({schedule:'every day 04:00',timeZone:'America/Montevideo',region:'us-central1',maxInstances:1},async()=>{
 const now=Date.now(),cutoff=uruguayDate(now-29*86400000).day;
 await db.ref('adminMetrics').transaction(metrics=>{
  if(!metrics)return null;
  for(const day of Object.keys(metrics.days||{}))if(day<cutoff)delete metrics.days[day];
  for(const [uid,sessions] of Object.entries(metrics.presence||{})){
   for(const [id,session] of Object.entries(sessions))if(now-session.at>=90000)delete sessions[id];
   if(!Object.keys(sessions).length)delete metrics.presence[uid];
  }
  return metrics;
 });
});
