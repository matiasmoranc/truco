const {test}=require('node:test');const assert=require('node:assert/strict');
const {moveVisitsUpdates,mergeVisitCounters,withoutTestActivity}=require('../functions/test-data.cjs');
const {visitorsInRange,visitRecord}=require('../functions/visit-service.cjs');
const increment=n=>({inc:n});
test('Marking test visits moves their counters, adding up visits that share one',()=>{
 const at=Date.parse('2026-10-24T15:00:00Z');
 const updates=moveVisitsUpdates([{at,platform:'web-ios',page:'juego',first:true},{at,platform:'web-ios',page:'juego',first:false}],true,increment);
 assert.deepEqual(updates['visits/2026-10-24/visits/web-ios'],{inc:-2});assert.deepEqual(updates['visitsTest/2026-10-24/visits/web-ios'],{inc:2});
 assert.deepEqual(updates['visits/2026-10-24/visitors/web-ios'],{inc:-1});assert.deepEqual(updates['visitsTest/2026-10-24/hours/12'],{inc:2});
 assert.deepEqual(moveVisitsUpdates([{at,platform:'web-ios',page:'juego',first:false}],false,increment)['visits/2026-10-24/pages/juego'],{inc:1});
});
test('Including test data adds both counters; hiding it drops test accounts from activity',()=>{
 const merged=mergeVisitCounters({'2026-10-24':{visits:{'web-ios':3},pages:{juego:3}}},{'2026-10-24':{visits:{'web-ios':2,'app-ios':1}},'2026-10-23':{visitors:{'web-ios':1}}});
 assert.deepEqual(merged['2026-10-24'].visits,{'web-ios':5,'app-ios':1});assert.deepEqual(merged['2026-10-23'].visitors,{'web-ios':1});
 const clean=withoutTestActivity({days:{'2026-10-24':{users:{me:true,a:true},hours:{'12':{me:true}},platforms:{me:{'web-ios':true}}}},presence:{me:{s:{at:1}},a:{s:{at:1}}}},new Set(['me']));
 assert.deepEqual(Object.keys(clean.days['2026-10-24'].users),['a']);assert.deepEqual(clean.days['2026-10-24'].hours['12'],{});assert.deepEqual(Object.keys(clean.presence),['a']);
});
test('The visitors list leaves out test accounts and test devices only when asked',()=>{
 const at=Date.parse('2026-10-24T15:00:00Z');
 const log={'2026-10-24':{a:{at,platform:'web-ios',page:'juego',uid:'me'},b:{at,platform:'web-ios',page:'juego',test:true},c:{at,platform:'web-ios',page:'juego'}}};
 const activity={'2026-10-24':{platforms:{me:{'web-ios':true},x:{'web-ios':true}}}};
 const hidden=visitorsInRange({log,activity,platform:'all',exclude:new Set(['me'])});
 assert.equal(hidden.totalVisits,1);assert.deepEqual(hidden.players.map(p=>p.uid),['x']);
 assert.equal(visitorsInRange({log,activity,platform:'all'}).totalVisits,3);
 assert.equal(visitRecord({platform:'web-ios',page:'juego',first:true,now:1,test:true}).test,true);
 assert.equal(visitRecord({platform:'web-ios',page:'juego',first:true,now:1,test:'yes'}).test,undefined);
});
