const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadedTransaction}=require('../functions/loaded-transaction.cjs');
test('Transaction keeps its data listener attached until success, including retries',async()=>{
 let active=false,handler;
 const ref={on:(event,fn)=>{active=true;handler=fn;queueMicrotask(fn);},off:(event,fn)=>{assert.equal(fn,handler);active=false;},transaction:async fn=>{
  assert.equal(active,true);assert.equal(fn({balance:5}).balance,4);
  assert.equal(fn({balance:7}).balance,6);return {committed:true};
 }};
 assert.equal((await loadedTransaction(ref,v=>({balance:v.balance-1}))).committed,true);assert.equal(active,false);
});
test('Transaction detaches its listener after rejection',async()=>{
 let active=false;const ref={on:(e,fn)=>{active=true;queueMicrotask(fn);},off:()=>{active=false;},transaction:async()=>{throw new Error('failed');}};
 await assert.rejects(loadedTransaction(ref,v=>v),/failed/);assert.equal(active,false);
});
