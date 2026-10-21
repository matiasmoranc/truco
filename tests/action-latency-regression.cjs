'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function extract(name){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source).index,open=source.indexOf('{',start);let depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}return source.slice(start,end);}
function apiHarness(){
 let syncs=0;const calls=[];
 const context={liveTableApi:async(name,data)=>{calls.push({name,data,live:true});return {ok:true};},performance,console:{info(){}},firebaseServices:async()=>({auth:{app:{}}}),loadCreditFunctions:async()=>({getFunctions:(_app,region)=>{assert.equal(region,'us-central1');return {};},httpsCallable:(_fn,name)=>async data=>{calls.push({name,data});return {data:{ok:true}};}}),credits:{sync:async()=>{syncs++;return true;}}};
 vm.createContext(context);vm.runInContext(extract('creditApi'),context);
 return {context,calls,syncs:()=>syncs};
}
test('Card actions and ticks return without a second wallet network round trip',async()=>{
 const h=apiHarness();for(const kind of ['call','play','declare','fold','tick'])assert.equal((await h.context.creditApi('creditTableAction',{command:{kind}})).ok,true);
 assert.equal(h.syncs(),0);assert.equal(h.calls.length,5);
});
test('Creating and joining refresh wallet balances in the background',async()=>{
 const h=apiHarness();for(const name of ['creditCreateTable','creditJoinTable'])await h.context.creditApi(name,{});assert.equal(h.syncs(),2);
});
test('Background ticks yield to foreground actions without delaying a user call behind a tick',async()=>{
 const calls=[],state={roomCode:'ABCDE',room:{creditMatch:{id:'m'}},liveAction:{},playActionInFlight:false,foldInFlight:false};
 const context={state,creditTickPending:false,applyActionReceipt(){},liveActionsBlocked:()=>false,crypto:{randomUUID:()=> 'request'},creditApi:async(name,data)=>{calls.push(data.command.kind);},toast(){},firebaseError:e=>e.message};
 vm.createContext(context);vm.runInContext(extract('creditCommand'),context);
 await context.creditCommand({kind:'tick'});assert.equal(calls.length,0);
 await context.creditCommand({kind:'call',value:'truco'});assert.deepEqual(calls,['call']);
 state.liveAction=null;context.creditTickPending=true;
 await context.creditCommand({kind:'call',value:'envido'});assert.deepEqual(calls,['call','call']);
 context.creditTickPending=false;await context.creditCommand({kind:'tick'});assert.deepEqual(calls,['call','call','tick']);assert.equal(context.creditTickPending,false);
});

test('Joining returns even while the wallet refresh is still pending',{timeout:1000},async()=>{const h=apiHarness();h.context.credits.sync=()=>new Promise(()=>{});assert.equal((await h.context.creditApi('creditJoinTable',{})).ok,true);});

test('Table calls go to the live table server; other calls stay on Cloud Functions',async()=>{
 const h=apiHarness();
 for(const name of ['creditCreateTable','creditJoinTable','creditTableAction'])await h.context.creditApi(name,{});
 await h.context.creditApi('playerActivity',{});
 assert.deepEqual(h.calls.map(c=>[c.name,!!c.live]),[['creditCreateTable',true],['creditJoinTable',true],['creditTableAction',true],['playerActivity',false]]);
});
test('Confirmed entry renders its private hand without resync GETs or waiting on presence',()=>{
 for(const mode of ['1v1','2v2']){
  const events=[],state={uid:'u',firebaseConnected:true},room={mode,status:'started',players:{player1:{uid:'u'}},creditMatch:{id:'m'},handNumber:1,handCounts:{player1:3}},deal={creditMatchId:'m',handNumber:1,hand:[{id:'a'},{id:'b'},{id:'c'}]};
  const c={state,$:()=>({classList:{add(){}}}),rememberRoomSeat(){},showView(){events.push('view');},watchRoom(){events.push('watch');},watchPrivateHand(){events.push('private-watch');},renderGame(){events.push('render');assert.equal(state.privateDeal,deal);},renderWaiting(){},syncRoomPresence:()=>new Promise(()=>{}),refreshLiveConnection(){events.push('GET');}};
  vm.createContext(c);c.watchLiveConnection??=()=>{};vm.runInContext([extract('roomTransportConnected'),extract('privateHandMatchesRoom'),extract('attachLiveRoom')].join('\n'),c);c.attachLiveRoom('ABCDE','player1',room,deal);
  assert.equal(state.connectionReady,true);assert.ok(events.includes('render'));assert.equal(events.includes('GET'),false);
 }
});
test('A missing or mismatched entry receipt keeps controls blocked and uses authoritative recovery',()=>{
 for(const deal of [null,{creditMatchId:'old',handNumber:1,hand:[1,2,3]}]){
  let resync=0;const state={uid:'u',firebaseConnected:true};const c={state,$:()=>({classList:{add(){}}}),rememberRoomSeat(){},showView(){},watchRoom(){},watchPrivateHand(){},renderGame(){},renderWaiting(){},syncRoomPresence(){},refreshLiveConnection(){resync++;}};
  vm.createContext(c);c.watchLiveConnection??=()=>{};vm.runInContext([extract('roomTransportConnected'),extract('privateHandMatchesRoom'),extract('attachLiveRoom')].join('\n'),c);c.attachLiveRoom('ABCDE','player1',{managedCredits:true,status:'started',players:{player1:{uid:'u'}},creditMatch:{id:'m'},handCounts:{player1:3}},deal);assert.equal(state.connectionReady,false);assert.equal(resync,1);
 }
});

test('Lobby warmup is non-blocking, bounded and safe before any module-tail variables initialize',async()=>{
 let calls=0,finish;const state={uid:'a',firebaseConnected:true};const c={state,creditApi:()=>{calls++;return new Promise(resolve=>finish=resolve);},console:{warn(){}}};vm.createContext(c);vm.runInContext(extract('warmGameConnection'),c);
 assert.equal(c.warmGameConnection(),undefined);assert.equal(calls,1);c.warmGameConnection();assert.equal(calls,1);finish();await Promise.resolve();
});
