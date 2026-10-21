'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {closeLiveTable}=require('../functions/live-server.cjs');
const {reservationAlerts,repairReservation}=require('../functions/player-service.cjs');

const response=(status,body)=>({ok:status<300,status,json:async()=>body});
test('Admin close reaches the live table server with the internal secret',async()=>{
 let seen;
 const outcome=await closeLiveTable({code:'ABCDE',actor:'adm',requestId:'r1',reason:'Prueba',secret:'s3cret',fetchImpl:async(url,init)=>{seen={url,init};return response(200,{ok:true});}});
 assert.deepEqual(outcome,{closed:true});
 assert.match(seen.url,/\/internal\/tables\/ABCDE\/admin-close$/);
 assert.equal(seen.init.headers['x-internal-secret'],'s3cret');
 assert.deepEqual(JSON.parse(seen.init.body),{actor:'adm',requestId:'r1',reason:'Prueba'});
});
test('A table the server no longer holds falls back to closing the ledger directly',async()=>{
 assert.deepEqual(await closeLiveTable({code:'ABCDE',secret:'x',fetchImpl:async()=>response(409,{ok:false,error:'La mesa ya no está disponible.'})}),{missing:true});
 await assert.rejects(closeLiveTable({code:'ABCDE',secret:'x',fetchImpl:async()=>response(401,{})}),/servidor de mesas/);
});
test('Live matches are never ticked from the ledger copy by repairs',()=>{
 const ledger={wallets:{a:{balance:0,locked:5}},tables:{ABCDE:'m1'},matches:{m1:{id:'m1',code:'ABCDE',live:'cloudflare',status:'waiting',stake:5,createdAt:0,player1:'a',players:{player1:{uid:'a',name:'A'}}}}};
 const alerts=reservationAlerts(ledger,700000);
 assert.equal(alerts.length,1);assert.equal(alerts[0].repairable,false);
 assert.throws(()=>repairReservation(ledger,{uid:'a',now:700000}),/automáticamente/);
 assert.deepEqual(reservationAlerts(ledger,1000),[]);
});
