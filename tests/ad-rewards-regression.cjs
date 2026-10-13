const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {parseSignedQuery,verifySignature,applyReward}=require('../functions/ad-rewards.cjs');
const id='a'.repeat(48),now=Date.now();
const root=()=>({rewardedAds:{liveEnabled:true},profiles:{u:{name:'Mati'}},creditEconomy:{wallets:{u:{balance:0,locked:0,lastGrantAt:now}},adRewards:{[id]:{uid:'u',platform:'ios',createdAt:now-1000,expiresAt:now+600000}}}});
const params=()=>new URLSearchParams({custom_data:id,user_id:'u',transaction_id:'receipt1',ad_unit:'2408365354',reward_amount:'1',timestamp:String(now)});
test('Only the unmodified Google-style signed query verifies; duplicates and unsigned callbacks fail',()=>{
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const content=params().toString(),signature=crypto.sign('sha256',Buffer.from(content),privateKey).toString('base64url');
  const query=content+'&signature='+signature+'&key_id=1';
  assert.doesNotThrow(()=>verifySignature(parseSignedQuery(query),publicKey));
  assert.throws(()=>verifySignature(parseSignedQuery(query.replace('reward_amount=1','reward_amount=2')),publicKey));
  assert.throws(()=>parseSignedQuery(content));
  assert.throws(()=>parseSignedQuery('user_id=evil&'+query));
});
test('A signed receipt grants exactly one credit, once, retaining daily grant and reserved credits',()=>{
  const before=root();before.creditEconomy.wallets.u.locked=3;
  const after=applyReward(before,params(),now);
  assert.equal(before.creditEconomy.wallets.u.balance,0);
  assert.deepEqual(after.creditEconomy.wallets.u,{balance:1,locked:3,lastGrantAt:now});
  assert.deepEqual(applyReward(after,params(),now+1000),after);
  const another=params();another.set('transaction_id','receipt2');assert.throws(()=>applyReward(after,another,now));
});
test('Wrong user, amount, unit, missing timestamp and out-of-session timestamps are rejected',()=>{
  for(const [key,value] of [['user_id','other'],['reward_amount','2'],['ad_unit','other'],['timestamp',''],['timestamp',String(now-10000000)],['timestamp',String(now+10000000)]]){
    const p=params();p.set(key,value);assert.throws(()=>applyReward(root(),p,now));
  }
});
test('Unenabled serving and deleted or blocked accounts cannot receive a delayed reward',()=>{
  for(const change of [r=>r.rewardedAds.liveEnabled=false,r=>delete r.profiles.u,r=>r.userAccess={u:{blocked:true}},r=>delete r.creditEconomy.wallets.u]){
    const r=root();change(r);assert.throws(()=>applyReward(r,params(),now));
  }
});
test('A transaction cannot be replayed through another session',()=>{
  const after=applyReward(root(),params(),now),other='b'.repeat(48);
  after.creditEconomy.adRewards[other]={uid:'u',platform:'ios',createdAt:now-1000,expiresAt:now+600000};
  const p=params();p.set('custom_data',other);assert.throws(()=>applyReward(after,p,now));
});
