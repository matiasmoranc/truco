const {test}=require('node:test');const assert=require('node:assert/strict');
const {createTable,joinTable,tableOperation,publicTable,privateTableHand}=require('../functions/table-service.cjs');
const {SEATS,team,newTeamSession,createTeamReferee,settledTricks}=require('../functions/team-referee.cjs');
const {flower,florValue}=require('../functions/team-referee.cjs');
const {validateAccounting}=require('../functions/accounting-guard.cjs');const {recordHistory}=require('../functions/history-service.cjs');const {personalHistory,reservationAlerts}=require('../functions/player-service.cjs');
const base=()=>({wallets:Object.fromEntries(['a','b','c','d','e'].map(uid=>[uid,{balance:10,locked:0}]))});
const make=()=>createTable(base(),{code:'ABCDE',id:'m1',uid:'a',name:'A',mode:'2v2',stake:2,targetPoints:10,now:100});
const join=(l,uid,now=200)=>joinTable(l,{code:'ABCDE',uid,name:uid.toUpperCase(),now});
const full=()=>['b','c','d'].reduce((l,uid)=>join(l,uid),make());
const act=(l,uid,command,now=1000,requestId='r'+now+uid+command.kind)=>tableOperation(l,{code:'ABCDE',uid,command,now,requestId,expectedMatchId:l.tables.ABCDE});
function databaseRoundTrip(value){if(value===null)return undefined;if(Array.isArray(value)){if(!value.length)return undefined;return value.map(databaseRoundTrip);}if(value&&typeof value==='object'){const entries=Object.entries(value).map(([k,v])=>[k,databaseRoundTrip(v)]).filter(([,v])=>v!==undefined);return entries.length?Object.fromEntries(entries):undefined;}return value;}
// Each flower holder declares in turn from the mano: their real points if they beat the best so far, else son buenas.
function declareFlowers(l,now){for(let i=0;i<4;i++){const s=l.matches.m1.session,b=s.room.pendingBet;if(!b?.revealMode||b.type!=='flor')break;const p=b.revealTurn,v=florValue(s.originals[p],s.room.muestra),best=Math.max(-1,...Object.values(b.reveals||{}));l=act(l,s.room.players[p].uid,v>best?{kind:'declare',value:v}:{kind:'declare',good:true},now+i);}return l;}
const card=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada','♣':'basto'})[suit]+'-'+rank,suit,rank,label:String(rank)});
function started(){const l=full(),s=l.matches.m1.session;Object.assign(s.room,{status:'started',mano:'player1',dealer:'player4',turn:'player1',handNumber:1,muestra:card('♦',6),playedBy:{},folded:{},envidoClosed:true});s.hands={player1:[card('♠',1),card('♥',4),card('♣',6)],player2:[card('♣',1),card('♠',4),card('♥',6)],player3:[card('♣',3),card('♥',1),card('♠',6)],player4:[card('♠',3),card('♣',4),card('♥',7)]};s.originals=structuredClone(s.hands);s.truth={player1:6,player2:6,player3:6,player4:7};s.room.pendingNextHand=undefined;return l;}
test('An unannounced flower allows playing and cannot be claimed or auto-announced afterward',()=>{
 let l=started(),s=l.matches.m1.session;
 s.room.envidoClosed=false;
 s.hands.player1=[card('♦',2),card('♠',7),card('♠',1)];
 s.originals.player1=structuredClone(s.hands.player1);
 l=act(l,'a',{kind:'play',cardId:'espada-7'},1000);
 s=l.matches.m1.session;
 assert.equal(s.hands.player1.length,2);
 assert.equal(s.room.turn,'player2');
 assert.equal(s.room.flors.player1,undefined);
 assert.throws(()=>act(l,'a',{kind:'call',value:'flor'},1001),/No podés cantar flor/);
 l=act(l,'b',{kind:'call',value:'envido'},1002);
 assert.equal(l.matches.m1.session.room.pendingBet.type,'envido');
 assert.equal(l.matches.m1.session.room.flors.player1,undefined);
});
test('2v2 reserves each participant once, starts only with four and hides private hands',()=>{let l=make();l=join(l,'b');l=join(l,'c');assert.equal(l.matches.m1.status,'waiting');assert.equal(publicTable(l.matches.m1).mode,'2v2');assert.equal(publicTable(l.matches.m1).creditMatch.pot,8);assert.deepEqual(reservationAlerts(l,500),[]);assert.deepEqual(join(l,'b'),l);l=join(l,'d');assert.equal(l.matches.m1.status,'reserved');for(const uid of ['a','b','c','d'])assert.deepEqual(l.wallets[uid],{balance:8,locked:2});const pub=publicTable(l.matches.m1);assert.equal(pub.originals,undefined);assert.equal(pub.hands,undefined);assert.throws(()=>join(l,'e'));assert.equal(base().wallets.e.balance,10);validateAccounting(base(),recordHistory(base(),l,500));});
test('Canceled and expired partial 2v2 tables refund ALL seated players once',()=>{for(const n of [1,2,3]){let l=make();for(const uid of ['b','c'].slice(0,n-1))l=join(l,uid);const expired=act(l,'a',{kind:'tick'},700000);for(const uid of ['a','b','c'].slice(0,n))assert.deepEqual(expired.wallets[uid],{balance:10,locked:0});assert.equal(expired.matches.m1.status,'refunded');assert.deepEqual(act(expired,'a',{kind:'cancel'},700001),act(expired,'a',{kind:'cancel'},700001));}});
test('Four-player turns advance and a teammate can win the second trick for the team',()=>{let l=started();for(const [uid,id] of [['a','espada-1'],['b','basto-1'],['c','copa-1'],['d','basto-4']])l=act(l,uid,{kind:'play',cardId:id},1000);assert.equal(l.matches.m1.session.room.tricks[0].winner,'player1');l=act(l,'a',{kind:'tick'},4000);assert.equal(l.matches.m1.session.room.turn,'player1');for(const [uid,id] of [['a','copa-4'],['b','espada-4'],['c','basto-3'],['d','copa-7']])l=act(l,uid,{kind:'play',cardId:id},4100);l=act(l,'a',{kind:'tick'},7000);assert.equal(l.matches.m1.session.room.scores.player1,1);assert.equal(l.matches.m1.session.room.status,'revealing');});
test('Pardas use team results and the first winning trick',()=>{assert.equal(settledTricks([{winner:null},{winner:'player2'}],'player1'),'player2');assert.equal(settledTricks([{winner:'player1'},{winner:null}],'player2'),'player1');assert.equal(settledTricks([{winner:'player1'},{winner:'player2'},{winner:null}],'player4'),'player1');assert.equal(settledTricks([{winner:null},{winner:null},{winner:null}],'player4'),'player2');});
test('Individual fold leaves teammate playing; both folds end the hand',()=>{let l=started();l=act(l,'a',{kind:'fold'},1000);assert.equal(l.matches.m1.session.room.pendingNextHand,undefined);assert.equal(l.matches.m1.session.room.turn,'player2');l=act(l,'c',{kind:'fold'},1001);assert.equal(l.matches.m1.session.room.pendingNextHand.winner,'player2');l=act(l,'b',{kind:'tick'},4100);assert.equal(l.matches.m1.session.room.scores.player2,1);});
test('The opposing pie answers calls; its teammate cannot answer or raise instead',()=>{
 let l=started();l=act(l,'a',{kind:'call',value:'truco'},1000);
 assert.equal(l.matches.m1.session.room.pendingBet.responder,'player4');
 assert.throws(()=>act(l,'b',{kind:'call',value:'yes'},1001));
 assert.throws(()=>act(l,'b',{kind:'call',value:'raise'},1001));
 l=act(l,'d',{kind:'call',value:'raise'},1002);
 assert.equal(l.matches.m1.session.room.pendingBet.responder,'player3');
 l=act(l,'c',{kind:'call',value:'yes'},1003);
 assert.equal(l.matches.m1.session.room.trucoLevel,3);
});

