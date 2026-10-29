const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const google=uid=>({uid,isAnonymous:false,providerData:[{providerId:'google.com'}]});
async function harness(user=null,profile=null,navigator={platform:"Win32",userAgent:"Windows"}){
 const source=fs.readFileSync(path.join(__dirname,'../account.js'),'utf8');
 const {installAccount}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const nodes={},writes=[],cache=new Map();
 const document={getElementById(id){return nodes[id]??={value:'',hidden:false,disabled:false,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn},focus(){},showModal(){this.open=true},close(){this.open=false}}}};
 const fb={db:{},auth:{currentUser:user},authSdk:{OAuthProvider:class{constructor(id){this.providerId=id;this.scopes=[]}addScope(scope){this.scopes.push(scope)}setCustomParameters(params){this.params=params}},GoogleAuthProvider:class{setCustomParameters(){} static credentialFromError(e){return e.credential}},async linkWithPopup(u){fb.auth.currentUser=google(u.uid)},async signInWithPopup(auth,provider){fb.auth.currentUser=provider?.providerId==='apple.com'?{uid:'apple',isAnonymous:false,providerData:[{providerId:'apple.com'}]}:google('google')},async signInWithCredential(){fb.auth.currentUser=google('existing')},async signOut(){fb.auth.currentUser=null}},ref(db,path){return path},get:async(ref)=>({val:()=>ref==='usernameIndexReady'?true:ref?.startsWith('usernames/')?null:profile}),update:async(ref,value)=>{writes.push({ref,value})}};
 const state={firebase:fb,room:null,uid:user?.uid||null};let name='',starts=0,resets=0,registrations=[];
 const account=installAccount({api:async(name,data)=>fb.api?.(name,data),services:async()=>fb,getState:()=>state,rememberName:v=>name=v,document,navigator,storage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)},onReady:()=>{starts++},onIdentityChange:()=>{resets++},onRegistered:uid=>registrations.push(uid)});
 for(const id of ['auth-email','auth-password'])document.getElementById(id);
 await account.observe(fb,user);
 return {account,fb,state,nodes,writes,cache,registrations,name:()=>name,starts:()=>starts,resets:()=>resets,click:async id=>nodes[id].handlers.click(),submit:async id=>nodes[id].handlers.submit({preventDefault(){}})};
}
test('Logged-out and legacy anonymous users stay behind the Google gate',async()=>{
 for(const user of [null,{uid:'old',isAnonymous:true}]){
  const h=await harness(user);assert.equal(h.account.isReady(),false);assert.equal(h.nodes.app.inert,true);assert.equal(h.nodes['auth-gate'].hidden,false);
  assert.equal(h.nodes['account-google'].disabled,false);assert.equal(h.starts(),0);
 }
});
test('First Google sign-in asks for a username before opening the lobby',async()=>{
 const h=await harness();await h.click('account-google');
 assert.equal(h.nodes['auth-register'].hidden,false);assert.equal(h.account.isReady(),false);assert.equal(h.starts(),0);
 h.nodes['auth-name'].value='Mati';await h.submit('auth-register');
 assert.deepEqual(h.writes,[{ref:undefined,value:{'profiles/google/name':'Mati','usernames/mati':'google'}}]);
 assert.equal(h.account.isReady(),true);assert.equal(h.starts(),1);assert.equal(h.name(),'Mati');
});
test('Returning Google user goes directly to the lobby and repeated auth callbacks do not restart it',async()=>{
 const user=google('known'),h=await harness(user,{name:'Mati'});
 assert.equal(h.account.isReady(),true);assert.equal(h.nodes['auth-gate'].hidden,true);assert.equal(h.starts(),1);
 await h.account.observe(h.fb,user);assert.equal(h.starts(),1);assert.equal(h.nodes['player-name'].value,'Mati');
});
test('Canceled Google popup keeps the gate closed to gameplay',async()=>{
 const h=await harness();h.fb.authSdk.signInWithPopup=async()=>{throw {code:'auth/popup-closed-by-user'}};
 await h.click('account-google');assert.equal(h.account.isReady(),false);assert.equal(h.nodes.app.inert,true);assert.match(h.nodes['auth-status'].textContent,/volver a intentar/);
});
test('Legacy anonymous linking preserves the UID; a collision opens the existing Google account',async()=>{
 const h=await harness({uid:'old',isAnonymous:true});await h.click('account-google');assert.equal(h.fb.auth.currentUser.uid,'old');
 const c=await harness({uid:'old',isAnonymous:true});c.fb.authSdk.linkWithPopup=async()=>{throw {code:'auth/credential-already-in-use',credential:{}}};
 await c.click('account-google');assert.equal(c.fb.auth.currentUser.uid,'existing');assert.equal(c.writes.length,0);
});
test('Mi cuenta shows only its menu until changing the username',async()=>{
 const h=await harness(google('known'),{name:'Mati'});
 await h.click('account-open');assert.equal(h.nodes['account-edit'].hidden,true);assert.equal(h.nodes['account-menu'].hidden,false);
 await h.click('account-change-name');assert.equal(h.nodes['account-edit'].hidden,false);assert.equal(h.nodes['account-name'].value,'Mati');
 h.nodes['account-name'].value='Nuevo';await h.submit('account-edit');
 assert.equal(h.name(),'Nuevo');assert.equal(h.nodes['account-edit'].hidden,true);assert.equal(h.nodes['account-panel'].open,false);assert.equal(h.starts(),1);
});
test('Registration failure cannot enter the game; retrying the save succeeds',async()=>{
 const h=await harness(google('new'));h.fb.update=async()=>{throw new Error('permission denied')};
 h.nodes['auth-name'].value='Mati';await h.submit('auth-register');assert.equal(h.account.isReady(),false);assert.equal(h.name(),'');
 h.fb.update=async()=>{};await h.submit('auth-register');assert.equal(h.account.isReady(),true);
});
test('A known UID can restore its name on a slow connection, while a new UID cannot',async()=>{
 const h=await harness();h.cache.set('truco-profile-name:known','Mati');
 h.fb.get=async()=>{throw new Error('offline')};await h.account.observe(h.fb,google('known'));
 assert.equal(h.account.isReady(),true);
 await h.account.observe(h.fb,google('unknown'));assert.equal(h.account.isReady(),false);
});
test('A profile response from the old account cannot unlock or rename the new account',async()=>{
 const h=await harness();let resolve;
 h.fb.get=()=>new Promise(r=>resolve=r);
 const pending=h.account.observe(h.fb,google('old'));
 await h.account.observe(h.fb,null);
 resolve({val:()=>({name:'Old'})});await pending;
 assert.equal(h.account.isReady(),false);assert.equal(h.name(),'');
});
test('Signing out closes the account panel and returns to Google without creating a guest',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-open');await h.click('account-logout');
 assert.equal(h.fb.auth.currentUser,null);assert.equal(h.account.isReady(),false);assert.equal(h.nodes.app.inert,true);assert.equal(h.name(),'');assert.equal(h.resets(),1);
});
test('Account changes during a game are blocked',async()=>{
 const h=await harness(google('known'),{name:'Mati'});h.state.room={status:'started'};
 await h.click('account-logout');assert.ok(h.fb.auth.currentUser);
});


