'use strict';
const assert=require('node:assert/strict');
if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST||!String(process.env.GCLOUD_PROJECT).startsWith('demo-'))throw new Error('Requires isolated demo RTDB emulator.');
// The Admin WebSocket implementation ignores NO_PROXY. These tests only connect
// to the loopback demo emulator, so do not send that connection through a proxy.
delete process.env.HTTP_PROXY;delete process.env.http_proxy;
const deadline=setTimeout(()=>{console.error('Emulator integration timed out');process.exit(1);},45000);
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:process.env.GCLOUD_PROJECT,databaseURL:'https://'+process.env.GCLOUD_PROJECT+'-default-rtdb.firebaseio.com'});
const functions=require('../functions/index.cjs'),serverRequire=require('node:module').createRequire(require('node:path').join(__dirname,'../functions/package.json')),{getDatabase}=serverRequire('firebase-admin/database');
const db=getDatabase();

const request=(uid,data)=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'}}},data});
const call=(name,uid,data)=>functions[name].run(request(uid,data));
let seq=0;
(async()=>{
 console.log('Checking callable server against the local emulator…');
 const ping=await fetch('http://'+process.env.FIREBASE_DATABASE_EMULATOR_HOST+'/.json?ns='+process.env.GCLOUD_PROJECT+'-default-rtdb',{headers:{Authorization:'Bearer owner'}});assert.equal(ping.status,200);console.log('Local REST connection ready');
 await db.ref().set({profiles:{a:{name:'Mati'},b:{name:'Ricky'},c:{name:'Nico'}},creditEconomy:{wallets:{a:{balance:20,locked:0,lastGrantAt:1},b:{balance:20,locked:0,lastGrantAt:1},c:{balance:20,locked:0,lastGrantAt:1}}}});
 await assert.rejects(()=>functions.creditCreateTable.run({data:{stake:2}}),/Iniciá sesión/);
 const created=await call('creditCreateTable','a',{stake:3,targetPoints:10,visibility:'password',password:'clave-de-prueba'});
 assert.equal(created.room.creditMatch.stake,3);assert.equal(created.room.creditMatch.hasPassword,true);
 await assert.rejects(()=>call('creditJoinTable','b',{code:created.code,password:'wrong'}),/clave/);
 const races=await Promise.allSettled(['b','c'].map(uid=>call('creditJoinTable',uid,{code:created.code,password:'clave-de-prueba'})));
 assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
 const joined=races.find(x=>x.status==='fulfilled').value,peer=joined.player2,code=created.code,id=joined.room.creditMatch.id;
 const action=(uid,command)=>call('creditTableAction',uid,{code,command,expectedMatchId:id,requestId:'e2e-'+(++seq)});
 await action('a',{kind:'draw'});await action(peer,{kind:'draw'});
 await db.ref('creditEconomy/matches/'+id+'/session/room/openingDraw').update({'cards/player1/rank':1,'cards/player2/rank':7,resolveAt:Date.now()-1});
 await action('a',{kind:'tick'});
 for(let n=0;n<10;n++){
  await action(peer,{kind:'fold'});
  await db.ref('creditEconomy/matches/'+id+'/session/room/pendingNextHand/endsAt').set(Date.now()-1);
  await action('a',{kind:'tick'});
  let room=(await db.ref('rooms/'+code+'/public').get()).val();
  if(room.status==='revealing'){await db.ref('creditEconomy/matches/'+id+'/session/room/endReveal/endsAt').set(Date.now()-1);await action('a',{kind:'tick'});}
 }
 const ledger=(await db.ref('creditEconomy').get()).val();assert.equal(ledger.matches[id].status,'settled');assert.equal(ledger.wallets.a.balance,23);assert.equal(ledger.wallets[peer].balance,17);assert.equal(ledger.wallets.a.locked,0);
 await action('a',{kind:'tick'});assert.equal((await db.ref('creditEconomy/wallets/a/balance').get()).val(),23);
 await action('a',{kind:'rematch',value:'request'});await action(peer,{kind:'rematch',value:'accept'});
 const rematch=(await db.ref('rooms/'+code+'/public').get()).val();assert.notEqual(rematch.creditMatch.id,id);assert.equal(rematch.matchNumber,2);assert.equal(rematch.status,'drawing');
 const privateHand=(await db.ref('hands/'+code+'/a').get()).val();assert.equal(privateHand.creditMatchId,rematch.creditMatch.id);
 assert.equal((await db.ref('creditEconomy/wallets/a').get()).val().balance,20);
 console.log('Firebase Admin/emulator: callable authentication, password, concurrent joins, complete match payout, retries, private projections and rematch passed.');
 await db.ref().set(null);process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
