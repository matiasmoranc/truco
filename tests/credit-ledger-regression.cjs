const {test}=require('node:test');const assert=require('node:assert/strict');
const {reserveStakes,settleVerifiedMatch,refundCanceledMatch,commitCreditOperation}=require('../server/credit-ledger.cjs');
const ledger=()=>({wallets:{a:{balance:2,locked:0,lastGrantAt:100},b:{balance:2,locked:0,lastGrantAt:100}}});
const parameters={id:'room1_match1',player1:'a',player2:'b',stake:1,now:200};
test('Both stakes reserve atomically; winner receives the pot with no house deduction',()=>{
 const before=ledger(),reserved=reserveStakes(before,parameters);assert.equal(before.wallets.a.balance,2);
 assert.equal(reserved.wallets.a.balance,1);assert.equal(reserved.wallets.b.balance,1);assert.equal(reserved.wallets.a.locked,1);
 const result=settleVerifiedMatch(reserved,{id:parameters.id,winner:'a',now:300});assert.equal(result.wallets.a.balance,3);assert.equal(result.wallets.b.balance,1);assert.equal(result.wallets.a.locked+result.wallets.b.locked,0);assert.equal(result.wallets.a.balance+result.wallets.b.balance,4);
});
test('Repeated starts and results after reconnection never debit or pay twice',()=>{
 const reserved=reserveStakes(ledger(),parameters);assert.equal(reserveStakes(reserved,parameters),reserved);
 const result=settleVerifiedMatch(reserved,{id:parameters.id,winner:'b',now:300});assert.equal(settleVerifiedMatch(result,{id:parameters.id,winner:'b',now:400}),result);assert.equal(reserveStakes(result,parameters),result);
 assert.throws(()=>settleVerifiedMatch(result,{id:parameters.id,winner:'a',now:400}),/conflict/);
});
test('Insufficient credit or overlapping matches never partially debit the other wallet',()=>{
 const before=ledger();before.wallets.b.balance=0;assert.throws(()=>reserveStakes(before,parameters),/insufficient/);assert.equal(before.wallets.a.balance,2);
 const reserved=reserveStakes(ledger(),parameters);assert.throws(()=>reserveStakes(reserved,{...parameters,id:'room2'}),/already-reserved/);
});
test('Canceled matches refund both stakes once and cannot subsequently pay a winner',()=>{
 const reserved=reserveStakes(ledger(),parameters),result=refundCanceledMatch(reserved,{id:parameters.id,now:300});assert.equal(result.wallets.a.balance,2);assert.equal(result.wallets.b.balance,2);assert.equal(refundCanceledMatch(result,{id:parameters.id,now:400}),result);assert.throws(()=>settleVerifiedMatch(result,{id:parameters.id,winner:'a',now:400}),/not-reserved/);
});
test('A rematch uses a new receipt and preserves accumulated credits',()=>{
 const first=settleVerifiedMatch(reserveStakes(ledger(),parameters),{id:parameters.id,winner:'a',now:300});
 const next=reserveStakes(first,{...parameters,id:'room1_match2'});const result=settleVerifiedMatch(next,{id:'room1_match2',winner:'b',now:500});assert.equal(result.wallets.a.balance,2);assert.equal(result.wallets.b.balance,2);
});
test('Invalid stakes, duplicate players, changed receipts and outside winners are rejected',()=>{
 for(const stake of [0,-1,0.5,NaN,Infinity,'1',1000000001])assert.throws(()=>reserveStakes(ledger(),{...parameters,stake}));
 assert.throws(()=>reserveStakes(ledger(),{...parameters,player2:'a'}));const reserved=reserveStakes(ledger(),parameters);
 assert.throws(()=>reserveStakes(reserved,{...parameters,stake:2}),/conflict/);assert.throws(()=>settleVerifiedMatch(reserved,{id:parameters.id,winner:'other',now:300}));
});
test('Server wrapper re-evaluates simultaneous operations using one RTDB transaction',async()=>{
 let current=ledger();const db={ref:path=>{assert.equal(path,'creditEconomy');return {transaction:async fn=>{current=fn(current);return {committed:true,snapshot:{val:()=>current}};}};}};
 await Promise.all([commitCreditOperation(db,'reserve',parameters),commitCreditOperation(db,'reserve',parameters)]);assert.equal(current.wallets.a.balance,1);
 await Promise.all([commitCreditOperation(db,'settle',{id:parameters.id,winner:'a',now:300}),commitCreditOperation(db,'settle',{id:parameters.id,winner:'a',now:300})]);assert.equal(current.wallets.a.balance,3);
});
test('An initially empty Admin SDK cache retries against funded server wallets',async()=>{
 const db={ref:()=>({transaction:async fn=>{assert.equal(fn(null),null);const result=fn(ledger());return {committed:true,snapshot:{val:()=>result}};}})};
 const result=await commitCreditOperation(db,'reserve',parameters);assert.equal(result.wallets.a.balance,1);
 const empty={ref:()=>({transaction:async fn=>({committed:true,snapshot:{val:()=>fn(null)}})})};
 await assert.rejects(commitCreditOperation(empty,'reserve',parameters),/wallet-not-found/);
});
