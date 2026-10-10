const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../auth-init.js'),'utf8')).toString('base64'));
function sdkFor(auth){return {browserLocalPersistence:'local',indexedDBLocalPersistence:'indexed',browserSessionPersistence:'session',inMemoryPersistence:'memory',initializeAuth(app,options){this.options=options;return auth;},getAuth(){throw Error('Unexpected default initialization');}};}
test('Initialization preserves persistent sessions without eagerly opening the mobile auth iframe',async()=>{
 const {initializeGameAuth}=await modulePromise;
 const user={uid:'existing'};const auth={currentUser:user,authStateReady:async()=>{}};const sdk=sdkFor(auth);const stages=[];
 assert.equal(await initializeGameAuth(sdk,{}, {onStage:s=>stages.push(s)}),auth);
 assert.equal(auth.currentUser,user);assert.deepEqual(sdk.options.persistence,['local','indexed','session','memory']);assert.equal('popupRedirectResolver' in sdk.options,false);
 assert.deepEqual(stages,['session','ready']);
});
test('A stuck saved session fails with a specific retryable startup error',async()=>{
 const {initializeGameAuth}=await modulePromise;
 await assert.rejects(initializeGameAuth(sdkFor({authStateReady:()=>new Promise(()=>{})}),{},{timeoutMs:5}),e=>e.code==='auth/startup-timeout');
});
test('Repeated initialization reuses Auth and unrelated setup failures are preserved',async()=>{
 const {initializeGameAuth}=await modulePromise;const auth={authStateReady:async()=>{}};
 assert.equal(await initializeGameAuth({initializeAuth(){throw {code:'auth/already-initialized'};},getAuth(){return auth;}},{}),auth);
 await assert.rejects(initializeGameAuth({initializeAuth(){throw {code:'auth/invalid-api-key'};}},{}),e=>e.code==='auth/invalid-api-key');
});
