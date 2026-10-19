'use strict';
const crypto=require('node:crypto');
const SEATS=['player1','player2','player3','player4'];
const team=p=>['player1','player3'].includes(p)?'player1':'player2';
const opponent=t=>t==='player1'?'player2':'player1';
const ordered=first=>{const i=SEATS.indexOf(first);return [...SEATS.slice(i),...SEATS.slice(0,i)];};
const nextSeat=p=>SEATS[(SEATS.indexOf(p)+1)%4];
function deck(){const a=[];for(const [suit,name] of [['♦','oro'],['♥','copa'],['♠','espada'],['♣','basto']])for(const rank of [1,2,3,4,5,6,7,10,11,12])a.push({id:name+'-'+rank,suit,rank,label:String(rank),red:['♦','♥'].includes(suit)});for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function piece(c,m){if(c.suit!==m.suit)return 0;const ranks=[2,4,5,11,10];return ranks.indexOf(c.rank===12&&ranks.includes(m.rank)?m.rank:c.rank)+1;}
function strength(c,m){const p=piece(c,m);if(p)return 30-p;const id=c.id;if(id==='espada-1')return 20;if(id==='basto-1')return 19;if(id==='espada-7')return 18;if(id==='oro-7')return 17;return ({3:16,2:15,1:14,12:13,11:12,10:11,7:10,6:9,5:8,4:7})[c.rank];}
function value(c,m){const p=piece(c,m);return p?[30,29,28,27,27][p-1]:c.rank<10?c.rank:0;}
function flower(h,m){return h.length===3&&(h.filter(c=>piece(c,m)).length>=2||new Set(h.map(c=>c.suit)).size===1||h.some(c=>piece(c,m))&&new Set(h.filter(c=>!piece(c,m)).map(c=>c.suit)).size===1);}
function florValue(h,m){const pieces=h.filter(c=>piece(c,m)).sort((a,b)=>value(b,m)-value(a,m));return pieces.length?value(pieces[0],m)+h.filter(c=>c!==pieces[0]).reduce((n,c)=>n+(piece(c,m)?value(c,m)%10:value(c,m)),0):20+h.reduce((n,c)=>n+value(c,m),0);}
function envido(h,m){let best=0;for(let i=0;i<h.length;i++){best=Math.max(best,value(h[i],m));for(let j=i+1;j<h.length;j++)if(piece(h[i],m)||piece(h[j],m))best=Math.max(best,value(h[i],m)+value(h[j],m));else if(h[i].suit===h[j].suit)best=Math.max(best,20+value(h[i],m)+value(h[j],m));}return best;}
function settledTricks(tricks,mano){const a=tricks[0]?.winner,b=tricks[1]?.winner;if(tricks.length<2)return null;if(a&&(!b||a===b))return a;if(!a&&b)return b;if(tricks.length<3)return null;return tricks[2].winner||a||team(mano);}
function newTeamSession(code,players,targetPoints,creditMatch,now=Date.now()){
 const s={code,hands:{},originals:{},truth:{},drawPool:deck(),room:{mode:'2v2',managedCredits:true,creditMatch,deviceMode:'two',status:'drawing',createdAt:now,matchNumber:creditMatch.matchNumber||1,targetPoints,table:players.player1,players,teams:{player1:['player1','player3'],player2:['player2','player4']},scores:{player1:0,player2:0},handNumber:0,trickNo:1,playedCount:0,tricks:[],trickCards:[],feed:[],trucoLevel:1,flors:{},timeoutCounts:{},openingDraw:{cards:{},endsAt:now+60000}}};createTeamReferee(s,{now}).start();return s;
}
function createTeamReferee(s,{now=Date.now(),deckFactory=deck}={}){
 const r=s.room;
 // Realtime Database omits empty collections and null fields on a round-trip.
 r.tricks=Array.isArray(r.tricks)?r.tricks:Object.values(r.tricks||{});r.trickCards=Array.isArray(r.trickCards)?r.trickCards:Object.values(r.trickCards||{});
 r.flors??={};r.timeoutCounts??={};r.playedBy??={};r.folded??={};r.feed??=[];s.hands??={};s.originals??={};s.truth??={};
 if(r.openingDraw)r.openingDraw.cards??={};
 const feed=text=>{r.feed=[{text,time:now},...(r.feed||[])].slice(0,12);};
 const notice=(p,text)=>{r.callNotice={id:crypto.randomUUID(),from:p,text,spoken:text,time:now,handNumber:r.handNumber};};
 const active=p=>!r.folded?.[p];
 const members=t=>ordered(r.mano||'player1').filter(p=>team(p)===t&&active(p));
 const responder=t=>members(t).at(0);
 function resume(bet){r.pendingBet=bet||null;if(bet&&!active(bet.responder))bet.responder=responder(opponent(bet.callerTeam),bet.type==='flor');}
 const rest=()=>Math.max(1,r.targetPoints-Math.max(...Object.values(r.scores)));
 const envidoStake=(kind,base=0)=>kind==='falta'?(Math.max(...Object.values(r.scores))<r.targetPoints/2?r.targetPoints:rest()):base+(kind==='real'?3:2)>rest()?2:base+(kind==='real'?3:2);
 function award(t,n,detail){r.scores[t]=Math.min(r.targetPoints,r.scores[t]+n);r.handScoreEntries??=[];r.handScoreEntries.push({player:t,points:n,detail});feed(detail);}
 function evidence(){const groups=[];for(const p of Object.keys(r.flors||{}))groups.push({player:p,name:r.players[p].name,cards:s.originals[p],label:'FLOR'+(r.florCompared?' · '+florValue(s.originals[p],r.muestra):'')});if(r.envidoAudit){const p=r.envidoAudit.winner;groups.push({player:p,name:r.players[p].name,cards:s.originals[p],label:r.envidoAudit.value+' TANTOS'});}return groups;}
 function finish(winner,points,reason='Mano ganada.'){
  if(r.status!=='started')return;
  if(r.envidoAudit&&!r.envidoAudit.settled){
   const a=r.envidoAudit,liar=a.order.find(p=>a.reveals[p]>=0&&a.reveals[p]!==s.truth[p]);
   if(liar){winner=opponent(team(liar));const candidates=ordered(r.mano).filter(p=>team(p)===winner);a.winner=candidates.reduce((best,p)=>s.truth[p]>s.truth[best]?p:best,candidates[0]);a.value=s.truth[a.winner];reason='Declaración incorrecta de '+r.players[liar].name+'. El rival gana el envido y la mano.';}
   award(team(a.winner),a.stake,liar?reason:'Envido ganado por '+r.players[a.winner].name+'.');a.settled=true;
  }
  if(points)award(winner,points,reason);
  r.lastHandScore={handNumber:r.handNumber,totals:Object.fromEntries(['player1','player2'].map(t=>[t,(r.handScoreEntries||[]).filter(e=>e.player===t).reduce((n,e)=>n+e.points,0)])),entries:r.handScoreEntries||[],names:{player1:'Equipo 1',player2:'Equipo 2'},time:now};
  r.handScoreHistory=[...(r.handScoreHistory||[]),r.lastHandScore].slice(-60);
  r.turn=null;r.turnClock=null;r.pendingBet=null;r.pendingNextHand=null;r.resolvingTrick=false;r.resolutionEndsAt=null;
  const groups=evidence(),won=['player1','player2'].find(t=>r.scores[t]>=r.targetPoints);
  r.endReveal={groups,endsAt:now+(groups.length?5000:3000),done:!groups.length};
  r.status=won?'complete':'revealing';if(won)r.matchResult={winner:won,reason};
 }
 function checkWin(){const t=['player1','player2'].find(t=>r.scores[t]>=r.targetPoints);if(t){finish(t,0,'Partida ganada.');return true;}return false;}
 function deal(dealer=r.dealer||'player4'){
  const cards=deckFactory();r.dealer=dealer;r.mano=nextSeat(dealer);r.handNumber++;r.status='started';r.turn=r.mano;
  s.hands=Object.fromEntries(SEATS.map((p,i)=>[p,cards.slice(i*3,i*3+3)]));s.originals=structuredClone(s.hands);r.muestra=cards[12];s.truth=Object.fromEntries(SEATS.map(p=>[p,envido(s.hands[p],r.muestra)]));
  Object.assign(r,{deckCount:27,trickNo:1,playedCount:0,tricks:[],trickCards:[],folded:{},playedBy:{},trucoLevel:1,lastTrucoTeam:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionEndsAt:null,flors:{},florSettled:false,florCompared:false,envidoClosed:false,envidoAudit:null,endReveal:null,handScoreEntries:[]});r.callNotice=null;feed('Nueva mano. Empieza '+r.players[r.mano].name+'.');
 }
 function clock(){const p=r.pendingBet?.revealMode?r.pendingBet.revealTurn:r.pendingBet?.responder||r.turn;const key=r.status==='started'&&!r.resolvingTrick&&!r.pendingNextHand&&p?`${r.handNumber}:${r.trickNo}:${r.playedCount}:${p}:${r.pendingBet?.id||''}:${r.pendingBet?.revealTurn||''}`:null;if(!key)r.turnClock=null;else if(r.turnClock?.key!==key)r.turnClock={key,player:p,startedAt:now};}
 function fold(p){r.folded??={};r.folded[p]=true;notice(p,'Me voy al mazo');feed(r.players[p].name+' se fue al mazo.');const t=team(p);if(!members(t).length){const b=r.pendingBet,w=opponent(t);if(b&&b.type!=='truco'){award(w,(b.revealMode?b.stake:b.accepted)||(['envido','flor'].includes(b.type)?b.type==='flor'?3:1:0),'El rival se fue al mazo.');}r.pendingNextHand={id:'fold:'+crypto.randomUUID(),winner:w,foldPoints:r.trucoLevel,endsAt:now+3000};r.pendingBet=null;r.turn=null;}else if(r.pendingBet?.revealTurn===p){declare(p,0,true);}else if(r.pendingBet?.responder===p){r.pendingBet.responder=responder(t,r.pendingBet.type==='flor');if(!r.pendingBet.responder)resolveSide(false);}else if(r.turn===p){r.turn=nextActive(p);completeTrick();}if(r.turn===p)r.turn=nextActive(p);}
 function nextActive(p){for(let i=0;i<4;i++){p=nextSeat(p);if(active(p))return p;}return null;}
 function completeTrick(){const cards=r.trickCards||[];if(!SEATS.filter(active).every(p=>cards.some(c=>c.playerId===p)))return;
  if(!cards.length)return;const best=Math.max(...cards.map(c=>strength(c.card,r.muestra)));const leaders=cards.filter(c=>strength(c.card,r.muestra)===best);const teams=new Set(leaders.map(c=>team(c.playerId)));const winner=teams.size===1?team(leaders[0].playerId):null;
  r.tricks.push({winner,leader:leaders[0].playerId,cards:structuredClone(cards)});r.resolvedTrickWinner=winner?leaders[0].playerId:cards[0].playerId;r.resolvingTrick=true;r.resolutionEndsAt=now+1800;r.turn=null;
 }
 function play(p,id){if(r.pendingBet||r.turn!==p||!active(p))throw new Error('No te corresponde jugar.');const c=s.hands[p].find(c=>c.id===id);if(!c)throw new Error('Esa carta no está en tu mano.');s.hands[p]=s.hands[p].filter(c=>c.id!==id);r.playedBy[p]=(r.playedBy[p]||0)+1;r.playedCount++;r.trickCards.push({playerId:p,name:r.players[p].name,card:c});r.turn=nextActive(p);completeTrick();}
 function flor(p){if(!flower(s.originals[p]||[],r.muestra)||r.flors[p]!=null||(r.playedBy?.[p]||0)>0)throw new Error('No podés cantar flor.');
  const suspended=r.pendingBet?.type==='truco'?r.pendingBet:r.pendingBet?.suspendedBet||null;
  // Every real flower is announced together, preventing an envido from settling
  // before an opponent later reveals a flower. Individual points remain private.
  for(const q of SEATS)if(flower(s.originals[q],r.muestra)&&((r.playedBy[q]||0)===0||r.flors[q]!=null))r.flors[q]=true;
  r.envidoClosed=true;notice(p,'Flor');
  const teams=new Set(Object.keys(r.flors).map(team));if(teams.size===1){award(team(p),Object.keys(r.flors).length*3,'Flores del equipo: '+Object.keys(r.flors).length+'.');r.florSettled=true;resume(suspended);checkWin();return;}
  r.pendingBet={id:crypto.randomUUID(),type:'flor',caller:p,callerTeam:team(p),responder:responder(opponent(team(p)),true),stake:3,accepted:0,called:'flor',suspendedBet:suspended};
 }
 function call(p,v){const b=r.pendingBet;
  if(v==='flor'){flor(p);return;}
  if(['yes','no','raise'].includes(v)||v.startsWith('raise-')){if(!b||b.responder!==p||b.revealMode)throw new Error('Le corresponde responder a la mano del equipo.');
   if(b.type!=='flor'&&(r.playedBy[p]||0)===0&&flower(s.originals[p],r.muestra)&&r.flors[p]==null)throw new Error('Tenés flor. Cantala antes de responder.');
   if(v==='no'){if(b.type==='truco'){r.pendingNextHand={id:'declined:'+crypto.randomUUID(),winner:b.callerTeam,foldPoints:b.stake-1,endsAt:now+3000};r.pendingBet=null;r.turn=null;}else resolveSide(false);notice(p,b.type==='flor'?'Con flor me achico':'No quiero');return;}
   if(v==='raise'||v.startsWith('raise-')){
    if(b.type==='truco'&&v==='raise'&&b.stake<4){b.stake++;b.called=b.stake===3?'retruco':'vale4';}
    else if(b.type==='envido'&&b.called!=='falta'&&['raise-envido','raise-real','raise-falta'].includes(v)){b.accepted=b.stake;b.called=v.slice(6);b.stake=envidoStake(b.called,b.stake);}
    else if(b.type==='flor'&&['raise-conflor','raise-faltaflor'].includes(v)&&b.called==='flor'){b.accepted=b.stake;b.called=v==='raise-conflor'?'conflor':'falta';b.stake=b.called==='falta'?r.targetPoints:5;}
    else throw new Error('No se puede subir ese canto.');
    b.caller=p;b.callerTeam=team(p);b.responder=responder(opponent(team(p)),b.type==='flor');b.id=crypto.randomUUID();notice(p,b.type==='truco'?b.stake===3?'Retruco':'Vale cuatro':b.called==='conflor'?'Con flor envido':b.called==='falta'?(b.type==='flor'?'Contra flor al resto':'Falta envido'):b.called==='real'?'Real envido':'Envido');return;
   }
   if(b.type==='truco'){r.trucoLevel=b.stake;r.lastTrucoTeam=b.callerTeam;r.pendingBet=null;notice(p,'Quiero');}
   else if(b.type==='flor')resolveSide(true);
   else{b.revealMode=true;b.reveals={};b.order=ordered(r.mano).filter(active);b.revealTurn=b.order[0];b.responder=b.revealTurn;notice(p,'Quiero');}return;
  }
  if(b?!(b.type==='truco'&&b.responder===p&&['envido','real','falta'].includes(v)):r.turn!==p)throw new Error('Esperá tu turno.');
  if((r.playedBy[p]||0)===0&&flower(s.originals[p],r.muestra)&&r.flors[p]==null)throw new Error('Tenés flor. Cantala primero.');
  if(['envido','real','falta'].includes(v)){if(r.envidoClosed||(r.playedBy?.[p]||0)>0||r.trickNo!==1)throw new Error('El envido ya está cerrado.');const withFlor=SEATS.find(q=>active(q)&&(r.playedBy[q]||0)===0&&flower(s.originals[q],r.muestra));if(withFlor){flor(withFlor);return;}r.pendingBet={id:crypto.randomUUID(),type:'envido',caller:p,callerTeam:team(p),responder:responder(opponent(team(p))),stake:envidoStake(v),accepted:0,called:v,suspendedBet:b||null};}
  else if(['truco','retruco','vale4'].includes(v)){const wanted={truco:2,retruco:3,vale4:4}[v];if(b||wanted!==r.trucoLevel+1||wanted>4||r.lastTrucoTeam===team(p))throw new Error('Ese grito no está disponible.');r.pendingBet={id:crypto.randomUUID(),type:'truco',caller:p,callerTeam:team(p),responder:responder(opponent(team(p))),stake:wanted,called:v};}
  else throw new Error('Canto inválido.');notice(p,({truco:'Truco',retruco:'Retruco',vale4:'Vale cuatro',envido:'Envido',real:'Real envido',falta:'Falta envido'})[v]);
 }
 function resolveSide(accepted){const b=r.pendingBet;if(!b)return;let winner=b.callerTeam,n=b.accepted|| (b.type==='flor'?Object.keys(r.flors).filter(p=>team(p)===b.callerTeam).length*3:1);
  if(accepted){const eligible=ordered(r.mano).filter(p=>r.flors[p]!=null);const best=eligible.reduce((a,p)=>!a||florValue(s.originals[p],r.muestra)>florValue(s.originals[a],r.muestra)?p:a,null);winner=team(best);n=b.stake;r.florCompared=b.called!=='flor';}
  award(winner,n,accepted?'Flor ganada.':'El rival no quiso '+(b.type==='flor'?'la flor.':'el envido.'));if(b.type==='flor')r.florSettled=true;r.envidoClosed=true;resume(b.suspendedBet);checkWin();
 }
 function declare(p,n,good){
  const b=r.pendingBet;if(!b?.revealMode||b.revealTurn!==p)throw new Error('No te corresponde declarar.');
  if(!good&&(!Number.isInteger(n)||n<0||n>37))throw new Error('Elegí un valor entre 0 y 37.');
  b.reveals??={};if(good&&!Object.values(b.reveals).some(v=>v>=0)&&active(p))throw new Error('El mano declara primero sus tantos.');
  b.reveals[p]=good?-1:n;notice(p,good?'Son buenas':n+' tantos');
  const i=b.order.indexOf(p),next=b.order.slice(i+1).find(active);
  if(next){b.revealTurn=next;b.responder=next;return;}
  const best=b.order.reduce((a,q)=>!a||(b.reveals[q]??-1)>(b.reveals[a]??-1)?q:a,null);
  r.envidoAudit={winner:best,value:b.reveals[best],stake:b.stake,reveals:b.reveals,order:b.order,settled:false};r.envidoClosed=true;resume(b.suspendedBet);
  if(b.called==='falta')finish(team(best),0,'Falta envido: se verifican los tantos.');
 }
 function advance(){
  if(r.status==='drawing'){deal('player4');r.openingDraw=null;delete s.drawPool;}
  if(r.status==='started'&&r.resolvingTrick&&now>=r.resolutionEndsAt){const w=settledTricks(r.tricks,r.mano);r.resolvingTrick=false;r.resolutionEndsAt=null;if(w)finish(w,r.trucoLevel);else{r.trickCards=[];r.trickNo++;r.turn=active(r.resolvedTrickWinner)?r.resolvedTrickWinner:nextActive(r.resolvedTrickWinner);}}
  if(r.status==='started'&&r.pendingNextHand&&now>=r.pendingNextHand.endsAt){const b=r.pendingNextHand;finish(b.winner,b.foldPoints,'El equipo rival se retiró o no quiso.');}
  if(r.status==='complete'&&r.endReveal&&!r.endReveal.done&&now>=r.endReveal.endsAt)r.endReveal.done=true;
  if(r.status==='revealing'&&now>=r.endReveal.endsAt)deal(nextSeat(r.dealer));
  if(r.status==='started'&&r.turnClock&&now-r.turnClock.startedAt>=45000){const p=r.turnClock.player;r.timeoutCounts[p]=(r.timeoutCounts[p]||0)+1;if(r.timeoutCounts[p]>=3){finish(opponent(team(p)),r.targetPoints,'Inactividad.');r.endReveal.done=true;}else if(r.pendingBet?.responder===p&&!r.pendingBet.revealMode)call(p,'no');else if(r.pendingBet?.revealMode)declare(p,s.truth[p],false);else fold(p);}
  clock();return s;
 }
 function action(p,c){if(!SEATS.includes(p))throw new Error('Jugador inválido.');advance();if(c.kind==='draw'){if(r.status!=='drawing'||r.openingDraw.cards[p])throw new Error('El sorteo cambió.');r.openingDraw.cards[p]=s.drawPool.shift();if(SEATS.every(q=>r.openingDraw.cards[q]))r.openingDraw.resolveAt=now+2000;return advance();}
  if(r.status!=='started'||r.resolvingTrick||r.pendingNextHand)throw new Error('Esperá a que termine la pausa.');if(!active(p))throw new Error('Te fuiste al mazo en esta mano.');if(c.kind==='play')play(p,c.cardId);else if(c.kind==='call')call(p,c.value);else if(c.kind==='fold')fold(p);else if(c.kind==='declare')declare(p,c.value,c.good===true);else throw new Error('Acción inválida.');return advance();}
 return {action,advance,start:()=>{deal('player4');r.openingDraw=null;delete s.drawPool;clock();return s;}};
}
module.exports={SEATS,team,nextSeat,ordered,piece,strength,flower,florValue,envido,settledTricks,newTeamSession,createTeamReferee};
