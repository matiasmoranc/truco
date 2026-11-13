'use strict';
const {prepareUserDeletion,validKey,legacyTableActive}=require('./admin-service.cjs');
const {chatDay,CHAT_LOG_DAYS}=require('./chat-log.cjs');
const {uruguayDate}=require('./activity-service.cjs');
const {VISIT_DAYS}=require('./visit-service.cjs');
function prepareSelfDeletion(root,{uid,requestId,now}){
 for(const entry of Object.values(root?.rooms||{}))if(entry?.public?.table?.uid===uid&&legacyTableActive(entry.public,now))throw new Error('Cerrá tu mesa antes de eliminar tu cuenta.');
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
 for(const entry of Object.values(root?.rooms||{}))if(entry?.public?.table?.uid===request.uid&&legacyTableActive(entry.public,request.now))throw new Error('El usuario tiene una mesa activa. Cerrala primero.');
 if(!/^deleted_[a-zA-Z0-9-]+$/.test(anonymousId||''))throw new Error('Identificador de anonimización inválido.');
 const next=prepareUserDeletion(root,{...request,self:false});
 next.accountDeletionJobs??={};
 next.accountDeletionJobs[request.uid]={anonymousId,requestId:request.requestId,at:request.now};
 return next;
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Replaces the uid (values and inside keys) and the player's name.
function scrubber(uid,anonymousId,name){
 const scrub=value=>{
  if(typeof value==='string')return value===uid?anonymousId:name&&value===name?'Jugador eliminado':value;
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k.split(uid).join(anonymousId),scrub(v)]));
  return value;
 };
 return scrub;
}
// The credit ledger part: preserve credit totals and opponents' results with an unrelated identifier.
function eraseLedger(ledger,{uid,anonymousId,name,now}){
 const next=structuredClone(ledger||{});
 for(const match of Object.values(next.matches||{}))if(match&&[match.player1,match.player2,...Object.values(match.players||{}).map(p=>p?.uid)].includes(uid))delete match.session;
 const clean=scrubber(uid,anonymousId,name)(next);
 const wallet=clean.wallets?.[anonymousId];
 if(wallet)Object.assign(wallet,{balance:0,locked:0,deletedAt:wallet.deletedAt??now});
 return clean;
}
// Branches keyed by the player's uid.
const OWN_BRANCHES=['profiles','administrators','creditRateLimits','avatars','pushTokens','presence','playerStatus','levels','adminMessages','adminThreads'];
// Branches keyed by uid on both levels ({a}/{b}): the player's own list and their entry in everyone else's.
const PAIR_BRANCHES=['userBlocks','friends','friendRequests','friendRequestsSent','tableInviteLog'];
function erasePlayerData(root,{uid,anonymousId,now,name:knownName}){
 const next=structuredClone(root||{}),name=next.profiles?.[uid]?.name||knownName;
 const entries=value=>isObject(value)?Object.entries(value):[];
 for(const [key,owner] of entries(next.usernames))if(owner===uid)delete next.usernames[key];
 for(const branch of OWN_BRANCHES)if(isObject(next[branch]))delete next[branch][uid];
 for(const branch of PAIR_BRANCHES)if(isObject(next[branch])){delete next[branch][uid];for(const [,list] of entries(next[branch]))if(isObject(list))delete list[uid];}
 // Table invitations the player received or sent, and answers to/from them.
 if(isObject(next.tableInvites)){delete next.tableInvites[uid];for(const [,list] of entries(next.tableInvites))for(const [id,invite] of entries(list))if(invite?.from===uid)delete list[id];}
 if(isObject(next.tableInviteReplies)){delete next.tableInviteReplies[uid];for(const [,list] of entries(next.tableInviteReplies))for(const [id,reply] of entries(list))if(reply?.to===uid)delete list[id];}
 if(isObject(next.adminConfig?.testUsers))delete next.adminConfig.testUsers[uid];
 // Activity and visits: the player leaves the daily lists; visits stay counted, without the account.
 const metrics=next.adminMetrics;
 if(isObject(metrics)){
  if(isObject(metrics.presence))delete metrics.presence[uid];
  for(const [,day] of entries(metrics.days)){
   if(isObject(day.users))delete day.users[uid];
   if(isObject(day.platforms))delete day.platforms[uid];
   for(const [,hour] of entries(day.hours))if(isObject(hour))delete hour[uid];
  }
  for(const [,list] of entries(metrics.visitLog))for(const [,visit] of entries(list))if(visit?.uid===uid)delete visit.uid;
 }
 // Copies of what the player typed in table chats (kept for moderation).
 for(const [,list] of entries(next.chatLog))for(const [key,message] of entries(list))if(message?.uid===uid)delete list[key];
 for(const [id,report] of entries(next.problemReports))if(report?.uid===uid)delete next.problemReports[id];
 for(const [code,entry] of entries(next.rooms)){
  if(Object.values(entry?.public?.players||{}).some(p=>p?.uid===uid)||entry?.public?.table?.uid===uid){delete next.rooms[code];if(next.hands)delete next.hands[code];}
 }
 for(const [,hands] of entries(next.hands))if(isObject(hands))delete hands[uid];
 if(next.creditEconomy)next.creditEconomy=eraseLedger(next.creditEconomy,{uid,anonymousId,name,now});
 const scrub=scrubber(uid,anonymousId,name);
 for(const branch of ['creditAccountingAudit','adminUserAudit'])if(next[branch])next[branch]=scrub(next[branch]);
 // A security tombstone prevents delayed writes from restoring the old account.
 next.userAccess??={};next.userAccess[uid]={blocked:true,deletedAt:now};
 return next;
}

