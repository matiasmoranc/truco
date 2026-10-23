const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function extract(name){
 const expression=new RegExp('^(async )?function '+name+'\\(','m'),match=expression.exec(source);
 assert.ok(match,'Missing function '+name);
 const start=match.index,open=source.indexOf('{',start);let depth=1,end=open+1;
 for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
 return source.slice(start,end);
}
const names=['roomTransportConnected','liveSnapshot','envidoAuditResult','settleAuditedHand','auditEnvidoScores','trickWinnerMark','botRivalHands','canRaiseEnvido','closeFinishedRoomChanges','pieceOrder','cardStrength','envidoValue','hasFlor','handEnvido','florValue','normalizeTargetPoints','targetPoints','capScores','faltanParaGanar','faltaEnvidoPoints','envidoBetPoints','florBetPoints','declinedFlorPoints','florAnswers','otherPlayer','settleHand','topFeed','matchWinner','matchFinished','sessionMatchResults','sessionWins','rematchRoom','rematchChanges','botDeck','botHandOutcome','rememberBotCards','botRiskAdjustment','assessBotHand','chooseBotDecision','disconnectedPlayer','disconnectMatchChanges','turnClockPlayer','turnClockRemaining','turnTimeoutChanges','declinedTrucoChanges','liveActionsBlocked','runLiveAction','privateHandMatchesRoom','roomHasFlor','canCallFirstRoundEnvido','enqueueLearningHelp','rememberLearningHelp','learningHelpTopic','localHand','localFeed','localCallAction','localAnswerAction','localPlay'];
function harness(){
 const context={account:{isReady:()=>true},console,Math:Object.create(Math),Date,crypto:require('node:crypto').webcrypto,structuredClone,Set,Map,navigator:{onLine:true},state:{},localStorage:{setItem(){}},learningSeen:new Set(),VALID_TARGET_POINTS:[10,20,30,40,50,60],RECONNECT_GRACE_MS:45000,PRACTICE_PAUSE_MS:5000,gameTime:()=>100000,newOpeningDraw:()=>({cards:{}}),makeCallNotice:text=>({text}),renderGame(){},renderConnectionNotice(){},syncLiveControls(){},touchFeedback(){},toast(){},firebaseError:String,queueLearningAction(){},queueLearningTrucoCall(){},turnClockKey:()=>null,pauseMessage:()=>null,animatePlayedHandCard(){},shakeTurnBadge(){},scheduleLocalNextHand(){},scheduleLocalTransition(room,fn){context.transition=fn;},localFinishHand(winner,points){context.finished={winner,points};},localScore(player,points){context.state.room.scores[player]=Math.min(20,context.state.room.scores[player]+points);},localResolveFlor(){},revealEnvido(){}};
 vm.createContext(context);vm.runInContext(names.map(extract).join('\n'),context);return context;
}
const card=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada','♣':'basto'}[suit])+'-'+rank,suit,rank});
test('Folding with cards renders its animation and schedules the following hand in bot and practice games',async()=>{
 for(const practice of [false,true]){
  const c=harness(),r=room(),flights=[],errors=[];
  const rect={left:50,top:400,width:100,height:160};
  const source={offsetWidth:90,offsetHeight:150,getBoundingClientRect:()=>rect,cloneNode:()=>({style:{},classList:{remove(){},add(){}},removeAttribute(){},setAttribute(){},animate(){},remove(){}})};
  const nodes={'game-view':{classList:{toggle(){}}},hand:{querySelectorAll:()=>[source,source]},'deck-stack':{getBoundingClientRect:()=>({left:250,top:200,width:60,height:100})}};
  c.$=id=>nodes[id];c.document={body:{append:flight=>flights.push(flight)}};c.setTimeout=()=>1;
  c.toast=message=>errors.push(message);c.state={room:r,playerId:'player1',localGame:true,learning:practice?{}:null};
  c.renderGame=()=>c.animateFoldedHand();
  vm.runInContext(['canFoldHand','foldHandChanges','animateFoldedHand','scheduleLocalNextHand','foldHand'].map(extract).join('\n'),c);
  c.clearTimeout=()=>{};
  await c.foldHand();
  assert.deepEqual(errors,[]);assert.equal(flights.length,2);
  assert.equal(flights[0].style.width,'90px');assert.equal(flights[0].style.height,'150px');
  assert.equal(typeof c.transition,'function');c.transition();
  assert.equal(c.finished.winner,'player2');assert.equal(c.finished.points,2);
  assert.equal(c.state.foldInFlight,false);
 }
});
test('Own normal-table calls use the requested verbs; raised envido and rival notices stay distinct',()=>{
 const c=harness();c.escapeHtml=String;c.state={playerId:'player1',room:{handNumber:1,players:{player2:{name:'Ricky'}}}};
 vm.runInContext(['spokenCall','callNoticeText','ownCallVerb','makeCallNotice','callNoticeHtml'].map(extract).join('\n'),c);
 for(const [call,verb] of [['envido','Tocaste'],['truco','Gritaste'],['flor','Cantaste'],['retruco','Dijiste'],['vale cuatro','Dijiste'],['real envido','Dijiste'],['falta envido','Dijiste'],['con flor envido','Dijiste'],['contra flor al resto','Dijiste']]){
  const n=c.makeCallNotice('Mati dice '+call+'.',{calls:[call],accepted:0});
  assert.equal(c.callNoticeHtml(n),verb+' <strong>'+call.toUpperCase()+'</strong>');
 }
 const raised=c.makeCallNotice('Mati dice envido.',{calls:['envido','envido'],accepted:2});assert.equal(raised.selfVerb,'Dijiste');
 c.state.playerId='player2';assert.equal(c.callNoticeHtml(raised,{players:{player1:{name:'Mati'}}}),'Mati dice <strong>ENVIDO</strong>');
 c.state.playerId='player1';c.state.learning={};assert.equal(c.callNoticeHtml(raised,{players:{player1:{name:'Mati'}}}),'Dijiste <strong>ENVIDO</strong>');
});
const room=()=>({status:'started',targetPoints:20,matchNumber:1,handNumber:1,trickNo:1,playedCount:0,turn:'player1',mano:'player1',trucoLevel:1,muestra:card('♦',7),scores:{player1:0,player2:0},players:{player1:{name:'Mati',uid:'a'},player2:{name:'Ricky',uid:'b'}},tricks:[],trickCards:[],flors:{},feed:[],deckCount:33});
test('Ties settle correctly, including all three tied rounds',()=>{const c=harness(),r=room();for(const [rounds,winner] of [[['player1',null],'player1'],[[null,'player2'],'player2'],[['player1','player2',null],'player1'],[[null,null,null],'player1']])assert.equal(c.settleHand(rounds.map(winner=>({winner})),r),winner);});
test('Envido, flor, replacement king and score caps',()=>{const c=harness(),r=room();assert.equal(c.handEnvido([card('♥',6),card('♥',7),card('♠',10)],r.muestra),33);assert.equal(c.florValue([card('♦',2),card('♦',5),card('♠',6)],r.muestra),44);assert.equal(c.envidoValue(card('♦',12),card('♦',10)),27);assert.equal(c.capScores(r,{player1:22}).player1,20);assert.equal(c.faltaEnvidoPoints(r),20);r.scores.player1=15;assert.equal(c.faltaEnvidoPoints(r),5);assert.equal(c.envidoBetPoints(r,'real',4),2);assert.equal(c.florBetPoints(r,'falta'),20);});
test('All flor raises offer legal acceptance and rejection',()=>{const c=harness();for(const called of ['conflor','falta']){const actions=c.florAnswers({called},true).map(x=>x[0]);assert.ok(actions.includes('yes'));assert.ok(actions.includes('no'));}assert.equal(c.declinedFlorPoints({called:'conflor',stake:5}),3);});
test('A full hand can raise truco, accept, play and finish after round pause',()=>{const c=harness();c.state={room:room(),playerId:'player1',localGame:true,localHands:{player1:[card('♠',1),card('♣',1),card('♥',3)],player2:[card('♥',4),card('♥',5),card('♠',6)]}};c.localCallAction('truco');c.state.playerId='player2';c.localAnswerAction('raise');c.state.playerId='player1';c.localAnswerAction('yes');assert.equal(c.state.room.trucoLevel,3);for(let round=0;round<2;round++){for(const player of ['player1','player2']){c.state.playerId=player;c.localPlay(c.state.localHands[player][0]);}assert.equal(c.state.room.resolvingTrick,true);c.transition();}assert.equal(c.finished.winner,'player1');assert.equal(c.finished.points,3);});
test('Envido suspends truco, accumulated refusal pays accepted stake',()=>{const c=harness();c.state={room:room(),playerId:'player1',localHands:{player1:[card('♥',6),card('♥',7),card('♠',4)],player2:[card('♠',5),card('♠',6),card('♥',4)]}};c.localCallAction('truco');c.state.playerId='player2';c.localCallAction('envido');assert.equal(c.state.room.pendingBet.suspendedBet.type,'truco');c.state.playerId='player1';c.localAnswerAction('raise-envido');assert.equal(c.state.room.pendingBet.stake,4);c.state.playerId='player2';c.localAnswerAction('no');assert.equal(c.state.room.scores.player1,2);assert.equal(c.state.room.pendingBet.type,'truco');});
test('NO QUIERO waits 3 seconds with notification before redealing',()=>{const c=harness(),r=room();r.pendingBet={type:'truco',stake:3,caller:'player1',responder:'player2'};const changes=c.declinedTrucoChanges(r,'player2');assert.equal(changes.pendingNextHand.endsAt,103000);assert.equal(changes.pendingNextHand.foldPoints,2);assert.match(changes.callNotice.text,/no quiere/);assert.equal(r.scores.player1,0);});
test('Disconnect grace expires and stale match presence is ignored',()=>{const c=harness(),r=room();r.connectionPresence={player2:{uid:'b',matchNumber:1,online:false,disconnectedAt:100000}};assert.equal(c.disconnectedPlayer(r,110000).seconds,35);assert.equal(c.disconnectedPlayer(r,145000).seconds,0);const end=c.disconnectMatchChanges(r,'player2');assert.equal(end.status,'complete');assert.equal(end.scores.player1,20);assert.equal(end.turnClock,null);r.connectionPresence.player2.matchNumber=0;assert.equal(c.disconnectedPlayer(r,150000),null);});
test('Three inactivity strikes terminate the match instead of leaving a turn',()=>{const c=harness(),r=room();assert.equal(c.turnClockRemaining({startedAt:1000},46000).expired,true);for(let strike=1;strike<=3;strike++){Object.assign(r,{status:'started',turn:'player2'});Object.assign(r,c.turnTimeoutChanges(r));assert.equal(r.timeoutCounts.player2,strike);}assert.equal(r.status,'complete');assert.equal(r.turn,null);assert.equal(r.scores.player1,20);});
test('Mutual rematch requests accept; wins accumulate once and stale answers fail',()=>{const c=harness(),r=room();Object.assign(r,{status:'complete',scores:{player1:20,player2:8},endReveal:{done:true}});assert.equal(c.sessionWins(r).player1,1);Object.assign(r,c.rematchChanges(r,'player1','request','r1'));const next=c.rematchChanges(r,'player2','request','r2');assert.equal(next.status,'drawing');assert.equal(next.matchNumber,2);assert.equal(c.sessionWins(next).player1,1);assert.equal(c.rematchChanges(next,'player2','accept','r1'),null);Object.assign(next,{status:'complete',scores:{player1:5,player2:20},endReveal:{done:true}});assert.equal(c.sessionWins(next).player2,1);assert.equal(c.sessionWins(next).player1,1);});
test('Disconnected or unsynchronized clients block actions; slow sends ignore double taps',async()=>{const c=harness();c.state={room:room(),roomCode:'X',firebaseConnected:true,liveConnected:true,connectionReady:false};assert.equal(c.liveActionsBlocked(),true);let calls=0;await c.runLiveAction(null,()=>calls++);assert.equal(calls,0);c.state.connectionReady=true;let finish;const first=c.runLiveAction(null,()=>{calls++;return new Promise(resolve=>finish=resolve);});await c.runLiveAction(null,()=>calls++);assert.equal(calls,1);assert.ok(c.state.liveAction);finish();await first;assert.equal(c.state.liveAction,null);c.navigator.onLine=false;assert.equal(c.liveActionsBlocked(),true);c.state.localGame=true;assert.equal(c.liveActionsBlocked(),false);});
test('Bot remembers completed public rounds and raises caution near a rival win',()=>{const c=harness(),r=room(),memory={};r.tricks=[{winner:'player1',played:[{card:card('♠',1)},{card:card('♥',4)}]}];c.rememberBotCards(r,memory);c.rememberBotCards(r,memory);assert.equal(memory.played.length,2);r.scores.player1=18;assert.ok(c.botRiskAdjustment(r,2)>0);r.scores.player1=0;r.scores.player2=18;assert.ok(c.botRiskAdjustment(r,2)<0);});
test('Every bot level declines a guaranteed lost last round',()=>{const c=harness(),r=room();Object.assign(r,{turn:'player2',mano:'player1',playedCount:5,tricks:[{winner:'player1'},{winner:'player2'}],trickCards:[{playerId:'player1',card:card('♠',1)}],pendingBet:{type:'truco',stake:2,caller:'player1',responder:'player2'}});for(const level of ['easy','normal','hard'])assert.equal(c.chooseBotDecision(r,[card('♥',4)],level,{played:[]},()=>0.5).value,'no');});
test('Help is offered once per topic, with distinct raises explained separately',()=>{const c=harness();c.state.learning={hints:true};c.enqueueLearningHelp({text:'Truco'},'truco:2');c.enqueueLearningHelp({text:'Truco'},'truco:2');assert.equal(c.state.learning.tutorialMessages.length,1);c.rememberLearningHelp('truco:2');c.state.learning.tutorialMessages=[];c.enqueueLearningHelp({text:'Truco'},'truco:2');c.enqueueLearningHelp({text:'Retruco'},'truco:3');assert.equal(c.state.learning.tutorialMessages.length,1);});
test('Quick messages use the normal chat path and remain under 40 characters',()=>{const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const messages=[...html.matchAll(/data-quick-message="([^"]+)"/g)].map(x=>x[1]);assert.equal(messages.length,3);assert.ok(messages.every(text=>text.length<=40));assert.match(source,/sendMatchChat\(event,button\.dataset\.quickMessage\)/);const held=[...html.matchAll(/data-hold-message="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(held,['Andate Fernando!','Buena jugada!','Jajaja','Que suerte']);assert.match(source,/sendMatchChat\(null,target\.dataset\.holdMessage\)/);assert.match(extract('sendMatchChat'),/peerChatMuted\(room\)/);});
test('Complete matches reach the target across repeated hands, then support a rematch',()=>{const c=harness(),r=room();c.state={room:r,playerId:'player1',localGame:true};let hands=0;while(!c.matchFinished(r)){const deck=c.botDeck();const offset=hands%4;const mine=deck.filter(x=>x.suit==='♠').slice(offset,offset+3),rival=deck.filter(x=>x.suit==='♥').slice(offset,offset+3);c.state.localHands={player1:mine,player2:rival};Object.assign(r,{status:'started',turn:r.mano,trickNo:1,tricks:[],trickCards:[],playedCount:0,pendingBet:null,trucoLevel:1});c.finished=null;let plays=0;while(!c.finished){const player=r.turn;c.state.playerId=player;c.localPlay(c.state.localHands[player][0]);if(r.resolvingTrick)c.transition();assert.ok(++plays<=6);}r.scores=c.capScores(r,{...r.scores,[c.finished.winner]:r.scores[c.finished.winner]+c.finished.points});r.mano=c.otherPlayer(r.mano);r.handNumber++;if(c.matchWinner(r))Object.assign(r,{status:'complete',endReveal:{done:true}});assert.ok(++hands<=60);}assert.equal(Math.max(...Object.values(r.scores)),20);assert.equal(c.sessionWins(r).player1+c.sessionWins(r).player2,1);Object.assign(r,c.rematchChanges(r,'player1','request','again'));assert.equal(c.rematchChanges(r,'player2','accept','again').matchNumber,2);});
test('Recovery waits for matching private cards and ignores an older connection attempt',async()=>{const c=harness();let roomSnap=room(),deal={handNumber:1,hand:[card('♥',4)]};roomSnap.handCounts={player1:1};const elements={};c.$=id=>elements[id]||={};c.roomSeatForUid=()=> 'player1';c.syncPrivateHand=()=>{};c.syncRoomPresence=async()=>{};c.publishChatMute=()=>{};c.returnToLobby=()=>assert.fail('Unexpected lobby');c.setTimeout=()=>1;c.clearTimeout=()=>{};c.state={room:roomSnap,roomCode:'X',playerId:'player1',uid:'a',firebaseConnected:true,liveConnected:true,connectionEpoch:1,firebase:{db:{},ref:(db,path)=>path,get:async path=>({val:()=>path.startsWith('rooms/')?roomSnap:deal})}};vm.runInContext(extract('refreshLiveConnection'),c);await c.refreshLiveConnection();assert.equal(c.state.connectionReady,true);deal={handNumber:0,hand:[]};c.state.connectionReady=false;const log=c.console;c.console={warn(){}};await c.refreshLiveConnection();assert.equal(c.state.connectionReady,false);c.console=log;deal={handNumber:1,hand:[card('♥',4)]};c.state.firebase.get=async path=>{c.state.connectionEpoch=2;return {val:()=>path.startsWith('rooms/')?roomSnap:deal};};await c.refreshLiveConnection();assert.equal(c.state.connectionReady,false);});
test('Folding succeeds through the action wrapper even with an initially empty Firebase cache',async()=>{const c=harness();const r=room();let changes,attempts=0;c.state={room:r,roomCode:'X',playerId:'player1',uid:'a',firebaseConnected:true,liveConnected:true,connectionReady:true,firebase:{db:{},ref:(db,path)=>path,runTransaction:async(ref,update)=>{assert.equal(update(null),null);attempts++;changes=update(r);return {committed:true,snapshot:{val:()=>changes}};}}};vm.runInContext(['canFoldHand','foldHandChanges','foldHand'].map(extract).join('\n'),c);await c.runLiveAction(null,()=>c.foldHand());assert.equal(attempts,1);assert.equal(c.state.room.pendingNextHand.winner,'player2');assert.equal(c.state.room.pendingNextHand.foldPoints,2);assert.equal(c.state.foldInFlight,false);assert.equal(c.state.liveAction,null);assert.equal(c.state.room.callNotice.kind,'fold');});
test('A fold cannot change a newer hand or another user seat',async()=>{const c=harness(),r=room();c.state={room:r,roomCode:'X',playerId:'player1',uid:'a',firebaseConnected:true,liveConnected:true,connectionReady:true,firebase:{db:{},ref:(db,path)=>path,runTransaction:async(ref,update)=>{assert.equal(update({...r,handNumber:2}),undefined);assert.equal(update({...r,players:{...r.players,player1:{uid:'other'}}}),undefined);return {committed:false};}}};vm.runInContext(['canFoldHand','foldHandChanges','foldHand'].map(extract).join('\n'),c);await c.foldHand();assert.equal(c.state.room.pendingNextHand,undefined);assert.equal(c.state.foldInFlight,false);});
test('Equal declared envido says son iguales and keeps the mano as winner',async()=>{const c=harness(),r=room();r.pendingBet={type:'envido',called:'envido',stake:2,revealMode:true,revealTurn:'player2',reveals:{player1:30}};c.state={room:r,playerId:'player2',localGame:true};c.$=()=>({dataset:{}});vm.runInContext(extract('revealEnvido'),c);await c.revealEnvido(false,30);assert.equal(r.envidoAudit.winner,'player1');assert.match(r.feed[0].text,/30 son iguales/);assert.doesNotMatch(r.feed[0].text,/son mejores/);r.pendingBet={type:'envido',stake:2,revealMode:true,revealTurn:'player2',reveals:{player1:30}};await c.revealEnvido(false,31);assert.equal(r.envidoAudit.winner,'player2');assert.match(r.feed[0].text,/31 son mejores/);});
test('Opening the normal page forgets a completed match and opens the lobby',async()=>{const c=harness(),r=room();r.status='complete';let forgotten=0,attached=0,lobby=0;c.state={config:{},uid:'a'};c.location={search:''};c.URLSearchParams=URLSearchParams;c.firebaseConfigValid=()=>true;c.firebaseServices=async()=>({db:{},ref:(db,path)=>path,get:async()=>({val:()=>r})});c.liveTables=()=>({readTable:async()=>({room:r,hand:null})});c.savedRoomSeat=()=>forgotten?null:{code:'ABCDE',createdAt:r.createdAt};c.forgetRoomSeat=()=>forgotten++;c.roomExpired=()=>false;c.attachLiveRoom=()=>attached++;c.openLobby=async()=>lobby++;c.openInvitation=()=>assert.fail('Unexpected invitation');vm.runInContext(['roomSeatForUid','restoreRoom','openInitialRoom'].map(extract).join('\n'),c);await c.openInitialRoom();assert.equal(forgotten,1);assert.equal(attached,0);assert.equal(lobby,1);});
test('An active match remains recoverable after reload',async()=>{const c=harness(),r=room();let attached=0;c.state={config:{},uid:'a'};c.firebaseConfigValid=()=>true;c.firebaseServices=async()=>({db:{},ref:(db,path)=>path,get:async()=>({val:()=>r})});c.liveTables=()=>({readTable:async()=>({room:r,hand:null})});c.savedRoomSeat=()=>({code:'ABCDE'});c.forgetRoomSeat=()=>assert.fail('Active seat must stay saved');c.roomExpired=()=>false;c.attachLiveRoom=(code,seat)=>{assert.equal(seat,'player1');attached++;};vm.runInContext(['roomSeatForUid','restoreRoom'].map(extract).join('\n'),c);assert.equal(await c.restoreRoom('ABCDE'),true);assert.equal(attached,1);});
test('Finishing clears the saved URL; a new rematch can save its active seat again',()=>{const c=harness();let forgotten=0,saved=0,url;c.state={room:{...room(),status:'complete'},roomCode:'ABCDE',playerId:'player1',uid:'a'};c.forgetRoomSeat=()=>forgotten++;c.setRoomUrl=code=>url=code;c.localStorage.setItem=()=>saved++;vm.runInContext(extract('rememberRoomSeat'),c);c.rememberRoomSeat();assert.equal(forgotten,1);assert.equal(saved,0);c.state.room.status='drawing';c.rememberRoomSeat();assert.equal(saved,1);assert.equal(url,'ABCDE');});
test('Two flor reveals show actual values calculated from all three cards and the muestra',()=>{const c=harness(),r=room();r.flors={player1:44,player2:36};r.florCompared=true;const originals={player1:[card('♦',2),card('♦',5),card('♠',6)],player2:[card('♥',3),card('♥',6),card('♥',7)]};vm.runInContext(extract('buildEndEvidence'),c);const groups=c.buildEndEvidence(r,originals);assert.equal(groups[0].label,'Flor · 44 tantos');assert.equal(groups.length,1);assert.equal(groups[0].player,'player1');r.florCompared=false;assert.equal(c.buildEndEvidence(r,originals)[0].label,'Flor');delete r.flors.player2;assert.equal(c.buildEndEvidence(r,originals)[0].label,'Flor');});
test('Five consecutive local bot rematches reset round counters and play through real rounds',async()=>{const c=harness();c.clearTimeout=()=>{};c.shuffleDeck=c.botDeck;c.state={room:{...room(),status:'complete',endReveal:{done:true},scores:{player1:20,player2:5}},roomCode:'BOT1',playerId:'player1',localGame:true,bot:true};vm.runInContext('let rematchInFlight=false;'+extract('respondRematch'),c);for(let match=2;match<=6;match++){await c.respondRematch('request');c.state.playerId='player2';await c.respondRematch('accept');const r=c.state.room;assert.equal(r.matchNumber,match);assert.equal(r.trickNo,1);assert.equal(r.playedCount,0);assert.equal(r.trucoLevel,1);assert.equal(c.state.botMemory,null);assert.equal(c.state.playActionInFlight,false);Object.assign(r,{status:'started',turn:'player1',mano:'player1'});c.state.localHands={player1:[card('♠',1),card('♣',1),card('♥',3)],player2:[card('♥',4),card('♥',5),card('♠',6)]};c.finished=null;for(let round=0;round<2;round++){for(const player of ['player1','player2']){c.state.playerId=player;c.localPlay(c.state.localHands[player][0]);}c.transition();}assert.equal(c.finished.winner,'player1');assert.ok(Number.isFinite(r.trickNo));Object.assign(r,{status:'complete',endReveal:{done:true},scores:{player1:20,player2:5}});c.state.playerId='player1';assert.equal(c.sessionWins(r).player1,match);}});
test('Accepted falta envido ends the local hand after declarations without adding truco points',async()=>{const c=harness(),r=room();r.pendingBet={type:'envido',called:'falta',stake:20,revealMode:true,revealTurn:'player2',reveals:{player1:30},suspendedBet:{type:'truco',stake:2}};c.state={room:r,playerId:'player2',localGame:true};c.$=()=>({dataset:{}});vm.runInContext(extract('revealEnvido'),c);await c.revealEnvido(false,30);assert.equal(c.finished.winner,'player1');assert.equal(c.finished.points,0);assert.equal(r.pendingBet,null);assert.equal(r.turn,null);assert.equal(r.envidoAudit.stake,20);});
test('Live falta envido queues immediate verification and reveals both players cards',async()=>{const c=harness(),r=room();r.pendingBet={type:'envido',called:'falta',stake:5,revealMode:true,revealTurn:'player2',reveals:{player1:29}};c.state={room:r,playerId:'player2',localGame:false,firebaseConnected:true,liveConnected:true,connectionReady:true};c.$=()=>({dataset:{}});let patch;c.writeRoom=async changes=>patch=changes;vm.runInContext(['revealEnvido','envidoEvidenceCards','buildEndEvidence','auditEnvidoScores'].map(extract).join('\n'),c);await c.revealEnvido(false,30);assert.equal(patch.pendingBet,null);assert.equal(patch.pendingNextHand.endsAt,c.gameTime());assert.equal(patch.pendingNextHand.foldPoints,0);Object.assign(r,patch);const hands={player1:[card('♥',4),card('♥',5),card('♠',1)],player2:[card('♠',4),card('♠',6),card('♥',1)]};const scores=c.auditEnvidoScores(r,r.scores,{player1:29,player2:30});assert.equal(scores.player2,5);assert.equal(scores.player1,0);assert.equal(c.buildEndEvidence(r,hands).length,1);});

