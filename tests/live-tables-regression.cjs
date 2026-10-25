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
test('Browser modules for live tables and credits parse as ES modules',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const file of ['live-tables.js','credits.js']){
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.ok(Object.keys(module).length>0,file);
 }
 const {createLiveTables}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../live-tables.js'),'utf8')).toString('base64'));
 const api=createLiveTables({url:'http://127.0.0.1:1',token:async()=>'x'});
 for(const name of ['watchTable','readTable','call','watchLobby','creditsBackend'])assert.equal(typeof api[name],'function',name);
 for(const name of ['watch','get','claim'])assert.equal(typeof api.wallet[name],'function',name);
});
test('Leaving a table ends its pending calls quietly, not as a lost connection',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sockets=[];
 class FakeSocket{constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}send(m){this.sent.push(m);}close(){this.readyState=3;setTimeout(()=>this.onclose?.(),5);}}
 const previous=globalThis.WebSocket;globalThis.WebSocket=FakeSocket;
 try{
  const {createLiveTables}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../live-tables.js'),'utf8')).toString('base64')+'#close');
  const api=createLiveTables({url:'http://127.0.0.1:1',token:async()=>'x'});
  const pending=api.call('ABCDE','act',{command:{kind:'cancel'}});
  api.closeTable('ABCDE');
  await assert.rejects(pending,error=>error.code==='closed');
  await new Promise(r=>setTimeout(r,20));
 }finally{globalThis.WebSocket=previous;}
});