test('Abandonment pays both winners equally once, conserves supply and records their histories',()=>{let l=started();l=act(l,'b',{kind:'abandon'},1000);assert.equal(l.matches.m1.status,'settled');assert.deepEqual(l.matches.m1.winners,['a','c']);assert.equal(l.wallets.a.balance,12);assert.equal(l.wallets.c.balance,12);assert.equal(l.wallets.b.balance,8);assert.equal(l.wallets.d.balance,8);assert.equal(Object.values(l.wallets).reduce((n,w)=>n+w.balance+w.locked,0),50);assert.deepEqual(act(l,'b',{kind:'abandon'},1000),l);assert.equal(personalHistory(l,'c').matches[0].delta,2);assert.equal(personalHistory(l,'d').matches[0].delta,-2);validateAccounting(base(),recordHistory(base(),l,1000));});
test('All four rematch votes are required; balances reserve atomically and old requests cannot debit twice',()=>{let l=act(started(),'b',{kind:'abandon'},1000);for(const uid of ['a','b','c'])l=act(l,uid,{kind:'rematch',value:'request'},2000+uid.charCodeAt(0));assert.equal(l.tables.ABCDE,'m1');l=act(l,'d',{kind:'rematch',value:'accept'},2100);assert.notEqual(l.tables.ABCDE,'m1');const m=l.matches[l.tables.ABCDE];assert.equal(m.session.room.status,'started');for(const uid of ['a','b','c','d'])assert.equal(l.wallets[uid].locked,2);assert.throws(()=>tableOperation(l,{code:'ABCDE',uid:'a',command:{kind:'rematch',value:'accept'},expectedMatchId:'m1',now:2200}));});
test('The fourth player starts the deal directly without drawing cards',()=>{
 const s=full().matches.m1.session;
 assert.equal(s.room.status,'started');assert.equal(s.room.dealer,'player4');assert.equal(s.room.turn,'player1');
 assert.equal(s.room.handNumber,1);assert.equal(s.room.openingDraw,null);assert.equal(s.drawPool,undefined);
 assert.equal(new Set([...Object.values(s.hands).flat(),s.room.muestra].map(c=>c.id)).size,13);
});