test('Falta envido cannot be raised, directly or after accumulated calls',()=>{
 const c=harness();assert.equal(c.canRaiseEnvido({type:'envido',called:'falta'}),false);
 assert.equal(c.canRaiseEnvido({type:'envido',called:'envido',calls:['envido','falta']}),false);
 assert.equal(c.canRaiseEnvido({type:'envido',called:'envido'}),true);assert.equal(c.canRaiseEnvido({type:'envido',called:'real'}),true);
 const r=room();r.pendingBet={type:'envido',called:'falta',caller:'player1',responder:'player2',stake:20};
 c.state.room=r;c.state.playerId='player2';c.state.localHands={player2:[card('♠',2),card('♣',3),card('♥',6)]};
 for(const action of ['raise-envido','raise-real','raise-falta']){c.localAnswerAction(action);assert.equal(r.pendingBet.called,'falta');assert.equal(r.pendingBet.stake,20);}
});
test('Closing a finished result closes the shared room, but cannot close a new rematch or another seat',()=>{
 const c=harness(),r=room();r.status='complete';r.scores.player1=20;r.rematch={status:'pending'};
 const result=c.closeFinishedRoomChanges(r,'player2','b',1);
 assert.equal(result.status,'closed');assert.equal(result.closeReason,'match-left');assert.equal(result.rematch,null);
 assert.equal(c.closeFinishedRoomChanges(r,'player2','wrong',1),null);
 assert.equal(c.closeFinishedRoomChanges(r,'table','b',1),null);
 assert.equal(c.closeFinishedRoomChanges(r,'player2','b',2),null);
 r.status='drawing';r.scores={player1:0,player2:0};assert.equal(c.closeFinishedRoomChanges(r,'player2','b',1),null);
});


