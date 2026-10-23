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
