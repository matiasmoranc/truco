'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tablePlayerStats}=require('../functions/table-stats.cjs');
const dayOf=at=>new Date(at-10800000).toISOString().slice(0,10);
const T=Date.parse('2026-11-10T15:00:00Z'),D=86400000;
const p=(...uids)=>Object.fromEntries(uids.map((uid,i)=>['player'+(i+1),{uid,name:uid}]));

test('Each person counts once a day, whether they played or finished one table or several',()=>{
 const ledger={matches:{
  a:{players:p('ana','beto'),startedAt:T,status:'settled',settledAt:T+600000},
  b:{players:p('ana','house_1'),startedAt:T+3600000,status:'settled',settledAt:T+4000000,house:true},
  c:{players:p('beto','caro'),startedAt:T+D,status:'reserved'},
  d:{players:p('dani','beto'),status:'waiting',createdAt:T},
  e:{players:p('caro','bot:x'),startedAt:T+D,status:'settled',settledAt:T+2*D}
 }};
 const {played,finished}=tablePlayerStats(ledger,{dayOf});
 assert.deepEqual(played,{'2026-11-10':2,'2026-11-11':2});
 assert.deepEqual(finished,{'2026-11-10':2,'2026-11-12':1});
});

test('Test users are left out and old games without startedAt use the day they were created',()=>{
 const ledger={matches:{a:{players:p('ana','test1'),createdAt:T,status:'settled',settledAt:T+D}}};
 const {played,finished}=tablePlayerStats(ledger,{dayOf,exclude:new Set(['test1'])});
 assert.deepEqual(played,{'2026-11-10':1});assert.deepEqual(finished,{'2026-11-11':1});
});