test('Invalid characters and spaces are rejected without writing',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');
 for(const name of ['Mati Perez',' Mati','Mati ','@Mati','a/b','a#b','a'.repeat(19)]){
 h.nodes['account-name'].value=name;await h.submit('account-edit');assert.equal(h.writes.length,0);assert.equal(h.name(),'Mati');
 }
 h.nodes['account-name'].value='Ñandu_01-test.ok';await h.submit('account-edit');assert.equal(h.name(),'Ñandu_01-test.ok');assert.equal(h.writes[0].value['usernames/ñandu_01-test%2Eok'],'known');
});
test('Names are reserved case-insensitively; own capitalization can change',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');
 h.fb.get=async ref=>({val:()=>ref==='usernameIndexReady'?true:ref?.startsWith('usernames/')?'another':{name:'Mati'}});
 h.nodes['account-name'].value='MATI';await h.submit('account-edit');assert.equal(h.writes.length,0);assert.match(h.nodes['account-status'].textContent,/ya existe/);
 h.fb.get=async ref=>({val:()=>ref==='usernameIndexReady'?true:ref?.startsWith('usernames/')?'known':{name:'Mati'}});
 await h.submit('account-edit');assert.equal(h.name(),'MATI');assert.deepEqual(h.writes[0].value,{'profiles/known/name':'MATI','usernames/mati':'known'});
});
test('Rename releases only a reservation owned by this user in the same update',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');
 h.fb.get=async ref=>({val:()=>ref==='usernameIndexReady'?true:ref==='usernames/mati'?'known':ref?.startsWith('usernames/')?null:{name:'Mati'}});
 h.nodes['account-name'].value='Nuevo';await h.submit('account-edit');assert.deepEqual(h.writes[0].value,{'profiles/known/name':'Nuevo','usernames/nuevo':'known','usernames/mati':null});
});
test('A claim lost to a concurrent save reports a duplicate and retains the old name',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');let taken=false;
 h.fb.get=async ref=>({val:()=>ref==='usernameIndexReady'?true:ref==='usernames/nuevo'?(taken?'other':null):ref?.startsWith('usernames/')?null:{name:'Mati'}});
 h.fb.update=async()=>{taken=true;throw new Error('permission denied')};
 h.nodes['account-name'].value='Nuevo';await h.submit('account-edit');assert.equal(h.name(),'Mati');assert.match(h.nodes['account-status'].textContent,/ya existe/);
});
test('The account menu hidden selector overrides its flex display',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');assert.match(css,/#account-menu\[hidden\]\s*\{display:none\}/);
});

