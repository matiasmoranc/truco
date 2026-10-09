const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function harness(){
 const source=fs.readFileSync(path.join(__dirname,'../account.js'),'utf8');
 const {installAccount}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const nodes={},callbacks=[],writes=[];
 const document={getElementById(id){return nodes[id]??= {value:'',hidden:false,disabled:false,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn},focus(){},showModal(){this.open=true},close(){this.open=false}}}};
 const user={uid:'guest',isAnonymous:true};
 const fb={db:{},auth:{currentUser:user},authSdk:{GoogleAuthProvider:class{setCustomParameters(){} static credentialFromError(error){return error.credential}},async linkWithPopup(u){u.isAnonymous=false},async signInWithPopup(){},async signInWithCredential(){fb.auth.currentUser={uid:'existing',isAnonymous:false}},async signOut(){fb.auth.currentUser=null},async signInAnonymously(){fb.auth.currentUser={uid:'new-guest',isAnonymous:true}}},ref(db,path){return path},onValue(ref,ok,error){callbacks.push({ref,ok,error});return ()=>{}},async set(ref,value){writes.push({ref,value})}};
 const state={firebase:fb,room:null};
 let name='Mati';
 const account=installAccount({services:async()=>fb,getState:()=>state,savedName:()=>name,rememberName:value=>name=value,document});
 account.observe(fb,user);
 return {account,fb,state,nodes,callbacks,writes,name:()=>name,click:async id=>nodes[id].handlers.click()};
}
test('Google links the guest UID and canceled access retains the guest',async()=>{
 const h=await harness();
 await h.click('account-google');assert.equal(h.fb.auth.currentUser.uid,'guest');assert.equal(h.fb.auth.currentUser.isAnonymous,false);
 const c=await harness();c.fb.authSdk.linkWithPopup=async()=>{throw {code:'auth/popup-closed-by-user'}};
 await c.click('account-google');assert.equal(c.fb.auth.currentUser.uid,'guest');assert.match(c.nodes['account-status'].textContent,/invitado/);
});
test('Existing Google credential switches to its account, without copying private guest data',async()=>{
 const h=await harness();h.fb.authSdk.linkWithPopup=async()=>{throw {code:'auth/credential-already-in-use',credential:{}}};
 await h.click('account-google');assert.equal(h.fb.auth.currentUser.uid,'existing');assert.equal(h.writes.length,0);
});
test('Account actions are blocked during a game',async()=>{
 const h=await harness();h.state.room={status:'started'};let calls=0;
 h.fb.authSdk.linkWithPopup=async()=>{calls++};
 await h.click('account-google');assert.equal(calls,0);
});
test('Stale profile callbacks cannot overwrite the new account name',async()=>{
 const h=await harness();h.account.observe(h.fb,{uid:'other',isAnonymous:false});
 h.callbacks[0].ok({val:()=>({name:'Old'})});assert.equal(h.name(),'Mati');
 h.callbacks[1].ok({val:()=>({name:'New'})});assert.equal(h.name(),'New');
});
test('Saving uses only the current UID and permission failure keeps local name',async()=>{
 const h=await harness();h.nodes['account-name'].value='Nuevo';await h.click('account-save');
 assert.deepEqual(h.writes,[{ref:'profiles/guest/name',value:'Nuevo'}]);
 h.fb.set=async()=>{throw new Error('permission denied')};
 h.nodes['account-name'].value='Local';await h.click('account-save');assert.equal(h.name(),'Local');assert.match(h.nodes['account-status'].textContent,/dispositivo/);
});
test('Sign-out clears the saved account nickname and creates a fresh guest',async()=>{
 const h=await harness();h.fb.auth.currentUser={uid:'google',isAnonymous:false};await h.click('account-logout');
 assert.equal(h.name(),'');assert.equal(h.fb.auth.currentUser.uid,'new-guest');
});
