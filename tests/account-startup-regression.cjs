const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../account.js'),'utf8').replaceAll('export function','function');
function setup(platform,userAgent=platform,origin='https://matiasmoranc.github.io'){
 const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',value:'',events:{},addEventListener(event,handler){this.events[event]=handler;},close(){},focus(){}});return elements.get(id);}};
 let reloads=0;const state={firebase:null};
 const context={document,navigator:{platform,userAgent},state,localStorage:{getItem(){return null;}},URL,history:{replaceState(){}},location:{origin,href:origin+'/',assign(url){this.destination=url;},reload(){reloads++;}},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(source+';globalThis.account=installAccount({services:async()=>state.firebase,getState:()=>state,rememberName:()=>{},document});',context);
 return {account:context.account,state,el:id=>document.getElementById(id),reloads:()=>reloads,location:context.location};
}
test('Slow iPhone startup shows Apple immediately and offers retry without enabling unready providers',()=>{
 const app=setup('iPhone');assert.equal(app.el('account-apple').hidden,false);assert.equal(app.el('account-google').disabled,true);
 assert.match(app.el('auth-status').textContent,/Preparando/);assert.equal(app.el('auth-retry').hidden,true);
 app.account.loadingSlow('session');assert.match(app.el('auth-status').textContent,/sesión guardada/);assert.equal(app.el('auth-retry').hidden,false);
 app.el('auth-retry').events.click();assert.equal(app.reloads(),1);
 app.state.firebase={};app.account.observe(app.state.firebase,null);
 assert.equal(app.el('account-google').disabled,false);assert.equal(app.el('account-apple').disabled,false);assert.equal(app.el('auth-retry').hidden,true);assert.equal(app.el('auth-status').textContent,'');
});
test('Windows does not show Apple and failed startup provides a recovery control',()=>{
 const app=setup('Win32');assert.equal(app.el('account-apple').hidden,true);
 app.account.failed(new Error('network'));assert.equal(app.el('auth-retry').hidden,false);
});
test('Apple uses the confirmed result even before currentUser is updated',async()=>{
 const app=setup('iPhone');const user={uid:'apple-user',isAnonymous:false,providerData:[{providerId:'apple.com'}]};
 class OAuthProvider{addScope(){}setCustomParameters(){}}
 app.state.firebase={auth:{currentUser:null},authSdk:{OAuthProvider,browserPopupRedirectResolver:'resolver',async signInWithPopup(auth,provider,resolver){assert.equal(resolver,'resolver');return {user};}},ref:()=>({}),get:async()=>({val:()=>({name:'ApplePlayer'})})};
 await app.el('account-apple').events.click();
 assert.equal(app.account.isReady(),true);assert.equal(app.el('account-username').textContent,'ApplePlayer');assert.equal(app.el('auth-gate').hidden,true);
});
test('Apple rejection shows the actual Firebase error and allows another attempt',async()=>{
 const app=setup('iPhone');class OAuthProvider{addScope(){}setCustomParameters(){}}
 app.state.firebase={auth:{currentUser:null},authSdk:{OAuthProvider,async signInWithPopup(){throw {code:'auth/account-exists-with-different-credential'};}}};
 await app.el('account-apple').events.click();
 assert.equal(app.account.isReady(),false);assert.match(app.el('auth-status').textContent,/auth\/account-exists-with-different-credential/);assert.equal(app.el('account-apple').disabled,false);
});

test('Chrome iPhone leaves the cross-origin popup flow for Firebase Hosting',async()=>{
 const app=setup('iPhone','iPhone CriOS/140');class OAuthProvider{addScope(){}setCustomParameters(){}}
 app.state.firebase={auth:{app:{options:{authDomain:'truco-6553d.firebaseapp.com'}}},authSdk:{OAuthProvider,signInWithPopup(){throw Error('Must not open popup');}}};
 await app.el('account-apple').events.click();
 assert.equal(app.location.destination,'https://truco-6553d.firebaseapp.com/?appleLogin=1&v=apple45');
});
test('Chrome iPhone on Firebase uses redirect on the same origin',async()=>{
 const app=setup('iPhone','iPhone CriOS/140','https://truco-6553d.firebaseapp.com');let calls=0;class OAuthProvider{addScope(){}setCustomParameters(){}}
 app.state.firebase={auth:{app:{options:{authDomain:'truco-6553d.firebaseapp.com'}}},authSdk:{OAuthProvider,browserPopupRedirectResolver:'resolver',async signInWithRedirect(auth,provider,resolver){calls++;assert.equal(resolver,'resolver');}}};
 await app.el('account-apple').events.click();assert.equal(calls,1);assert.equal(app.location.destination,undefined);
});
