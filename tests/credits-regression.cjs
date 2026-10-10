const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../credits.js'),'utf8')).toString('base64'));
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase.database.rules.json'))).rules;
const creditRules=rules.creditEconomy.wallets.$uid;
// Evaluate the actual shipped expressions with the documented RTDB snapshot
// methods. This checks policy logic; it does not replace emulator compilation.
class Snapshot {
 constructor(value){this.value=value??null;}
 child(key){return new Snapshot(this.value?.[key]);}
 exists(){return this.value!==null;}
 val(){return this.value;}
 isString(){return typeof this.value==='string';}
 isNumber(){return typeof this.value==='number'&&Number.isFinite(this.value);}
 hasChildren(keys){return keys.every(key=>this.child(key).exists());}
}
const run=(expression,context)=>Function(...Object.keys(context),'return ('+expression+')')(...Object.values(context));
function permitted(old,next,now,{uid='a',owner='a',provider='google.com',profile=true}={}) {
 const context={auth:uid?{uid,token:{firebase:{sign_in_provider:provider}}}:null,$uid:owner,now,data:new Snapshot(old),newData:new Snapshot(next),root:new Snapshot({profiles:profile?{[owner]:{name:'Mati'}}:{}})};
 if(!run(creditRules['.write'],context)||!run(creditRules['.validate'],context))return false;
 return Object.entries(next||{}).every(([key,value])=>{
  const rule=creditRules[key]||creditRules.$other;
  return run(rule['.validate'],{...context,newData:new Snapshot(value)});
 });
}
const today=Date.parse('2026-10-10T12:00:00-03:00');
test('Daily credits start at Uruguay midnight, not UTC midnight',async()=>{
 const m=await modulePromise;assert.equal(m.creditDayStart(Date.parse('2026-10-10T02:59:59Z')),Date.parse('2026-10-09T03:00:00Z'));
 assert.equal(m.creditDayStart(Date.parse('2026-10-10T03:00:00Z')),Date.parse('2026-10-10T03:00:00Z'));
});
test('A new account receives exactly two credits and cannot claim twice',()=>{
 const grant={balance:2,locked:0,lastGrantAt:today};assert.equal(permitted(null,grant,today),true);
 assert.equal(permitted(grant,{...grant,lastGrantAt:today+1},today+1),false);
 assert.equal(permitted({...grant,balance:0},{...grant,lastGrantAt:today+1},today+1),false);
});
test('Yesterday credits do not top up a remaining balance of one',async()=>{
 const m=await modulePromise,old={balance:1,locked:0,lastGrantAt:today-86400000};
 assert.equal(m.creditEligibility(old,today),'balance');assert.equal(m.dailyCreditChanges(old,today),undefined);
 assert.equal(permitted(old,{balance:2,locked:0,lastGrantAt:today},today),false);
});
test('A zero balance gets two the next Uruguay day, and grants never accumulate',async()=>{
 const m=await modulePromise,old={balance:0,locked:0,lastGrantAt:today-86400000};
 assert.equal(m.creditEligibility(old,today),'available');assert.equal(permitted(old,m.dailyCreditChanges(old,today),today),true);
 for(const balance of [1,2,3,100])assert.equal(permitted({...old,balance},{balance:2,locked:0,lastGrantAt:today},today),false);
});
test('The exact midnight boundary permits a new day only once',()=>{
 const last=Date.parse('2026-10-10T02:59:59.999Z'),next=last+1;
 assert.equal(permitted({balance:0,locked:0,lastGrantAt:last},{balance:2,locked:0,lastGrantAt:next},next),true);
 assert.equal(permitted({balance:0,locked:0,lastGrantAt:next},{balance:2,locked:0,lastGrantAt:next+1},next+1),false);
});
test('Forging amount, timestamp, identity, provider, fields or deleting the wallet is rejected',()=>{
 const grant={balance:2,locked:0,lastGrantAt:today};
 for(const next of [{...grant,balance:100},{...grant,lastGrantAt:today-1},{...grant,locked:1},{...grant,bonus:100},null])assert.equal(permitted(null,next,today),false);
 for(const options of [{uid:null},{uid:'other'},{provider:'anonymous'},{profile:false}])assert.equal(permitted(null,grant,today,options),false);
 assert.equal(permitted(null,grant,today,{provider:'apple.com'}),true);
});
test('Reserved stakes cannot be used to appear broke and claim extra credits',async()=>{
 const m=await modulePromise,old={balance:0,locked:1,lastGrantAt:today-86400000};
 assert.equal(m.creditEligibility(old,today),'locked');assert.equal(m.dailyCreditChanges(old,today),undefined);
 assert.equal(permitted(old,{balance:2,locked:0,lastGrantAt:today},today),false);
});
test('Wallets are private and the browser cannot write match accounting',()=>{
 const context={auth:{uid:'a'},$uid:'b'};assert.equal(run(creditRules['.read'],context),false);
 context.$uid='a';assert.equal(run(creditRules['.read'],context),true);
 assert.equal(rules.creditEconomy['.read'],false);assert.equal(rules.creditEconomy['.write'],false);
 assert.equal(rules.creditEconomy.matches['.write'],false);
});
function harness(m,initial=null) {
 const elements={},listeners={},callbacks=[],writes=[];
 for(const id of ['credits-panel','credits-balance','credits-status','credits-claim'])elements[id]={hidden:false,disabled:false,textContent:'',addEventListener(name,fn){listeners[id+':'+name]=fn;}};
 const state={uid:'a',firebaseConnected:true,serverTimeOffset:0};let value=initial;
 const fb={db:{},ref:(_db,p)=>p,onValue(_ref,onValue,onError){callbacks.push({onValue,onError});onValue({val:()=>value});return ()=>{};},serverTimestamp:()=>({'.sv':'timestamp'}),async runTransaction(ref,update,options){writes.push({ref,options});const next=update(value);if(next)value={...next,lastGrantAt:today};return {committed:!!next,snapshot:{val:()=>value}};},get:async()=>({val:()=>value})};
 const api=m.installCredits({services:async()=>fb,getState:()=>state,document:{getElementById:id=>elements[id]},now:()=>today,setTimer:()=>1,clearTimer(){}});
 return {api,state,elements,callbacks,writes,fb};
}
test('The UI claims once, waits for confirmation and resets on account change',async()=>{
 const m=await modulePromise,h=harness(m);await h.api.start();assert.equal(h.elements['credits-balance'].textContent,'0');
 await Promise.all([h.api.claim(),h.api.claim()]);assert.equal(h.writes.length,1);assert.equal(h.writes[0].options.applyLocally,false);assert.equal(h.elements['credits-balance'].textContent,'2');assert.equal(h.elements['credits-panel'].hidden,true);
 h.api.stop();assert.equal(h.elements['credits-panel'].hidden,true);
 h.callbacks[0].onValue({val:()=>({balance:999})});assert.equal(h.elements['credits-panel'].hidden,true);
 h.state.uid='b';await h.api.start();assert.equal(h.elements['credits-panel'].hidden,true);
});
test('Offline, unreadable or unconfirmed balances cannot trigger grants',async()=>{
 const m=await modulePromise,h=harness(m);await h.api.start();h.state.firebaseConnected=false;h.api.refresh();await h.api.claim();assert.equal(h.writes.length,0);
 h.state.firebaseConnected=true;h.callbacks[0].onError();assert.equal(h.elements['credits-balance'].textContent,'—');assert.equal(h.elements['credits-claim'].hidden,true);await h.api.claim();assert.equal(h.writes.length,0);
});
test('A transaction retry with a newly funded wallet cannot overwrite its balance',async()=>{
 const m=await modulePromise,h=harness(m);await h.api.start();h.fb.runTransaction=async(_ref,update)=>{const existing={balance:7,locked:0,lastGrantAt:today-86400000};assert.equal(update(existing),undefined);return {committed:false,snapshot:{val:()=>existing}};};
 await h.api.claim();assert.equal(h.elements['credits-balance'].textContent,'7');
});
test('Late confirmation from the previous account cannot overwrite the new account',async()=>{
 const m=await modulePromise,h=harness(m);await h.api.start();let resolve;
 h.fb.runTransaction=()=>new Promise(r=>resolve=r);const pending=h.api.claim();await Promise.resolve();
 h.api.stop();h.state.uid='b';await h.api.start();resolve({committed:true,snapshot:{val:()=>({balance:2,locked:0,lastGrantAt:today})}});await pending;
 assert.equal(h.elements['credits-balance'].textContent,'0');
});
