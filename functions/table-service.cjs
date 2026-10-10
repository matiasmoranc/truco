'use strict';
const crypto=require('node:crypto');
const {createReferee,newSession}=require('./game-referee.cjs');
const {settleVerifiedMatch,refundCanceledMatch,reserveStakes}=require('./credit-ledger.cjs');
const WAIT_MS=600000;
function fail(message){throw new Error(message);}
function validCode(code){if(typeof code!=='string'||!/^[A-Z2-9]{5}$/.test(code))fail('Mesa inválida.');return code;}
function passwordHash(password){if(typeof password!=='string'||password.trim().length<4||password.length>64)fail('La clave debe tener entre 4 y 64 caracteres.');const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(password,salt,32).toString('hex')};}
function passwordMatches(password,secret){if(!secret)return true;if(typeof password!=='string'||password.length>64)return false;const actual=crypto.scryptSync(password,secret.salt,32);return crypto.timingSafeEqual(actual,Buffer.from(secret.hash,'hex'));}
function checkWallet(ledger,uid,stake){const w=ledger.wallets?.[uid];if(w?.deleting||w?.deletedAt)fail('La cuenta fue eliminada.');if(!w||!Number.isSafeInteger(w.balance)||!Number.isSafeInteger(w.locked))fail('Reclamá tus créditos antes de crear o entrar a una mesa.');if(w.locked!==0)fail('Ya tenés créditos reservados en otra mesa.');if(!Number.isSafeInteger(stake)||stake<1||stake>w.balance)fail('No tenés créditos suficientes para esta apuesta.');return w;}
function tableFor(ledger,code){validCode(code);const id=ledger.tables?.[code],m=id&&ledger.matches?.[id];if(!m)fail('La mesa ya no está disponible.');return m;}
function findPlayer(m,uid){return m.player1===uid?'player1':m.player2===uid?'player2':null;}
function createTable(ledger,{code,id,uid,name,stake,targetPoints,secret=null,now}){
 validCode(code);if(![10,20,30,40,50,60].includes(targetPoints))fail('Puntaje inválido.');
 const next=structuredClone(ledger||{});if(next.tables?.[code])fail('La mesa cambió. Volvé a intentar.');
 const wallet=checkWallet(next,uid,stake);wallet.balance-=stake;wallet.locked=stake;
 next.matches??={};next.tables??={};next.tables[code]=id;
 next.matches[id]={id,code,player1:uid,player2:null,stake,targetPoints,status:'waiting',createdAt:now,secret,revision:1,players:{player1:{uid,name,online:true}},requests:{},matchNumber:1};return next;
}
function joinTable(ledger,{code,uid,name,password='',now}){
 const next=structuredClone(ledger),m=tableFor(next,code);
 if(findPlayer(m,uid))return next;
 if(m.status!=='waiting'||now-m.createdAt>=WAIT_MS)fail('La mesa ya no está disponible.');
 if(!passwordMatches(password,m.secret))fail('La clave no es correcta.');
 const wallet=checkWallet(next,uid,m.stake),host=next.wallets[m.player1];
 if(host.locked!==m.stake)fail('La reserva de la mesa no es válida.');
 wallet.balance-=m.stake;wallet.locked=m.stake;m.player2=uid;m.players.player2={uid,name,online:true};m.status='reserved';
 m.session=newSession(code,m.players,m.targetPoints,{id:m.id,stake:m.stake,pot:m.stake*2,hasPassword:!!m.secret,matchNumber:1},now);m.revision++;return next;
}
function cancelWaiting(ledger,m,now){const wallet=ledger.wallets[m.player1];if(wallet.locked!==m.stake)fail('La reserva cambió.');wallet.balance+=m.stake;wallet.locked=0;m.status='refunded';m.closedAt=now;m.closeReason='waiting-canceled';m.revision++;}
function finishAccounting(ledger,m,now){
 const room=m.session.room;
 if(room.status==='closed'&&m.status==='reserved'){const next=refundCanceledMatch(ledger,{id:m.id,now});next.matches[m.id].revision++;return next;}
 if(room.status==='complete'&&room.endReveal?.done&&m.status==='reserved'){
  const winner=room.matchResult?.winner||['player1','player2'].find(p=>room.scores[p]>=room.targetPoints);
  if(!winner)fail('No hay resultado válido.');const next=settleVerifiedMatch(ledger,{id:m.id,winner:m.players[winner].uid,now});next.matches[m.id].revision++;return next;
 }return ledger;
}
function tableOperation(ledger,{code,uid,command,requestId,expectedMatchId,presence,now}){
 let next=structuredClone(ledger),m=tableFor(next,code),player=findPlayer(m,uid);
 if(!player)fail('No pertenecés a esta mesa.');
 m.requests??={};
 if(expectedMatchId&&expectedMatchId!==m.id)fail('La partida cambió. Esperá la actualización.');
 if(requestId&&Object.hasOwn(m.requests||{},requestId))return next;
 if(command.kind==='abandon'){
  if(m.status==='settled'||m.status==='refunded')return next;
  if(m.status!=='reserved'||!m.session)fail('La partida no está en juego.');
  const room=m.session.room;
  if(room.status==='complete'||Math.max(...Object.values(room.scores||{}))>=m.targetPoints){createReferee(m.session,{now}).advance();return finishAccounting(next,m,now);}
  if(room.status==='drawing'){
   room.status='closed';room.closeReason='draw-left';room.closedAt=now;
  }else{
   const winner=player==='player1'?'player2':'player1';
   Object.assign(room,{status:'complete',scores:{...room.scores,[winner]:m.targetPoints},matchResult:{winner,loser:player,reason:'abandon'},endReveal:{done:true},turn:null,turnClock:null,turnTimeout:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionEndsAt:null,rematch:null});
  }
  m.revision++;if(requestId)m.requests[requestId]=true;
  return finishAccounting(next,m,now);
 }
 if(command.kind==='cancel'){
  if(m.status==='waiting'){if(player!=='player1')fail('No podés cerrar esta mesa.');cancelWaiting(next,m,now);return next;}
  if(m.status==='settled'||m.status==='refunded'){m.closedAt=now;if(m.session)m.session.room.status='closed';m.revision++;return next;}
  if(command.reason==='draw-cancel'&&m.session?.room.status==='drawing'){m.session.room.status='closed';m.session.room.closeReason='draw-cancel';return finishAccounting(next,m,now);}
  fail('La partida está en juego. Podés irte al mazo.');
 }
 if(m.status==='waiting'){if(now-m.createdAt>=WAIT_MS)cancelWaiting(next,m,now);return next;}
 if(!m.session)fail('La mesa está cerrada.');
 if(command.kind==='chat'||command.kind==='mute'){
  const room=m.session.room;
  if(command.kind==='mute'){room.chatPreferences={...(room.chatPreferences||{}),[player]:{uid,muted:command.value===true}};}
  else{
   if(typeof command.text!=='string'||!command.text.trim()||command.text.length>40)fail('El mensaje debe tener hasta 40 caracteres.');
   const other=player==='player1'?'player2':'player1';if(room.chatPreferences?.[other]?.muted)fail('El rival ha silenciado los mensajes.');
   room.chatMessages??={};room.chatMessages[requestId]={sender:player,text:command.text.trim(),at:now};
  }
  m.revision++;if(requestId){m.requests[requestId]=true;const ids=Object.keys(m.requests);if(ids.length>100)delete m.requests[ids[0]];}return next;
 }
 if(presence&&m.status==='reserved'&&['started','revealing','timed-out'].includes(m.session.room.status)){
  const disconnected=Object.entries(presence).filter(([p,v])=>m.players[p]?.uid===v?.uid&&v.matchNumber===m.matchNumber&&v.online===false&&Number.isFinite(v.disconnectedAt)&&now-v.disconnectedAt>=45000).sort((a,b)=>a[1].disconnectedAt-b[1].disconnectedAt);
  if(disconnected.length){const loser=disconnected[0][0],winner=loser==='player1'?'player2':'player1';Object.assign(m.session.room,{status:'complete',scores:{...m.session.room.scores,[winner]:m.targetPoints},matchResult:{winner,loser,reason:'disconnect'},endReveal:{done:true},turn:null,turnClock:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false});m.revision++;return finishAccounting(next,m,now);}
 }
 const before=JSON.stringify(m.session);const referee=createReferee(m.session,{now});referee.advance();
 next=finishAccounting(next,m,now);m=tableFor(next,code);
 if(command.kind==='rematch'){
  if(m.status!=='settled')fail('Primero debe terminar la partida.');
  const r=m.session.room;if(['request','accept'].includes(command.value))checkWallet(next,uid,m.stake);if(command.value==='request'&&!r.rematch){r.rematch={id:requestId,requester:player,status:'pending'};}
  else if(r.rematch?.status==='pending'&&r.rematch.requester!==player&&['request','accept'].includes(command.value)){
   const newId=code+'_'+now+'_m'+(m.matchNumber+1),funded=reserveStakes(next,{id:newId,player1:m.player1,player2:m.player2,stake:m.stake,now});
   const record=funded.matches[newId];Object.assign(record,{id:newId,code,players:m.players,targetPoints:m.targetPoints,secret:m.secret,createdAt:now,revision:m.revision+1,requests:{},matchNumber:m.matchNumber+1});
   record.session=newSession(code,m.players,m.targetPoints,{id:newId,stake:m.stake,pot:m.stake*2,hasPassword:!!m.secret,matchNumber:record.matchNumber},now);
   record.session.room.sessionResults={...(r.sessionResults||{}),[m.matchNumber]:{winner:r.matchResult?.winner||['player1','player2'].find(p=>r.scores[p]>=r.targetPoints),scores:r.scores}};
   funded.tables[code]=newId;return funded;
  }else if(command.value==='decline'&&r.rematch?.status==='pending'&&r.rematch.requester!==player){r.rematch={...(r.rematch||{}),status:'declined'};}else fail('La revancha cambió.');
 }else if(command.kind!=='tick'){
  if(m.status!=='reserved')fail('La partida ya terminó.');
  createReferee(m.session,{now}).action(player,command);
 }
 if(before!==JSON.stringify(m.session))m.revision++;
 if(requestId){m.requests[requestId]=true;const ids=Object.keys(m.requests);if(ids.length>100)delete m.requests[ids[0]];}
 next=finishAccounting(next,m,now);return next;
}
function publicTable(m){
 if(m.status==='waiting')return {managedCredits:true,creditMatch:{id:m.id,stake:m.stake,pot:m.stake*2,hasPassword:!!m.secret},revision:m.revision,status:'waiting',deviceMode:'two',createdAt:m.createdAt,targetPoints:m.targetPoints,table:m.players.player1,players:m.players,scores:{player1:0,player2:0},handNumber:1,trickCards:[],feed:[]};
 const room=m.session?structuredClone(m.session.room):publicWaitingClosed(m);
 room.revision=m.revision;room.managedCredits=true;if(m.closedAt||m.status==='refunded')room.status='closed';
 room.handCounts=Object.fromEntries(['player1','player2'].map(p=>[p,m.session?.hands?.[p]?.length||0]));
 room.creditResult=m.status==='settled'?{winnerUid:m.winner,pot:m.stake*2,stake:m.stake}:null;return room;
}
function publicWaitingClosed(m){return {status:'closed',managedCredits:true,creditMatch:{id:m.id,stake:m.stake},players:m.players,createdAt:m.createdAt};}
module.exports={passwordHash,passwordMatches,createTable,joinTable,tableOperation,publicTable,tableFor};