// Root-relative multi-path update that turns `before` into `after`. Both hold only
// the branches that were read, so nothing else in the database is touched.
function diffUpdates(before,after){
 const out={};
 // Only leaves are written: a branch that appears or disappears is walked down to what was read,
 // so a node read partially (one user's entry) never replaces or deletes its siblings.
 const walk=(a,b,path)=>{
  if(isObject(a)&&isObject(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path?path+'/'+key:key);return;}
  if(isObject(b)&&a==null){walk({},b,path);return;}
  if(isObject(a)&&b==null){walk(a,{},path);return;}
  if(JSON.stringify(a??null)===JSON.stringify(b??null))return;
  if(!path)throw new Error('No se puede reemplazar toda la base.');
  out[path]=b===undefined?null:b;
 };
 walk(before||{},after||{},'');
 return out;
}
// Joins update maps. A path under one already removed is dropped (Firebase rejects overlapping paths).
function mergeUpdates(...maps){
 const all=Object.assign({},...maps),out={};
 for(const path of Object.keys(all).sort()){
  const parts=path.split('/');let covered=false;
  for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(Object.hasOwn(out,parent)){if(out[parent]!==null)throw new Error('Rutas superpuestas: '+parent);covered=true;break;}}
  if(!covered)out[path]=all[path];
 }
 return out;
}
const dayKeys=(now,count,format)=>[...new Set(Array.from({length:count+1},(_,i)=>format(now-i*86400000)))];
// Daily activity is keyed by uid inside each day; removing those keys needs no read.
// Days are kept for VISIT_DAYS; a week more covers a late cleanup.
function activityDayPaths(uid,now,days=VISIT_DAYS+7){
 const out={};
 for(const day of dayKeys(now,days,at=>uruguayDate(at).day)){
  const base='adminMetrics/days/'+day+'/';
  out[base+'users/'+uid]=null;out[base+'platforms/'+uid]=null;
  for(let hour=0;hour<24;hour++)out[base+'hours/'+String(hour).padStart(2,'0')+'/'+uid]=null;
 }
 return out;
}
const ROOM_UID_PATHS=['public/table/uid','public/players/player1/uid','public/players/player2/uid','public/players/player3/uid','public/players/player4/uid'];
const value=async query=>(await query.get()).val();
function place(root,path,data){
 if(data===null||data===undefined)return;
 const keys=path.split('/');let node=root;
 for(const key of keys.slice(0,-1))node=node[key]??={};
 const last=keys.at(-1);node[last]=isObject(node[last])&&isObject(data)?{...node[last],...data}:data;
}
// Legacy rooms (kept in the database) where the player sits or that they created.
async function legacyRoomsOf(db,uid){
 const found=await Promise.all(ROOM_UID_PATHS.map(path=>value(db.ref('rooms').orderByChild(path).equalTo(uid))));
 return Object.assign({},...found.map(rooms=>rooms||{}));
}
// What preparing a deletion checks and writes, read branch by branch (never the whole database).
async function loadPrepareState(db,uid,{requestId}={}){
 const root={};
 const reads=[['profiles/'+uid],['administrators/'+uid],['userAccess/'+uid],['accountDeletionJobs/'+uid]];
 if(validKey(requestId))reads.push(['adminUserAudit/'+requestId]);
 const [values,rooms]=await Promise.all([Promise.all(reads.map(([path])=>value(db.ref(path)))),legacyRoomsOf(db,uid)]);
 reads.forEach(([path],i)=>place(root,path,values[i]));
 for(const [code,room] of Object.entries(rooms))place(root,'rooms/'+code,room);
 return root;
}
// Everything erasePlayerData changes for this player, with targeted reads and queries.
async function loadPlayerData(db,uid,{now=Date.now()}={}){
 const root={},own=[...OWN_BRANCHES,'friends','friendRequests','friendRequestsSent','userAccess','accountDeletionJobs'].map(branch=>branch+'/'+uid);
 own.push('adminConfig/testUsers/'+uid,'adminMetrics/presence/'+uid);
 // Small branches cleaned up regularly, or frozen since credits moved to the bank.
 const whole=['userBlocks','tableInvites','tableInviteReplies','tableInviteLog','creditAccountingAudit'];
 const chatDays=dayKeys(now,CHAT_LOG_DAYS+1,chatDay),visitDays=dayKeys(now,VISIT_DAYS+7,at=>uruguayDate(at).day);
 const [ownValues,wholeValues,usernames,auditByUid,auditByActor,reports,rooms,chats,visits]=await Promise.all([
  Promise.all(own.map(path=>value(db.ref(path)))),
  Promise.all(whole.map(path=>value(db.ref(path)))),
  value(db.ref('usernames').orderByValue().equalTo(uid)),
  value(db.ref('adminUserAudit').orderByChild('uid').equalTo(uid)),
  value(db.ref('adminUserAudit').orderByChild('actor').equalTo(uid)),
  value(db.ref('problemReports').orderByKey().startAt(uid+'_').endAt(uid+'_')),
  legacyRoomsOf(db,uid),
  Promise.all(chatDays.map(day=>value(db.ref('chatLog/'+day).orderByChild('uid').equalTo(uid)))),
  Promise.all(visitDays.map(day=>value(db.ref('adminMetrics/visitLog/'+day).orderByChild('uid').equalTo(uid))))
 ]);
 own.forEach((path,i)=>place(root,path,ownValues[i]));
 whole.forEach((path,i)=>place(root,path,wholeValues[i]));
 place(root,'usernames',usernames);place(root,'adminUserAudit',auditByUid);place(root,'adminUserAudit',auditByActor);place(root,'problemReports',reports);
 chatDays.forEach((day,i)=>place(root,'chatLog/'+day,chats[i]));
 visitDays.forEach((day,i)=>place(root,'adminMetrics/visitLog/'+day,visits[i]));
 for(const [code,room] of Object.entries(rooms))place(root,'rooms/'+code,room);
 // Second step: the other side of each friendship and request, the name's key and the rooms' hands.
 const name=root.profiles?.[uid]?.name,second=[];
 for(const peer of Object.keys(root.friends?.[uid]||{}))second.push('friends/'+peer+'/'+uid);
 for(const peer of Object.keys(root.friendRequests?.[uid]||{}))second.push('friendRequestsSent/'+peer+'/'+uid);
 for(const peer of Object.keys(root.friendRequestsSent?.[uid]||{}))second.push('friendRequests/'+peer+'/'+uid);
 if(typeof name==='string'&&name)second.push('usernames/'+name.toLowerCase().replaceAll('.','%2E'));
 for(const code of Object.keys(rooms))second.push('hands/'+code);
 const secondValues=await Promise.all(second.filter(validPath).map(path=>value(db.ref(path))));
 second.filter(validPath).forEach((path,i)=>place(root,path,secondValues[i]));
 return root;
}
const validPath=path=>path.split('/').every(key=>key&&!/[.#$[\]]/.test(key));
// Prepares a deletion: the credit part (checks and the wallet lock) changes atomically in
// the ledger; then only the database paths that changed are written in one update.
async function prepareDeletion({db,creditStore,uid,requestId,prepare,extraUpdates=()=>({})}){
 const state=await loadPrepareState(db,uid,{requestId});
 let failure=null,prepared;
 const result=await creditStore.patchLedger(ledger=>{
  failure=null;prepared=undefined;
  try{prepared=prepare({...state,creditEconomy:ledger||{}});}catch(error){failure=error;return undefined;}
  return JSON.stringify(prepared.creditEconomy??{})===JSON.stringify(ledger||{})?undefined:prepared.creditEconomy;
 });
 if(failure)throw failure;
 if(result?.empty||!prepared)throw new Error('No se pudieron leer los créditos. Volvé a intentar.');
 const {creditEconomy,...rest}=prepared;
 const updates=mergeUpdates(diffUpdates(state,rest),extraUpdates(state,prepared));
 if(Object.keys(updates).length)await db.ref().update(updates);
 return prepared;
}
// Erases the player's data: first the credit ledger (which still needs the name), then the database.
// Every step is idempotent, so a failed run is completed by the next one.
async function completeDeletion({db,creditStore,uid,job,now=Date.now()}){
 const state=await loadPlayerData(db,uid,{now}),name=state.profiles?.[uid]?.name||job.name||null;
 let failure=null;
 await creditStore.patchLedger(ledger=>{
  failure=null;
  try{const next=eraseLedger(ledger,{uid,anonymousId:job.anonymousId,name,now});return JSON.stringify(next)===JSON.stringify(ledger)?undefined:next;}
  catch(error){failure=error;return undefined;}
 });
 if(failure)throw failure;
 const next=erasePlayerData(state,{uid,anonymousId:job.anonymousId,now,name});
 next.userAccess[uid].deletionRequestId=job.requestId;
 const updates=mergeUpdates(diffUpdates(state,next),activityDayPaths(uid,now));
 await db.ref().update(updates);
 return updates;
}
module.exports={prepareSelfDeletion,prepareAdminPrivacyDeletion,erasePlayerData,eraseLedger,diffUpdates,mergeUpdates,activityDayPaths,loadPrepareState,loadPlayerData,prepareDeletion,completeDeletion};
