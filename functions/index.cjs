'use strict';
const crypto=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase,ServerValue}=require('firebase-admin/database');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createTable,joinTable,tableOperation,publicTable,privateTableHand,passwordHash,tableFor}=require('./table-service.cjs');
const {recordHistory}=require('./history-service.cjs');
const {validateAccounting}=require('./accounting-guard.cjs');
const {loadedTransaction}=require('./loaded-transaction.cjs');
const {tryLiveAction,withMatchPreload}=require('./live-match.cjs');
const {hasStartedMatch}=require('./match-start.cjs');
const {reservationAlerts,repairReservation,personalHistory}=require('./player-service.cjs');
const {usersBlockEachOther}=require('./user-blocks.cjs');
initializeApp();const sdkDb=getDatabase();
const {AsyncLocalStorage}=require('node:async_hooks'),gameDatabase=new AsyncLocalStorage();
const restDb=require('./rest-database.cjs').createRestDatabase({baseUrl:require('firebase-admin/app').getApp().options.databaseURL||sdkDb.ref().toString(),getAccessToken:()=>require('firebase-admin/app').getApp().options.credential.getAccessToken()});
const gameTransport=process.env.TRUCO_GAME_TRANSPORT==='rest'?restDb:sdkDb;
const ledgerWarmup=require('./database-warmup.cjs').createLedgerWarmup(sdkDb);
const warmGameDatabase=()=>gameTransport===sdkDb?ledgerWarmup.warm():Promise.resolve();
const db=new Proxy(sdkDb,{get(target,key){const selected=gameDatabase.getStore()||target,value=selected[key];return typeof value==='function'?value.bind(selected):value;}});
const {defineSecret}=require('firebase-functions/params');
const liveInternalSecret=defineSecret('LIVE_INTERNAL_SECRET');
// Every callable can reach the Cloudflare credit bank through the table server.
const options={region:'us-central1',maxInstances:5,timeoutSeconds:30,secrets:[liveInternalSecret]};
const creditStore=require('./credit-store.cjs').createCreditStore({db:sdkDb,secret:()=>liveInternalSecret.value()});
const {closeLiveTable}=require('./live-server.cjs');
// Ad rewards credit Firebase wallets; they stay off once credits live in the bank.
const rewardIdentity=async request=>{if(await creditStore.isActive())throw new HttpsError('failed-precondition','Las recompensas no están disponibles.');return identity(request);};
Object.assign(exports,require('./ad-rewards.cjs').createRewardFunctions({db,identity:rewardIdentity,rateLimit,options}));
// Friends and table invitations with push notifications.
Object.assign(exports,require('./social.cjs').createSocialFunctions({db,identity,rateLimit,options,readLedger:()=>creditStore.readLedger(),usersBlockEachOther}));
async function identity(request){
 const auth=request.auth,provider=auth?.token?.firebase?.sign_in_provider;
 if(!auth||!['google.com','apple.com','password'].includes(provider))throw new HttpsError('unauthenticated','Iniciá sesión con tu cuenta.');
 const [access,snap]=await Promise.all([db.ref('userAccess/'+auth.uid+'/blocked').once('value'),db.ref('profiles/'+auth.uid+'/name').once('value')]);
 if(access.val()===true)throw new HttpsError('permission-denied','Tu cuenta está bloqueada.');
 const name=snap.val();
 if(typeof name!=='string'||!name)throw new HttpsError('failed-precondition','Guardá tu nombre de usuario primero.');return {uid:auth.uid,name};
}
async function actionIdentity(request){
 const auth=request.auth,provider=auth?.token?.firebase?.sign_in_provider;
 if(!auth||!['google.com','apple.com','password'].includes(provider))throw new HttpsError('unauthenticated','Iniciá sesión con tu cuenta.');
 if((await db.ref('userAccess/'+auth.uid+'/blocked').once('value')).val()===true)throw new HttpsError('permission-denied','Tu cuenta está bloqueada.');
 // Names and credit eligibility were checked when joining this match.
 return {uid:auth.uid};
}
async function rateLimit(uid,limit=15,bucket='tables'){const now=Date.now();const r=await loadedTransaction(db.ref('creditRateLimits/'+uid+'/'+bucket),current=>{if(!current||now-current.start>=60000)return {start:now,count:1};if(current.count>=limit)return undefined;return {...current,count:current.count+1};});if(!r.committed)throw new HttpsError('resource-exhausted','Esperá un minuto antes de volver a intentar.');}
async function mutate(update,allowEmpty=false,context={}){
 let failure=null;
 try{
  if(await creditStore.isActive()){
   const result=await creditStore.patchBank(current=>{
    failure=null;if(!Object.keys(current).length&&!allowEmpty)return undefined;
    try{return validateAccounting(current,recordHistory(current,update(current),Date.now()));}catch(error){failure=error;return undefined;}
   });
   if(!result.committed)throw failure||new Error('No hay créditos disponibles.');
   return result.value;
  }
  const result=await loadedTransaction(db.ref('creditEconomy'),current=>{
   failure=null;if(current===null&&!allowEmpty)return undefined;
   try{return validateAccounting(current,recordHistory(current,update(current),Date.now()));}catch(error){failure=error;return undefined;}
  });
  if(!result.committed||!result.snapshot.val())throw failure||new Error('No hay créditos disponibles.');
  return result.snapshot.val();
 }catch(error){console.error('Accounting operation rejected',{...context,error:error.message});throw new HttpsError('failed-precondition',error.message||'La mesa cambió. Volvé a intentar.');}
}
// Tables run on the Cloudflare table server once credits live in the bank;
// these functions only serve app versions from before that switch.
async function refuseOldTables(){if(await creditStore.isActive())throw new HttpsError('failed-precondition','Actualizá el juego para jugar en línea.');}
function measured(stages,key,task){const at=Date.now();return Promise.resolve(task).finally(()=>{stages[key]=Date.now()-at;});}
async function publish(ledger,code){
 const m=tableFor(ledger,code),room=publicTable(m);
 let collision=false;
 const publicWrite=loadedTransaction(db.ref('rooms/'+code+'/public'),current=>{
  collision=!!(current&&!current.managedCredits);if(collision)return undefined;
  if(current?.managedCredits&&Number(current.revision)>=m.revision)return undefined;
  return {...room,...(current?.connectionPresence?{connectionPresence:current.connectionPresence}:{})};
 });
 const handWrites=Object.entries(m.players).map(async([player,person])=>{
  if(!person)return;
  const data=privateTableHand(m,player);
  await loadedTransaction(db.ref('hands/'+code+'/'+person.uid),current=>Number(current?.revision)>=m.revision?undefined:data);
 });
 const [published]=await Promise.all([publicWrite,...handWrites]);
 if(collision&&!published.committed)throw new Error('Ese código ya está en uso.');
 return {code,room,player1:m.player1,player2:m.player2};
}
async function createTableRequest(request){
 await refuseOldTables();
 const started=Date.now(),stages={};
 const [user]=await Promise.all([measured(stages,'identityMs',identity(request)),request.auth?measured(stages,'rateLimitMs',rateLimit(request.auth.uid)):Promise.resolve()]);
 const {stake,targetPoints,visibility,password,mode='1v1'}=request.data||{};
 if(!['public','password'].includes(visibility))throw new HttpsError('invalid-argument','Elegí mesa pública o con clave.');
 let secret;try{secret=visibility==='password'?passwordHash(password):null;}catch(e){throw new HttpsError('invalid-argument',e.message);}
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from({length:5},()=>alphabet[crypto.randomInt(alphabet.length)]).join('');
 if((await db.ref('rooms/'+code+'/public').once('value')).exists())throw new HttpsError('aborted','Volvé a intentar crear la mesa.');
 const id=crypto.randomUUID(),now=Date.now();
 const ledger=await measured(stages,'accountingMs',mutate(current=>createTable(current,{...user,code,id,stake,targetPoints,mode,secret,now})));
 try{const result=await measured(stages,'projectionMs',publish(ledger,code));return {...result,privateHand:privateTableHand(tableFor(ledger,code),'player1'),timing:{...stages,totalMs:Date.now()-started}};}catch(error){
  // Recover a reservation if a legacy room claimed the same code before publish.
  // Retain the receipt and let a later create choose a different code.
  if(error.message==='Ese código ya está en uso.')await mutate(current=>{
   const record=current.matches?.[id];if(!record||record.status!=='waiting')return current;
   const refunded=tableOperation(current,{code,uid:user.uid,command:{kind:'cancel'},now:Date.now()});
   delete refunded.tables[code];return refunded;
  });
  throw new HttpsError('aborted','No pudimos confirmar la mesa. Revisá el lobby antes de volver a intentar.');
 }finally{console.info('Table entry timing',{kind:'create',...stages,totalMs:Date.now()-started});}
}
exports.creditCreateTable=onCall(options,request=>gameDatabase.run(gameTransport,()=>createTableRequest(request)));
async function joinTableRequest(request){
 await refuseOldTables();
 const started=Date.now(),stages={}, {code,password,team}=request.data||{};
 if(!request.auth)await identity(request);
 if(typeof code!=='string'||!/^[A-Z2-9]{5}$/.test(code))throw new HttpsError('invalid-argument','Mesa inválida.');
 const readTable=async()=>{const id=(await db.ref('creditEconomy/tables/'+code).once('value')).val();if(typeof id!=='string')throw new HttpsError('failed-precondition','La mesa ya no está disponible.');const match=(await db.ref('creditEconomy/matches/'+id).once('value')).val();return tableFor({tables:{[code]:id},matches:{[id]:match}},code);};
 try{
  const [user,,table]=await Promise.all([measured(stages,'identityMs',identity(request)),request.auth?measured(stages,'rateLimitMs',rateLimit(request.auth.uid)):Promise.resolve(),measured(stages,'lookupMs',readTable())]);
  if((await measured(stages,'blocksMs',Promise.all(Object.values(table.players||{}).filter(person=>person?.uid).map(person=>usersBlockEachOther(db,user.uid,person.uid))))).some(Boolean))throw new HttpsError('failed-precondition','No pueden entrar a la misma mesa porque uno bloqueó al otro.');
  const ledger=await measured(stages,'accountingMs',mutate(current=>joinTable(current,{...user,code,password,team,now:Date.now()})));
  const result=await measured(stages,'projectionMs',publish(ledger,code)),m=tableFor(ledger,code),seat=Object.keys(m.players).find(p=>m.players[p]?.uid===user.uid);
  return {...result,privateHand:seat?privateTableHand(m,seat):null,timing:{...stages,totalMs:Date.now()-started}};
 }finally{console.info('Table entry timing',{kind:'join',...stages,totalMs:Date.now()-started});}
}
exports.creditJoinTable=onCall(options,request=>gameDatabase.run(gameTransport,()=>joinTableRequest(request)));
async function tableActionRequest(request){
 await refuseOldTables();
 return withMatchPreload(db,request,()=>tableActionCore(request));
}
async function tableActionCore(request){
 const started=Date.now(),stages={};const {code,command,requestId,expectedMatchId}=request.data||{};
 if(!command||typeof command.kind!=='string'||!requestId||['__proto__','constructor','prototype'].includes(requestId)||!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)){await identity(request);await rateLimit(request.auth.uid,120,'actions');throw new HttpsError('invalid-argument','Jugada inválida.');}
 const [user,presenceSnapshot]=await Promise.all([measured(stages,'identityMs',actionIdentity(request)),command.kind==='tick'?db.ref('rooms/'+code+'/public/connectionPresence').once('value'):Promise.resolve(null)]);
 if(command.kind==='rematch'){
  let currentMatch;try{currentMatch=tableFor((await db.ref('creditEconomy').once('value')).val()||{},code);}catch(error){throw new HttpsError('failed-precondition',error.message||'La partida ya no está disponible.');}
  const people=Object.values(currentMatch.players||{});for(let a=0;a<people.length;a++)for(let b=a+1;b<people.length;b++)if(await usersBlockEachOther(db,people[a].uid,people[b].uid))throw new HttpsError('failed-precondition','No pueden iniciar una revancha porque hay jugadores bloqueados.');
 }
 // Membership and match identity are checked atomically by tableOperation,
 // including ticks; do not pre-read the entire historical ledger for a tick.
 const now=Date.now(),presence=presenceSnapshot?.val();
 const parameters={code,uid:user.uid,command,requestId:command.kind==='tick'?null:requestId,expectedMatchId,presence,now,enforceRateLimit:true};
 let live;try{live=await tryLiveAction(db,parameters);}catch(error){if(error.code==='resource-exhausted')throw new HttpsError(error.code,error.message);throw error;}
 // Ordinary moves share their abuse counter with the atomic match update.
 // Invalid moves and accounting transitions retain the global limiter.
 if(!live)await measured(stages,'rateLimitMs',rateLimit(user.uid,command.kind==='tick'?60:120,command.kind==='tick'?'ticks':'actions'));
 const ledger=live||await mutate(current=>tableOperation(current,parameters),false,{code,uid:user.uid,kind:command.kind,requestId});
 const saved=Date.now(),m=tableFor(ledger,code);
 const result=ledger.liveUnchanged?{code,room:publicTable(m),player1:m.player1,player2:m.player2}:await publish(ledger,code);
 if(command.kind!=='tick')console.info('Game action timing',{kind:command.kind,path:live?'match':'accounting',...stages,validationMs:now-started,transactionMs:saved-now,projectionMs:Date.now()-saved,totalMs:Date.now()-started});
 const seat=Object.keys(m.players).find(p=>m.players[p]?.uid===user.uid);
 return {...result,privateHand:seat?privateTableHand(m,seat):null};
}
exports.creditTableAction=onCall(options,request=>gameDatabase.run(gameTransport,()=>tableActionRequest(request)));
exports.creditGame=onCall({...options,concurrency:16,memory:'512MiB'},request=>gameDatabase.run(gameTransport,async()=>{
 const auth=request.auth,provider=auth?.token?.firebase?.sign_in_provider;
 if(!auth||!['google.com','apple.com','password'].includes(provider))throw new HttpsError('unauthenticated','Iniciá sesión con tu cuenta.');
 const operation=request.data?.operation;
 if(operation==='warm'){await Promise.all([actionIdentity(request),warmGameDatabase()]);return {ready:true};}
 const handlers={creditCreateTable:createTableRequest,creditJoinTable:joinTableRequest,creditTableAction:tableActionRequest};
 if(!Object.hasOwn(handlers,operation))throw new HttpsError('invalid-argument','Operación inválida.');
 if(operation!=='creditTableAction')void warmGameDatabase().catch(error=>console.warn('Entry cache warmup failed',error.message));
 return handlers[operation]({...request,auth:request.auth,data:request.data.payload});
}));
exports.creditExpireTables=onSchedule({schedule:'every 1 minutes',region:'us-central1',maxInstances:1,secrets:[liveInternalSecret]},async()=>{
 // The table server expires its own tables; never touch the frozen copy.
 if(await creditStore.isActive().catch(()=>true))return;
 const now=Date.now();let changed=[];
 const rooms=(await db.ref('rooms').once('value')).val()||{};
 const r=await loadedTransaction(db.ref('creditEconomy'),current=>{
  if(!current)return undefined;let next=current;changed=[];
  for(const code of Object.keys(current.tables||{})){
   const old=tableFor(next,code);if(!['waiting','reserved'].includes(old.status)||old.live==='cloudflare')continue;
   const before=JSON.stringify(old);next=tableOperation(next,{code,uid:old.player1,command:{kind:'tick'},presence:rooms[code]?.public?.connectionPresence,now});if(before!==JSON.stringify(tableFor(next,code)))changed.push(code);
  }return validateAccounting(current,recordHistory(current,next,now));
 });
 if(r.committed&&r.snapshot.val())await Promise.all(changed.map(code=>publish(r.snapshot.val(),code)));
});

