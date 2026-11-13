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
test('The notice waits for the second visit; once closed, it comes back after five more visits; reloads in the same session do not count',async()=>{
 const {promoVisit}=await load();
 const storage=memory();let session=memory();
 assert.equal(promoVisit(storage,session).show,false);
 assert.equal(promoVisit(storage,session).visits,1);
 assert.equal(promoVisit(storage,memory()).show,true);
 storage.setItem('truco-ios-app',JSON.stringify({visits:1,closedAt:1}));
 const shown=[];for(let i=0;i<5;i++){session=memory();shown.push(promoVisit(storage,session).show);}
 assert.deepEqual(shown,[false,false,false,false,true]);
});
test('Android browsers get the Google Play notice, with its own visits; the app and iPhone do not',async()=>{
 const {storeFor,androidWeb,STORES,promoVisit}=await load();
 const android={userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8)'},iphone={userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'};
 assert.equal(storeFor(android,false),STORES.android);assert.equal(storeFor(iphone,false),STORES.ios);
 assert.equal(androidWeb(android,true),false);assert.equal(storeFor({userAgent:'Mozilla/5.0 (Windows NT 10.0)'},false),null);
 assert.equal(STORES.android.url,'https://play.google.com/store/apps/details?id=com.matiasmoranc.truco');
 const storage=memory();storage.setItem(STORES.ios.key,JSON.stringify({visits:3,closedAt:3}));
 assert.equal(promoVisit(storage,memory(),STORES.android.key).show,false);
 assert.equal(promoVisit(storage,memory(),STORES.android.key).show,true);
});