test('Firebase round-trips preserve directly dealt hands and dealer rotation',()=>{
 let l=databaseRoundTrip(full());const s=l.matches.m1.session;assert.equal(s.room.status,'started');
 for(const p of ['player1','player3'])l=databaseRoundTrip(act(l,l.matches.m1.players[p].uid,{kind:'fold'},3100));
 l=databaseRoundTrip(act(l,'b',{kind:'tick'},6200));l=databaseRoundTrip(act(l,'b',{kind:'tick'},13000));
 assert.equal(l.matches.m1.session.room.handNumber,2);assert.equal(l.matches.m1.session.room.dealer,'player1');
});

test('Envido compares all four individual totals and ties prefer the earlier player',()=>{let l=started(),r=l.matches.m1.session.room;r.envidoClosed=false;l=act(l,'a',{kind:'call',value:'envido'},1000);l=act(l,'d',{kind:'call',value:'yes'},1001);for(const [uid,value] of [['a',6],['b',6],['d',7],['c',6]])l=act(l,uid,{kind:'declare',value},1002+uid.charCodeAt(0));r=l.matches.m1.session.room;assert.equal(r.envidoAudit.winner,'player4');assert.equal(r.scores.player2,0);assert.equal(r.turn,'player1');assert.equal(r.pendingBet,null);assert.throws(()=>act(l,'a',{kind:'declare',value:38},1100));});
test('Each teammate sings their own flower and the team scores six; opponents use the strongest individual flower',()=>{let l=started(),s=l.matches.m1.session;s.room.envidoClosed=false;s.hands.player1=[card('♦',2),card('♠',7),card('♠',1)];s.originals.player1=s.hands.player1;s.hands.player3=[card('♦',4),card('♣',5),card('♣',7)];s.originals.player3=s.hands.player3;l=act(l,'a',{kind:'call',value:'flor'},1000);assert.equal(l.matches.m1.session.room.scores.player1,3);assert.equal(l.matches.m1.session.room.flors.player3,undefined);l=act(l,'c',{kind:'call',value:'flor'},1001);assert.equal(l.matches.m1.session.room.scores.player1,6);assert.equal(l.matches.m1.session.room.envidoClosed,true);
 l=started();s=l.matches.m1.session;s.hands.player1=[card('♦',2),card('♦',4),card('♦',5)];s.originals.player1=s.hands.player1;s.hands.player2=[card('♣',4),card('♣',5),card('♣',7)];s.originals.player2=s.hands.player2;l=act(l,'a',{kind:'call',value:'flor'},1000);assert.equal(l.matches.m1.session.room.pendingBet.responder,'player2');l=act(l,'b',{kind:'call',value:'raise-conflor'},1001);assert.equal(l.matches.m1.session.room.pendingBet.responder,'player1');l=act(l,'a',{kind:'call',value:'yes'},1002);assert.equal(l.matches.m1.session.room.pendingBet.revealMode,true);assert.equal(l.matches.m1.session.room.scores.player1,0);
 l=declareFlowers(l,1003);assert.equal(l.matches.m1.session.room.scores.player1,5);assert.equal(l.matches.m1.session.room.florCompared,true);});
