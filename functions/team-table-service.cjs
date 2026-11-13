'use strict';
const {SEATS,team,newTeamSession,createTeamReferee}=require('./team-referee.cjs');
const {blockedChatReason}=require('./chat-moderation.cjs');
const {isBotUid,botPlayer}=require('./bot-seat.cjs');
const opposite=t=>t==='player1'?'player2':'player1';
const fail=text=>{throw new Error(text);};
// Bots have no wallet: the bank covers their stake, so only people pay or collect.
const humanSeats=m=>SEATS.filter(p=>m.players[p]&&!isBotUid(m.players[p].uid));
// A table without stake (stake 0) never touches a wallet.
function wallet(ledger,uid,stake){if(stake===0)return null;const w=ledger.wallets?.[uid];if(!w||w.deletedAt||w.deleting||!Number.isSafeInteger(w.balance)||!Number.isSafeInteger(w.locked)||w.locked!==0||!Number.isSafeInteger(stake)||stake<1||w.balance<stake)fail('No tenés créditos disponibles para esta apuesta.');return w;}
function refund(ledger,m,now,reason){if(reason)m.closeReason=reason;for(const p of m.stake>0?humanSeats(m):[]){const w=ledger.wallets[m.players[p].uid];if(w.locked!==m.stake)fail('La reserva cambió.');w.balance+=m.stake;w.locked=0;}m.status='refunded';m.refundedAt=now;m.closedAt=now;m.revision++;return ledger;}
function account(ledger,m,now){const r=m.session?.room;if(!r)return ledger;if(!m.startedAt&&r.status==='started')m.startedAt=now;if(r.status==='closed'&&m.status==='reserved')return refund(ledger,m,now);if(r.status==='complete'&&r.endReveal?.done&&m.status==='reserved'){
 const t=r.matchResult?.winner;if(!['player1','player2'].includes(t))fail('Resultado de equipos inválido.');
 const people=humanSeats(m),winners=people.filter(p=>team(p)===t).map(p=>m.players[p].uid);
 const paid=m.stake>0?people:[];
 for(const p of paid){const w=ledger.wallets[m.players[p].uid];if(w.locked!==m.stake)fail('La reserva no coincide con la partida.');}
 for(const p of paid){const w=ledger.wallets[m.players[p].uid];w.locked=0;if(winners.includes(m.players[p].uid))w.balance+=m.stake*2;}
 m.status='settled';m.winners=winners;m.winner=winners[0]??null;m.settledAt=now;m.revision++;
 }return ledger;}
// Waiting room: who comes and goes is written in its chat, so everyone sees it.
const WAITING_DROP_MS=120000;
function lobbyLine(m,line,now){m.lobbyChat??={};m.lobbySeq=(m.lobbySeq||0)+1;m.lobbyChat['s'+now+'-'+m.lobbySeq]={...line,at:now};const keys=Object.keys(m.lobbyChat);if(keys.length>60)delete m.lobbyChat[keys[0]];}
// A player who is not the creator leaves the waiting room: only their seat is freed and their stake returned.
function leaveSeat(ledger,m,seat,now,text='salió de la sala'){
 const person=m.players[seat];if(!person)return ledger;
 if(m.stake>0&&!isBotUid(person.uid)){const w=ledger.wallets[person.uid];if(w.locked!==m.stake)fail('La reserva cambió.');w.balance+=m.stake;w.locked=0;}
 delete m.players[seat];delete m[seat];if(!isBotUid(person.uid))lobbyLine(m,{system:true,text:(person.name||'Un jugador')+' '+text},now);m.revision++;return ledger;
}
// Seats whose player has been disconnected from the waiting room for a while.
const droppedSeats=(m,presence,now)=>SEATS.filter(q=>m.players[q]&&!isBotUid(m.players[q].uid)&&presence?.[q]?.uid===m.players[q].uid&&presence[q].online===false&&Number.isFinite(presence[q].disconnectedAt)&&now-presence[q].disconnectedAt>=WAITING_DROP_MS);
function startWhenFull(m,now){if(SEATS.every(p=>m.players[p])){m.status='reserved';m.session=newTeamSession(m.code,m.players,m.targetPoints,{id:m.id,stake:m.stake,pot:4*m.stake,hasPassword:!!m.secret,matchNumber:m.matchNumber},now);
 const said=Object.entries(m.lobbyChat||{}).filter(([,x])=>!x.system&&x.sender);if(said.length)m.session.room.chatMessages=Object.fromEntries(said.map(([k,x])=>[k,{sender:x.sender,text:x.text,at:x.at}]));}}