test('Practice frames the winning card with who won beside it, both cards on a tie, and can be disabled',()=>{
 const played=[{playerId:'player2',card:card('♠',1)},{playerId:'player1',card:card('♥',3)}];
 for(const [winner,own,rival] of [['player1','Ganás vos',''],['player2','','Gana el rival'],[null,'Empate','']]){
  const c=harness();c.state.playerId='player1';c.state.learning={whoWins:true};
  const r={resolvingTrick:true,resolvedTrickWinner:winner,trickCards:played};
  const mine=c.trickWinnerMark(r,'player1'),theirs=c.trickWinnerMark(r,'player2');
  assert.equal(mine.label,own);assert.equal(theirs.label,rival);
  assert.equal(mine.framed,winner!=='player2');assert.equal(theirs.framed,winner!=='player1');
  c.state.learning.whoWins=false;assert.equal(c.trickWinnerMark(r,'player1').framed,false);
  c.state.learning.whoWins=true;assert.equal(c.trickWinnerMark({...r,resolvingTrick:false},winner||'player1').framed,false);
 }
 const c=harness();assert.equal(c.trickWinnerMark({resolvingTrick:true,resolvedTrickWinner:'player1',trickCards:played},'player1').framed,false);
});

test('First incorrect declaration is determined by order, including mano player2 and old hands',()=>{
 const c=harness(),r=room();r.mano='player2';r.envidoAudit={reveals:{player1:30,player2:29},winner:'player1',stake:2};
 assert.equal(c.envidoAuditResult(r,{player1:28,player2:28}).winner,'player1');
 r.envidoAudit.declarationOrder=['player1','player2'];assert.equal(c.envidoAuditResult(r,{player1:28,player2:28}).winner,'player2');
});