test('A normal complete 2v2 game pays exactly once without abandoning',()=>{let l=started(),now=1000;for(let i=0;i<12&&l.matches.m1.status!=='settled';i++){l=databaseRoundTrip(act(l,'b',{kind:'fold'},now));l=databaseRoundTrip(act(l,'d',{kind:'fold'},now+1));l=databaseRoundTrip(act(l,'a',{kind:'tick'},now+3100));l=databaseRoundTrip(act(l,'a',{kind:'tick'},now+9000));now+=10000;}assert.equal(l.matches.m1.status,'settled');assert.deepEqual(l.matches.m1.winners,['a','c']);assert.equal(l.wallets.c.balance,12);assert.deepEqual(reservationAlerts(l,now),[]);assert.equal(Object.values(l.wallets).reduce((n,w)=>n+w.balance+w.locked,0),50);});
test('A wrong Envido declaration is audited and awards the other team both envido and hand',()=>{let l=started();l.matches.m1.session.room.envidoClosed=false;l=act(l,'a',{kind:'call',value:'envido'},1000);l=act(l,'d',{kind:'call',value:'yes'},1001);for(const [uid,value] of [['a',37],['b',6],['d',7]])l=act(l,uid,{kind:'declare',value},1100+uid.charCodeAt(0));l=act(l,'b',{kind:'fold'},1300);l=act(l,'d',{kind:'fold'},1301);l=act(l,'a',{kind:'tick'},4500);assert.equal(l.matches.m1.session.room.scores.player1,0);assert.equal(l.matches.m1.session.room.scores.player2,3);});
test('Disconnecting player3 loses for their team and does not leave credits reserved',()=>{let l=started();const presence={player3:{uid:'c',matchNumber:1,online:false,disconnectedAt:1000}};l=tableOperation(l,{code:'ABCDE',uid:'a',command:{kind:'tick'},presence,now:47000});assert.equal(l.matches.m1.status,'settled');assert.deepEqual(l.matches.m1.winners,['b','d']);assert.equal(l.wallets.c.locked,0);});
test('Folding while declaring Envido transfers the card turn and declarations continue',()=>{let l=started();l.matches.m1.session.room.envidoClosed=false;l=act(l,'a',{kind:'call',value:'envido'},1000);l=act(l,'d',{kind:'call',value:'yes'},1001);l=act(l,'a',{kind:'fold'},1002);for(const [uid,value] of [['b',6],['c',6]])l=act(l,uid,{kind:'declare',value},1100+uid.charCodeAt(0));assert.equal(l.matches.m1.session.room.turn,'player2');assert.equal(l.matches.m1.session.room.pendingBet,null);l=act(l,'b',{kind:'play',cardId:'basto-1'},1300);assert.equal(l.matches.m1.session.room.turn,'player3');});
test('Twenty complete random deals play through four-seat calls, cards, pauses and accounting',()=>{
 for(let game=0;game<20;game++){
  let l=databaseRoundTrip(full()),now=1000;
  for(let step=0;step<1500&&l.matches.m1.status!=='settled';step++){
   let s=l.matches.m1.session,r=s.room,seat,command;
   if(r.status==='drawing'){seat=SEATS.find(p=>!r.openingDraw?.cards?.[p]);command=seat?{kind:'draw'}:{kind:'tick'};seat??='player1';if(command.kind==='tick')now+=3000;}
   else if(r.status!=='started'||r.resolvingTrick||r.pendingNextHand){seat='player1';command={kind:'tick'};now+=6000;}
   else if(r.pendingBet){seat=r.pendingBet.revealMode?r.pendingBet.revealTurn:r.pendingBet.responder;command=r.pendingBet.revealMode?(r.pendingBet.type==='flor'?(()=>{const v=florValue(s.originals[seat],r.muestra),best=Math.max(-1,...Object.values(r.pendingBet.reveals||{}));return v>best?{kind:'declare',value:v}:{kind:'declare',good:true};})():{kind:'declare',value:s.truth[seat]}):r.pendingBet.type!=='flor'&&flower(s.originals[seat],r.muestra)&&!r.flors?.[seat]?{kind:'call',value:'flor'}:{kind:'call',value:'yes'};}
   else{seat=r.turn;command=flower(s.originals[seat],r.muestra)&&!r.flors?.[seat]?{kind:'call',value:'flor'}:!r.envidoClosed&&!r.playedBy?.[seat]&&r.trickNo===1&&step%5===0?{kind:'call',value:'envido'}:r.trucoLevel===1&&step%7===0?{kind:'call',value:'truco'}:{kind:'play',cardId:s.hands[seat][0].id};}
   now+=20;l=databaseRoundTrip(act(l,l.matches.m1.players[seat].uid,command,now,'g'+game+'s'+step));
  }
  assert.equal(l.matches.m1.status,'settled','game '+game+' must finish');assert.equal(l.matches.m1.winners.length,2);assert.equal(Object.values(l.wallets).reduce((n,w)=>n+w.balance+w.locked,0),50);validateAccounting(base(),l);
 }
});