test('An incomplete legacy index blocks all username saves',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');
 h.fb.get=async ref=>({val:()=>ref==='usernameIndexReady'?false:{name:'Mati'}});
 h.nodes['account-name'].value='Otro';await h.submit('account-edit');
 assert.equal(h.writes.length,0);assert.equal(h.name(),'Mati');assert.match(h.nodes['account-status'].textContent,/pausados/);
});
test('A successful rename shows confirmation for two seconds and then closes the account panel',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-open');await h.click('account-change-name');
 h.nodes['account-name'].value='Otro';const pending=h.submit('account-edit');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.nodes['account-panel'].open,true);assert.equal(h.nodes['account-menu'].hidden,true);
 assert.match(h.nodes['account-status'].textContent,/cambiado correctamente/);
 await new Promise(resolve=>setTimeout(resolve,1000));assert.equal(h.nodes['account-panel'].open,true);
 await pending;assert.equal(h.nodes['account-panel'].open,false);assert.equal(h.nodes['account-status'].textContent,'');
});

test('Touching the dialog background or username input cannot dismiss it',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-open');await h.click('account-change-name');
 h.nodes['account-panel'].handlers.click({target:h.nodes['account-panel']});
 assert.equal(h.nodes['account-panel'].open,true);
 h.nodes['account-panel'].handlers.click({target:h.nodes['account-name']});assert.equal(h.nodes['account-panel'].open,true);
 await h.click('account-close');assert.equal(h.nodes['account-panel'].open,false);
});
test('Missing index read permission reports setup failure and never changes the name',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-change-name');
 h.fb.get=async()=>{throw {code:'PERMISSION_DENIED'}};h.nodes['account-name'].value='Otro';await h.submit('account-edit');
 assert.equal(h.writes.length,0);assert.equal(h.name(),'Mati');assert.match(h.nodes['account-status'].textContent,/Falta habilitar/);
});
test('A slow rename confirmation cannot reopen another editing dialog before it completes',async()=>{
 const h=await harness(google('known'),{name:'Mati'});await h.click('account-open');await h.click('account-change-name');
 h.nodes['account-name'].value='Otro';const pending=h.submit('account-edit');await new Promise(resolve=>setImmediate(resolve));
 await h.click('account-change-name');await h.click('account-open');assert.equal(h.nodes['account-edit'].hidden,true);
 await pending;assert.equal(h.nodes['account-panel'].open,false);
});

