'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tableDailyStats}=require('../functions/table-stats.cjs');
const DAY=86400000,now=Date.UTC(2026,10,13,15),dayOf=at=>new Date(at-3*3600000).toISOString().slice(0,10);

test('Admin table charts: tables created by players, games finished between players and against the house, per Uruguay day',()=>{
 const today=dayOf(now),yesterday=dayOf(now-DAY);
 const ledger={matches:{
  a:{createdAt:now-DAY,status:'settled',settledAt:now,matchNumber:1,players:{player1:{uid:'u1'},player2:{uid:'u2'}}},
  b:{createdAt:now,status:'settled',settledAt:now,matchNumber:2,players:{player1:{uid:'u1'},player2:{uid:'u2'}}},     // rematch: finished, not created
  c:{createdAt:now,status:'refunded',matchNumber:1,players:{player1:{uid:'u3'}}},                                      // created, never played
  d:{createdAt:now,status:'settled',settledAt:now,matchNumber:1,house:'player1',players:{player1:{uid:'house_x'},player2:{uid:'u4'}}},
  e:{createdAt:now-40*DAY,status:'settled',settledAt:now-40*DAY,matchNumber:1,players:{}}                                // older than 30 days
 }};
 const s=tableDailyStats(ledger,{now,dayOf});
 assert.equal(s.days.length,30);assert.equal(s.days.at(-1),today);
 assert.equal(s.created[yesterday],1);assert.equal(s.created[today],1);
 assert.equal(s.vsPlayers[today],2);assert.equal(s.vsHouse[today],1);
 assert.equal(Object.values(s.created).reduce((a,b)=>a+b,0),2);
});
