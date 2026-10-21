'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createLedgerWarmup}=require('../functions/database-warmup.cjs');
test('Entry warmup shares one live cache and releases it after the entry flow becomes idle',async()=>{
 let attached=0,detached=0,idle;const ref={on:(_e,fn)=>{attached++;queueMicrotask(()=>fn({val:()=>({wallets:{}})}));},off:()=>detached++};
 const w=createLedgerWarmup({ref:()=>ref},{schedule:fn=>{idle=fn;return {unref(){}};},cancel(){}});const a=w.warm(),b=w.warm();assert.equal(a,b);await a;assert.equal(attached,1);idle();assert.equal(detached,1);await w.warm();assert.equal(attached,2);w.stop();assert.equal(detached,2);
});
test('Failed connection warmup can be retried without retaining the failed subscription',async()=>{
 let attempts=0,detached=0;const ref={on:(_e,fn,error)=>queueMicrotask(()=>{attempts++;if(attempts===1)error(Error('offline'));else fn({val:()=>({})});}),off:()=>detached++};
 const w=createLedgerWarmup({ref:()=>ref});await assert.rejects(w.warm(),/offline/);await w.warm();w.stop();assert.equal(detached,2);
});
const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('functions/index.cjs','utf8');
function gateway(){const a=source.indexOf('exports.creditGame=onCall('),b=source.indexOf('exports.creditExpireTables=',a);return source.slice(a,b);}
test('One game service routes the original authenticated payload without altering commands',async()=>{
 const seen=[],c={gameDatabase:{run:(_db,task)=>task()},restDb:{},gameTransport:{},warmGameDatabase:async()=>{},exports:{},onCall:(_o,f)=>f,options:{},HttpsError:Error,ledgerWarmup:{warm:async()=>{}},actionIdentity:async()=>{},createTableRequest:async r=>{seen.push(r);return 'create';},joinTableRequest:async r=>{seen.push(r);return 'join';},tableActionRequest:async r=>{seen.push(r);return 'action';},console};vm.createContext(c);vm.runInContext(gateway(),c);
 const auth={uid:'a',token:{firebase:{sign_in_provider:'google.com'}}},payload={code:'ABCDE',command:{kind:'play',cardId:'a'}};
 for(const operation of ['creditCreateTable','creditJoinTable','creditTableAction'])await c.exports.creditGame({auth,data:{operation,payload}});
 assert.equal(seen.length,3);for(const r of seen){assert.equal(r.auth,auth);assert.equal(r.data,payload);}
 await assert.rejects(()=>c.exports.creditGame({data:{operation:'warm'}}));for(const operation of ['__proto__','toString','other'])await assert.rejects(()=>c.exports.creditGame({auth,data:{operation}}));assert.equal(seen.length,3);
});