test('Partner cards stay out of public data and each private payload contains only the viewer and teammate',()=>{
 const m=full().matches.m1,s=m.session;
 for(const p of SEATS){const partner={player1:'player3',player2:'player4',player3:'player1',player4:'player2'}[p],data=privateTableHand(m,p);
  assert.deepEqual(data.hand,s.hands[p]);assert.deepEqual(data.partnerHand,s.hands[partner]);
  assert.deepEqual(Object.keys(data).sort(),['creditMatchId','revision','handNumber','hand','partnerHand'].sort());
 }
 assert.equal(publicTable(m).partnerHand,undefined);assert.equal(publicTable(m).hands,undefined);
});
test('If the opposing pie folds, the remaining teammate answers the next call',()=>{
 let l=started();l=act(l,'b',{kind:'fold'},1000);l=act(l,'a',{kind:'call',value:'truco'},1001);
 assert.equal(l.matches.m1.session.room.pendingBet.responder,'player4');
});
test('The response follows the pie after the dealer rotates, including flor',()=>{
 let l=started(),s=l.matches.m1.session;
 s.room.mano='player4';l=act(l,'a',{kind:'call',value:'truco'},1000);
 assert.equal(l.matches.m1.session.room.pendingBet.responder,'player2');
 l=started();s=l.matches.m1.session;s.room.turn='player3';
 s.hands.player3=[card('♣',1),card('♣',4),card('♣',6)];
 s.hands.player4=[card('♥',1),card('♥',4),card('♥',6)];
 s.originals=structuredClone(s.hands);
 l=act(l,'c',{kind:'call',value:'flor'},1000);
 assert.equal(l.matches.m1.session.room.pendingBet.responder,'player4');
 assert.throws(()=>act(l,'b',{kind:'call',value:'yes'},1001));
 l=act(l,'d',{kind:'call',value:'raise-conflor'},1002);l=act(l,'c',{kind:'call',value:'yes'},1002);
 assert.equal(l.matches.m1.session.room.pendingBet.revealMode,true);
 l=declareFlowers(l,1003);
 assert.equal(l.matches.m1.session.room.pendingBet,null);
});

