'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {sessionUpdates,sessionSummary,retentionSummary}=require('../functions/session-service.cjs');
const inc=n=>({inc:n});

test('A session tick is filed under the day it started, with the area that was open',()=>{
 const start=Date.UTC(2026,10,15,2,59);// 23:59 of the 14th in Uruguay
 const sid=start.toString(36)+'-abcd1234';
 const u=sessionUpdates({sid,platform:'web-desktop',page:'juego',area:'lobby',signed:true,seconds:30,now:start+10*60000,increment:inc});
 assert.deepEqual(u,{['2026-11-14/'+sid+'/p']:'web-desktop',['2026-11-14/'+sid+'/g']:'juego',['2026-11-14/'+sid+'/at']:start,['2026-11-14/'+sid+'/s']:true,['2026-11-14/'+sid+'/t']:{inc:30},['2026-11-14/'+sid+'/a/lobby']:{inc:30}});
 const first=sessionUpdates({sid,platform:'app-ios',page:'juego',area:'inicio',signed:false,seconds:0,now:start,increment:inc});
 assert.equal(first['2026-11-14/'+sid+'/t'],undefined);assert.equal(first['2026-11-14/'+sid+'/s'],undefined);
 for(const bad of [{seconds:45},{area:'casino'},{platform:'x'},{sid:'nope'},{sid:(start+3600000).toString(36)+'-abcd1234'},{now:start+13*3600000}])
  assert.throws(()=>sessionUpdates({sid,platform:'web-desktop',page:'juego',area:'lobby',signed:true,seconds:30,now:start+60000,increment:inc,...bad}));
});

test('Time summary: visits, average, length groups, devices, areas and accounts',()=>{
 const stored={'2026-11-14':{a:{p:'web-desktop',g:'juego',t:30,a:{lobby:30}},b:{p:'app-android',g:'juego',s:true,t:600,a:{partida:500,lobby:100}},c:{p:'app-android',g:'anotador'}},'2026-11-15':{d:{p:'web-ios',g:'juego',s:true,t:2400,a:{bot:2400}}}};
 const s=sessionSummary(stored,'2026-11-14','2026-11-15');
 assert.equal(s.sessions,4);assert.equal(s.seconds,3030);assert.equal(s.average,758);
 assert.deepEqual(s.daily['2026-11-14'],{sessions:3,seconds:630,average:210});
 assert.deepEqual(s.buckets.map(b=>b.count),[2,0,1,0,1]);
 assert.deepEqual(s.platforms['app-android'],{n:2,t:600});assert.equal(s.areas.partida,500);assert.equal(s.areas.bot,2400);
 assert.deepEqual(s.accounts,{signed:{n:2,t:3000},guest:{n:2,t:30}});assert.equal(s.pages.anotador.n,1);
});

test('Retention: new players by first day, back the next day, within a week and a month; test accounts left out',()=>{
 const days={'2026-11-01':{users:{old:true}},'2026-11-02':{users:{old:true,ana:true,beto:true,test:true}},'2026-11-03':{users:{ana:true}},'2026-11-07':{users:{beto:true}},'2026-11-20':{users:{}}};
 const r=retentionSummary(days,{today:'2026-11-15',exclude:new Set(['test'])});
 assert.deepEqual(r.cohorts,[{day:'2026-11-02',size:2,d1:1,d7:2}]);
 assert.deepEqual(r.totals.d1,{size:2,back:1});assert.deepEqual(r.totals.d7,{size:2,back:2});assert.deepEqual(r.totals.d30,{size:0,back:0});
});

test('The session clock counts only time on screen, 30 seconds at a time',async()=>{
 const {startSessionClock}=await import('data:text/javascript;base64,'+Buffer.from(require('node:fs').readFileSync(require('node:path').join(__dirname,'../visit.js'),'utf8')).toString('base64'));
 const sent=[];let t=1000000,state='visible';const doc={get visibilityState(){return state;},addEventListener(){}};
 const clock=startSessionClock({fetch:(url,o)=>{sent.push(JSON.parse(o.body).data);return Promise.resolve();},platform:'web-desktop',page:'juego',doc,now:()=>t,every:5000});
 clock.stop();
 assert.equal(sent[0].seconds,0);assert.equal(sent[0].area,'inicio');
 for(let i=0;i<6;i++){t+=5000;clock.check();}assert.equal(sent.length,2);assert.equal(sent[1].seconds,30);
 state='hidden';for(let i=0;i<20;i++){t+=5000;clock.check();}assert.equal(sent.length,2);
});