test('Envido reveal heading names the winner and the awarded points',()=>{
 const c=harness(),element={classList:{toggle(){}},innerHTML:''};c.$=()=>element;c.escapeHtml=String;c.cardImageStyle=()=>'';c.cardAccessibleName=()=>'';
 vm.runInContext(extract('renderEndEvidence'),c);
 c.renderEndEvidence({status:'revealing',players:{player1:{name:'Matias'}},endReveal:{groups:[{player:'player1',label:'Envido · 28 tantos',cards:[],envidoAward:{player:'player1',points:2}}]}},true);
 assert.match(element.innerHTML,/2 puntos para Matias/);
});

test('Unopened folds award two points from either seat; flor awards four and is revealed',()=>{
 for(const loser of ['player1','player2']){
  const c=harness(),r=room(),winner=loser==='player1'?'player2':'player1';
  c.state={localOriginalHands:{[winner]:[card('♥',3),card('♣',6),card('♠',7)]}};
  vm.runInContext(extract('foldHandChanges'),c);
  assert.equal(c.foldHandChanges(r,loser).pendingNextHand.foldPoints,2);
  c.state.localOriginalHands[winner]=[card('♥',3),card('♥',6),card('♥',7)];
  const changes=c.foldHandChanges(r,loser);
  assert.equal(changes.pendingNextHand.foldPoints,4);assert.equal(changes.flors[winner],36);assert.equal(changes.florSettled,true);assert.equal(changes.callNotice.spoken,'Flor');
  r.playedCount=1;assert.equal(c.foldHandChanges(r,loser).pendingNextHand.foldPoints,1);
  r.playedCount=0;r.envidoClosed=true;assert.equal(c.foldHandChanges(r,loser).pendingNextHand.foldPoints,1);
 }
});

