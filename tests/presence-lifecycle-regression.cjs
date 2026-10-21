'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function fn(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=source.slice(start),end=rest.slice(1).search(/\n(?:async )?function /);return end<0?rest:rest.slice(0,end+1);}
function harness(){
 const events=[],errors=[];let release;
 const c={Promise,Number,crypto:{randomUUID:()=> 'session'},console:{error:e=>errors.push(e)},roomPresenceContext:null,presenceWriteSerial:0,roomSeats:()=>['player1','player2'],state:{roomCode:'ABCDE',playerId:'player1',uid:'a',firebaseConnected:true,room:{status:'started',createdAt:1,matchNumber:1,players:{player1:{uid:'a'}}}}};
 c.state.firebase={db:{},ref:(_,path)=>path,serverTimestamp:()=>123,set:async(_ref,value)=>events.push(['write',value.matchNumber,value.online]),onDisconnect:()=>({set:async value=>{events.push(['register',value.matchNumber]);if(c.delay)await new Promise(resolve=>{release=resolve;});},cancel:async()=>events.push(['cancel'])})};
 vm.createContext(c);vm.runInContext(fn('stopRoomPresence')+'\n'+fn('syncRoomPresence'),c);
 return {c,events,errors,release:()=>release()};
}
test('Waiting and finished tables never register disconnect handlers',async()=>{
 const {c,events}=harness();for(const status of ['waiting','complete','closed']){c.state.room.status=status;await c.syncRoomPresence();}assert.deepEqual(events,[]);
});
test('Rematch cancels old registration without writing an obsolete offline record',async()=>{
 const {c,events,errors}=harness();await c.syncRoomPresence();c.state.room.matchNumber=2;await c.syncRoomPresence();
 assert.deepEqual(events,[['register',1],['write',1,true],['cancel'],['register',2],['write',2,true]]);assert.deepEqual(errors,[]);
 c.state.room.status='complete';await c.syncRoomPresence();assert.deepEqual(events.at(-1),['cancel']);assert.equal(c.roomPresenceContext,null);
});
test('A delayed old registration cannot cancel the new rematch disconnect handler',async()=>{
 const h=harness(),{c,events}=h;c.delay=true;const old=c.syncRoomPresence();await new Promise(resolve=>setImmediate(resolve));
 c.delay=false;c.state.room.matchNumber=2;const next=c.syncRoomPresence();h.release();await Promise.all([old,next]);
 assert.deepEqual(events,[['register',1],['cancel'],['register',2],['write',2,true]]);
 assert.equal(c.roomPresenceContext.matchNumber,2);
});
test('Leaving the current game still records a real disconnect',async()=>{
 const {c,events}=harness();await c.syncRoomPresence();await c.stopRoomPresence();assert.deepEqual(events.at(-1),['write',1,false]);
});
test('Expired notices remove their text, including screen reader content',()=>{
 let timer;const el={textContent:'',classList:{add(){},remove(){}}},c={$:()=>el,clearTimeout(){},setTimeout:callback=>{timer=callback;return 1;}};
 vm.createContext(c);vm.runInContext(fn('toast')+'\n'+fn('clearToast'),c);c.toast('La mesa cerró por inactividad.');timer();assert.equal(el.textContent,'');c.toast('Old');c.clearToast();assert.equal(el.textContent,'');
});
test('Both waiting room modes publish the match number required by presence rules',()=>{
 const {createTable,publicTable}=require('../functions/table-service.cjs');
 for(const mode of ['1v1','2v2']){const ledger=createTable({wallets:{a:{balance:10,locked:0}}},{mode,code:'ABCDE',id:'m',uid:'a',name:'A',stake:1,targetPoints:10,now:1});assert.equal(publicTable(ledger.matches.m).matchNumber,1);}
});
test('Incomplete team tables do not initialize match chat against empty seats',()=>{
 const c={state:{playerId:'player1',room:{mode:'2v2',status:'waiting',players:{player1:{uid:'a'},player2:{uid:'b'}}}},roomSeats:()=>['player1','player2','player3','player4']};
 vm.createContext(c);vm.runInContext(fn('chatAvailable'),c);assert.equal(c.chatAvailable(),false);
 c.state.room.status='started';assert.equal(c.chatAvailable(),false);
 c.state.room.players.player3={uid:'c'};c.state.room.players.player4={uid:'d'};assert.equal(c.chatAvailable(),true);
});
test('Reconnecting while waiting renders the waiting room without retrying a broken game render',async()=>{
 const room={status:'waiting',players:{player1:{uid:'a'}},handNumber:0},events=[];
 const c={state:{room,roomCode:'ABCDE',playerId:'player1',uid:'a',firebaseConnected:true,connectionEpoch:1,firebase:{db:{},ref:(_,path)=>path,get:async path=>({val:()=>path.startsWith('rooms/')?room:null})}},roomSeatForUid:()=> 'player1',syncPrivateHand(){},syncRoomPresence:async()=>{},syncLiveControls(){},privateHandMatchesRoom:()=>true,renderGame:()=>assert.fail('Waiting is not a game'),publishChatMute:()=>assert.fail('Waiting should not send gameplay commands'),renderWaiting:()=>events.push('waiting'),console:{warn:()=>assert.fail('No resync failure expected')}};
 vm.createContext(c);vm.runInContext(fn('roomTransportConnected')+'\n'+fn('refreshLiveConnection'),c);await c.refreshLiveConnection();assert.equal(c.state.connectionReady,true);assert.deepEqual(events,['waiting']);
});
