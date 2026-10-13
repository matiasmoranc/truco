const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('mobile/entry.js','utf8').replace(/^import .*;\n/gm,'').replace("await import('../app.js');",'');
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