test('Envido shows only incorrect declarations, or both if both lied',()=>{
 const c=harness(),r=room();r.envidoAudit={stake:2,reveals:{player1:33,player2:28},order:['player1','player2']};
 const hands={player1:[card('♥',1),card('♥',7),card('♣',3)],player2:[card('♦',1),card('♦',7),card('♣',3)]};
 vm.runInContext(['envidoEvidenceCards','buildEndEvidence'].map(extract).join('\n'),c);
 const groups=c.buildEndEvidence(r,hands);assert.equal(groups.length,1);assert.equal(groups[0].player,'player1');assert.match(groups[0].label,/Mintió/);assert.equal(groups[0].envidoAward.player,'player2');assert.match(groups[0].envidoAward.penalty,/Mati mintió\.\nRicky gana/);r.envidoAudit.reveals.player2=27;assert.equal(c.buildEndEvidence(r,hands).length,2);
});

test('Truco explanations repeat with help enabled despite previous practice visits',()=>{
 const c=harness();c.state={learning:{hints:true,tutorialMessages:[]},playerId:'player1',room:room()};
 vm.runInContext(extract('queueLearningTrucoCall'),c);
 for(const stake of [2,3,4]){
  c.learningSeen.add('truco-call:'+stake);c.queueLearningTrucoCall(stake,'player1');
  const message=c.state.learning.tutorialMessages.shift();assert.ok(message);assert.match(message.text,new RegExp('por '+stake+' puntos'));
 }
 c.state.learning.hints=false;c.queueLearningTrucoCall(2,'player1');assert.equal(c.state.learning.tutorialMessages.length,0);
});

test('Practice overlays never embed yellow calls, including stale QUIERO inside round help',()=>{
 const c=harness(),nodes={};let open=true;
 const node=()=>({innerHTML:'',classList:{hidden:false,add(name){if(name==='hidden')this.hidden=true},remove(name){if(name==='hidden')this.hidden=false},toggle(name,value){if(name==='hidden')this.hidden=value}},setAttribute(){}});
 c.$=id=>nodes[id]??=(node());c.document={querySelector:()=>open?{}:null};c.clearTimeout=()=>{};c.setTimeout=()=>1;c.callNoticeTimer=null;c.soundEnabled=false;c.CALL_NOTICE_DURATION=3000;c.receivedCallNotices=new Map();c.callSeen=new Map();c.speakCall=()=>{};c.callNoticeHtml=()=>'<strong>QUIERO</strong>';c.requestAnimationFrame=()=>{};c.positionMobileCallNotice=()=>{};
 c.state={playerId:'player1',roomCode:'X',learning:{activeTutorial:{roundCards:[]}},room:{handNumber:1,callNotice:{id:'reply',from:'player2',to:'player1',spoken:'Quiero',handNumber:1}}};
 vm.runInContext(extract('renderCallNotice'),c);c.renderCallNotice();assert.equal(nodes['learning-call-notice'].innerHTML,'');assert.equal(nodes['call-notice'].classList.hidden,true);
 open=false;c.renderCallNotice();assert.equal(nodes['learning-call-notice'].innerHTML,'');assert.match(nodes['call-notice'].innerHTML,/QUIERO/);
});
test('Declined action help is replaced by scoring info, but stays available when points info is disabled',()=>{
 const c=harness();c.state={playerId:'player1',room:room(),learning:{hints:true,pointsInfo:true,tutorialMessages:[]}};vm.runInContext(extract('queueLearningAction'),c);
 const bet={type:'truco',stake:3};c.queueLearningAction('no',bet);assert.equal(c.state.learning.tutorialMessages.length,0);
 c.state.learning.pointsInfo=false;c.queueLearningAction('no',bet);assert.equal(c.state.learning.tutorialMessages.length,1);assert.match(c.state.learning.tutorialMessages[0].text,/2 puntos/);
});

