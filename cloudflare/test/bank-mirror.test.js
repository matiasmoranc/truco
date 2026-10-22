import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankCore,rowPath} from '../src/bank-core.js';
import {createBankMirror,PENDING} from '../src/bank-mirror.js';
import {createTableEngine} from '../src/table-engine.js';
import {memoryStore} from './memory-store.js';

function fakeFirebase(){
 const db={tree:{},calls:[],fail:false,
  async patch(root,updates){db.calls.push(['patch',root,Object.keys(updates).length]);if(db.fail)throw new Error('offline');
   for(const [path,value] of Object.entries(updates)){const parts=(root+'/'+path).split('/');let node=db.tree;
    for(const part of parts.slice(0,-1))node=node[part]??={};
    if(value===null)delete node[parts.at(-1)];else node[parts.at(-1)]=structuredClone(value);}},
  async put(root,value){db.calls.push(['put',root]);if(db.fail)throw new Error('offline');if(value===null)delete db.tree[root];else db.tree[root]=value;}};
 return db;
}
function setup(){
 const store=memoryStore(),firebase=fakeFirebase(),mirror=createBankMirror(store,firebase);
 let puts=0;const put=store.put;store.put=async(...args)=>{puts++;return put(...args);};
 const core=createBankCore(store,{beforeCommit:(w,r)=>mirror.beforeCommit(w,r)});
 return {store,firebase,mirror,core,puts:()=>puts};
}
const ledger=()=>({wallets:{a:{balance:12,locked:0},b:{balance:7,locked:0}},adminAudit:{old:{at:1}}});

test('Row keys map to the same paths creditEconomy uses',()=>{
 assert.equal(rowPath('w:abc'),'wallets/abc');assert.equal(rowPath('m:x_1_m2'),'matches/x_1_m2');
 assert.equal(rowPath('mv:abc:1_ff'),'walletMovements/abc/1_ff');assert.equal(rowPath('b:adRewards'),'adRewards');
 assert.equal(rowPath('meta:version'),'meta/version');assert.equal(rowPath(PENDING),null);
});

test('Every bank change queues its backup in the same atomic write',async()=>{
 const s=setup();await s.core.importLedger(ledger());
 const before=s.puts();
 const engine=createTableEngine({code:'ABCDE',bank:s.core,clock:()=>5000});
 await engine.create({uid:'a',name:'A'},{id:'g1',stake:2,targetPoints:10,mode:'1v1'});
 assert.equal(s.puts()-before,1,'the change and its queue are one put');
 const queue=s.store.rows.get(PENDING);
 assert.deepEqual(queue['wallets/a'],{balance:10,locked:2});assert.equal(queue['tables/ABCDE'],'g1');assert.ok(queue['matches/g1']);
});

test('The backup reproduces the bank in Firebase, including the first import',async()=>{
 const s=setup();await s.core.importLedger(ledger());
 await createTableEngine({code:'ABCDE',bank:s.core,clock:()=>5000}).create({uid:'a',name:'A'},{id:'g1',stake:2,targetPoints:10,mode:'1v1'});
 const result=await s.mirror.flush();assert.equal(result.remaining,0);
 const {ledger:bank,version}=await s.core.exportLedger();
 assert.deepEqual(s.firebase.tree.creditBank,{...bank,meta:{version}});
 assert.equal(s.firebase.calls.filter(c=>c[0]==='patch').length,1,'one multi-path update');
 assert.equal(await s.mirror.hasPending(),false);
});

test('A failed send keeps everything queued; a change during the send waits for the next one',async()=>{
 const s=setup();await s.core.importLedger(ledger());
 s.firebase.fail=true;await assert.rejects(s.mirror.flush(),/offline/);assert.equal(await s.mirror.hasPending(),true);
 s.firebase.fail=false;
 const patch=s.firebase.patch;
 s.firebase.patch=async(root,updates)=>{await patch(root,updates);await s.core.claim('nuevo',Date.UTC(2026,9,21,12));};
 const first=await s.mirror.flush();assert.ok(first.remaining>0);
 s.firebase.patch=patch;await s.mirror.flush();
 assert.equal(s.firebase.tree.creditBank.wallets.nuevo.balance,5);assert.equal(await s.mirror.hasPending(),false);
});

test('Reset clears the backup before anything new is written',async()=>{
 const s=setup();await s.core.importLedger(ledger());await s.mirror.flush();
 for(const key of [...s.store.rows.keys()])s.store.rows.delete(key);
 await s.mirror.queueReset();await s.core.importLedger({wallets:{z:{balance:1,locked:0}}});
 await s.mirror.flush();
 assert.deepEqual(Object.keys(s.firebase.tree.creditBank.wallets),['z']);
 assert.deepEqual(s.firebase.calls.slice(-2).map(c=>c[0]),['put','patch']);
});
