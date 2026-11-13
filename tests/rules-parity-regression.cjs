'use strict';
// 2 vs 2 follows the 1 vs 1 rules: flor sung automatically for the first holder, the flor that
// annuls the envido, falta envido, going to the deck before playing, liars and the points history.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createReferee}=require('../functions/game-referee.cjs');
const {SEATS,createTeamReferee}=require('../functions/team-referee.cjs');

const NAMES={'♦':'oro','♥':'copa','♠':'espada','♣':'basto'};
const full=()=>Object.keys(NAMES).flatMap(suit=>[1,2,3,4,5,6,7,10,11,12].map(rank=>({id:NAMES[suit]+'-'+rank,suit,rank,label:String(rank),red:['♦','♥'].includes(suit)})));
// A deck whose first cards are the given ones ('♥1'...), the rest in any order.
const deckOf=(...codes)=>()=>{const cards=full(),first=codes.map(code=>cards.find(c=>c.id===NAMES[code[0]]+'-'+code.slice(1)));return [...first,...cards.filter(c=>!first.includes(c))];};
// Muestra ♠6 everywhere: its pieces (♠2, ♠4, ♠5, ♠10, ♠11) are never dealt here.
const PLAIN=[['♦1','♣3','♥4'],['♣7','♦6','♥12'],['♦3','♣4','♥5'],['♣6','♦5','♥10']];
const FLOR=['♥1','♥3','♥7'],FLOR2=['♣1','♣2','♣5'];

// 1v1: player1 is the mano of the first hand; deck order is player1, player2, muestra.
function duel(hands,{scores,target=30}={}){
 const session={code:'ABCDE',hands:{},originals:{},truth:{},room:{managedCredits:true,creditMatch:{id:'g',stake:1,matchNumber:1},deviceMode:'two',status:'drawing',createdAt:0,matchNumber:1,targetPoints:target,table:{name:'A'},players:{player1:{uid:'a',name:'Ana'},player2:{uid:'b',name:'Beto'}},scores:{player1:0,player2:0},handNumber:1,trickNo:1,playedCount:0,tricks:[],trickCards:[],feed:[],trucoLevel:1,flors:{},timeoutCounts:{}}};
 if(scores)session.room.scores=scores;
 const deckFactory=deckOf(...hands[0],...hands[1],'♠6');
 createReferee(session,{now:100,deckFactory}).start();
 const at=now=>createReferee(session,{now,deckFactory:deckOf(...PLAIN[0],...PLAIN[1],'♠6')});
 return {s:session,r:session.room,at};
}
// 2v2: player1 is the mano; deck order is player1..player4 and the muestra is the 13th card.
function table(hands,{scores,target=30}={}){
 const s={code:'ABCDE',hands:{},originals:{},truth:{},room:{mode:'2v2',managedCredits:true,creditMatch:{id:'m',stake:1},deviceMode:'two',status:'started',createdAt:0,matchNumber:1,targetPoints:target,table:{name:'A'},players:Object.fromEntries(SEATS.map((p,i)=>[p,{uid:'u'+i,name:'J'+(i+1)}])),teams:{player1:['player1','player3'],player2:['player2','player4']},scores:scores||{player1:0,player2:0},handNumber:0,trickNo:1,playedCount:0,tricks:[],trickCards:[],feed:[],trucoLevel:1,flors:{},timeoutCounts:{}}};
 createTeamReferee(s,{now:100,deckFactory:deckOf(...hands.flat(),'♠6')}).start();
 const at=now=>createTeamReferee(s,{now,deckFactory:deckOf(...PLAIN.flat(),'♠6')});
 return {s,r:s.room,at};
}

