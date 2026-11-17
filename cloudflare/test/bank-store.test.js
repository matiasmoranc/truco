// The bank's store reads every row from storage once and then answers from memory,
// keeping the copy in step with every write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {durableStore} from '../src/bank-store.js';

function fakeStorage(initial={}){
 const data=new Map(Object.entries(initial)),reads={rows:0,lists:0};let fail=false;
 return {data,reads,failNext(){fail=true;},
  async get(keys){const m=new Map();for(const k of keys)if(data.has(k)){reads.rows++;m.set(k,structuredClone(data.get(k)));}return m;},
  async list({prefix=''}={}){reads.lists++;const m=new Map();for(const k of [...data.keys()].sort())if(k.startsWith(prefix)){reads.rows++;m.set(k,structuredClone(data.get(k)));}return m;},
  async put(entries){if(fail){fail=false;throw new Error('boom');}for(const [k,v] of Object.entries(entries))data.set(k,structuredClone(v));},
  async delete(keys){for(const k of keys)data.delete(k);}};
}

test('the whole ledger is read from storage once, then from memory',async()=>{
 const storage=fakeStorage({'w:a':{balance:1},'w:b':{balance:2},'m:x':{id:'x'}}),store=durableStore(storage);
 assert.deepEqual([...(await store.list('')).keys()],['m:x','w:a','w:b']);
 const after=storage.reads.rows;
 for(let i=0;i<5;i++)await store.list('');
 assert.deepEqual([...(await store.list('w:')).keys()],['w:a','w:b']);
 assert.deepEqual(Object.fromEntries(await store.get(['w:a','w:zz'])),{'w:a':{balance:1}});
 assert.equal(storage.reads.rows,after);assert.equal(storage.reads.lists,1);
});

test('writes and deletes keep the copy in step, and callers cannot change it',async()=>{
 const storage=fakeStorage({'w:a':{balance:1},'w:b':{balance:2}}),store=durableStore(storage);
 await store.list('');
 const value={balance:5};await store.put({'w:a':value,'w:c':{balance:3}},['w:b']);value.balance=99;
 const all=await store.list('');
 assert.deepEqual(Object.fromEntries(all),{'w:a':{balance:5},'w:c':{balance:3}});
 all.get('w:a').balance=7;(await store.get(['w:a'])).get('w:a').balance=8;
 assert.deepEqual((await store.get(['w:a'])).get('w:a'),{balance:5});
 assert.deepEqual(Object.fromEntries(await store.list('')),Object.fromEntries([...storage.data].sort()));
});

test('a failed write or a reset drops the copy and reads storage again',async()=>{
 const storage=fakeStorage({'w:a':{balance:1}}),store=durableStore(storage);
 await store.list('');storage.failNext();
 await assert.rejects(store.put({'w:a':{balance:2}}));
 await store.list('');assert.equal(storage.reads.lists,2);
 storage.data.clear();store.forget();
 assert.equal((await store.list('')).size,0);
});

test('a write that lands while the rows are being read does not leave a stale copy',async()=>{
 const storage=fakeStorage({'w:a':{balance:1}}),store=durableStore(storage);
 const reading=store.list('');await store.put({'w:a':{balance:2}});await reading;
 assert.deepEqual((await store.get(['w:a'])).get('w:a'),{balance:2});
});

test('right after a wake-up, part of the ledger reads only its own rows',async()=>{
 const storage=fakeStorage({'w:a':{balance:1},'mv:a:1':{at:1},'mv:a:2':{at:2},'mv:b:1':{at:3}}),store=durableStore(storage);
 assert.deepEqual(Object.fromEntries(await store.list('mv:a:')),{'mv:a:1':{at:1},'mv:a:2':{at:2}});
 assert.equal(storage.reads.rows,2);
 // The whole ledger still loads once, and then parts come from memory.
 await store.list('');const after=storage.reads.rows;
 assert.deepEqual([...(await store.list('mv:a:')).keys()],['mv:a:1','mv:a:2']);
 assert.equal(storage.reads.rows,after);
});