test('Response help names the rival canto without relying on a separate yellow notice',()=>{
 const c=harness();c.betCallNames=bet=>[bet.called||'flor'];vm.runInContext(extract('learningResponseTitle'),c);
 const r=room();for(const [stake,name] of [[2,'TRUCO'],[3,'RETRUCO'],[4,'VALE 4']])assert.equal(c.learningResponseTitle(r,{type:'truco',caller:'player2',stake}),'Ricky'+(stake===2?' gritó ':' dice ')+name);
 assert.equal(c.learningResponseTitle(r,{type:'envido',caller:'player2',called:'real envido'}),'Ricky dijo REAL ENVIDO');
 assert.equal(c.learningResponseTitle(r,{type:'flor',caller:'player2'}),'Ricky cantó FLOR');
 assert.equal(c.learningResponseTitle(r,{type:'envido',revealMode:true}),'Declarar tus tantos de envido');
});

test('Final practice points announce victory without offering another deal',()=>{
 const c=harness();c.state={learning:{pointsInfo:true,scoreMessages:[]}};vm.runInContext(extract('queueLearningPoints'),c);
 const r=room();r.scores={player1:19,player2:3};
 c.queueLearningPoints(r,{player1:20,player2:3},[{player:'player1',points:1,detail:'Truco no querido. Se vuelve a repartir.'}]);
 assert.match(c.state.learning.scoreMessages[0],/Ganaste la partida/);assert.doesNotMatch(c.state.learning.scoreMessages[0],/repartir/);
 c.state.learning.scoreMessages=[];r.scores.player1=18;c.queueLearningPoints(r,{player1:19,player2:3},[{player:'player1',points:1,detail:'Truco no querido. Se vuelve a repartir.'}]);assert.match(c.state.learning.scoreMessages[0],/Se vuelve a repartir/);
});

test('Stages two and three open study introduction before queued table guidance',async()=>{
 for(const stage of [0,1,2]){
  const c=harness(),r=room(),events=[];c.state={room:r,localHands:{player1:[card('♥',1),card('♥',7),card('♣',3)],player2:[card('♦',1),card('♦',7),card('♣',3)]}};
  c.$=()=>({value:'Mati',close(){}});c.startLocalBotGame=async()=>true;c.cleanName=value=>value;c.savedPlayerName=()=>'';c.showView=()=>{};c.openLearningHelp=()=>events.push('study-intro');c.resumeLearning=()=>events.push('table-guidance');c.learningDeck=()=>[...c.state.localHands.player1,...c.state.localHands.player2,card('♠',6)];
  vm.runInContext(['rememberLearningPractice','startLearning'].map(extract).join('\n'),c);await c.startLearning(stage);
  assert.deepEqual(events,[stage?'study-intro':'table-guidance']);
  assert.equal(c.state.learning.tutorialMessages[0].pointAtGuide,true);assert.equal(c.state.learning.tutorialMessages[1].pointAtOptions,true);assert.match(c.state.learning.tutorialMessages[2].text,/Seleccioná/);
 }
});


test('Envido picker starts above the rival declaration unless the player is mano',()=>{
 const c=harness();vm.runInContext(extract('envidoPickerMinimum'),c);
 const r=room();r.mano='player2';r.pendingBet={reveals:{player2:20}};
 assert.equal(c.envidoPickerMinimum(r,'player1'),21);
 r.mano='player1';assert.equal(c.envidoPickerMinimum(r,'player1'),20);
 r.pendingBet.reveals.player2=0;r.mano='player2';assert.equal(c.envidoPickerMinimum(r,'player1'),1);
 r.pendingBet.reveals.player2=50;assert.equal(c.envidoPickerMinimum(r,'player1'),51);
 r.pendingBet.reveals={};assert.equal(c.envidoPickerMinimum(r,'player1'),0);
});

test('Practice declaration popup still identifies the bot envido call',()=>{
 const c=harness();c.state.playerId='player1';c.betCallNames=bet=>[bet.called||'envido'];vm.runInContext(extract('learningResponseTitle'),c);
 const r=room();r.players.player2.name='Bot de práctica';
 assert.equal(c.learningResponseTitle(r,{type:'envido',caller:'player2',called:'envido',revealMode:true}),'Bot de práctica dijo ENVIDO');
 assert.equal(c.learningResponseTitle(r,{type:'envido',caller:'player1',revealMode:true}),'Declarar tus tantos de envido');
});


test('Envido scoring explains the award plainly and only details incorrect declarations',()=>{
 const c=harness();vm.runInContext(['betCallNames','acceptedEnvidoExplanation','scoringEntries'].map(extract).join('\n'),c);
 const r=room();r.scores={player1:0,player2:0};r.envidoAudit={stake:2,called:'envido',reveals:{player1:27,player2:31},winner:'player2',declarationOrder:['player1','player2']};
 let entries=c.scoringEntries(r,{player1:0,player2:2},'',{player1:27,player2:31});
 assert.equal(entries[0].detail,'Envido querido: son 2 puntos.');
 entries=c.scoringEntries(r,{player1:3,player2:0},'Mano ganada.',{player1:27,player2:30});
 assert.match(entries[0].detail,/Ricky declaró 31 y tenía 30/);assert.match(entries[0].detail,/incorrectos/);assert.doesNotMatch(entries[0].detail,/declaró 27/);
 assert.equal(c.acceptedEnvidoExplanation({called:'real',calls:['envido','real'],stake:5}),'Envido + Real envido querido: son 5 puntos.');
});

test('Practice menu remembers the first start and shows three modes on later visits',()=>{
 const c=harness(),saved=new Map(),classes={};c.localStorage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
 c.$=id=>({classList:{toggle:(name,on)=>classes[id]=on}});
 vm.runInContext(['hasStartedLearningPractice','rememberLearningPractice','renderLearningMenu'].map(extract).join('\n'),c);
 c.renderLearningMenu();assert.equal(classes['learn-free'],false);assert.equal(classes['learn-game-modes'],true);
 c.rememberLearningPractice();c.state={};c.renderLearningMenu();assert.equal(classes['learn-free'],true);assert.equal(classes['learn-game-modes'],false);
});

test('Flor can be declared after the rival opening card while own three cards remain',()=>{const c=harness(),r=room();r.playedCount=1;r.turn='player2';c.state={room:r,playerId:'player2',localHands:{player2:[card('♥',3),card('♥',6),card('♥',7)]}};vm.runInContext(extract('localAction'),c);c.localAction('flor');assert.equal(r.flors.player2,36);assert.equal(r.pendingBet,null);assert.equal(r.florSettled,true);});

test('Abandonment cannot request or accept a rematch',()=>{
 const c=harness(),ended={status:'complete',targetPoints:20,scores:{player1:20,player2:0},players:{player1:{uid:'a'},player2:{uid:'b'}},matchResult:{winner:'player1',loser:'player2',reason:'abandon'},endReveal:{done:true},rematch:{id:'old',requester:'player2',status:'pending'}};
 for(const action of ['request','accept','decline'])assert.equal(c.rematchChanges(ended,'player1',action,'old'),null);
});

