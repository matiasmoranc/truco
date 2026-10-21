'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function fn(name){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source).index,open=source.indexOf('{',start);let n=1,end=open+1;for(;n;end++){if(source[end]==='{')n++;if(source[end]==='}')n--;}return source.slice(start,end);}
function harness(){const c={state:{roomCode:'ABCDE',playerId:'player1',room:{managedCredits:true,creditMatch:{id:'m'},revision:4,handNumber:2,status:'started',turn:'player1'},hand:[{id:'a'}]},liveActionsBlocked:()=>false,syncLiveControls(){},renderConnectionNotice(){},animatePlayedHandCard(){},removeCardFlight(){},renderGame(){},refreshLiveConnection:async()=>{},console:{error(){}},syncPrivateHand(){}};vm.createContext(c);vm.runInContext(['isOlderRoom','applyActionReceipt','reconcilePendingPlay','playManagedCard'].map(fn).join('\n'),c);return c;}
test('Delayed action replies cannot roll back a newer turn or rematch',()=>{const c=harness();c.applyActionReceipt({room:{managedCredits:true,creditMatch:{id:'m'},revision:3,turn:'player1'}},'ABCDE');assert.equal(c.state.room.revision,4);c.state.room.matchNumber=2;c.applyActionReceipt({room:{managedCredits:true,creditMatch:{id:'old'},matchNumber:1,revision:99}},'ABCDE');assert.equal(c.state.room.creditMatch.id,'m');});
test('An action receipt applies the public turn and only the caller private hand together',()=>{const c=harness();let rendered=0;c.renderGame=()=>rendered++;c.applyActionReceipt({room:{...c.state.room,revision:5,turn:'player2'},privateHand:{revision:5,creditMatchId:'m',hand:[]}},'ABCDE');assert.equal(c.state.room.turn,'player2');assert.equal(c.state.privateDeal.revision,5);assert.equal(rendered,1);c.applyActionReceipt({room:{...c.state.room,revision:6}},'OTHER');assert.equal(c.state.room.revision,5);});
test('Realtime acknowledgment releases a play without waiting for a slow callable response',async()=>{const c=harness();let done;c.creditCommand=()=>new Promise(resolve=>done=resolve);const pending=c.playManagedCard({id:'a'});assert.equal(c.state.playActionInFlight,true);c.state.room.trickCards=[{playerId:'player1',card:{id:'a'}}];c.reconcilePendingPlay();assert.equal(c.state.playActionInFlight,true);c.state.hand=[];c.reconcilePendingPlay();assert.equal(c.state.playActionInFlight,false);const newer={cardId:'b'};c.state.playActionToken=newer;c.state.playActionInFlight=true;done();await pending;assert.equal(c.state.playActionToken,newer);assert.equal(c.state.playActionInFlight,true);});
test('Failed actions release their own lock and refresh authoritative state without replaying the card',async()=>{const c=harness();let refreshed=0,calls=0;c.refreshLiveConnection=async()=>refreshed++;c.creditCommand=async()=>{calls++;throw Error('timeout');};await c.playManagedCard({id:'a'});assert.equal(calls,1);assert.equal(refreshed,1);assert.equal(c.state.playActionInFlight,false);assert.equal(c.state.playActionToken,null);});
test('Pending calls, trick pauses and a different turn reject extra managed plays',async()=>{for(const patch of [{turn:'player2'},{pendingBet:{}},{resolvingTrick:true},{pendingNextHand:{}},{status:'complete'}]){const c=harness();Object.assign(c.state.room,patch);let calls=0;c.creditCommand=async()=>calls++;await c.playManagedCard({id:'a'});assert.equal(calls,0);}});
test('Sample drag works when the finger starts over the overlapping deck and remains within ten pixels',()=>{
 const events={sample:{},deck:{}},values={};const sample={classList:{contains:()=>false,add(){},remove(){}},style:{setProperty:(k,v)=>values[k]=v},setPointerCapture(){throw Error('capture unavailable');},releasePointerCapture(){}};
 const c={$:id=>id==='muestra-card'?sample:{addEventListener:(kind,fn)=>events.deck[kind]=fn},getComputedStyle:()=>({getPropertyValue:k=>values[k]||'0px'})};sample.addEventListener=(kind,fn)=>events.sample[kind]=fn;vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function limitMuestraOffset('),source.indexOf('// Prevent browser zoom')),c);
 const event={pointerId:1,button:0,clientX:100,clientY:100,preventDefault(){},stopPropagation(){}};events.deck.pointerdown(event);events.sample.pointermove({...event,clientX:130,clientY:140});assert.equal(Math.hypot(parseFloat(values['--muestra-dx']),parseFloat(values['--muestra-dy'])),10);events.sample.pointerup(event);assert.equal(sample._drag,null);
});
test('Public-first and private-first updates keep the remaining cards visible throughout a play',()=>{
 for(const privateFirst of [false,true]){
  const room={managedCredits:true,creditMatch:{id:'m'},revision:1,handNumber:1,handCounts:{player1:3},trickCards:[]},cards=['a','b','c'].map(id=>({id}));
  const c={state:{room,playerId:'player1',renderedHandNumber:1,privateDeal:{creditMatchId:'m',revision:1,handNumber:1,hand:cards},hand:cards},handGesture:null,reconcilePendingPlay(){}};vm.createContext(c);vm.runInContext([fn('privateHandMatchesRoom'),fn('syncPrivateHand')].join('\n'),c);
  const publicUpdate=()=>Object.assign(room,{revision:2,handCounts:{player1:2},trickCards:[{playerId:'player1',card:cards[0]}]});
  const privateUpdate=()=>c.state.privateDeal={creditMatchId:'m',revision:2,handNumber:1,hand:cards.slice(1)};
  (privateFirst?privateUpdate:publicUpdate)();c.syncPrivateHand();assert.deepEqual(Array.from(c.state.hand,x=>x.id),['b','c']);
  (privateFirst?publicUpdate:privateUpdate)();c.syncPrivateHand();assert.deepEqual(Array.from(c.state.hand,x=>x.id),['b','c']);
  room.handNumber=2;room.handCounts.player1=3;c.syncPrivateHand();assert.equal(c.state.hand.length,0);
 }
});
test('Lobby redraws keep Entering until the entry intent is cleared',()=>{
 const make=()=>({dataset:{room:'ABCDE',seat:'player'},textContent:'Entrar',disabled:false,setAttribute(){},removeAttribute(){}});let buttons=[make()];const c={state:{joinIntent:{code:'ABCDE',seat:'player'}},document:{querySelectorAll:()=>buttons}};vm.createContext(c);vm.runInContext(fn('syncLobbyJoinFeedback'),c);c.syncLobbyJoinFeedback();assert.equal(buttons[0].textContent,'Entrando…');buttons=[make()];c.syncLobbyJoinFeedback();assert.equal(buttons[0].textContent,'Entrando…');assert.equal(buttons[0].disabled,true);c.state.joinIntent=null;c.syncLobbyJoinFeedback();assert.equal(buttons[0].textContent,'Entrar');assert.equal(buttons[0].disabled,false);
});

test('A legal online card starts its flight before a delayed server reply, without changing authoritative turn',async()=>{
 const c=harness();let finish;const events=[];c.animatePlayedHandCard=(card)=>events.push('flight:'+card.id);c.creditCommand=()=>{events.push('request');return new Promise(resolve=>finish=resolve);};
 const pending=c.playManagedCard({id:'a'});assert.deepEqual(events,['flight:a','request']);assert.equal(c.state.room.turn,'player1');assert.equal(c.state.playActionInFlight,true);
 await c.playManagedCard({id:'a'});assert.equal(events.length,2);finish();await pending;
});

test('Room and private hands publish concurrently and preserve newer revisions',async()=>{
 const backend=fs.readFileSync('functions/index.cjs','utf8');const start=backend.indexOf('async function publish('),end=backend.indexOf('exports.creditCreateTable=',start);
 const writes=[],resolvers=[];const room={managedCredits:true,revision:4,players:{player1:{uid:'u1'},player2:{uid:'u2'}}};
 const c={db:{ref:path=>path},tableFor:()=>room,publicTable:m=>m,privateTableHand:(_m,p)=>({revision:4,seat:p}),loadedTransaction:(path,update)=>{writes.push({path,update});return new Promise(resolve=>resolvers.push(resolve));}};
 vm.createContext(c);vm.runInContext(backend.slice(start,end),c);const pending=c.publish({},'ABCDE');assert.equal(writes.length,3);
 assert.equal(writes[0].update({managedCredits:true,revision:5}),undefined);assert.equal(writes[1].update({revision:5}),undefined);
 resolvers.forEach(resolve=>resolve({committed:true}));assert.equal((await pending).code,'ABCDE');
});
