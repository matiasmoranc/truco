'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function extract(name){const start=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source).index,open=source.indexOf('{',start);let depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}return source.slice(start,end);}
function apiHarness(){
 let syncs=0;const calls=[];
 const context={liveTableApi:async(name,data)=>{calls.push({name,data,live:true});return {ok:true};},firebaseServices:async()=>({auth:{app:{}}}),loadCreditFunctions:async()=>({getFunctions:(_app,region)=>{assert.equal(region,'us-central1');return {};},httpsCallable:(_fn,name)=>async data=>{calls.push({name,data});return {data:{ok:true}};}}),credits:{sync:async()=>{syncs++;return true;}}};
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
 const context={state,creditTickPending:false,liveActionsBlocked:()=>false,crypto:{randomUUID:()=> 'request'},creditApi:async(name,data)=>{calls.push(data.command.kind);},toast(){},firebaseError:e=>e.message};
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