function join(ledger,m,{uid,name,team:requested,now}){if(Object.values(m.players).some(p=>p.uid===uid))return ledger;if(m.status!=='waiting'||now-m.createdAt>=600000)fail('La mesa ya no está disponible.');const seat=SEATS.find(p=>!m.players[p]&&(!requested||team(p)===requested));if(!seat)fail('Ese equipo ya está completo.');const w=wallet(ledger,uid,m.stake);if(w){w.balance-=m.stake;w.locked=m.stake;}m[seat]=uid;m.players[seat]={uid,name,online:true};lobbyLine(m,{system:true,text:(name||'Un jugador')+' entró a la sala'},now);m.revision++;
 startWhenFull(m,now);return ledger;}
// "Usar bot": only the table's creator fills an empty seat with a bot.
function addBot(ledger,m,{by,seat,now}){if(by!=='player1')fail('Solo quien creó la mesa puede sumar bots.');if(!SEATS.includes(seat)||m.players[seat])fail('Ese lugar ya está ocupado.');const bot=botPlayer(seat);m[seat]=bot.uid;m.players[seat]=bot;m.revision++;startWhenFull(m,now);return ledger;}
function operation(ledger,m,{uid,command:c,requestId,expectedMatchId,presence,now}){
 const p=SEATS.find(p=>m.players[p]?.uid===uid);if(!p)fail('No pertenecés a esta mesa.');if(expectedMatchId&&expectedMatchId!==m.id)fail('La partida cambió. Esperá la actualización.');m.requests??={};if(requestId&&m.requests[requestId])return ledger;
 if(m.status==='waiting'){
  if(now-m.createdAt>=600000)return refund(ledger,m,now,'waiting-expired');
  // The creator leaving (or disconnected for a while) closes the room; anyone else only frees their seat.
  const dropped=droppedSeats(m,presence,now);
  if(dropped.includes('player1'))return refund(ledger,m,now,'creator-left');
  for(const q of dropped)leaveSeat(ledger,m,q,now,'se desconectó');
  if(c.kind==='cancel'||c.kind==='abandon'){if(p==='player1')return refund(ledger,m,now,'creator-left');if(m.players[p])leaveSeat(ledger,m,p,now);return ledger;}
  if(!m.players[p])return ledger;
  if(c.kind==='add-bot')return addBot(ledger,m,{by:p,seat:c.seat,now});
  if(c.kind==='chat'){
   if(typeof c.text!=='string'||!c.text.trim()||c.text.trim().length>40||blockedChatReason(c.text))fail('El mensaje no se puede enviar.');
   if(requestId){if(m.requests[requestId])return ledger;m.requests[requestId]=true;const ids=Object.keys(m.requests);for(const id of ids.slice(0,Math.max(0,ids.length-100)))delete m.requests[id];}
   lobbyLine(m,{sender:p,name:m.players[p].name||'',text:c.text.trim()},now);m.revision++;return ledger;
  }
  if(c.kind!=='tick')fail('Esperando a los cuatro jugadores.');return ledger;
 }
 if(m.status==='refunded')return ledger;
 if(!m.session)fail('Mesa cerrada.');let r=m.session.room;
 // A timer step that fails must never trap the players: abandoning still ends the match.
 const before=JSON.stringify(m.session);try{createTeamReferee(m.session,{now}).advance();}catch(error){if(c.kind!=='abandon')throw error;}account(ledger,m,now);
 if(c.kind==='abandon'&&m.status==='reserved'){
  if(r.status==='drawing'){r.status='closed';return refund(ledger,m,now);}
  const t=opposite(team(p));Object.assign(r,{status:'complete',scores:{...r.scores,[t]:m.targetPoints},matchResult:{winner:t,loser:p,reason:'abandon'},endReveal:{done:true},turn:null,turnClock:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false});
 }else if(c.kind==='cancel'){
  if(['settled','refunded'].includes(m.status)){m.closedAt=now;r.status='closed';r.closeReason??='match-left';}
  else if(r.status==='drawing'){r.status='closed';return refund(ledger,m,now);}else fail('La partida está en juego.');
 }else if(c.kind==='rematch'){
  if(m.status!=='settled')fail('Primero debe terminar la partida.');
  if(c.value==='decline'){r.rematch={...(r.rematch||{}),status:'declined'};}
  else if(['request','accept'].includes(c.value)){
   wallet(ledger,uid,m.stake);const prior=r.rematch?.status==='pending'?r.rematch:null;
   // Bots always accept a rematch.
   const bots=Object.fromEntries(SEATS.filter(q=>isBotUid(m.players[q].uid)).map(q=>[q,true]));
   r.rematch={id:prior?.id||requestId,requester:prior?.requester||p,status:'pending',votes:{...(prior?.votes||{}),...bots,[p]:true}};
   if(SEATS.every(q=>r.rematch.votes[q])){
    for(const q of humanSeats(m))wallet(ledger,m.players[q].uid,m.stake);
    if(m.stake>0)for(const q of humanSeats(m)){const w=ledger.wallets[m.players[q].uid];w.balance-=m.stake;w.locked=m.stake;}
    const id=m.code+'_'+now+'_m'+(m.matchNumber+1),n={...structuredClone(m),id,status:'reserved',createdAt:now,matchNumber:m.matchNumber+1,requests:{},revision:m.revision+1};delete n.winner;delete n.winners;delete n.settledAt;delete n.closedAt;delete n.startedAt;
    n.session=newTeamSession(m.code,m.players,m.targetPoints,{id,stake:m.stake,pot:m.stake*4,hasPassword:!!m.secret,matchNumber:n.matchNumber},now);
    n.session.room.sessionResults={...(r.sessionResults||{}),[m.matchNumber]:{winner:r.matchResult.winner,scores:r.scores}};ledger.matches[id]=n;ledger.tables[m.code]=id;return ledger;
   }
  }else fail('Revancha inválida.');
 }else if(c.kind==='chat'||c.kind==='mute'){
  if(c.kind==='mute'){r.chatPreferences={...(r.chatPreferences||{}),[p]:{uid,muted:c.value===true}};}
  else{if(typeof c.text!=='string'||!c.text.trim()||c.text.length>40||blockedChatReason(c.text))fail('El mensaje no se puede enviar.');if(r.chatPreferences?.[p]?.muted)fail('Silenciaste el chat.');r.chatMessages??={};r.chatMessages[requestId]={sender:p,text:c.text.trim(),at:now};}
 }else if(c.kind!=='tick'){if(m.status!=='reserved')fail('La partida ya terminó.');createTeamReferee(m.session,{now}).action(p,c);}
 if(presence&&m.status==='reserved'&&['started','revealing'].includes(r.status)){
  const lost=SEATS.find(q=>presence[q]?.uid===m.players[q].uid&&presence[q].matchNumber===m.matchNumber&&presence[q].online===false&&Number.isFinite(presence[q].disconnectedAt)&&now-presence[q].disconnectedAt>=45000);
  if(lost){const t=opposite(team(lost));Object.assign(r,{status:'complete',scores:{...r.scores,[t]:m.targetPoints},matchResult:{winner:t,loser:lost,reason:'disconnect'},endReveal:{done:true},turn:null,turnClock:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false});}
 }
 if(before!==JSON.stringify(m.session))m.revision++;if(requestId){m.requests[requestId]=true;const ids=Object.keys(m.requests);if(ids.length>100)delete m.requests[ids[0]];}return account(ledger,m,now);
}
module.exports={join,operation,refund};
