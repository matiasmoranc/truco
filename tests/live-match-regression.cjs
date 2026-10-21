'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTable,joinTable,tableOperation}=require('../functions/table-service.cjs');
const {liveUpdate,tryLiveAction}=require('../functions/live-match.cjs');
function fixture(mode='1v1'){
 let l={wallets:Object.fromEntries(['a','b','c','d'].map(uid=>[uid,{balance:10,locked:0}]))};
 l=createTable(l,{code:'ABCDE',id:'m',uid:'a',name:'a',mode,stake:1,targetPoints:10,now:100});
 for(const uid of (mode==='1v1'?['b']:['b','c','d']))l=joinTable(l,{code:'ABCDE',uid,name:uid,now:200});
 return l;
}
for(const mode of ['1v1','2v2'])test(mode+' live play matches the full referee without reading wallets',()=>{
 const l=fixture(mode),m=l.matches.m,player=m.session.room.turn,uid=m.players[player].uid;
 const p={code:'ABCDE',uid,command:{kind:'play',cardId:m.session.hands[player][0].id},requestId:'one',expectedMatchId:'m',now:300};
 const expected=tableOperation(l,p).matches.m,actual=liveUpdate(m,p);
 assert.deepEqual(actual,expected);assert.equal(m.session.hands[player].length,3);
 assert.deepEqual(liveUpdate(actual,p),actual,'duplicate request cannot play twice');
 assert.equal(liveUpdate(m,{...p,uid:'stranger'}),null);
 assert.equal(liveUpdate(m,{...p,expectedMatchId:'old'}),null);
 const other=Object.keys(m.players).find(seat=>seat!==player);
 assert.equal(liveUpdate(m,{...p,uid:m.players[other].uid}),null,'wrong turn never commits');
});
test('Only a pending response blocks an otherwise valid card; answering uses the same fast referee',()=>{
 const l=fixture(),m=l.matches.m,p={code:'ABCDE',uid:'a',command:{kind:'call',value:'truco'},requestId:'call',expectedMatchId:'m',now:300};
 const called=liveUpdate(m,p);assert.ok(called?.session.room.pendingBet);
 const responder=called.session.room.pendingBet.responder||'player2';
 const play={...p,uid:called.players[responder].uid,command:{kind:'play',cardId:called.session.hands[responder][0].id},requestId:'play',now:301};
 assert.equal(liveUpdate(called,play),null);
 const answer={...play,command:{kind:'call',value:'yes'},requestId:'yes'};
 const accepted=liveUpdate(called,answer);
 assert.ok(accepted);assert.equal(accepted.session.room.pendingBet,null);
 assert.equal(accepted.session.room.trucoLevel,2);assert.equal(accepted.session.room.turn,'player1');
 assert.deepEqual(accepted.session.hands,called.session.hands);
});
test('Database fast path only touches the table pointer and current match, including transaction retries',async()=>{
 const l=fixture(),m=l.matches.m,p={code:'ABCDE',uid:'a',command:{kind:'play',cardId:m.session.hands.player1[0].id},requestId:'play',expectedMatchId:'m',now:300},paths=[];
 let value=structuredClone(m),active=false;
 const db={ref(path){paths.push(path);if(path.endsWith('/tables/ABCDE'))return {once:async()=>({val:()=> 'm'})};
 assert.equal(path,'creditEconomy/matches/m');
 return {on(_event,fn){active=true;queueMicrotask(fn);},off(){active=false;},async transaction(update){
 assert.equal(active,true);const first=update(value);assert.equal(value.session.hands.player1.length,3);
 // A retry against another action's receipt must retain it.
 value.requests.other=true;value=update(value);assert.equal(value.requests.other,true);
 assert.deepEqual(value.session.hands,first.session.hands);
 return {committed:!!value,snapshot:{val:()=>value}};
 }};}};
 const result=await tryLiveAction(db,p);assert.equal(active,false);
 assert.equal(result.matches.m.session.hands.player1.length,2);
 assert.deepEqual(paths,['creditEconomy/tables/ABCDE','creditEconomy/matches/m']);
 assert.equal(await tryLiveAction(db,{...p,command:{kind:'abandon'}}),null);
 assert.equal(paths.length,2,'abandonment is handled by the atomic settlement path');
});
test('An already confirmed request returns its current snapshot without writing or invoking accounting',async()=>{
 const l=fixture(),m=l.matches.m;m.requests.confirmed=true;
 let written=false;
 const db={ref(path){if(path.endsWith('/tables/ABCDE'))return {once:async()=>({val:()=> 'm'})};
 return {on(_event,fn){queueMicrotask(fn);},off(){},async transaction(update){
 const next=update(m);written=next!==undefined;
 return {committed:written,snapshot:{val:()=>next||m}};
 }};}};
 const result=await tryLiveAction(db,{code:'ABCDE',uid:'a',command:{kind:'play',cardId:m.session.hands.player1[0].id},requestId:'confirmed',expectedMatchId:'m',now:300});
 assert.equal(written,false);assert.equal(result.liveUnchanged,true);assert.deepEqual(result.matches.m,m);
});
for(const mode of ['1v1','2v2'])test(mode+' terminal state falls back without changing a wallet or match',()=>{
 const l=fixture(mode),m=l.matches.m,before=structuredClone(m);
 Object.assign(m.session.room,{status:'complete',endReveal:{done:true},matchResult:{winner:'player1'}});
 const terminal=structuredClone(m);
 assert.equal(liveUpdate(m,{code:'ABCDE',uid:'a',command:{kind:'tick'},now:500}),null);
 assert.deepEqual(m,terminal);assert.equal(l.wallets.a.locked,1);
 const settled=tableOperation(l,{code:'ABCDE',uid:'a',command:{kind:'tick'},now:500});
 assert.equal(settled.matches.m.status,'settled');
 assert.deepEqual(liveUpdate(settled.matches.m,{code:'ABCDE',uid:'a',command:{kind:'tick'},now:501}),settled.matches.m);
 assert.equal(liveUpdate(settled.matches.m,{code:'ABCDE',uid:'stranger',command:{kind:'tick'},now:501}),null);
 assert.deepEqual(tableOperation(settled,{code:'ABCDE',uid:'a',command:{kind:'tick'},now:501}).wallets,settled.wallets);
 assert.equal(before.status,'reserved');
});
for(const mode of ['1v1','2v2'])test(mode+' complete game keeps credits outside play and settles once',()=>{
 let l=fixture(mode),now=300,plays=0;
 const wallets=structuredClone(l.wallets);
 for(let n=0;n<2000&&l.matches.m.status==='reserved';n++){
  const m=l.matches.m,r=m.session.room;
  const waiting=r.status!=='started'||r.resolvingTrick||r.pendingNextHand||!r.turn;
  now+=waiting?10000:1;
  const player=waiting?'player1':r.turn;
  const command=waiting?{kind:'tick'}:{kind:'play',cardId:m.session.hands[player][0].id};
  const p={code:'ABCDE',uid:m.players[player].uid,command,requestId:'step'+n,expectedMatchId:'m',now};
  const updated=liveUpdate(m,p);
  if(updated){l.matches.m=updated;assert.deepEqual(l.wallets,wallets);}
  else l=tableOperation(l,p);
  if(command.kind==='play')plays++;
 }
 assert.ok(plays>6);assert.equal(l.matches.m.status,'settled');
 assert.equal(Object.values(l.wallets).reduce((sum,w)=>sum+w.balance+w.locked,0),40);
 const settled=structuredClone(l.wallets);
 l=tableOperation(l,{code:'ABCDE',uid:'a',command:{kind:'tick'},now:now+10000});
 assert.deepEqual(l.wallets,settled);
});
