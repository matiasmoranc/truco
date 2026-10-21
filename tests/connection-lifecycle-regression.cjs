'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createConnectionLifecycle}=require('../functions/connection-lifecycle.cjs');
test('Idle connection reconnects before use without interrupting concurrent transactions',async()=>{
 let time=0,offline=0,online=0,release;const run=createConnectionLifecycle({goOffline(){offline++;},goOnline(){online++;}},{now:()=>time,idleMs:30});
 time=31;const first=run(()=>new Promise(r=>{release=r;}));assert.equal(offline,1);assert.equal(online,1);
 time=100;assert.equal(await run(async()=>42),42);assert.equal(offline,1);release('done');assert.equal(await first,'done');
 time=120;await run(async()=>{});assert.equal(offline,1);time=151;await run(async()=>{});assert.equal(offline,2);
});
test('Failed request releases connection use so later requests can recover',async()=>{
 let time=0,reconnections=0;const run=createConnectionLifecycle({goOffline(){reconnections++;},goOnline(){}},{now:()=>time,idleMs:30});
 await assert.rejects(run(async()=>{throw Error('failed');}));time=31;assert.equal(await run(async()=>true),true);assert.equal(reconnections,1);
});