// Admin permissions are server-only. Clients cannot write administrators.
const {getAuth}=require('firebase-admin/auth');
const adminMessages=require('./admin-messages.cjs');
const alertAdmin=require('./social.cjs').adminAlerter(db);
const pushToPlayer=require('./social.cjs').pushSender(db);
const {pastWins,tableEvents,requireAdmin,adminLedgerChange,validKey,prepareUserDeletion,finishUserDeletion,legacyTableActive,closeLegacyTable,adminTableCurrent}=require('./admin-service.cjs');
async function adminIdentity(request){
 const uid=request.auth?.uid;
 if(!uid)throw new HttpsError('unauthenticated','Iniciá sesión primero.');
 const [role,user]=await Promise.all([db.ref('administrators/'+uid).get(),getAuth().getUser(uid)]);
 try{requireAdmin(request.auth,role.val()===true&&!user.disabled);}catch{throw new HttpsError('permission-denied','Tu cuenta no tiene acceso de administrador.');}
 await rateLimit(uid,60,'admin');return uid;
}
const {prepareSelfDeletion,prepareAdminPrivacyDeletion,erasePlayerData}=require('./self-deletion.cjs');
async function completeSelfDeletion(uid,job){
 let failure;
 const result=await creditStore.rootTransaction(root=>{
  try{const next=erasePlayerData(root,{uid,anonymousId:job.anonymousId,now:Date.now()});next.userAccess[uid].deletionRequestId=job.requestId;return next;}catch(e){failure=e;return undefined;}
 });
 if(!result.committed)throw failure||new Error('No se pudieron limpiar los datos.');
 try{await getAuth().deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 await db.ref('accountDeletionJobs/'+uid).remove();
}
exports.deleteMyAccount=onCall({...options,timeoutSeconds:120},async request=>{
 const uid=request.auth?.uid,data=request.data||{};
 if(!uid||!['google.com','apple.com','password'].includes(request.auth.token?.firebase?.sign_in_provider))throw new HttpsError('unauthenticated','Iniciá sesión con tu cuenta.');
 if(!['check','delete'].includes(data.action))throw new HttpsError('invalid-argument','Acción inválida.');
 const existing=(await db.ref('accountDeletionJobs/'+uid).get()).val();
 if(existing){await completeSelfDeletion(uid,existing);return {ok:true};}
 const requestId=crypto.randomUUID();
 if(data.action==='check'){
  try{prepareSelfDeletion(await creditStore.readRoot(),{uid,requestId,now:Date.now()});}catch(e){throw new HttpsError('failed-precondition',e.message);}
  return {ok:true};
 }
 if(!Number.isFinite(Number(request.auth.token.auth_time))||Date.now()/1000-Number(request.auth.token.auth_time)>300)throw new HttpsError('unauthenticated','Verificá tu identidad nuevamente.');
 const job={anonymousId:'deleted_'+crypto.randomUUID(),requestId,at:Date.now()};
 let failure;
 const prepared=await creditStore.rootTransaction(root=>{
  try{const next=prepareSelfDeletion(root,{uid,requestId,now:job.at});next.accountDeletionJobs??={};next.accountDeletionJobs[uid]=job;return next;}catch(e){failure=e.message;return undefined;}
 });
 if(!prepared.committed)throw new HttpsError('failed-precondition',failure||'No se pudo preparar la eliminación.');
 try{await completeSelfDeletion(uid,job);}catch(e){console.error('Account deletion pending',e.code||'internal');throw new HttpsError('internal','Tu eliminación está en proceso. La completaremos automáticamente.');}
 return {ok:true};
});
exports.finishAccountDeletions=onSchedule({schedule:'every 5 minutes',region:'us-central1',timeoutSeconds:120,maxInstances:1,secrets:[liveInternalSecret]},async()=>{
 for(const [uid,job] of Object.entries((await db.ref('accountDeletionJobs').get()).val()||{}))await completeSelfDeletion(uid,job);
});
exports.adminConsole=onCall({...options,secrets:[liveInternalSecret]},async request=>{
 const actor=await adminIdentity(request),data=request.data||{},action=data.action;
 if(action==='repair-reservation'){
  if(!validKey(data.uid))throw new HttpsError('invalid-argument','Usuario inválido.');
  const repairId=crypto.randomUUID();
  const ledger=await mutate(current=>{const now=Date.now(),next=repairReservation(current,{uid:data.uid,now});next.adminAudit??={};next.adminAudit[repairId]={actor,action:'repair-reservation',uid:data.uid,reason:'Resolver una reserva vencida o pendiente de liquidación',at:now};return next;});
  for(const m of Object.values(ledger.matches||{}).filter(m=>Object.values(m.players||{}).some(p=>p.uid===data.uid)&&ledger.tables?.[m.code]===m.id))await publish(ledger,m.code);
  return {ok:true};
 }
 if(action==='metrics'){
  const registeredUids=[],signups=[];let token;
  do{const page=await getAuth().listUsers(1000,token);const real=page.users.filter(u=>u.providerData.some(p=>['google.com','apple.com','password'].includes(p.providerId)));registeredUids.push(...real.map(u=>u.uid));for(const u of real)signups.push({uid:u.uid,email:u.email||'',at:Date.parse(u.metadata.creationTime)||0});token=page.pageToken;}while(token);
  const now=Date.now(),cutoff=uruguayDate(now-29*86400000).day;
  const visitStart=uruguayDate(now-(VISIT_DAYS-1)*86400000).day;
  const [days,presence,start,visits,testVisits,testUsers]=await Promise.all([db.ref('adminMetrics/days').orderByKey().startAt(cutoff).get(),db.ref('adminMetrics/presence').get(),db.ref('adminMetrics/startedAt').get(),db.ref('adminMetrics/visits').orderByKey().startAt(visitStart).get(),db.ref('adminMetrics/visitsTest').orderByKey().startAt(visitStart).get(),db.ref('adminConfig/testUsers').get()]);
  const testUids=Object.keys(testUsers.val()||{}),include=data.includeTest===true;
  // Without test data: test accounts leave the totals and test visits stay in their own counters.
  const activity=include?{days:days.val()||{},presence:presence.val()||{}}:withoutTestActivity({days:days.val()||{},presence:presence.val()||{}},new Set(testUids));
  const counted=include?registeredUids:registeredUids.filter(uid=>!testUids.includes(uid));
  const visitCounters=include?mergeVisitCounters(visits.val()||{},testVisits.val()||{}):visits.val()||{};
  // Who signed up each day of the visits window, with their game name.
  const windowStart=Date.parse(visitStart+'T03:00:00Z'),recent=signups.filter(s=>s.at>=windowStart&&(include||!testUids.includes(s.uid)));
  const signupNames=await Promise.all(recent.map(s=>db.ref('profiles/'+s.uid+'/name').get()));
  const registrations={};recent.forEach((s,i)=>{const day=uruguayDate(s.at).day;(registrations[day]??=[]).push({uid:s.uid,name:signupNames[i].val()||'',email:s.email,at:s.at});});
  for(const list of Object.values(registrations))list.sort((a,b)=>a.at-b.at);
  const record=(await db.ref('adminMetrics/concurrentRecord/'+(include?'all':'real')).get()).val()||null;
  return {registrations,concurrentRecord:record,...activitySummary({registeredUids:counted,now,concurrentKey:include?'all':'real',metrics:{...activity,startedAt:start.val()}}),visits:visitSummary({visits:visitCounters,now,days:VISIT_DAYS}),testUids,includeTest:include};
 }
 if(action==='visitors'){
  let range;try{range=visitRange({...data,now:Date.now()});}catch(e){throw new HttpsError('invalid-argument',e.message);}
  const [log,activity]=await Promise.all(['visitLog','days'].map(key=>db.ref('adminMetrics/'+key).orderByKey().startAt(range.from).endAt(range.to).get()));
  const testUids=data.includeTest===true?null:new Set(Object.keys((await db.ref('adminConfig/testUsers').get()).val()||{}));
  const result=visitorsInRange({log:log.val()||{},activity:activity.val()||{},platform:range.platform,page:range.page,hour:range.hour,exclude:testUids});
  result.players=result.players.slice(0,300);
  const names=await Promise.all(result.players.map(p=>db.ref('profiles/'+p.uid+'/name').get()));
  result.players=result.players.map((p,i)=>({...p,name:names[i].val()||''}));
  return result;
 }
 if(action==='test-user'){
  if(!validKey(data.uid)||typeof data.test!=='boolean')throw new HttpsError('invalid-argument','Usuario inválido.');
  await db.ref('adminConfig/testUsers/'+data.uid).set(data.test||null);
  // Their visits already logged move to (or back from) the test counters.
  const log=(await db.ref('adminMetrics/visitLog').get()).val()||{},moved=[],flags={};
  for(const [day,records] of Object.entries(log))for(const [id,r] of Object.entries(records||{}))if(r?.uid===data.uid&&Number.isFinite(r.at)&&!!r.test!==data.test){moved.push(r);flags['visitLog/'+day+'/'+id+'/test']=data.test||null;}
  if(moved.length)await db.ref('adminMetrics').update({...moveVisitsUpdates(moved,data.test,ServerValue.increment),...flags});
  return {ok:true,moved:moved.length};
 }
 if(action==='delete'){
  let failure;
  const anonymousId='deleted_'+crypto.randomUUID();
  const prepared=await creditStore.rootTransaction(root=>{
   failure=null;if(!root)return undefined;
   try{return prepareAdminPrivacyDeletion(root,{...data,actor,anonymousId,now:Date.now()});}catch(e){failure=e.message;return undefined;}
  });
  if(!prepared.committed)throw new HttpsError('failed-precondition',failure||'No se pudo preparar la eliminación.');
  const next=prepared.snapshot.val();
  const job=next.accountDeletionJobs?.[data.uid];
  if(!job&&next.userAccess?.[data.uid]?.deletionRequestId===data.requestId)return {ok:true};
  try{await completeSelfDeletion(data.uid,job);}catch(e){console.error('Admin account deletion pending',e.code||'internal');throw new HttpsError('internal','La eliminación está en proceso. Se completará automáticamente.');}
  return {ok:true};
 }
 // Messages to players: send one, list the conversations, mark a player's answers as seen.
 // Starting levels from the wins already played (only for people without a level yet).
 if(action==='levels-backfill'){
  const wins=pastWins(await creditStore.readLedger()),now=Date.now();let seeded=0;
  for(const [uid,count] of Object.entries(wins)){const r=await db.ref('levels/'+uid).transaction(current=>current?undefined:{points:count*10,wins:count,seededAt:now});if(r.committed)seeded++;}
  return {players:Object.keys(wins).length,seeded};
 }
 if(action==='send-message'){
  if(!validKey(data.uid))throw new HttpsError('invalid-argument','Usuario inválido.');
  let text;try{text=adminMessages.cleanText(data.text);}catch(e){throw new HttpsError('invalid-argument',e.message);}
  try{await getAuth().getUser(data.uid);}catch{throw new HttpsError('not-found','No encontramos a ese jugador.');}
  const id=crypto.randomUUID(),now=Date.now();
  await db.ref().update(adminMessages.sendUpdates({uid:data.uid,id,text,now,actor}));
  await pushToPlayer(data.uid,{title:'Mensaje del administrador',body:text.length>120?text.slice(0,117)+'…':text,data:{type:'admin-message',messageId:id}}).catch(()=>0);
  return {ok:true,id};
 }
 if(action==='messages'){
  const threads=(await db.ref('adminThreads').get()).val()||{},uids=Object.keys(threads);
  const names=Object.fromEntries(await Promise.all(uids.map(async uid=>[uid,(await db.ref('profiles/'+uid+'/name').get()).val()||''])));
  return {threads:adminMessages.threadList(threads,names)};
 }
 if(action==='messages-seen'){
  if(!validKey(data.uid))throw new HttpsError('invalid-argument','Usuario inválido.');
  const thread=(await db.ref('adminThreads/'+data.uid).get()).val()||{},updates={};
  for(const [id,m] of Object.entries(thread))if(m?.from==='player'&&m.seen===false)updates['adminThreads/'+data.uid+'/'+id+'/seen']=true;
  if(Object.keys(updates).length)await db.ref().update(updates);
  return {ok:true};
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
  const users=await Promise.all(page.users.filter(u=>!u.providerData.every(p=>!['google.com','apple.com','password'].includes(p.providerId))).map(async u=>{
   const [profile,wallet,points]=await Promise.all([db.ref('profiles/'+u.uid).get(),creditStore.wallet(u.uid).then(value=>({val:()=>value})),db.ref('levels/'+u.uid+'/points').get()]);
   return {uid:u.uid,email:u.email||'',name:profile.val()?.name||'',disabled:u.disabled,createdAt:u.metadata.creationTime,balance:wallet.val()?.balance??0,locked:wallet.val()?.locked??0,points:Number(points.val())||0};
  }));
  return {users,pageToken:page.pageToken||null};
 }
 if(action==='tables'){
  const ledger=await creditStore.readLedger();
  const userAudit=(await db.ref('adminUserAudit').get()).val()||{};
  const reports=(await db.ref('problemReports').get()).val()||{};
  const rooms=(await db.ref('rooms').get()).val()||{};
  const legacy=Object.entries(rooms).filter(([code,entry])=>!ledger.tables?.[code]&&legacyTableActive(entry?.public,Date.now())).map(([code,{public:room}])=>({code,status:room.status,stake:0,targetPoints:room.targetPoints||30,players:Object.values(room.players||{}).map(p=>p.name||p.uid),createdAt:room.createdAt||null,finishedAt:room.matchResult?.at||null}));
  const now=Date.now(),tables=[],archivedTables=[...legacy.map(m=>({...m,status:'Sistema anterior'}))];
  for(const [id,m] of Object.entries(ledger.matches||{})){
   if(!hasStartedMatch(m))continue;
   const code=m.code||Object.entries(ledger.tables||{}).find(([,value])=>value===id)?.[0]||id;
   const entry={id,code,matchNumber:m.matchNumber||1,rawStatus:m.status,closedAt:m.closedAt||null,stake:m.stake,targetPoints:m.targetPoints,players:Object.values(m.players||{}).map(p=>p.name),createdAt:m.createdAt||null,finishedAt:m.settledAt||m.refundedAt||m.closedAt||null,scores:m.session?.room?.scores||null,winnerName:Object.values(m.players||{}).find(p=>p.uid===m.winner)?.name||null,reason:m.session?.room?.matchResult?.reason||m.closeReason||null,history:Object.values(ledger.history?.[id]||{}).sort((a,b)=>a.at-b.at)};
   if(ledger.tables?.[code]===id&&adminTableCurrent(m,now))tables.push({...entry,status:m.status==='waiting'?'Esperando rival':'En juego'});
   else archivedTables.push({...entry,status:m.status==='settled'?'Terminada':m.status==='refunded'?'Créditos devueltos':m.closedAt?'Cerrada':m.status==='waiting'?'Vencida':'Finalizando'});
  }
  return {tables,archivedTables,events:tableEvents(ledger,now),movements:ledger.walletMovements||{},alerts:reservationAlerts(ledger,now),reports:Object.entries(reports).map(([id,r])=>({id,...r})).sort((a,b)=>b.at-a.at),
   audit:[...Object.values(ledger.adminAudit||{}),...Object.values(userAudit)].sort((a,b)=>b.at-a.at).slice(0,100)};
 }
 if(action==='close-table'&&!validKey(data.code))throw new HttpsError('invalid-argument','Mesa inválida.');
 const tableLedger=action==='close-table'?await creditStore.readLedger():null;
 if(action==='close-table'&&!tableLedger.tables?.[String(data.code)]){
  let failure;const result=await loadedTransaction(db.ref(),root=>{failure=null;if(!root)return undefined;try{return closeLegacyTable(root,{...data,actor,now:Date.now()});}catch(error){failure=error.message;return undefined;}});
  if(!result.committed)throw new HttpsError('failed-precondition',failure||'No se pudo cerrar la mesa.');
  return {ok:true};
 }
 if(action==='close-table'){
  const id=tableLedger.tables?.[data.code];
  const live=id&&tableLedger.matches?.[id]?.live==='cloudflare';
  if(live){
   let outcome;
   try{outcome=await closeLiveTable({code:data.code,actor,requestId:data.requestId,reason:data.reason,secret:liveInternalSecret.value()});}
   catch(error){throw new HttpsError('unavailable',error.message);}
   if(outcome.closed)return {ok:true};
  }
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
  await db.ref().get();
  const r=await db.ref().transaction(root=>{
   failure=null;if(!root)return undefined;
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

const {uruguayDate,activityUpdates,activitySummary,requestPlatform,PLATFORMS,onlineUids,higherPeak}=require('./activity-service.cjs');
// The most players connected at once, per day and the all-time record, with and without
// test accounts. Checked at most every 30 seconds per server instance.
let lastPeakCheck=0;
async function recordConcurrentPeak(now){
 if(now-lastPeakCheck<30000)return;lastPeakCheck=now;
 const [presence,tests]=await Promise.all([db.ref('adminMetrics/presence').get(),db.ref('adminConfig/testUsers').get()]);
 const online=onlineUids(presence.val()||{},now),testSet=new Set(Object.keys(tests.val()||{}));
 const counts={all:online.length,real:online.filter(uid=>!testSet.has(uid)).length},day=uruguayDate(now).day;
 await Promise.all(Object.entries(counts).flatMap(([key,count])=>[
  db.ref('adminMetrics/days/'+day+'/concurrent/'+key).transaction(current=>higherPeak(current,count,now)),
  db.ref('adminMetrics/concurrentRecord/'+key).transaction(current=>higherPeak(current,count,now))]));
}
exports.playerActivity=onCall({...options,maxInstances:3},async request=>{
 const user=await identity(request);await rateLimit(user.uid,10,'activity');
 const now=Date.now();let updates;
 try{updates=activityUpdates({uid:user.uid,sessionId:request.data?.sessionId,visible:request.data?.visible,platform:PLATFORMS.includes(request.data?.platform)?request.data.platform:requestPlatform({origin:request.rawRequest?.headers?.origin,userAgent:request.rawRequest?.headers?.['user-agent']}),now});}catch(e){throw new HttpsError('invalid-argument',e.message);}
 await db.ref('adminMetrics').update(updates);
 await db.ref('adminMetrics/startedAt').transaction(current=>current||now);
 // The visit that opened this page belongs to this player (only an unclaimed, recent one).
 const testUser=(await db.ref('adminConfig/testUsers/'+user.uid).get()).val()===true;
 await recordConcurrentPeak(now).catch(error=>console.error('concurrent peak',error));
 const visit=visitClaimPath(request.data);
 if(visit){
  const entry=db.ref(visit),record=(await entry.get()).val();
  if(Number.isFinite(record?.at)&&now-record.at<12*3600000&&!record.uid){
   await entry.child('uid').transaction(current=>current||user.uid);
   // A test account's visit moves to the test counters.
   if(testUser&&!record.test)await db.ref('adminMetrics').update({...moveVisitUpdates(record,true,ServerValue.increment),[visit.slice('adminMetrics/'.length)+'/test']:true});
  }
 }
 // The page marks its device as a test device, so later visits count apart too.
 return {ok:true,testDevice:testUser};
});
// Anonymous visit counters for the admin panel. No login and no stored
// identifiers; a per-instance limit keeps one address from inflating them.
const {visitUpdates,visitSummary,visitRecord,visitRange,visitorsInRange,visitClaimPath,deviceFacts,dedupeVisit,rememberDevice,VISIT_DAYS}=require('./visit-service.cjs');
const {moveVisitUpdates,moveVisitsUpdates,mergeVisitCounters,withoutTestActivity}=require('./test-data.cjs');
const visitLimits=new Map(),visitDevices=new Map();
exports.siteVisit=onCall({region:'us-central1',maxInstances:3,timeoutSeconds:10,cors:true},async request=>{
 const now=Date.now(),ip=String(request.rawRequest?.ip||'');
 const recent=(visitLimits.get(ip)||[]).filter(at=>now-at<60000);
 if(recent.length>=20)throw new HttpsError('resource-exhausted','Demasiadas visitas.');
 recent.push(now);visitLimits.set(ip,recent);
 if(visitLimits.size>5000)for(const [key,list] of visitLimits)if(list.every(at=>now-at>=60000))visitLimits.delete(key);
 const {day}=uruguayDate(now),data={...(request.data||{})},agent=request.rawRequest?.headers?.['user-agent'];
 const facts=deviceFacts(agent),key=[ip,data.platform,facts.os,facts.model,facts.browser].join('|');
 const repeat=dedupeVisit({seen:visitDevices,key,day,page:data.page,now});
 if(repeat.duplicateOf)return {ok:true,id:repeat.duplicateOf,day,duplicate:true};
 if(repeat.known)data.first=false;
 let updates;
 try{updates=visitUpdates({...data,now,increment:ServerValue.increment});}catch(e){throw new HttpsError('invalid-argument',e.message);}
 const record=visitRecord({...data,now,userAgent:agent});
 const entry=db.ref('adminMetrics/visitLog/'+day).push();
 rememberDevice({seen:visitDevices,key,day,page:data.page,now,id:entry.key});
 // Devices flagged as test devices count apart from the real visits.
 await Promise.all([db.ref(record.test?'adminMetrics/visitsTest':'adminMetrics/visits').update(updates),entry.set(record)]);
 // The page hands this id to the player's first signal after signing in.
 return {ok:true,id:entry.key,day};
});
exports.activityCleanup=onSchedule({schedule:'every day 04:00',timeZone:'America/Montevideo',region:'us-central1',maxInstances:1},async()=>{
 const now=Date.now();
 // Table invitations and their answers older than a day are not useful anymore.
 for(const root of ['tableInvites','tableInviteReplies']){const all=(await db.ref(root).get()).val()||{},gone={};for(const [uid,list] of Object.entries(all))for(const [id,v] of Object.entries(list||{}))if(!(now-(v?.at||0)<86400000))gone[root+'/'+uid+'/'+id]=null;if(Object.keys(gone).length)await db.ref().update(gone);}
 await db.ref('adminMetrics').transaction(metrics=>{
  if(!metrics)return undefined;
  // Daily activity, counters and visit details are kept for VISIT_DAYS.
  const visitCutoff=uruguayDate(now-(VISIT_DAYS-1)*86400000).day;
  for(const key of ['days','visits','visitsTest','visitLog'])for(const day of Object.keys(metrics[key]||{}))if(day<visitCutoff)delete metrics[key][day];
  for(const [uid,sessions] of Object.entries(metrics.presence||{})){
   for(const [id,session] of Object.entries(sessions))if(now-session.at>=90000)delete sessions[id];
   if(!Object.keys(sessions).length)delete metrics.presence[uid];
  }
  return metrics;
 });
});

exports.playerConsole=onCall(options,async request=>{
 const user=await identity(request);await rateLimit(user.uid,20,'player-console');
 const data=request.data||{};
 if(data.action==='history')return personalHistory(await creditStore.readLedger(),user.uid);
 if(data.action==='report'){
  if(typeof data.message!=='string'||data.message.trim().length<5||data.message.length>1000||!validKey(data.requestId))throw new HttpsError('invalid-argument','Escribí un mensaje de entre 5 y 1000 caracteres.');
  let match=null;
  if(data.matchId){
   if(!validKey(data.matchId))throw new HttpsError('invalid-argument','Partida inválida.');
   match=(await creditStore.readLedger()).matches?.[data.matchId]??null;
   if(!match||!Object.values(match.players||{}).some(p=>p.uid===user.uid))throw new HttpsError('permission-denied','No pertenecés a esa partida.');
  }
  if(data.localId&&!validKey(data.localId))throw new HttpsError('invalid-argument','Identificador inválido.');
  const report={uid:user.uid,name:user.name,message:data.message.trim(),matchId:match?.id||null,code:match?.code||null,localId:!match&&data.localId?data.localId:null,mode:match?'online':data.mode==='bot'?'bot':'general',at:Date.now()};
  const r=await db.ref('problemReports/'+user.uid+'_'+data.requestId).transaction(old=>old||report);
  if(r.committed&&r.snapshot.val()?.at===report.at)await alertAdmin('Reporte de '+(user.name||'un jugador'),report.message,{kind:'report'});
  return {ok:!!r.snapshot.val()};
 }
 throw new HttpsError('invalid-argument','Acción inválida.');
});
const {onValueWritten,onValueCreated}=require('firebase-functions/v2/database');
// A new player: the first time an account saves its username.
exports.newPlayerAlert=onValueCreated({ref:'/profiles/{uid}/name',region:'us-central1',maxInstances:2},async event=>{
 const name=event.data.val();if(typeof name!=='string'||!name)return;
 await alertAdmin('Nuevo jugador registrado',name+' se registró en Truco Uruguayo.',{kind:'signup'});
});
// Independent of creditEconomy: a deletion cannot erase its own evidence.
exports.creditAccountingAudit=onValueWritten({ref:'/creditEconomy',region:'us-central1',maxInstances:2},async event=>{
 const before=event.data.before.val()||{},after=event.data.after.val()||{};
 const changes=[];
 for(const uid of new Set([...Object.keys(before.wallets||{}),...Object.keys(after.wallets||{})])){
  const a=before.wallets?.[uid]||null,b=after.wallets?.[uid]||null;
  if(JSON.stringify(a)!==JSON.stringify(b)&&!(await db.ref('userAccess/'+uid+'/deletedAt').get()).exists())changes.push({uid,before:a,after:b});
 }
 const matches=[];
 for(const id of new Set([...Object.keys(before.matches||{}),...Object.keys(after.matches||{})])){
  const a=before.matches?.[id],b=after.matches?.[id];
  if(a?.status!==b?.status||(!a)!==(!b))matches.push({id,code:b?.code||a?.code||null,before:a?.status||null,after:b?.status||null});
 }
 if(!changes.length&&!matches.length)return;
 const deletedWallets=changes.filter(c=>c.before&&!c.after).length;
 const deletedMatches=matches.filter(c=>c.before&&!c.after).length;
 const entry={at:Date.parse(event.time)||Date.now(),changes,matches,deletedWallets,deletedMatches};
 if(deletedWallets||deletedMatches)console.error('Accounting deletion detected',{eventId:event.id,deletedWallets,deletedMatches});
 const key=crypto.createHash('sha256').update(event.id).digest('hex');
 await db.ref('creditAccountingAudit/'+key).set(entry);
});
exports.creditWalletHistory=onValueWritten({ref:'/creditEconomy/wallets/{uid}',region:'us-central1',maxInstances:2},async event=>{
 const before=event.data.before.val(),after=event.data.after.val();if(!after)return;
 const uid=event.params.uid,at=Date.parse(event.time)||Date.now();
 if((await db.ref('userAccess/'+uid).get()).val()?.deletedAt)return;
 const balance=Math.max(Number(before?.balance)||0,Number(after.balance)||0);
 await db.ref('creditEconomy/peaks/'+uid).transaction(old=>({balance:Math.max(old?.balance||0,balance),startedAt:Math.min(old?.startedAt||at,at)}));
 if(before?.balance===after.balance&&before?.locked===after.locked)return;
 const key=crypto.createHash('sha256').update(event.id).digest('hex');
 await db.ref('creditEconomy/walletMovements/'+uid+'/'+key).set({at,before:before?.balance||0,after:after.balance,reservedBefore:before?.locked||0,reservedAfter:after.locked});
});
