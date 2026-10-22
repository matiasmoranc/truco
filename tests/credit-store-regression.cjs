'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCreditStore}=require('../functions/credit-store.cjs');

function fakeDb(root){
 const ref=path=>({
  async get(){const value=path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],root);return {val:()=>value??null};},
  on(_e,listener){listener();},off(){},
  async transaction(update){const next=update(structuredClone(root));if(next===undefined)return {committed:false,snapshot:{val:()=>root}};root=next;return {committed:true,snapshot:{val:()=>root}};}
 });
 return {ref:(path='')=>ref(path),root:()=>root};
}
function fakeBank({active=true,ledger={wallets:{a:{balance:3,locked:0}}},conflicts=0}={}){
 const calls=[];let state=structuredClone(ledger);
 const fetchImpl=async(url,init)=>{
  const path=url.split('/internal/bank/')[1];calls.push({path,secret:init.headers['x-internal-secret']});
  const json=(status,body)=>({ok:status<300,status,json:async()=>body});
  if(path==='status')return json(200,{active});
  if(path==='export')return json(200,{version:1,ledger:state});
  if(path.startsWith('wallet'))return json(200,{wallet:state.wallets[new URL(url).searchParams.get('uid')]??null});
  if(path==='patch'){if(conflicts-->0)return json(409,{ok:false,error:'Los créditos cambiaron.',code:'conflict'});state=JSON.parse(init.body).next;return json(200,{ok:true});}
  return json(404,{});
 };
 return {fetchImpl,calls,state:()=>state};
}

test('Before the switch the functions keep reading Firebase',async()=>{
 const db=fakeDb({creditEconomy:{wallets:{a:{balance:9,locked:0}}}}),bank=fakeBank({active:false});
 const store=createCreditStore({db,secret:()=>'s',fetchImpl:bank.fetchImpl});
 assert.equal((await store.readLedger()).wallets.a.balance,9);assert.equal((await store.wallet('a')).balance,9);
 assert.deepEqual(bank.calls.map(c=>c.path),['status']);
});
test('With the bank active, reads come from the bank with the internal secret',async()=>{
 const db=fakeDb({creditEconomy:{wallets:{a:{balance:9,locked:0}}}}),bank=fakeBank();
 const store=createCreditStore({db,secret:()=>'s3cret',fetchImpl:bank.fetchImpl});
 assert.equal((await store.readLedger()).wallets.a.balance,3);assert.equal((await store.wallet('a')).balance,3);
 assert.ok(bank.calls.every(c=>c.secret==='s3cret'));
});
test('A bank patch is retried when the same rows changed meanwhile',async()=>{
 const bank=fakeBank({conflicts:2}),store=createCreditStore({db:fakeDb({}),secret:()=>'s',fetchImpl:bank.fetchImpl});
 let runs=0;const result=await store.patchBank(ledger=>{runs++;ledger.wallets.a.balance+=1;return ledger;});
 assert.equal(result.committed,true);assert.equal(runs,3);assert.equal(bank.state().wallets.a.balance,4);
});
test('Account deletion writes Firebase without credits and patches the bank with them',async()=>{
 const db=fakeDb({profiles:{a:{name:'A'}},creditEconomy:{frozen:true}}),bank=fakeBank(),store=createCreditStore({db,secret:()=>'s',fetchImpl:bank.fetchImpl});
 const result=await store.rootTransaction(root=>{assert.equal(root.creditEconomy.wallets.a.balance,3);delete root.profiles.a;root.creditEconomy.wallets.a={balance:0,locked:0,deletedAt:5};return root;});
 assert.equal(result.committed,true);
 assert.deepEqual(db.root(),{profiles:{},creditEconomy:{frozen:true}});
 assert.deepEqual(bank.state().wallets.a,{balance:0,locked:0,deletedAt:5});
 assert.equal(result.snapshot.val().creditEconomy.wallets.a.deletedAt,5);
});
test('If the bank state cannot be confirmed nothing falls back to the frozen copy',async()=>{
 const store=createCreditStore({db:fakeDb({creditEconomy:{wallets:{a:{balance:9}}}}),secret:()=>'s',fetchImpl:async()=>{throw new Error('offline');}});
 await assert.rejects(store.readLedger(),/offline/);await assert.rejects(store.rootTransaction(r=>r),/offline/);
});