test('Apple sign-in is visible only on Apple devices, including desktop-mode iPads',async()=>{
 for(const [navigator,visible] of [
 [{platform:'iPhone',userAgent:'iPhone'},true],
 [{platform:'MacIntel',userAgent:'Macintosh',maxTouchPoints:5},true],
 [{platform:'MacIntel',userAgent:'Macintosh'},true],
 [{platform:'Linux armv8',userAgent:'Android'},false],
 [{platform:'Win32',userAgent:'Windows'},false],
 [{platform:'Linux x86_64',userAgent:'Linux'},false]
 ]){
 const h=await harness(null,null,navigator);assert.equal(h.nodes['account-apple'].hidden,!visible);
 }
});
test('Desktop Apple OAuth requests the right provider and asks first-time users for a name',async()=>{
 const h=await harness(null,null,{platform:'MacIntel',userAgent:'Macintosh'});let used;
 const signIn=h.fb.authSdk.signInWithPopup;h.fb.authSdk.signInWithPopup=async(auth,provider)=>{used=provider;await signIn(auth,provider)};
 await h.click('account-apple');assert.equal(used.providerId,'apple.com');assert.deepEqual(used.scopes,['email','name']);assert.equal(used.params.locale,'es');
 assert.equal(h.account.isReady(),false);h.nodes['auth-name'].value='AppleUser';await h.submit('auth-register');
 assert.equal(h.account.isReady(),true);assert.equal(h.writes[0].value['usernames/appleuser'],'apple');
});
test('Existing Apple accounts restore their profile on reload without repeating registration',async()=>{
 const user={uid:'apple',isAnonymous:false,providerData:[{providerId:'apple.com'}]};
 const h=await harness(user,{name:'AppleUser'},{platform:'MacIntel',userAgent:'Macintosh'});
 assert.equal(h.account.isReady(),true);assert.equal(h.name(),'AppleUser');assert.equal(h.starts(),1);
 await h.account.observe(h.fb,user);assert.equal(h.starts(),1);
});
test('Unconfigured Apple sign-in reports Apple and never unlocks gameplay',async()=>{
 const h=await harness(null,null,{platform:'iPhone',userAgent:'iPhone'});
 h.fb.authSdk.signInWithPopup=async()=>{throw {code:'auth/operation-not-allowed'}};
 await h.click('account-apple');assert.equal(h.account.isReady(),false);assert.match(h.nodes['auth-status'].textContent,/Apple/);
});
test('Hidden Apple action cannot start OAuth on Windows',async()=>{
 const h=await harness();let calls=0;h.fb.authSdk.signInWithPopup=async()=>{calls++};
 await h.click('account-apple');assert.equal(calls,0);
});

