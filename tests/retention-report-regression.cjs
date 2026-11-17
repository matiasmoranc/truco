'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {report,finishedGames,groupsOf,cleanRange}=require('../functions/retention-report.cjs');
const at=(day,hour=12)=>Date.parse(day+'T00:00:00Z')+(hour+3)*3600000; // Uruguay time
const match=(day,uids,extra={})=>({status:'settled',settledAt:at(day),players:Object.fromEntries(uids.map((uid,i)=>[i,{uid}])),...extra});

test('A game counts once per match, for its real players; bots, house players and test accounts are left out',()=>{
 const games=finishedGames({a:match('2026-11-10',['ana','beto']),b:match('2026-11-10',['ana','house_1']),c:match('2026-11-11',['bot:1','test']),
  d:{...match('2026-11-11',['ana']),status:'refunded'},e:match('2026-11-12',['ana','ana'])},new Set(['test']));
 assert.deepEqual(games,[{day:'2026-11-10',uids:['ana','beto'],house:false},{day:'2026-11-10',uids:['ana'],house:true},{day:'2026-11-12',uids:['ana'],house:false}]);
 // 23:30 in Uruguay is still that day.
 assert.equal(finishedGames({a:{...match('2026-11-10',['x']),settledAt:at('2026-11-10',23.5)}})[0].day,'2026-11-10');
});

test('Players of a period: who played, how many games, new accounts that played, and who kept playing from the period before',()=>{
 const accounts=[{uid:'ana',at:at('2026-10-01')},{uid:'beto',at:at('2026-10-01')},{uid:'caro',at:at('2026-11-12')},{uid:'dani',at:at('2026-11-13')},{uid:'test',at:at('2026-10-01')}];
 const games=finishedGames({
  p1:match('2026-11-05',['ana','beto']),p2:match('2026-11-06',['beto']),
  a1:match('2026-11-10',['ana','house_1']),a2:match('2026-11-12',['ana','caro']),a3:match('2026-11-12',['ana']),t:match('2026-11-12',['test'])
 },new Set(['test']));
 const entered={'2026-11-11':['ana','beto','dani'],'2026-11-12':['caro','test']};
 const r=report({accounts,games,entered,entryFrom:'2026-11-01',today:'2026-11-16',from:'2026-11-10',to:'2026-11-16',compareFrom:'2026-11-03',compareTo:'2026-11-09',exclude:new Set(['test'])});
 const m=r.main;
 assert.equal(m.registered,4);assert.equal(m.newAccounts,2);assert.equal(m.newPlayed,1);
 assert.equal(m.players,2);assert.equal(m.plays,4);assert.deepEqual(m.histogram,{1:1,3:1});
 assert.deepEqual([m.games,m.vsPeople,m.vsBots],[3,2,1]);
 assert.equal(m.severalDays,1); // ana on the 10th and the 12th
 assert.deepEqual(m.previous,{from:'2026-11-03',to:'2026-11-09',players:2,kept:1});
 assert.deepEqual(m.entry,{entered:4,withoutPlaying:2,partial:false}); // beto and dani came in without playing
 assert.deepEqual(m.top.map(p=>[p.uid,p.games,p.days,p.last]),[['ana',3,2,'2026-11-12'],['caro',1,1,'2026-11-12']]);
 assert.deepEqual(m.stopped,[{uid:'beto',games:2,last:'2026-11-06'}]);
 assert.equal(m.series.length,7);assert.deepEqual(m.series.find(s=>s.from==='2026-11-12'),{from:'2026-11-12',to:'2026-11-12',histogram:{1:1,2:1},games:2,newAccounts:1});
 // The comparison only knows the accounts that existed then.
 assert.deepEqual([r.compare.registered,r.compare.players,r.compare.games],[2,2,2]);
 assert.equal(r.compare.top,undefined);
});

test('Sign-up groups: the share that played in each week after signing up, only for weeks that started',()=>{
 const accounts=[{uid:'a',at:at('2026-11-02')},{uid:'b',at:at('2026-11-04')},{uid:'c',at:at('2026-11-10')}];
 const games=finishedGames({x:match('2026-11-03',['a']),y:match('2026-11-13',['b']),z:match('2026-11-14',['a'])});
 const r=report({accounts,games,today:'2026-11-16',from:'2026-11-02',to:'2026-11-16',group:'week'});
 const [w2,w1]=r.cohorts.rows;
 assert.deepEqual([w1.from,w1.size],['2026-11-02',2]);
 // Week 1 after sign-up: a played (3rd); b did not (4th-10th). Week 2: a (14th, in 9th-15th), b (13th, in 11th-17th, still going). Week 3 started only for a (16th).
 assert.deepEqual(w1.cells,[{players:2,played:1,complete:true},{players:2,played:2,complete:false},{players:1,played:0,complete:false}]);
 // c signed up on the 10th: its first week ends today, so it is still going.
 assert.deepEqual(w2.cells,[{players:1,played:0,complete:false}]);
});

test('Chart groups follow weeks from Monday and calendar months, cut to the range; ranges are checked',()=>{
 assert.deepEqual(groupsOf('2026-11-12','2026-11-25','week'),[{from:'2026-11-12',to:'2026-11-15'},{from:'2026-11-16',to:'2026-11-22'},{from:'2026-11-23',to:'2026-11-25'}]);
 assert.deepEqual(groupsOf('2026-01-20','2026-03-05','month').map(g=>g.to),['2026-01-31','2026-02-28','2026-03-05']);
 assert.equal(groupsOf('2026-11-01','2026-11-30','day').length,30);
 assert.deepEqual(cleanRange('2026-11-01','2026-12-31','2026-11-16'),{from:'2026-11-01',to:'2026-11-16'});
 assert.equal(cleanRange('2026-11-10','2026-11-01','2026-11-16'),null);
 assert.equal(cleanRange('2026-02-30','2026-03-01','2026-11-16'),null);
 assert.equal(cleanRange('2020-01-01','2026-11-16','2026-11-16'),null);
});