test('Only the team pie can send the three instructions during the teammate card turn',()=>{
 let l=started(),r=l.matches.m1.session.room;
 for(const value of ['veni','juga','grita']){l=act(l,'c',{kind:'team-signal',value},1100+value.length,'signal-'+value);r=l.matches.m1.session.room;assert.equal(r.teamSignal.from,'player3');assert.equal(r.teamSignal.to,'player1');assert.equal(r.turn,'player1');}
 assert.throws(()=>act(l,'a',{kind:'team-signal',value:'veni'},1200));assert.throws(()=>act(l,'d',{kind:'team-signal',value:'juga'},1200));assert.throws(()=>act(l,'c',{kind:'team-signal',value:'otro'},1200));
 l=act(l,'a',{kind:'call',value:'truco'},1300);assert.throws(()=>act(l,'c',{kind:'team-signal',value:'grita'},1301));
});
test('Pie remains fixed until dealing clears previous notices and signals',()=>{
 const l=started(),s=l.matches.m1.session,r=s.room;r.trickNo=2;r.trickCards=[];r.resolvedTrickWinner='player3';r.turn='player1';
 createTeamReferee(s,{now:2000}).action('player3',{kind:'team-signal',value:'veni'});assert.equal(r.teamSignal.to,'player1');
 assert.throws(()=>createTeamReferee(s,{now:2001}).action('player1',{kind:'team-signal',value:'veni'}));
 r.callNotice={handNumber:r.handNumber,text:'28 tantos'};r.status='revealing';r.endReveal={endsAt:2002};createTeamReferee(s,{now:2003}).advance();
 assert.equal(r.callNotice,null);assert.equal(r.teamSignal,null);assert.equal(r.resolvedTrickWinner,null);
});

test('The responding pie does not change when another teammate leads the next trick',()=>{let l=started(),r=l.matches.m1.session.room;r.trickNo=2;r.resolvedTrickWinner='player4';r.turn='player1';l=act(l,'a',{kind:'call',value:'truco'},1500);assert.equal(l.matches.m1.session.room.pendingBet.responder,'player4');assert.throws(()=>act(l,'b',{kind:'call',value:'yes'},1501));l=act(l,'d',{kind:'call',value:'yes'},1502);assert.equal(l.matches.m1.session.room.pendingBet,null);});

