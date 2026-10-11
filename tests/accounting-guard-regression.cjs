const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateAccounting}=require('../functions/accounting-guard.cjs');
test('Accounting rejects missing wallets, receipts and malformed SDK values',()=>{
 const before={wallets:{a:{balance:5,locked:0}},matches:{first:{status:'settled'}},history:{first:{event:{at:1}}}};
 for(const branch of ['wallets','matches','history']){
  const next=structuredClone(before);delete next[branch];assert.throws(()=>validateAccounting(before,next),/eliminación/);
 }
 const next=structuredClone(before);next.matches.second={secret:undefined};assert.throws(()=>validateAccounting(before,next),/indefinido/);
 assert.throws(()=>validateAccounting(before,null),/vaciar/);
 next.matches.second={secret:null};assert.equal(validateAccounting(before,next),next);
 next.wallets.a.balance=-1;assert.throws(()=>validateAccounting(before,next),/Saldo inválido/);
});
