'use strict';
// Friends and table invitations: pure rules, so the callable only reads and writes.
const {hasStartedMatch}=require('./match-start.cjs');
const {isBotUid}=require('./bot-seat.cjs');
const INVITE_MS=3*60000;
const nameKey=name=>String(name).toLowerCase().replaceAll('.','%2E');
const keyName=key=>String(key).replaceAll('%2E','.');
// A search term becomes a username key prefix (same alphabet as names).
function searchPrefix(query){
 const text=typeof query==='string'?query.trim():'';
 if(!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9._-]{2,18}$/.test(text))return null;
 return nameKey(text);
}
// The last distinct people (no bots) the player sat with, newest first.
function recentOpponents(ledger,uid,limit=10){
 const matches=Object.values(ledger?.matches||{}).filter(m=>hasStartedMatch(m)&&Object.values(m.players||{}).some(p=>p?.uid===uid)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
 const seen=new Map();
 for(const m of matches){
  for(const p of Object.values(m.players||{})){
   if(!p?.uid||p.uid===uid||isBotUid(p.uid)||seen.has(p.uid))continue;
   seen.set(p.uid,{uid:p.uid,name:p.name||'',lastPlayedAt:m.createdAt||null});
   if(seen.size>=limit)return [...seen.values()];
  }
 }
 return [...seen.values()];
}
// Friendship as the viewer sees someone: friend, request sent, request received or none.
function relation(viewer,uid,{friends,incoming,outgoing}){
 if(uid===viewer)return 'self';
 if(friends?.[uid])return 'friend';
 if(incoming?.[uid])return 'incoming';
 if(outgoing?.[uid])return 'outgoing';
 return 'none';
}
// Multi-path updates (root-relative) for each friendship step.
function requestUpdates({from,fromName,to,toName,now,reverseExists}){
 if(reverseExists)return acceptUpdates({uid:from,name:fromName,peer:to,peerName:toName,now});
 return {[`friendRequests/${to}/${from}`]:{name:fromName,at:now},[`friendRequestsSent/${from}/${to}`]:{name:toName,at:now}};
}
function acceptUpdates({uid,name,peer,peerName,now}){
 return {[`friends/${uid}/${peer}`]:{name:peerName,since:now},[`friends/${peer}/${uid}`]:{name,since:now},
  [`friendRequests/${uid}/${peer}`]:null,[`friendRequestsSent/${peer}/${uid}`]:null,[`friendRequests/${peer}/${uid}`]:null,[`friendRequestsSent/${uid}/${peer}`]:null};
}
function declineUpdates({uid,peer}){return {[`friendRequests/${uid}/${peer}`]:null,[`friendRequestsSent/${peer}/${uid}`]:null};}
function removeUpdates({uid,peer}){return {[`friends/${uid}/${peer}`]:null,[`friends/${peer}/${uid}`]:null,...declineUpdates({uid,peer}),...declineUpdates({uid:peer,peer:uid})};}
// A table invitation: the friend gets the table code (and the password the host typed
// for a private table, readable only by that friend) and has a few minutes to answer.
function inviteRecord({from,fromName,table,now}){
 if(!/^[A-Z2-9]{5}$/.test(table?.code||''))throw new Error('Mesa inválida.');
 const password=typeof table.password==='string'?table.password.slice(0,40):'';
 return {from,fromName,code:table.code,mode:table.mode==='2v2'?'2v2':'1v1',targetPoints:Number.isSafeInteger(table.targetPoints)?table.targetPoints:null,stake:Number.isSafeInteger(table.stake)?table.stake:null,...(password?{password}:{}),at:now,expiresAt:now+INVITE_MS};
}
// A player reports while they are in a game; a report older than this is stale (the
// app was closed without a clean disconnect) and no longer blocks invitations.
const PLAYING_FRESH_MS=20*60000;
const isPlaying=(status,now)=>status?.playing===true&&Number(status.at)>now-PLAYING_FRESH_MS;
// The same friend gets at most this many invitations in a window; different friends
// can all be invited at once.
const INVITES_PER_FRIEND=2,INVITE_WINDOW_MS=20*60000;
function inviteAllowance(sentAt,now){
 const recent=(Array.isArray(sentAt)?sentAt:Object.values(sentAt||{})).map(Number).filter(t=>t>now-INVITE_WINDOW_MS).sort((a,b)=>a-b);
 if(recent.length<INVITES_PER_FRIEND)return {allowed:true,next:[...recent,now]};
 return {allowed:false,waitMinutes:Math.max(1,Math.ceil((recent[recent.length-INVITES_PER_FRIEND]+INVITE_WINDOW_MS-now)/60000)),next:recent};
}
const inviteText=invite=>`${invite.fromName} te invita a jugar al truco: `+[invite.mode==='2v2'?'2 vs 2':'1 vs 1',invite.targetPoints?`a ${invite.targetPoints} puntos`:null,invite.stake?`${invite.stake} crédito${invite.stake===1?'':'s'} por jugador`:'sin créditos'].filter(Boolean).join(', ')+'.';
module.exports={INVITE_MS,nameKey,keyName,searchPrefix,recentOpponents,relation,requestUpdates,acceptUpdates,declineUpdates,removeUpdates,inviteRecord,inviteText,PLAYING_FRESH_MS,isPlaying,INVITES_PER_FRIEND,INVITE_WINDOW_MS,inviteAllowance};
