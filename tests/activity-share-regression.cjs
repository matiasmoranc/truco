'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {activityShare,periodsFor}=require('../functions/activity-share.cjs');
const at=(day,hour=12)=>Date.parse(day+'T00:00:00Z')+(hour+3)*3600000; // Uruguay time

test('Each period counts the players registered by its end, not today, and how many times they came in',()=>{
 const signups=[{uid:'a',at:at('2026-11-10')},{uid:'b',at:at('2026-11-14')},{uid:'c',at:at('2026-11-15',23)},{uid:'t',at:at('2026-11-01')}];
 const log={'2026-11-14':{1:{uid:'a',at:0},2:{uid:'a',at:0},3:{uid:'b',at:0},4:{uid:'t',at:0},5:{at:0}},
  '2026-11-15':{1:{uid:'a',at:0},2:{uid:'c',at:0},3:{uid:'c',at:0},4:{uid:'c',at:0},5:{uid:'b',at:0,test:true}}};
 const {periods}=activityShare({kind:'day',signups,log,today:'2026-11-16',exclude:new Set(['t'])});
 assert.equal(periods.length,30);
 const d14=periods.find(p=>p.from==='2026-11-14'),d15=periods.find(p=>p.from==='2026-11-15');
 assert.deepEqual([d14.registered,d14.histogram],[2,{1:1,2:1}]);
 // c signed up at 23:00 on the 15th: counted that day. b's test-device visit does not count.
 assert.deepEqual([d15.registered,d15.histogram],[3,{1:1,3:1}]);
 const week=activityShare({kind:'week',signups,log,today:'2026-11-16',exclude:new Set(['t'])}).periods;
 const last=week.at(-2); // Monday 9 to Sunday 15
 assert.deepEqual([last.from,last.to,last.registered,last.histogram],['2026-11-09','2026-11-15',3,{1:1,3:2}]);
 assert.equal(week.at(-1).current,true);
});

test('Weeks start on Monday and months are calendar months',()=>{
 assert.deepEqual(periodsFor('week','2026-11-16').at(-1),{from:'2026-11-16',to:'2026-11-22'});
 assert.deepEqual(periodsFor('month','2026-01-05').map(p=>p.from),['2025-11-01','2025-12-01','2026-01-01']);
 assert.equal(periodsFor('month','2026-02-10').at(-1).to,'2026-02-28');
});

test('Periods that ended before the first records are left out; the first one with records is partial',()=>{
 const {periods}=activityShare({kind:'week',signups:[],log:{},today:'2026-11-16',firstDay:'2026-10-24'});
 assert.equal(periods[0].from,'2026-10-19');assert.equal(periods[0].partial,true);assert.equal(periods[1].partial,false);
});
