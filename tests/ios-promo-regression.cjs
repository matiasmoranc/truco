const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../ios-promo.js')).toString('base64'));
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};
test('The App Store notice is only for iPhone browsers, not the app, iPad or Android',async()=>{
 const {iphoneWeb}=await load();
 assert.equal(iphoneWeb({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},false),true);
 assert.equal(iphoneWeb({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},true),false);
 assert.equal(iphoneWeb({userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'},false),false);
 assert.equal(iphoneWeb({userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8)'},false),false);
});
test('Once closed, the notice comes back after five more visits; reloads in the same session do not count',async()=>{
 const {promoVisit}=await load();
 const storage=memory();let session=memory();
 assert.equal(promoVisit(storage,session).show,true);
 assert.equal(promoVisit(storage,session).visits,1);
 storage.setItem('truco-ios-app',JSON.stringify({visits:1,closedAt:1}));
 const shown=[];for(let i=0;i<5;i++){session=memory();shown.push(promoVisit(storage,session).show);}
 assert.deepEqual(shown,[false,false,false,false,true]);
});