test('iPhone Apple access redirects to the Firebase origin, preserving the existing mobile flow',async()=>{
 const h=await harness(null,null,{platform:'iPhone',userAgent:'iPhone'});h.fb.auth.app={options:{authDomain:'truco-6553d.firebaseapp.com'}};
 const previous=globalThis.location;let assigned,provider;
 try{
  globalThis.location={origin:'https://matiasmoranc.github.io',assign:url=>assigned=url};await h.click('account-apple');
  assert.equal(new URL(assigned).origin,'https://truco-6553d.firebaseapp.com');assert.equal(new URL(assigned).searchParams.get('appleLogin'),'1');
  globalThis.location={origin:'https://truco-6553d.firebaseapp.com'};h.fb.authSdk.signInWithRedirect=async(auth,p)=>provider=p;
  await h.click('account-apple');assert.equal(provider.providerId,'apple.com');assert.deepEqual(provider.scopes,['email','name']);assert.equal(h.account.isReady(),false);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});

test('Welcome tour is requested only for a new profile, including recreated Google and Apple accounts',async()=>{
 const user={uid:'new-google',isAnonymous:false,providerData:[{providerId:'google.com'}]};
 const h=await harness(user);h.nodes['auth-name'].value='Nuevo';await h.submit('auth-register');assert.deepEqual(h.registrations,[user.uid]);
 const existing=await harness(user,{name:'Nuevo'});assert.deepEqual(existing.registrations,[]);
 const recreated=await harness({...user,uid:'recreated-google'});recreated.nodes['auth-name'].value='Nuevo';await recreated.submit('auth-register');assert.deepEqual(recreated.registrations,['recreated-google']);
 const apple=await harness({uid:'new-apple',isAnonymous:false,providerData:[{providerId:'apple.com'}]});assert.deepEqual(apple.registrations,['new-apple']);
 const appleExisting=await harness({uid:'new-apple',isAnonymous:false,providerData:[{providerId:'apple.com'}]},{name:'Nuevo'});assert.deepEqual(appleExisting.registrations,[]);
});
test('A new Apple account never asks for a name: it uses the Apple first name or a numbered player name',async()=>{
 const named=await harness({uid:'a1',isAnonymous:false,displayName:'Ana María López',providerData:[{providerId:'apple.com'}]});
 assert.equal(named.account.isReady(),true);assert.equal(named.nodes['auth-register'].hidden,true);assert.equal(named.name(),'Ana');
 assert.deepEqual(named.writes,[{ref:undefined,value:{'profiles/a1/name':'Ana','usernames/ana':'a1'}}]);
 const hidden=await harness({uid:'a2',isAnonymous:false,providerData:[{providerId:'apple.com'}]});
 assert.equal(hidden.account.isReady(),true);assert.match(hidden.name(),/^Jugador\d{4}$/);
});
test('Guests enter without an account and online features send them back to sign in',async()=>{
 const h=await harness();assert.equal(h.account.isGuest(),false);assert.equal(h.nodes['auth-gate'].hidden,false);
 await h.click('auth-guest');
 assert.equal(h.account.isGuest(),true);assert.equal(h.nodes['auth-gate'].hidden,true);assert.equal(h.nodes.app.inert,false);assert.equal(h.cache.get('truco-guest'),'1');
 assert.equal(h.account.isReady(),false);assert.equal(h.starts(),0);
 await h.click('account-open');assert.equal(h.account.isGuest(),false);assert.equal(h.nodes['auth-gate'].hidden,false);
});

test('Account deletion reauthenticates before server deletion and signs out on success',async()=>{
 const h=await harness(google('known'),{name:'Mati'}),calls=[];
 h.fb.api=async(name,data)=>calls.push(data.action);
 h.fb.authSdk.reauthenticateWithPopup=async()=>calls.push('reauth');
 h.fb.auth.currentUser.getIdToken=async()=>calls.push('refresh');
 await h.click('account-delete');assert.equal(h.nodes['account-delete-confirm'].hidden,false);
 await h.click('account-delete-submit');
 assert.deepEqual(calls,['check','reauth','refresh','delete']);assert.equal(h.account.isReady(),false);
 assert.equal(h.nodes['auth-status'].textContent,'Tu cuenta fue eliminada.');
});
test('Wrong identity or an active table prevents deletion',async()=>{
 const h=await harness(google('known'),{name:'Mati'}),calls=[];
 h.fb.api=async(name,data)=>calls.push(data.action);
 h.fb.authSdk.reauthenticateWithPopup=async()=>{throw {code:'auth/user-mismatch'}};
 await h.click('account-delete-submit');assert.deepEqual(calls,['check']);assert.equal(h.account.isReady(),true);
 assert.match(h.nodes['account-status'].textContent,/misma cuenta/);
 calls.length=0;h.fb.api=async()=>{throw new Error('Cerrá tu mesa')};
 await h.click('account-delete-submit');assert.deepEqual(calls,[]);assert.match(h.nodes['account-status'].textContent,/Cerrá tu mesa/);
});

test('Android Google uses a same-origin redirect and records its return marker',async()=>{
 const h=await harness(null,{name:'Mati'},{platform:'Linux armv8l',userAgent:'Mozilla/5.0 Android 14 Chrome/130'});let redirects=0;const markers=new Map();
 h.fb.auth.app={options:{authDomain:'trucouruguayo.uy'}};h.fb.authSdk.signInWithRedirect=async()=>{redirects++;};h.fb.authSdk.signInWithPopup=()=>{throw Error('Popup should not open');};
 globalThis.location={hostname:'trucouruguayo.uy'};globalThis.sessionStorage={setItem:(k,v)=>markers.set(k,v),removeItem:k=>markers.delete(k)};
 try{await h.click('account-google');assert.equal(redirects,1);assert.ok(markers.has('truco-google-redirect-pending'));assert.equal(h.account.isReady(),false);}
 finally{delete globalThis.location;delete globalThis.sessionStorage;}
});
test('Google popup uses the returned user even when currentUser has not updated',async()=>{
 const h=await harness(null,{name:'Mati'});h.fb.authSdk.signInWithPopup=async()=>({user:google('confirmed')});await h.click('account-google');assert.equal(h.account.isReady(),true);assert.equal(h.state.uid,'confirmed');
});
test('A popup with no Google session shows an error instead of silently returning to login',async()=>{
 const h=await harness();h.fb.authSdk.signInWithPopup=async()=>({});await h.click('account-google');assert.equal(h.account.isReady(),false);assert.match(h.nodes['auth-status'].textContent,/auth\/google-session-missing/);
});

test('Password account signs in through Firebase and clears the entered password',async()=>{
 const h=await harness();const user={uid:'review',isAnonymous:false,email:'review@example.test',providerData:[{providerId:'password'}]};
 h.fb.authSdk.signInWithEmailAndPassword=async(auth,email,password)=>{assert.equal(email,'review@example.test');assert.equal(password,'test-password');auth.currentUser=user;return {user};};
 h.nodes['auth-email'].value=' review@example.test ';h.nodes['auth-password'].value='test-password';
 await h.submit('auth-email-form');assert.equal(h.nodes['auth-password'].value,'');assert.equal(h.nodes['auth-register'].hidden,false);
});
test('Invalid password cannot unlock gameplay and is cleared',async()=>{
 const h=await harness();h.fb.authSdk.signInWithEmailAndPassword=async()=>{throw {code:'auth/invalid-credential'};};
 h.nodes['auth-email'].value='review@example.test';h.nodes['auth-password'].value='wrong';
 await h.submit('auth-email-form');assert.equal(h.account.isReady(),false);assert.equal(h.nodes['auth-password'].value,'');assert.match(h.nodes['auth-status'].textContent,/Correo o contraseña incorrectos/);
});

test('iPhone and iPad Google use the same-origin redirect; a desktop Mac keeps the popup',async()=>{
 const devices=[
  [{platform:'iPhone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130 Mobile/15E148 Safari/604.1'},true],
  [{platform:'MacIntel',maxTouchPoints:5,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'},true],
  [{platform:'MacIntel',maxTouchPoints:0,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'},false]
 ];
 for(const [navigator,redirect] of devices){
  const h=await harness(null,{name:'Mati'},navigator);let redirects=0,popups=0;const markers=new Map();
  h.fb.auth.app={options:{authDomain:'trucouruguayo.uy'}};h.fb.authSdk.signInWithRedirect=async()=>{redirects++;};h.fb.authSdk.signInWithPopup=async()=>{popups++;return {user:google('popup')};};
  globalThis.location={hostname:'trucouruguayo.uy'};globalThis.sessionStorage={setItem:(k,v)=>markers.set(k,v),removeItem:k=>markers.delete(k)};
  try{await h.click('account-google');assert.equal(redirects,redirect?1:0,navigator.userAgent);assert.equal(popups,redirect?0:1,navigator.userAgent);assert.equal(markers.has('truco-google-redirect-pending'),redirect);}
  finally{delete globalThis.location;delete globalThis.sessionStorage;}
 }
});
