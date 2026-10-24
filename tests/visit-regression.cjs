const {test}=require('node:test');const assert=require('node:assert/strict');
const {visitUpdates,visitSummary}=require('../functions/visit-service.cjs');
const increment=n=>({inc:n});
test('A visit increments platform, page and hour counters; only a first visit adds a visitor',()=>{
 const now=Date.parse('2026-10-23T15:00:00Z');
 const first=visitUpdates({platform:'web-android',page:'juego',first:true,now,increment});
 assert.deepEqual(first,{'2026-10-23/visits/web-android':{inc:1},'2026-10-23/pages/juego':{inc:1},'2026-10-23/hours/12':{inc:1},'2026-10-23/visitors/web-android':{inc:1}});
 assert.equal(visitUpdates({platform:'app-ios',page:'anotador',first:false,now,increment})['2026-10-23/visitors/app-ios'],undefined);
});
test('Visits reject unknown platforms, pages and flags so clients cannot write arbitrary paths',()=>{
 for(const data of [{platform:'../x',page:'juego',first:true},{platform:'web-ios',page:'admin',first:true},{platform:'web-ios',page:'juego',first:'yes'},{}])
  assert.throws(()=>visitUpdates({...data,now:1,increment}));
});
test('The summary fills missing days with zeros and ignores malformed counters',()=>{
 const now=Date.parse('2026-10-23T15:00:00Z');
 const summary=visitSummary({now,days:3,visits:{'2026-10-23':{visits:{'web-ios':4,'app-android':2,'web-desktop':-3},visitors:{'web-ios':2,'app-android':'9'},pages:{juego:5},hours:{'12':6}}}});
 assert.deepEqual(summary.days.map(d=>d.day),['2026-10-21','2026-10-22','2026-10-23']);
 const today=summary.days[2];
 assert.equal(today.totalVisits,6);assert.equal(today.totalVisitors,2);assert.equal(today.visits['web-desktop'],0);assert.equal(today.hours[12],6);
 assert.equal(summary.days[0].totalVisits,0);
});
test('The client reports app, iPhone, Android and desktop visits apart',async()=>{
 const {visitPlatform,visitPage,recordVisit}=await import('data:text/javascript;base64,'+Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname,'../visit.js'),'utf8')).toString('base64'));
 assert.equal(visitPlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},null),'web-ios');
 assert.equal(visitPlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:5},null),'web-ios');
 assert.equal(visitPlatform({userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8)'},null),'web-android');
 assert.equal(visitPlatform({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'},null),'web-desktop');
 assert.equal(visitPlatform({userAgent:''},'ios'),'app-ios');assert.equal(visitPlatform({userAgent:''},'android'),'app-android');
 assert.equal(visitPage('/truco/'),'juego');assert.equal(visitPage('/anotador-de-truco.html'),'anotador');assert.equal(visitPage('/reglas.html'),'otra');
 const sent=[];const fetch=(url,init)=>{sent.push(JSON.parse(init.body).data);return Promise.resolve();};
 assert.equal(recordVisit({fetch,nav:{userAgent:'Mozilla/5.0 (Windows NT 10.0)'},location:{hostname:'localhost',pathname:'/'}}),null);
 assert.equal(recordVisit({fetch,nav:{userAgent:'Googlebot/2.1'},location:{hostname:'trucouruguayo.uy',pathname:'/'}}),null);
 await recordVisit({fetch,nav:{userAgent:'Mozilla/5.0 (Linux; Android 14)'},location:{hostname:'trucouruguayo.uy',pathname:'/aprender-truco-uruguayo.html'}});
 assert.equal(sent.length,1);assert.equal(sent[0].platform,'web-android');assert.equal(sent[0].page,'aprender');assert.equal(typeof sent[0].first,'boolean');
});
