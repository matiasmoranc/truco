const {test}=require('node:test');
const assert=require('node:assert/strict');
const {newTeamSession,strength}=require('../functions/team-referee.cjs');
const {botCommands,signalFor}=require('../functions/team-bot.cjs');

const people=Object.fromEntries(['player1','player2','player3','player4'].map(p=>[p,{uid:'bot:'+p,name:'Bot',bot:true}]));
// A fresh hand where the bot on turn got `value` from its partner; envido and flor are already settled.
function signaled(value){
 const s=newTeamSession('ABCDE',people,30,{id:'m1',stake:1,pot:4,matchNumber:1},1000),r=s.room,p=r.turn;
 Object.assign(r,{envidoClosed:true,flors:{[p]:true}});
 r.teamSignal={id:'n1',from:'player3',to:p,text:'',value,handNumber:r.handNumber,trickNo:r.trickNo,time:1000};
 return {s,r,p,sorted:[...s.hands[p]].sort((a,b)=>strength(a,r.muestra)-strength(b,r.muestra))};
}
const firstPlay=commands=>commands.find(c=>c.kind==='play')?.cardId;

test('The bot reads only the signal sent to it in this trick',()=>{
 const {r,p}=signaled('veni');
 assert.equal(signalFor(r,p),'veni');
 assert.equal(signalFor({...r,trickNo:r.trickNo+1},p),null);
 assert.equal(signalFor(r,p==='player1'?'player2':'player1'),null);
});
test('Vení throws the lowest card and jugá leads the highest, without calling truco',()=>{
 let {s,p,sorted}=signaled('veni');
 let commands=botCommands(s,p,()=>0.99);
 assert.equal(firstPlay(commands),sorted[0].id);assert.ok(!commands.some(c=>c.kind==='call'));
 ({s,p,sorted}=signaled('juga'));
 commands=botCommands(s,p,()=>0.99);
 assert.equal(firstPlay(commands),sorted.at(-1).id);assert.ok(!commands.some(c=>c.kind==='call'));
});
test('Gritá makes the bot call truco before playing',()=>{
 const {s,p}=signaled('grita');
 assert.deepEqual(botCommands(s,p,()=>0.99)[0],{kind:'call',value:'truco'});
});

test('Envido declarations: the first must say a number, and passing behind one\'s partner is "Paso"',()=>{
 const {createTeamReferee}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m2',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 const order=['player1','player2','player3','player4'];
 r.pendingBet={id:'b1',type:'envido',caller:'player2',callerTeam:'player2',responder:'player1',stake:2,accepted:0,called:'envido',revealMode:true,reveals:{},order,revealTurn:'player1'};
 const ref=createTeamReferee(s,{now:1500});
 assert.throws(()=>ref.action('player1',{kind:'declare',good:true}),/declara primero/);
 ref.action('player1',{kind:'declare',value:28});
 ref.action('player2',{kind:'declare',good:true});assert.equal(r.callNotice.text,'Son buenas');
 ref.action('player3',{kind:'declare',good:true});assert.equal(r.callNotice.text,'Paso');
});

test('Envido never passes 37: two pieces count only the best one, like the 1v1 game',()=>{
 const {envido}=require('../functions/team-referee.cjs');
 const muestra={id:'oro-4',suit:'♦',rank:4},card=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada'})[suit]+'-'+rank,suit,rank});
 assert.equal(envido([card('♦',2),card('♥',2),card('♦',12)],muestra),30);
 assert.equal(envido([card('♦',2),card('♥',7),card('♠',3)],muestra),37);
 assert.equal(envido([card('♥',7),card('♥',6),card('♠',3)],muestra),33);
});
test('A table saved with an impossible envido unblocks: the timed-out player declares the recounted points',()=>{
 const {createTeamReferee}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m3',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 const muestra={id:'oro-4',suit:'♦',rank:4,label:'4'},card=(suit,rank)=>({id:({'♦':'oro','♥':'copa'})[suit]+'-'+rank,suit,rank,label:String(rank)});
 r.muestra=muestra;s.originals.player1=[card('♦',2),card('♥',2),card('♦',12)];s.hands.player1=s.originals.player1.slice(1);
 s.truth.player1=59;
 r.pendingBet={id:'b2',type:'envido',caller:'player2',callerTeam:'player2',responder:'player1',stake:2,accepted:0,called:'envido',revealMode:true,reveals:{},order:['player1','player2','player3','player4'],revealTurn:'player1'};
 r.turnClock={key:'k',player:'player1',startedAt:1000};
 createTeamReferee(s,{now:1000+46000}).advance();
 assert.equal(r.pendingBet.reveals.player1,30);assert.equal(s.truth.player1,30);assert.equal(r.pendingBet.revealTurn,'player2');
});
test('A timed-out flor declaration uses the flor points, and says son buenas when it cannot win',()=>{
 const {createTeamReferee,florValue}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m4',stake:1,pot:4,matchNumber:1},1000),r=s.room,order=['player1','player2','player3','player4'];
 r.pendingBet={id:'b3',type:'flor',caller:'player2',callerTeam:'player2',responder:'player1',stake:5,accepted:3,called:'conflor',revealMode:true,reveals:{},order:['player1','player2'],revealTurn:'player1'};
 r.turnClock={key:'k',player:'player1',startedAt:1000};
 createTeamReferee(s,{now:47000}).advance();
 assert.equal(r.pendingBet.reveals.player1,florValue(s.originals.player1,r.muestra));
 r.pendingBet.reveals.player1=99;r.turnClock={key:'k2',player:'player2',startedAt:47000};
 createTeamReferee(s,{now:93000}).advance();
 assert.equal(r.callNotice.text,'Son buenas');
});

test('Only the pie bot sings envido; the first of its team just plays',()=>{
 const s=newTeamSession('ABCDE',people,30,{id:'m5',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 Object.assign(r,{mano:'player1',turn:'player1',trickNo:1,envidoClosed:false,playedBy:{},flors:{},trickCards:[]});
 s.truth={player1:33,player2:0,player3:33,player4:0};
 for(const q of ['player1','player2','player3','player4'])r.flors[q]=true;
 assert.ok(!botCommands(s,'player1',()=>0.99).some(c=>c.kind==='call'&&['envido','real'].includes(c.value)));
 r.turn='player3';
 assert.deepEqual(botCommands(s,'player3',()=>0.99)[0],{kind:'call',value:'real'});
});
