'use strict';
// playerSocial: friends (search, recent opponents, requests, list) and table
// invitations with a push notification to the friend's phones.
const crypto=require('node:crypto');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getMessaging}=require('firebase-admin/messaging');
const S=require('./social-service.cjs');
const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(uid);
function createSocialFunctions({db,identity,rateLimit,options,readLedger,usersBlockEachOther}){
 const val=async path=>(await db.ref(path).get()).val();
 const names=async uids=>{const list=await Promise.all(uids.map(uid=>val('profiles/'+uid+'/name')));return Object.fromEntries(uids.map((uid,i)=>[uid,list[i]||'']));};
 const lists=async uid=>{const [friends,incoming,outgoing]=await Promise.all(['friends','friendRequests','friendRequestsSent'].map(k=>val(k+'/'+uid)));return {friends:friends||{},incoming:incoming||{},outgoing:outgoing||{}};};
 async function peer(user,uid){
  if(!validUid(uid)||uid===user.uid)throw new HttpsError('invalid-argument','Jugador inválido.');
  const name=await val('profiles/'+uid+'/name');
  if(typeof name!=='string'||!name)throw new HttpsError('not-found','No encontramos a ese jugador.');
  if(await usersBlockEachOther(db,user.uid,uid))throw new HttpsError('permission-denied','No podés interactuar con ese jugador.');
  return name;
 }
 // Every phone the player registered; tokens Google says are gone are removed.
 async function push(uid,{title,body,data}){
  const tokens=Object.entries(await val('pushTokens/'+uid)||{}).map(([id,t])=>({id,token:t?.token})).filter(t=>typeof t.token==='string');
  if(!tokens.length)return 0;
  const result=await getMessaging().sendEachForMulticast({tokens:tokens.map(t=>t.token),notification:{title,body},data,
   android:{priority:'high',notification:{channelId:'invitaciones',sound:'default'}},apns:{headers:{'apns-priority':'10'},payload:{aps:{sound:'default'}}}}).catch(()=>null);
  if(!result)return 0;
  const dead={};result.responses.forEach((r,i)=>{if(!r.success&&/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code||''))dead['pushTokens/'+uid+'/'+tokens[i].id]=null;});
  if(Object.keys(dead).length)await db.ref().update(dead);
  return result.successCount;
 }
 const playerSocial=onCall(options,async request=>{
  const user=await identity(request),data=request.data||{},now=Date.now();
  await rateLimit(user.uid,40,'social');
  switch(data.action){
   case 'overview':{
    const mine=await lists(user.uid);
    const map=o=>Object.entries(o).map(([uid,v])=>({uid,name:v?.name||'',at:v?.at||v?.since||null}));
    return {friends:map(mine.friends).sort((a,b)=>a.name.localeCompare(b.name,'es')),incoming:map(mine.incoming),outgoing:map(mine.outgoing)};
   }
   case 'search':{
    const prefix=S.searchPrefix(data.query);if(!prefix)return {results:[]};
    const found=(await db.ref('usernames').orderByKey().startAt(prefix).endAt(prefix+'').limitToFirst(12).get()).val()||{};
    const uids=Object.values(found).filter(uid=>validUid(uid)&&uid!==user.uid);
    const [mine,named]=await Promise.all([lists(user.uid),names(uids)]);
    const blocked=await Promise.all(uids.map(uid=>usersBlockEachOther(db,user.uid,uid)));
    return {results:uids.filter((uid,i)=>!blocked[i]&&named[uid]).map(uid=>({uid,name:named[uid],relation:S.relation(user.uid,uid,mine)}))};
   }
   case 'recent':{
    const [ledger,mine]=await Promise.all([readLedger(),lists(user.uid)]);
    const recent=S.recentOpponents(ledger,user.uid);
    const named=await names(recent.map(r=>r.uid));
    return {results:recent.filter(r=>named[r.uid]).map(r=>({...r,name:named[r.uid]||r.name,relation:S.relation(user.uid,r.uid,mine)}))};
   }
   case 'request':{
    const peerName=await peer(user,data.uid),mine=await lists(user.uid);
    if(mine.friends[data.uid])return {relation:'friend'};
    await db.ref().update(S.requestUpdates({from:user.uid,fromName:user.name,to:data.uid,toName:peerName,now,reverseExists:!!mine.incoming[data.uid]}));
    if(mine.incoming[data.uid])return {relation:'friend'};
    await push(data.uid,{title:'Solicitud de amistad',body:user.name+' quiere ser tu amigo en Truco Uruguayo.',data:{type:'friend-request',from:user.uid}});
    return {relation:'outgoing'};
   }
   case 'respond':{
    if(!validUid(data.uid))throw new HttpsError('invalid-argument','Jugador inválido.');
    const incoming=await val('friendRequests/'+user.uid+'/'+data.uid);
    if(!incoming)return {relation:'none'};
    if(data.accept===true){const peerName=await peer(user,data.uid);await db.ref().update(S.acceptUpdates({uid:user.uid,name:user.name,peer:data.uid,peerName,now}));return {relation:'friend'};}
    await db.ref().update(S.declineUpdates({uid:user.uid,peer:data.uid}));return {relation:'none'};
   }
   case 'cancel-request':{
    if(!validUid(data.uid))throw new HttpsError('invalid-argument','Jugador inválido.');
    await db.ref().update(S.declineUpdates({uid:data.uid,peer:user.uid}));return {relation:'none'};
   }
   case 'remove':{
    if(!validUid(data.uid))throw new HttpsError('invalid-argument','Jugador inválido.');
    await db.ref().update(S.removeUpdates({uid:user.uid,peer:data.uid}));return {relation:'none'};
   }
   case 'invite':{
    if(!validUid(data.uid)||!(await val('friends/'+user.uid+'/'+data.uid)))throw new HttpsError('permission-denied','Solo podés invitar a tus amigos.');
    await peer(user,data.uid);await rateLimit(user.uid,12,'table-invite');
    let invite;try{invite=S.inviteRecord({from:user.uid,fromName:user.name,table:data.table,now});}catch(e){throw new HttpsError('invalid-argument',e.message);}
    const id=crypto.randomUUID();
    await db.ref('tableInvites/'+data.uid+'/'+id).set(invite);
    const sent=await push(data.uid,{title:'Invitación a jugar',body:S.inviteText(invite),data:{type:'table-invite',inviteId:id,code:invite.code}});
    return {id,notified:sent>0};
   }
   case 'answer-invite':{
    if(typeof data.inviteId!=='string'||!/^[0-9a-f-]{36}$/.test(data.inviteId))throw new HttpsError('invalid-argument','Invitación inválida.');
    const ref=db.ref('tableInvites/'+user.uid+'/'+data.inviteId),invite=(await ref.get()).val();
    if(!invite)return {ok:true};
    await ref.remove();
    // The host hears back either way; a rejection shows in the waiting room.
    if(validUid(invite.from))await db.ref('tableInviteReplies/'+invite.from+'/'+data.inviteId).set({to:user.uid,name:user.name,code:invite.code,accepted:data.accept===true,at:now});
    return {ok:true,...(data.accept===true?{code:invite.code,password:invite.password||null}:{})};
   }
   case 'register-push':{
    if(typeof data.token!=='string'||data.token.length<20||data.token.length>4096)throw new HttpsError('invalid-argument','Token inválido.');
    const id=crypto.createHash('sha256').update(data.token).digest('hex').slice(0,32);
    await db.ref('pushTokens/'+user.uid+'/'+id).set({token:data.token,platform:data.platform==='ios'?'ios':'android',at:now});
    return {ok:true};
   }
   default:throw new HttpsError('invalid-argument','Acción inválida.');
  }
 });
 return {playerSocial};
}
module.exports={createSocialFunctions};
