const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {usageUpdates,mergeUsage,usageSummary,journeyOrigin}=require('../functions/usage-service.cjs');
const increment=n=>({inc:n});
test('Scorer and learning use counts per day and platform, and a step counts on the day of the landing',()=>{
 const now=Date.parse('2026-11-05T15:00:00Z');
 assert.deepEqual(usageUpdates({platform:'web-android',event:'anotador-web-start',first:true,target:30,now,increment}),{'2026-11-05/events/anotador-web-start/web-android':{inc:1},'2026-11-05/people/anotador-web-start/web-android':{inc:1},'2026-11-05/targets/30':{inc:1}});
 assert.deepEqual(usageUpdates({platform:'web-ios',step:'game',landing:{page:'anotador',ref:'www.google.com',day:'2026-11-02'},now,increment}),{'2026-11-02/journeys/anotador/Google/game':{inc:1}});
 assert.equal(journeyOrigin('trucoargentino.net'),'Otros');assert.equal(journeyOrigin(''),'Directo');
});
test('Usage rejects anything that could write other paths or dates',()=>{
 const now=Date.parse('2026-11-05T15:00:00Z'),landing={page:'anotador',ref:'',day:'2026-11-05'};
 for(const data of [{},{platform:'web-ios'},{platform:'x',event:'anotador-web-start',first:true},{platform:'web-ios',event:'../x',first:true},{platform:'web-ios',event:'anotador-web-start'},{platform:'web-ios',event:'anotador-web-start',first:true,target:7},{platform:'web-ios',step:'x',landing},{platform:'web-ios',step:'game',landing:{...landing,page:'juego'}},{platform:'web-ios',step:'game',landing:{...landing,day:'2026-11-06'}},{platform:'web-ios',step:'game',landing:{...landing,day:'2026-01-01'}}])
  assert.throws(()=>usageUpdates({...data,now,increment}));
});
test('The usage summary joins page visits, events and journeys, without test data',()=>{
 const log={'2026-11-01':{a:{page:'anotador',first:true,origin:'Google',platform:'web-android'},b:{page:'anotador',first:false,origin:'Google',platform:'web-android'},c:{page:'anotador',first:true,origin:'Directo',platform:'web-ios',test:true},d:{page:'aprender',first:true,origin:'Directo',platform:'web-ios',uid:'t'},e:{page:'juego',first:true,platform:'web-ios'}}};
 const usage={'2026-11-01':{events:{'anotador-game-open':{'app-ios':3,'web-ios':1}},people:{'anotador-game-open':{'app-ios':2}},targets:{30:2},journeys:{anotador:{Google:{landing:4,game:1}}}},'2026-12-01':{events:{'anotador-game-open':{'app-ios':9}}}};
 const s=usageSummary({log,usage,from:'2026-10-31',to:'2026-11-01',exclude:new Set(['t'])});
 assert.equal(s.pages.anotador.visits,2);assert.equal(s.pages.anotador.people,1);assert.equal(s.pages.anotador.origins.Google.people,1);assert.equal(s.pages.aprender.visits,0);
 assert.deepEqual(s.events['anotador-game-open'],{count:4,people:2,apps:3,web:1});
 assert.deepEqual(s.journeys.anotador.Google,{landing:4,game:1});assert.equal(s.targets[30],2);
 assert.deepEqual(s.days.map(d=>d.day),['2026-10-31','2026-11-01']);assert.deepEqual(s.days[1].anotador,{page:1,google:1,game:2});
 assert.deepEqual(mergeUsage({d:{events:{a:{p:1}}}},{d:{events:{a:{p:2,q:1}}}}),{d:{events:{a:{p:3,q:1}}}});
});
test('A new device keeps its landing on the scorer page and each next step counts once',async()=>{
 const store=new Map(),sent=[],names=['localStorage','location','navigator','fetch','document'],saved=names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
 const define=(k,value)=>Object.defineProperty(globalThis,k,{value,configurable:true,writable:true});
 define('localStorage',{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)});
 define('document',{referrer:'https://www.google.com/'});
 define('navigator',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8)'});
 // Like the browser fetch, it refuses to run as a method of another object (Illegal invocation).
 define('fetch',async function(url,o){if(this!=null&&this!==globalThis)throw new TypeError('Illegal invocation');sent.push({url,...JSON.parse(o.body).data});return {json:async()=>({result:{}})};});
 const source=fs.readFileSync(path.join(__dirname,'../visit.js'),'utf8');
 const load=(pathname,tag)=>{define('location',{pathname,search:'',hostname:'trucouruguayo.uy'});return import('data:text/javascript;base64,'+Buffer.from(source+'//'+tag).toString('base64'));};
 const usage=()=>sent.filter(s=>s.url.endsWith('siteUsage'));
 try{
  const page=await load('/anotador-de-truco.html','a');
  page.trackUsage('anotador-web-start',{target:30});page.trackUsage('anotador-web-start',{target:20});
  assert.deepEqual(usage().map(s=>[s.event,s.step,s.first]),[[undefined,'landing',undefined],['anotador-web-start','used',true],['anotador-web-start',undefined,false]]);
  assert.equal(usage()[0].landing.ref,'www.google.com');
  const game=await load('/','b');game.journeyStep('entered');game.journeyStep('entered');
  assert.deepEqual(usage().slice(3).map(s=>s.step),['game','entered']);
  // A device that already knew the site has no journey.
  store.delete('truco-journey');sent.length=0;
  const again=await load('/anotador-de-truco.html','c');again.journeyStep('game');
  assert.equal(usage().length,0);
 }finally{for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}
});