test('Accepted con flor envido in 2v2 is declared from the mano with real points before anyone scores',()=>{
 let l=started(),s=l.matches.m1.session;s.room.turn='player3';
 s.hands.player3=[card('♣',1),card('♣',4),card('♣',6)];s.hands.player4=[card('♥',1),card('♥',4),card('♥',6)];s.originals=structuredClone(s.hands);
 l=act(l,'c',{kind:'call',value:'flor'},1000);l=act(l,'d',{kind:'call',value:'raise-conflor'},1001);l=act(l,'c',{kind:'call',value:'yes'},1002);
 const room=l.matches.m1.session.room,first=room.pendingBet.revealTurn,uid=room.players[first].uid,truth=florValue(l.matches.m1.session.originals[first],room.muestra);
 assert.equal(room.pendingBet.order[0],first);assert.equal(room.scores.player1+room.scores.player2,0);
 assert.throws(()=>act(l,uid,{kind:'declare',good:true},1002),/mano/);
 assert.throws(()=>act(l,uid,{kind:'declare',value:truth+1},1003),/flor/);
 l=declareFlowers(l,1004);assert.equal(l.matches.m1.session.room.pendingBet,null);
 assert.equal(l.matches.m1.session.room.scores.player1+l.matches.m1.session.room.scores.player2>0,true);
});
test('La mia es flor in 2v2 keeps playing and the higher flower takes 3 points when the hand ends',()=>{
 let l=started(),s=l.matches.m1.session;s.room.turn='player3';
 s.hands.player3=[card('♣',1),card('♣',4),card('♣',6)];s.hands.player4=[card('♥',1),card('♥',4),card('♥',6)];s.originals=structuredClone(s.hands);
 l=act(l,'c',{kind:'call',value:'flor'},1000);l=act(l,'d',{kind:'call',value:'yes'},1001);
 let room=l.matches.m1.session.room;
 assert.equal(room.pendingBet,null);assert.equal(room.callNotice.text,'La mía es flor');assert.equal(room.scores.player1+room.scores.player2,0);assert.equal(room.florDeferred,3);
 const sess=l.matches.m1.session,best=['player3','player4'].reduce((a,p)=>florValue(sess.originals[p],room.muestra)>florValue(sess.originals[a],room.muestra)?p:a);
 l=act(l,'a',{kind:'fold'},1002);l=act(l,'c',{kind:'fold'},1003);l=act(l,'b',{kind:'tick'},4200);room=l.matches.m1.session.room;
 const groups=room.endReveal.groups;assert.equal(groups.length,1);assert.equal(groups[0].player,best);assert.match(groups[0].label,/FLOR · /);
 assert.ok(room.handScoreEntries.some(e=>e.player===team(best)&&e.points===3&&/La mía es flor/.test(e.detail||e.reason||JSON.stringify(e))));
});
test('A raise against a sung flor is answered by the player who sang it, even if not the pie, and only the winning flor is shown',()=>{
 let l=started(),s=l.matches.m1.session;
 s.hands.player1=[card('♣',1),card('♣',4),card('♣',6)];s.hands.player2=[card('♥',1),card('♥',4),card('♥',6)];s.originals=structuredClone(s.hands);
 l=act(l,'b',{kind:'call',value:'flor'},1000);assert.equal(l.matches.m1.session.room.pendingBet.responder,'player1');
 l=act(l,'a',{kind:'call',value:'raise-conflor'},1001);assert.equal(l.matches.m1.session.room.pendingBet.responder,'player2');
 l=act(l,'b',{kind:'call',value:'yes'},1002);l=declareFlowers(l,1003);
 const room=l.matches.m1.session.room;assert.ok(room.florWinner);
 l=act(l,'b',{kind:'fold'},1100);l=act(l,'d',{kind:'fold'},1101);l=act(l,'a',{kind:'tick'},4500);
 const flowers=l.matches.m1.session.room.endReveal.groups.filter(g=>/FLOR/.test(g.label));
 assert.equal(flowers.length,1);assert.equal(flowers[0].player,room.florWinner);
});
test('Gritá is only accepted while the team has the word to call truco',()=>{
 let l=started();const s=l.matches.m1.session;s.room.turn='player1';s.room.lastTrucoTeam='player1';s.room.trucoLevel=2;
 assert.throws(()=>act(l,'c',{kind:'team-signal',value:'grita'},1000),/palabra/);
 s.room.lastTrucoTeam='player2';l=act(l,'c',{kind:'team-signal',value:'grita'},1001);
 assert.equal(l.matches.m1.session.room.teamSignal.value,'grita');
});