test('1v1: the pie holding the only flor has it sung as the hand is dealt, so no envido can be called',()=>{
 const {r,at}=duel([PLAIN[0],FLOR]);
 assert.equal(r.mano,'player1');assert.ok(r.flors.player2>0);assert.equal(r.scores.player2,3);
 assert.equal(r.florSettled,true);assert.equal(r.envidoClosed,true);assert.equal(r.pendingBet,null);assert.equal(r.turn,'player1');
 assert.equal(r.callNotice.from,'player2');assert.equal(r.callNotice.spoken.toLowerCase(),'flor');
 assert.match(r.feed[0].text,/3 puntos por flor/);
 assert.throws(()=>at(200).action('player1',{kind:'call',value:'envido'}),/envido/i);
});
test('1v1: with two flowers only the first from the mano is sung; the other answers as before',()=>{
 const {r,s,at}=duel([FLOR,FLOR2]);
 assert.ok(r.flors.player1>0);assert.equal(r.flors.player2,undefined);
 assert.equal(r.pendingBet.type,'flor');assert.equal(r.pendingBet.responder,'player2');assert.equal(r.pendingBet.single,true);
 at(200).action('player2',{kind:'call',value:'raise-conflor'});assert.equal(r.pendingBet.called,'conflor');assert.equal(r.pendingBet.responder,'player1');
 assert.equal(s.hands.player1.length,3);
});
test('1v1: a hand without flor is left alone',()=>{
 const {r}=duel([PLAIN[0],PLAIN[1]]);
 assert.deepEqual(r.flors,{});assert.equal(r.envidoClosed,false);assert.equal(r.pendingBet,null);
});
test('1v1: a falta envido won by the side behind lets the hand go on and pays the truco normally',()=>{
 // Ana (28) is behind 0 to 20; the falta envido is worth the 10 the leader still needs.
 const {r,at}=duel([['♥6','♥2','♣3'],['♦1','♣4','♥5']],{scores:{player1:0,player2:20}});
 at(200).action('player1',{kind:'call',value:'falta'});at(300).action('player2',{kind:'call',value:'yes'});
 at(400).action('player1',{kind:'declare',value:28});at(500).action('player2',{kind:'declare',good:true});
 assert.ok(!r.pendingNextHand);assert.equal(r.turn,'player1');assert.equal(r.status,'started');
 at(600).action('player2',{kind:'fold'});at(3700).advance();
 assert.deepEqual(r.lastHandScore.totals,{player1:11,player2:0});
});