test('Envido declarations accept 37 and reject 38 without advancing the reveal',async()=>{
 const c=harness(),r=room();r.pendingBet={type:'envido',stake:2,revealMode:true,revealTurn:'player1',reveals:{}};
 c.state={room:r,playerId:'player1',localGame:true};c.$=()=>({dataset:{}});
 vm.runInContext(extract('revealEnvido'),c);
 await c.revealEnvido(false,38);assert.equal(r.pendingBet.revealTurn,'player1');assert.equal(r.pendingBet.reveals.player1,undefined);
 await c.revealEnvido(false,37);assert.equal(r.pendingBet.reveals.player1,37);assert.equal(r.pendingBet.revealTurn,'player2');
});
test('Sending a chat message closes the chat at once and shows it like the rival sees it, reopening only on failure',async()=>{
 const make=fail=>{const log=[],els={};const el=id=>els[id]||(els[id]={id,value:'',textContent:'',disabled:false,classList:{add(){},remove(){}}});
  const c={$:el,log,CHAT_LIMIT:40,chatMuted:false,chatModeration:null,matchChat:{sending:false,pendingOwn:[]},state:{roomCode:'ABCDE',playerId:'player1',uid:'a',room:{managedCredits:true}},
   liveActionsBlocked:()=>false,chatAvailable:()=>true,peerChatMuted:()=>false,renderChatComposer(){},chatContextKey:()=>'k',console:{error(){}},
   closeMatchChat:()=>log.push('close'),openMatchChat:()=>log.push('open'),showChatNotice:message=>{log.push('notice:'+message.sender+':'+message.text);return ()=>log.push('dismiss');},
   creditCommand:async command=>{log.push('send:'+command.text);if(fail)throw new Error('x');}};
  vm.createContext(c);vm.runInContext(extract('sendMatchChat'),c);return c;};
 let c=make(false);c.$('chat-input').value=' Hola ';await c.sendMatchChat({preventDefault(){}});
 assert.deepEqual(c.log,['close','notice:player1:Hola','send:Hola']);assert.equal(c.$('chat-input').value,'');assert.equal(c.matchChat.pendingOwn.length,1);
 c=make(false);c.$('chat-input').value='borrador';await c.sendMatchChat(null,'Jajaja');assert.deepEqual(c.log,['close','notice:player1:Jajaja','send:Jajaja']);assert.equal(c.$('chat-input').value,'borrador');
 c=make(true);c.$('chat-input').value='Hola';await c.sendMatchChat({preventDefault(){}});
 assert.deepEqual(c.log,['close','notice:player1:Hola','send:Hola','dismiss','open']);assert.equal(c.$('chat-input').value,'Hola');assert.equal(c.matchChat.pendingOwn.length,0);
});
test('The server copy of a message already shown when sent does not pop up twice',()=>{
 const src=extract('syncMatchChat');assert.match(src,/pendingOwn\.findIndex\(item=>item\.text===message\.text\)/);assert.match(src,/pendingOwn=\[\]/);
});
test('A flor against a rival without flower scores at once, shows the call for 3 seconds and keeps the suspended truco',()=>{
 const c=harness(),r=room();const truco={type:'truco',caller:'player2',responder:'player1',stake:2};r.pendingBet=truco;r.scores={player1:0,player2:0};
 c.state={room:r,playerId:'player1',localHands:{player1:[card('♥',3),card('♥',6),card('♥',7)],player2:[card('♠',1),card('♦',4),card('♣',5)]}};
 vm.runInContext(extract('localAction'),c);c.localAction('flor');
 assert.equal(r.scores.player1,3);assert.equal(r.pendingBet,truco);assert.equal(r.florSettled,true);assert.equal(r.callNotice.duration,3000);
});
test('A flor against a rival holding a flower still waits for the answer',()=>{
 const c=harness(),r=room();r.scores={player1:0,player2:0};
 c.state={room:r,playerId:'player1',localHands:{player1:[card('♥',3),card('♥',6),card('♥',7)],player2:[card('♠',3),card('♠',6),card('♠',7)]}};
 vm.runInContext(extract('localAction'),c);c.localAction('flor');
 assert.equal(r.pendingBet.type,'flor');assert.equal(r.pendingBet.responder,'player2');assert.equal(r.scores.player1,0);
});
test('La mia es flor keeps playing and the higher flower takes the stake when the hand ends',()=>{
 const c=harness(),r=room();r.scores={player1:0,player2:0};r.mano='player1';r.flors={player1:33,player2:28};
 r.pendingBet={type:'flor',called:'flor',caller:'player2',responder:'player1',stake:3,accepted:0,suspendedBet:null};
 c.state={room:r,playerId:'player1',localHands:{player1:[card('♥',3),card('♥',6),card('♥',7)],player2:[card('♠',3),card('♠',6),card('♠',7)]}};
 vm.runInContext([extract('localAnswerAction'),extract('settleSingleFlor'),extract('scoringEntries'),extract('spokenCall')].join(String.fromCharCode(10)),c);c.localAnswerAction('yes');
 assert.equal(r.pendingBet,null);assert.equal(r.florDeferred,3);assert.equal(r.scores.player1+r.scores.player2,0);
 assert.equal(c.spokenCall('Jugador responde: la mía es flor.'),'La mía es flor');
 assert.equal(JSON.stringify(c.settleSingleFlor(r,{player1:0,player2:0})),JSON.stringify({player1:3,player2:0}));
 assert.match(c.scoringEntries(r,{player1:3,player2:0},'').map(e=>e.detail).join(' '),/La mía es flor/);
 r.flors={player1:28,player2:28};assert.equal(JSON.stringify(c.settleSingleFlor(r,{player1:0,player2:0})),JSON.stringify({player1:3,player2:0}));
});
test('Por que opens the card guide with both round cards and practice pauses last 4 seconds',()=>{
 const c=harness();let opened=0;c.openStudySheet=()=>opened++;c.state.learning={};
 vm.runInContext(extract('openTrickGuide'),c);
 const played=[{playerId:'player2',card:card('♠',1)},{playerId:'player1',card:card('♥',3)}];
 c.openTrickGuide({trickCards:played});
 assert.equal(opened,1);assert.equal(c.state.learning.activeTutorial.trickGuide,true);assert.equal(c.state.learning.activeTutorial.roundCards.length,2);assert.notEqual(c.state.learning.activeTutorial.roundCards,played);
 assert.match(source,/const PRACTICE_PAUSE_MS=5000;/);
 assert.ok(source.includes('resolutionEndsAt=gameTime()+(state.learning?PRACTICE_PAUSE_MS:3000)'));
});
test('Practice answer help lists each visible button with one short line',()=>{
 const c=harness();c.state={hand:[card('♥',3),card('♥',6),card('♥',7)],localGame:true};
 vm.runInContext(extract('learningAnswerOptions'),c);
 const r=room();
 const truco=c.learningAnswerOptions(r,{type:'truco',stake:2,caller:'player2',responder:'player1'});
 assert.equal(JSON.stringify(truco.map(o=>o[0])),JSON.stringify(['QUIERO','NO QUIERO','RETRUCO']));assert.ok(truco.every(o=>o[1].length<70));
 assert.equal(c.learningAnswerOptions(r,{type:'truco',stake:4}).length,2);
 const flor=c.learningAnswerOptions(r,{type:'flor',called:'flor',stake:3,caller:'player2',responder:'player1'}).map(o=>o[0]);
 assert.equal(JSON.stringify(flor),JSON.stringify(c.florAnswers({called:'flor'},true).map(o=>o[1])));
 assert.ok(!flor.includes('NO QUIERO'));
 assert.ok(source.includes("pending.type==='flor'?florAnswers(pending,roomHasFlor(room,state.hand))"));
});
test('A command on a table still being created waits for the server to confirm it instead of being dropped',async()=>{
 const sent=[],c={state:{roomCode:'ABCDE',room:{managedCredits:true,creditMatch:{id:null},status:'waiting'}},setTimeout,crypto:require('node:crypto').webcrypto,liveActionsBlocked:()=>false,applyActionReceipt(){},toast(){},firebaseError:e=>String(e),creditTickPending:false,
  creditApi:async(name,data)=>{sent.push(data);return {ok:true};}};
 vm.createContext(c);vm.runInContext(extract('confirmedMatchId')+String.fromCharCode(10)+extract('creditCommand'),c);
 setTimeout(()=>{c.state.room={...c.state.room,creditMatch:{id:'m1'}};},150);
 await c.creditCommand({kind:'add-bot',seat:'player2'});
 assert.equal(sent.length,1);assert.equal(sent[0].expectedMatchId,'m1');assert.equal(sent[0].command.seat,'player2');
 c.state.room={managedCredits:true,creditMatch:{id:null}};await c.creditCommand({kind:'tick'});assert.equal(sent.length,1);
});
test('The bot sings flor only on its own turn or when answering, never during the rival turn',()=>{
 const c=harness(),flor=[card('♠',3),card('♠',6),card('♠',7)];
 const r=room();Object.assign(r,{turn:'player1',mano:'player1',playedCount:0,pendingBet:null,flors:{}});
 assert.equal(c.chooseBotDecision(r,flor,'hard',{}),null);
 r.turn='player2';assert.equal(c.chooseBotDecision(r,flor,'hard',{}).value,'flor');
 r.playedCount=1;assert.equal(c.chooseBotDecision(r,flor,'hard',{}).value,'flor');
 r.turn='player1';r.pendingBet={type:'truco',caller:'player1',responder:'player2',stake:2};assert.equal(c.chooseBotDecision(r,flor,'hard',{}).value,'flor');
 assert.ok(!source.includes("room.turn==='player2'||(!room.playedCount&&roomHasFlor"));
});
test('Team tables show the pause countdown while flowers, envidos and tricks are shown',()=>{
 const team=fs.readFileSync(path.join(__dirname,'../team-table-ui.js'),'utf8');
 assert.ok(!team.includes("$('round-pause-timer')"),'the team table must not hide the pause countdown');
 const branch=source.slice(source.indexOf("if(state.room.mode==='2v2'){syncPrivateHand();"));
 assert.ok(branch.slice(0,branch.indexOf('return;}')).includes('renderRoundPauseTimer()'));
});
test('A bot partner is shown as CompaBot to its teammates and as Bot to the rivals',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../team-table-ui.js'),'utf8');
 const line=key=>{const i=src.indexOf(key);return src.slice(i,src.indexOf(String.fromCharCode(10),i)).replace('export ','');};
 const seatName=new Function(line('export const playerTeam=')+';'+line('export function seatName')+';return seatName;')();
 const room={players:{player1:{name:'Ana'},player2:{name:'Bot',bot:true},player3:{name:'Bot',bot:true},player4:{name:'Luis'}}};
 assert.equal(seatName(room,'player3','player1'),'CompaBot');assert.equal(seatName(room,'player2','player1'),'Bot');assert.equal(seatName(room,'player1','player1'),'Ana');
 assert.ok(src.includes("value!=='grita'||hasWord"));
});
test('The hard bot deduces the rival hand only from declared envido, sung flor and played cards',()=>{
 const c={};vm.createContext(c);vm.runInContext(['pieceOrder','envidoValue','hasFlor','handEnvido','florValue','botDeck','botRivalHands'].map(extract).join(String.fromCharCode(10)),c);
 const muestra=card('♦',6),deck=c.botDeck();
 const sampleAll=(room,count,known)=>{const unseen=deck.filter(x=>!known.includes(x.id));const pick=c.botRivalHands(room,count,unseen);assert.ok(pick);const out=[];for(let i=0;i<300;i++)out.push(pick(Math.random));return out;};
 // Said 37 and threw a common 4: the other two must be the 2 of the muestra and a 7.
 let room={muestra,tricks:[],trickCards:[{playerId:'player1',card:card('♠',4)}],envidoAudit:{reveals:{player1:37,player2:20}},flors:{}};
 for(const hand of sampleAll(room,2,['oro-6','espada-4']))assert.deepEqual(hand.map(x=>x.id).filter(id=>id==='oro-2'||/-7$/.test(id)).length,2);
 // Said 30 and threw a 3: every guess adds up to exactly 30 (an 11 or 10 of the muestra, a 7 with the 3, ...).
 room={muestra,tricks:[],trickCards:[{playerId:'player1',card:card('♣',3)}],envidoAudit:{reveals:{player1:30,player2:20}},flors:{}};
 const thirty=sampleAll(room,2,['oro-6','basto-3']);for(const hand of thirty){const full=[card('♣',3),...hand];assert.equal(c.handEnvido(full,muestra),30);assert.equal(c.hasFlor(full,muestra),false);}
 assert.ok(thirty.some(hand=>hand.some(x=>['oro-10','oro-11'].includes(x.id))),'a piece of the muestra is among the options');
 // Said son buenas against 25: never more than 25.
 room={muestra,tricks:[],trickCards:[{playerId:'player1',card:card('♥',5)}],envidoAudit:{reveals:{player2:25}},flors:{}};
 for(const hand of sampleAll(room,2,['oro-6','copa-5']))assert.ok(c.handEnvido([card('♥',5),...hand],muestra)<=25);
 // Sang flor: every guess is a flower.
 room={muestra,tricks:[],trickCards:[{playerId:'player1',card:card('♠',1)}],flors:{player1:33},florCompared:false};
 for(const hand of sampleAll(room,2,['oro-6','espada-1']))assert.ok(c.hasFlor([card('♠',1),...hand],muestra));
 // With nothing declared and no card thrown, the bot does not narrow anything.
 assert.equal(c.botRivalHands({muestra,tricks:[],trickCards:[],flors:{}},3,deck),null);
});
test('Knowing the rival declared 37 and threw a common 4 lowers the hard bot win chance',()=>{
 const c={structuredClone};vm.createContext(c);vm.runInContext(['pieceOrder','cardStrength','envidoValue','hasFlor','handEnvido','florValue','botDeck','botRivalHands','rememberBotCards','otherPlayer','assessBotHand','botHandOutcome','settleHand'].map(extract).join(String.fromCharCode(10)),c);
 const seeded=()=>{let x=12345;return ()=>((x=(x*1103515245+12345)%2147483648)/2147483648);};
 const room={muestra:card('♦',6),mano:'player1',turn:'player2',tricks:[],trickCards:[{playerId:'player1',card:card('♠',4)}],envidoAudit:{reveals:{player1:37,player2:20}},flors:{}};
 const hand=[card('♠',3),card('♥',2),card('♣',12)];
 const hard=c.assessBotHand(room,hand,'hard',{},seeded()).chance,blind=c.assessBotHand(room,hand,'normal',{},seeded()).chance;
 assert.ok(hard<blind-0.1,'hard '+hard+' vs blind '+blind);
});
