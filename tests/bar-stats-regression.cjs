// The Lobby Virtual in the admin panel: people per day and hour, and tables opened from it (via 'bar').
const test=require('node:test'),assert=require('node:assert/strict');
const {barVisitStats,tablesByOrigin}=require('../functions/bar-stats.cjs');
const {createTable,joinTable}=require('../functions/table-service.cjs');

test('BAR visits: each person once per day, by hour of the chosen day, test users left out',()=>{
 const visits={'2026-11-20':{a:{name:'Ana',h10:true,last:5}},'2026-11-21':{a:{name:'Ana',h10:true,h14:true,last:9},b:{name:'Beto',h14:true,last:7},t:{name:'Test',h14:true}}};
 const r=barVisitStats(visits,{days:['2026-11-20','2026-11-21'],day:'2026-11-21',exclude:new Set(['t'])});
 assert.deepEqual(r.perDay,{'2026-11-20':1,'2026-11-21':2});
 assert.equal(r.perHour[10],1);assert.equal(r.perHour[14],2);assert.equal(r.perHour[9],0);
 assert.deepEqual(r.people.map(p=>[p.name,p.hours]),[['Ana',[10,14]],['Beto',[14]]]);
});

test('Tables remember the Lobby Virtual: created there, a house table taken there, rematches keep it',()=>{
 const now=Date.parse('2026-11-21T15:00:00Z');
 let ledger=createTable({wallets:{}},{code:'ABCDE',id:'m1',uid:'u1',name:'Ana',stake:0,targetPoints:20,via:'bar',now});
 assert.equal(ledger.matches.m1.via,'bar');
 ledger=createTable(ledger,{code:'FGHJK',id:'m2',uid:'u2',name:'Beto',stake:0,targetPoints:20,now});
 assert.equal(ledger.matches.m2.via,undefined);
 ledger=createTable(ledger,{code:'LMNPQ',id:'m3',uid:'house_x',name:'Bot X',stake:0,targetPoints:20,house:true,now});
 ledger=joinTable(ledger,{code:'LMNPQ',uid:'u3',name:'Caro',via:'bar',now:now+1000});
 assert.equal(ledger.matches.m3.via,'bar');
 // Settled: one game against people from the lobby, one against the house from the Lobby Virtual.
 ledger.matches.m2.status='settled';ledger.matches.m2.settledAt=now;ledger.matches.m3.status='settled';ledger.matches.m3.settledAt=now;
 const dayOf=at=>new Date(at-3*3600000).toISOString().slice(0,10),day=dayOf(now);
 const r=tablesByOrigin(ledger,{days:[day],dayOf});
 assert.deepEqual(r.created[day],{lobby:1,bar:1});
 assert.deepEqual(r.vsPlayers[day],{lobby:1,bar:0});
 assert.deepEqual(r.vsHouse[day],{lobby:0,bar:1});
});