test('2v2: the first holder from the mano gets the flor sung automatically, for any seat',()=>{
 const {r,at}=table([PLAIN[0],PLAIN[1],FLOR,PLAIN[3]]);
 assert.equal(r.flors.player3,true);assert.equal(r.scores.player1,3);assert.equal(r.florSettled,true);assert.equal(r.envidoClosed,true);
 assert.equal(r.callNotice.from,'player3');assert.equal(r.callNotice.text,'Flor');assert.equal(r.pendingBet,null);assert.equal(r.turn,'player1');
 assert.throws(()=>at(200).action('player1',{kind:'call',value:'envido'}),/envido/i);
});
test('2v2: with flowers on both teams only the first from the mano is sung; the rival holder answers and cannot back down',()=>{
 const {r,at}=table([PLAIN[0],FLOR,FLOR2,PLAIN[3]]);
 assert.equal(r.flors.player2,true);assert.equal(r.flors.player3,undefined);
 assert.equal(r.pendingBet.type,'flor');assert.equal(r.pendingBet.responder,'player3');
 // As in 1v1 there is no "con flor me achico": someone holding a flower sings it or raises.
 assert.throws(()=>at(200).action('player3',{kind:'call',value:'no'}),/flor/i);
 at(300).action('player3',{kind:'call',value:'yes'});assert.equal(r.flors.player3,true);assert.equal(r.florDeferred,3);assert.equal(r.pendingBet,null);
});
test('2v2: a sung flor annuls an envido already accepted, which is never paid',()=>{
 const {s,r,at}=table([['♥6','♥2','♣3'],PLAIN[1],PLAIN[2],PLAIN[3]]);
 at(200).action('player1',{kind:'call',value:'envido'});at(300).action('player4',{kind:'call',value:'yes'});
 for(let i=0;r.pendingBet?.revealMode&&i<4;i++){const p=r.pendingBet.revealTurn;at(400+i).action(p,{kind:'declare',value:s.truth[p]});}
 assert.ok(r.envidoAudit);
 // A hand saved before the automatic flor: the partner still holds an unsung one and sings it now.
 s.hands.player3=FLOR.map(code=>full().find(c=>c.id===NAMES[code[0]]+'-'+code.slice(1)));s.originals.player3=structuredClone(s.hands.player3);
 at(500).action('player3',{kind:'call',value:'flor'});
 assert.equal(r.envidoAudit,null);assert.equal(r.scores.player1,3);assert.equal(r.scores.player2,0);
 at(600).action('player2',{kind:'fold'});at(601).action('player4',{kind:'fold'});at(3700).advance();
 assert.deepEqual(r.lastHandScore.totals,{player1:4,player2:0});
 assert.ok(!r.lastHandScore.entries.some(e=>/envido/.test(e.detail)));
});
test('2v2: a falta envido won by the team behind lets the hand go on; the leader reaching the target stops it',()=>{
 const behind=table([['♥6','♥2','♣3'],PLAIN[1],PLAIN[2],PLAIN[3]],{scores:{player1:0,player2:20}});
 behind.at(200).action('player1',{kind:'call',value:'falta'});behind.at(300).action('player4',{kind:'call',value:'yes'});
 for(let i=0;behind.r.pendingBet?.revealMode&&i<4;i++){const p=behind.r.pendingBet.revealTurn;behind.at(400+i).action(p,{kind:'declare',value:behind.s.truth[p]});}
 assert.ok(!behind.r.pendingNextHand);assert.equal(behind.r.turn,'player1');assert.equal(behind.r.envidoAudit.winner,'player1');
 behind.at(500).action('player2',{kind:'fold'});behind.at(501).action('player4',{kind:'fold'});behind.at(3600).advance();
 assert.deepEqual(behind.r.lastHandScore.totals,{player1:11,player2:0});
 const ahead=table([['♥6','♥2','♣3'],PLAIN[1],PLAIN[2],PLAIN[3]],{scores:{player1:20,player2:0}});
 ahead.at(200).action('player1',{kind:'call',value:'falta'});ahead.at(300).action('player4',{kind:'call',value:'yes'});
 for(let i=0;ahead.r.pendingBet?.revealMode&&i<4;i++){const p=ahead.r.pendingBet.revealTurn;ahead.at(400+i).action(p,{kind:'declare',value:ahead.s.truth[p]});}
 assert.match(ahead.r.pendingNextHand.id,/^envido:/);ahead.at(3500).advance();assert.equal(ahead.r.scores.player1,30);assert.equal(ahead.r.status,'complete');
});
test('2v2: a liar in an envido that stopped the hand gives the honest team the envido and the hand points',()=>{
 const {s,r,at}=table([PLAIN[0],PLAIN[1],PLAIN[2],['♥6','♥2','♣12']],{scores:{player1:20,player2:0}});
 at(200).action('player1',{kind:'call',value:'falta'});at(300).action('player4',{kind:'call',value:'yes'});
 // J1 lies with 33 (it has 4) and the leaders would reach 30; J4 has 28.
 at(400).action('player1',{kind:'declare',value:33});
 for(let i=0;r.pendingBet?.revealMode&&i<4;i++){const p=r.pendingBet.revealTurn;at(500+i).action(p,{kind:'declare',value:s.truth[p]});}
 assert.match(r.pendingNextHand.id,/^envido:/);at(3600).advance();
 assert.deepEqual(r.scores,{player1:20,player2:11});
 assert.ok(r.lastHandScore.entries.some(e=>e.player==='player2'&&e.points===1&&/1 punto de la mano \(J1 mintió en el envido\)/.test(e.detail)));
 assert.ok(!r.lastHandScore.entries.some(e=>/^0 puntos/.test(e.detail)));
});
test('2v2: the points history records what was added when the score reaches the target',()=>{
 const {r}=table([FLOR,PLAIN[1],PLAIN[2],PLAIN[3]],{scores:{player1:28,player2:0}});
 assert.equal(r.scores.player1,30);assert.equal(r.status,'complete');
 assert.deepEqual(r.lastHandScore.entries.map(e=>[e.player,e.points]),[['player1',2]]);assert.equal(r.lastHandScore.totals.player1,2);
});
test('2v2: a team going to the deck before any card or call gives 2 points, as in 1v1; after a card, the hand',()=>{
 const early=table(PLAIN);
 early.at(200).action('player1',{kind:'fold'});early.at(201).action('player3',{kind:'fold'});
 assert.equal(early.r.pendingNextHand.foldPoints,2);early.at(3300).advance();
 assert.deepEqual(early.r.scores,{player1:0,player2:2});assert.match(early.r.lastHandScore.entries[0].detail,/antes de jugar o cantar: 2 puntos/);
 const late=table(PLAIN);
 late.at(200).action('player1',{kind:'play',cardId:late.s.hands.player1[0].id});
 late.at(201).action('player2',{kind:'fold'});late.at(202).action('player4',{kind:'fold'});late.at(3300).advance();
 assert.deepEqual(late.r.scores,{player1:1,player2:0});
});
test('2v2: going to the deck while a rival flor waits gives that flor and the hand, as in 1v1',()=>{
 const {r,at}=table([FLOR,FLOR2,PLAIN[2],PLAIN[3]]);
 assert.equal(r.pendingBet.type,'flor');assert.equal(r.pendingBet.callerTeam,'player1');
 at(200).action('player2',{kind:'fold'});at(201).action('player4',{kind:'fold'});at(3300).advance();
 assert.deepEqual(r.scores,{player1:4,player2:0});
});
