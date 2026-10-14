const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('mobile/entry.js','utf8').replace(/^import .*;\r?\n/gm,'').replace("await import('../app.js');",'');
for (const provider of ['google.com','apple.com']) {
  test(`Native ${provider} delivers credentials to the game Firebase session`, async () => {
    const calls=[];
    const sandbox={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'ios'},FirebaseAuthentication:{signInWithApple:async()=>({credential:{idToken:'apple-token',nonce:'nonce'}}),signInWithGoogle:async()=>({credential:{idToken:'google-token',accessToken:'access'}})},appSdk:{},dbSdk:{},authSdk:{},functionsSdk:{},rewardedAds:{}};
    vm.runInNewContext(source,sandbox);
    const auth={};
    const fb={auth,authSdk:{OAuthProvider:class {credential(value){calls.push(value);return value;}},GoogleAuthProvider:{credential:(idToken,accessToken)=>({idToken,accessToken})},signInWithCredential:async(session,credential)=>{assert.equal(session,auth);return {user:{uid:'same-uid'},credential};}}};
    const result=await sandbox.trucoNative.signIn(fb,provider);
    assert.equal(result.user.uid,'same-uid');
    assert.equal(result.credential.idToken,provider==='apple.com'?'apple-token':'google-token');
    if(provider==='apple.com')assert.equal(result.credential.rawNonce,'nonce');
  });
}
test('Missing native token never creates a game session',async()=>{
  const sandbox={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android'},FirebaseAuthentication:{signInWithGoogle:async()=>({})},appSdk:{},dbSdk:{},authSdk:{},functionsSdk:{},rewardedAds:{}};
  vm.runInNewContext(source,sandbox);
  await assert.rejects(()=>sandbox.trucoNative.signIn({},'google.com'),/credencial/);
});
for(const provider of ['apple.com','google.com'])test(`Deletion reauthenticates ${provider} before any Apple revocation`,async()=>{
 const calls=[],native={idToken:'token',nonce:'nonce',accessToken:'access',authorizationCode:'authorization'};
 const sandbox={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'ios'},FirebaseAuthentication:{signInWithApple:async()=>({credential:native}),signInWithGoogle:async()=>({credential:native}),revokeAccessToken:async value=>calls.push(['revoke',value.token])},appSdk:{},dbSdk:{},authSdk:{},functionsSdk:{},rewardedAds:{}};
 vm.runInNewContext(source,sandbox);
 const user={uid:'test'},fb={authSdk:{OAuthProvider:class {credential(value){return value;}},GoogleAuthProvider:{credential:()=>({})},reauthenticateWithCredential:async target=>{assert.equal(target,user);calls.push(['reauthenticate']);}}};
 await sandbox.trucoNative.reauthenticateForDeletion(fb,user,provider);
 assert.deepEqual(calls,provider==='apple.com'?[['reauthenticate'],['revoke','authorization']]:[['reauthenticate']]);
 calls.length=0;fb.authSdk.reauthenticateWithCredential=async()=>{throw Error('Different user');};
 await assert.rejects(()=>sandbox.trucoNative.reauthenticateForDeletion(fb,user,provider),/Different user/);assert.equal(calls.length,0);
});
