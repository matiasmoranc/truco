const {test}=require('node:test');const assert=require('node:assert/strict');
const {uruguayDate,activityUpdates,activitySummary}=require('../functions/activity-service.cjs');
test('Daily and hourly buckets follow Uruguay midnight instead of UTC',()=>{
 assert.deepEqual(uruguayDate(Date.parse('2026-10-10T02:59:59Z')),{day:'2026-10-09',hour:'23'});
 assert.deepEqual(uruguayDate(Date.parse('2026-10-10T03:00:00Z')),{day:'2026-10-10',hour:'00'});
});
test('Heartbeats set unique membership instead of incrementing visit counters',()=>{
 const now=Date.parse('2026-10-10T15:00:00Z'),updates=activityUpdates({uid:'a',sessionId:'session1',visible:true,now});
 assert.equal(updates['days/2026-10-10/users/a'],true);assert.equal(updates['days/2026-10-10/hours/12/a'],true);
 assert.deepEqual(updates,activityUpdates({uid:'a',sessionId:'session1',visible:true,now}));
 assert.deepEqual(activityUpdates({uid:'a',sessionId:'session1',visible:false,now}),{'presence/a/session1':null});
});
test('Active users count once across tabs, and exclude expired or deleted accounts',()=>{
 const now=Date.parse('2026-10-10T15:00:00Z');const metrics={presence:{a:{tab1:{at:now},tab2:{at:now-60000}},b:{tab1:{at:now-90000}},deleted:{tab1:{at:now}}},days:{'2026-10-10':{users:{a:true,b:true},hours:{'12':{a:true}}}}};
 const result=activitySummary({metrics,registeredUids:['a','b'],now});assert.equal(result.total,2);assert.equal(result.active,1);assert.deepEqual(result.online,['a']);assert.equal(result.todayUsers,2);assert.equal(result.days[0].hours[12].users,1);
});
test('Malformed sessions cannot write arbitrary metric paths',()=>{
 for(const sessionId of ['../user','a/b','__proto__',''])assert.throws(()=>activityUpdates({uid:'a',sessionId,visible:true,now:100}));
 assert.throws(()=>activityUpdates({uid:'a',sessionId:'valid',visible:'true',now:100}));
});

test('Admin activity filters return sorted unique IDs for current Uruguay day and active sessions',()=>{
 const {activityUserIds}=require('../functions/activity-service.cjs');
 const now=Date.parse('2026-10-10T02:59:59Z');
 const metrics={presence:{b:{a:{at:now-90000}},a:{a:{at:now},b:{at:now}},future:{a:{at:now+1}}},days:{'2026-10-09':{users:{b:true,a:true}},'2026-10-10':{users:{other:true}}}};
 assert.deepEqual(activityUserIds({scope:'active',metrics,now}),['a']);
 assert.deepEqual(activityUserIds({scope:'today',metrics,now}),['a','b']);
 assert.deepEqual(activityUserIds({scope:'today',metrics:{},now}),[]);
 assert.throws(()=>activityUserIds({scope:'invalid',metrics,now}));
});

test('Admin knows the device each player used last, also from activity before it was stored',()=>{
 const {activityUpdates,lastPlatforms}=require('../functions/activity-service.cjs');
 const now=Date.UTC(2026,10,14,20);
 const u=activityUpdates({uid:'u1',sessionId:'s1',visible:true,platform:'app-android',now});
 require('node:assert/strict').deepEqual(u['lastPlatform/u1'],{platform:'app-android',at:now});
 require('node:assert/strict').equal(activityUpdates({uid:'u1',sessionId:'s1',visible:false,platform:'app-ios',now})['lastPlatform/u1'],undefined);
 const found=lastPlatforms({stored:{u1:{platform:'app-android',at:now}},days:{'2026-11-10':{u2:{'web-desktop':true}},'2026-11-12':{u1:{'web-ios':true},u2:{'app-ios':true}}},uids:['u1','u2','u3']});
 require('node:assert/strict').deepEqual(found,{u1:{platform:'app-android',at:now},u2:{platform:'app-ios',at:null,day:'2026-11-12'}});
});
