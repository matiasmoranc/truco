const {test}=require('node:test');const assert=require('node:assert/strict');
const {visitUpdates,visitSummary}=require('../functions/visit-service.cjs');
const {activityUpdates}=require('../functions/activity-service.cjs');
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
test('Visit details keep device type, browser and origin without identifiers',()=>{
 const {deviceFacts,visitOrigin,visitRecord}=require('../functions/visit-service.cjs');
 assert.deepEqual(deviceFacts('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'),{os:'Android 14',browser:'Chrome',model:'SM-S918B'});
 assert.deepEqual(deviceFacts('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'),{os:'Android 10',browser:'Chrome',model:''});
 assert.equal(deviceFacts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Instagram 350.0').browser,'Instagram');
 assert.equal(deviceFacts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1').os,'iOS 18');
 assert.equal(deviceFacts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130').browser,'Edge');
 assert.equal(visitOrigin('l.instagram.com'),'Instagram');assert.equal(visitOrigin('www.google.com.uy'),'Google');assert.equal(visitOrigin(''),'Directo');
 assert.equal(visitOrigin('<script>'),'Directo');assert.equal(visitOrigin('www.foro.com.uy'),'foro.com.uy');
 const record=visitRecord({platform:'web-ios',page:'juego',first:true,ref:'instagram',userAgent:'iPhone OS 18_0',now:5});
 assert.deepEqual(Object.keys(record).sort(),['at','browser','first','model','origin','os','page','platform']);
});
test('The visitors list filters by platform and period and joins signed-in players',()=>{
 const {visitRange,visitorsInRange}=require('../functions/visit-service.cjs');
 const now=Date.parse('2026-10-24T15:00:00Z');
 assert.deepEqual(visitRange({from:'2026-10-20',to:'2026-10-24',platform:'web-ios',now}),{from:'2026-10-20',to:'2026-10-24',platform:'web-ios',page:null,hour:null});
 for(const bad of [{from:'2026-10-24',to:'2026-10-20',platform:'all'},{from:'2026-01-01',to:'2026-10-24',platform:'all'},{from:'2026-10-20',to:'2026-10-24',platform:'x'},{from:'../',to:'2026-10-24',platform:'all'}])
  assert.throws(()=>visitRange({...bad,now}));
 const log={'2026-10-23':{a:{at:1,platform:'web-ios',page:'juego'},b:{at:3,platform:'web-android',page:'juego'}},'2026-10-24':{c:{at:2,platform:'web-ios',page:'anotador'}}};
 const activity={'2026-10-23':{platforms:{u1:{'web-ios':true},u2:{'app-android':true}}},'2026-10-24':{platforms:{u1:{'web-ios':true,'web-desktop':true}}}};
 const ios=visitorsInRange({log,activity,platform:'web-ios'});
 assert.deepEqual(ios.visits.map(v=>v.at),[2,1]);assert.equal(ios.totalVisits,2);
 assert.deepEqual(ios.players,[{uid:'u1',days:2,lastDay:'2026-10-24',platforms:['web-ios'],visits:0}]);
 const all=visitorsInRange({log,activity,platform:'all'});assert.equal(all.visits.length,3);assert.deepEqual(all.players.map(p=>p.uid),['u1','u2']);
});
test('Signed-in heartbeats remember the platform only when it is a known one',()=>{
 const now=Date.parse('2026-10-24T15:00:00Z');
 assert.equal(activityUpdates({uid:'a',sessionId:'s',visible:true,now,platform:'app-ios'})['days/2026-10-24/platforms/a/app-ios'],true);
 assert.equal(Object.keys(activityUpdates({uid:'a',sessionId:'s',visible:true,now,platform:'../x'})).some(k=>k.includes('platforms')),false);
 assert.equal(Object.keys(activityUpdates({uid:'a',sessionId:'s',visible:false,now,platform:'app-ios'})).some(k=>k.includes('platforms')),false);
});
test('Visits claimed by a player count per player, and the rest stay anonymous',()=>{
 const {visitorsInRange,visitClaimPath}=require('../functions/visit-service.cjs');
 const at=Date.parse('2026-10-24T15:00:00Z');
 const log={'2026-10-24':{a:{at,platform:'web-ios',page:'juego',uid:'u1',first:true},b:{at:at+1,platform:'web-ios',page:'juego',uid:'u1',first:false},c:{at:at+2,platform:'web-ios',page:'anotador',first:true},d:{at:at+3,platform:'web-ios',page:'juego',first:false}}};
 const result=visitorsInRange({log,activity:{},platform:'web-ios'});
 assert.equal(result.signedVisits,2);assert.equal(result.anonymousVisits,2);assert.equal(result.anonymousDevices,1);
 assert.deepEqual(result.players.map(p=>[p.uid,p.visits,p.days]),[['u1',2,1]]);
 const pages=visitorsInRange({log,activity:{},platform:'all',page:'anotador'});assert.equal(pages.totalVisits,1);assert.equal(pages.players.length,0);
 assert.equal(visitClaimPath({visitId:'-NaBcDeFgHiJkLmNoPqR',visitDay:'2026-10-24'}),'adminMetrics/visitLog/2026-10-24/-NaBcDeFgHiJkLmNoPqR');
 for(const bad of [{visitId:'../x',visitDay:'2026-10-24'},{visitId:'-NaBcDeFgHiJkLmNoPqR',visitDay:'../'},{}])assert.equal(visitClaimPath(bad),null);
});
test("Claude's own browser checking the live site does not count as a visit",async()=>{
 const {recordVisit}=await import('data:text/javascript;base64,'+Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname,'../visit.js'),'utf8')).toString('base64'));
 assert.equal(recordVisit({fetch:()=>Promise.resolve(),nav:{userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/152 Claude/3.6556.2 Safari/537.36'},location:{hostname:'trucouruguayo.uy',pathname:'/'}}),null);
});
test('A device reporting twice within seconds is one visit, and a device seen today is not a new visitor',()=>{
 const {dedupeVisit,rememberDevice}=require('../functions/visit-service.cjs');
 const seen=new Map(),key='1.2.3.4|app-android|Android 11|OnePlus8Pro|App',day='2026-10-24',t=Date.parse('2026-10-24T12:00:00Z');
 assert.deepEqual(dedupeVisit({seen,key,day,page:'juego',now:t}),{duplicateOf:null,known:false});
 rememberDevice({seen,key,day,page:'juego',now:t,id:'-A'});
 assert.deepEqual(dedupeVisit({seen,key,day,page:'juego',now:t+11000}),{duplicateOf:'-A'});
 assert.deepEqual(dedupeVisit({seen,key,day,page:'juego',now:t+56000}),{duplicateOf:null,known:true});
 assert.deepEqual(dedupeVisit({seen,key,day,page:'anotador',now:t+5000}),{duplicateOf:null,known:true});
 assert.equal(dedupeVisit({seen,key:'other',day,page:'juego',now:t+1000}).known,false);
 assert.equal(dedupeVisit({seen,key,day:'2026-10-25',page:'juego',now:t+5000}).known,false);
});
test('The visitors of one hour of the day are those whose visit started then (Uruguay time)',()=>{
 const {visitRange,visitorsInRange}=require('../functions/visit-service.cjs');
 const now=Date.parse('2026-10-24T15:00:00Z');
 assert.equal(visitRange({from:'2026-10-20',to:'2026-10-24',platform:'all',hour:9,now}).hour,9);
 assert.throws(()=>visitRange({from:'2026-10-20',to:'2026-10-24',platform:'all',hour:24,now}));
 const at9=Date.parse('2026-10-23T12:10:00Z'),at10=Date.parse('2026-10-23T13:10:00Z');
 const log={'2026-10-23':{a:{at:at9,platform:'web-ios',page:'juego',uid:'u1'},b:{at:at10,platform:'web-ios',page:'juego',uid:'u2'}}};
 const nine=visitorsInRange({log,activity:{'2026-10-23':{platforms:{u2:{'web-ios':true}}}},platform:'all',hour:9});
 assert.deepEqual(nine.visits.map(v=>v.uid),['u1']);assert.deepEqual(nine.players.map(p=>p.uid),['u1']);
});
