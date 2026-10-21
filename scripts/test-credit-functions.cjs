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
 await assert.rejects(()=>call('creditTableAction',peer==='b'?'c':'b',{code,command:{kind:'tick'},requestId:'outsider-tick',expectedMatchId:id}),/No pertenecés/);
 const action=(uid,command)=>call('creditTableAction',uid,{code,command,expectedMatchId:id,requestId:'e2e-'+(++seq)});
 assert.equal(joined.room.status,'started');assert.equal(joined.room.openingDraw,null);
 assert.equal(joined.privateHand.hand.length,3);
 for(let n=0;n<10&&(await db.ref('creditEconomy/matches/'+id+'/status').get()).val()!=='settled';n++){
  await action(peer,{kind:'fold'});
  await db.ref('creditEconomy/matches/'+id+'/session/room/pendingNextHand/endsAt').set(Date.now()-1);
  await action('a',{kind:'tick'});
  let room=(await db.ref('rooms/'+code+'/public').get()).val();
  if(room.status==='revealing'){await db.ref('creditEconomy/matches/'+id+'/session/room/endReveal/endsAt').set(Date.now()-1);await action('a',{kind:'tick'});}
 }
 const ledger=(await db.ref('creditEconomy').get()).val();assert.equal(ledger.matches[id].status,'settled');assert.equal(ledger.wallets.a.balance,23);assert.equal(ledger.wallets[peer].balance,17);assert.equal(ledger.wallets.a.locked,0);
 await action('a',{kind:'tick'});assert.equal((await db.ref('creditEconomy/wallets/a/balance').get()).val(),23);
 await action('a',{kind:'rematch',value:'request'});await action(peer,{kind:'rematch',value:'accept'});
 const rematch=(await db.ref('rooms/'+code+'/public').get()).val();assert.notEqual(rematch.creditMatch.id,id);assert.equal(rematch.matchNumber,2);assert.equal(rematch.status,'started');
 const privateHand=(await db.ref('hands/'+code+'/a').get()).val();assert.equal(privateHand.creditMatchId,rematch.creditMatch.id);
 assert.equal((await db.ref('creditEconomy/wallets/a').get()).val().balance,20);
 console.log('Firebase Admin/emulator: callable authentication, password, concurrent joins, complete match payout, retries, private projections and rematch passed.');
 // Exercise the real callable and root cleanup with local RTDB. Auth deletion
 // is a fixture: no Google Auth service, real users or production credentials.
 const auth=serverRequire('firebase-admin/auth').getAuth(),oldGet=auth.getUser,oldDelete=auth.deleteUser;
 let deletionAttempts=0;
 auth.getUser=async uid=>({uid,disabled:false});
 auth.deleteUser=async uid=>{assert.equal(uid,'victim');deletionAttempts++;if(deletionAttempts===1)throw Error('Simulated Auth outage');};
 try{
  await db.ref().set({administrators:{admin:true},profiles:{victim:{name:'Victim'},other:{name:'Other'}},usernames:{victim:'victim'},userBlocks:{victim:{other:true},other:{victim:true}},problemReports:{own:{uid:'victim',message:'personal'}},creditEconomy:{wallets:{victim:{balance:2,locked:0},other:{balance:4,locked:0}},matches:{past:{player1:'victim',player2:'other',status:'settled'}}}});
  const request={action:'delete',uid:'victim',requestId:'privacy-e2e',confirmName:'Victim',reason:'Solicitud verificada de prueba'};
  await assert.rejects(()=>call('adminConsole','admin',request),/en proceso/);
  const pending=(await db.ref().get()).val();assert.ok(pending.accountDeletionJobs.victim);
  assert.equal(pending.profiles?.victim,undefined);assert.equal(pending.userBlocks?.victim,undefined);
  const anonymousId=pending.accountDeletionJobs.victim.anonymousId;
  assert.equal(pending.creditEconomy.matches.past.player1,anonymousId);
  assert.equal((await call('adminConsole','admin',request)).ok,true);
  assert.equal((await db.ref('accountDeletionJobs/victim').get()).exists(),false);
  assert.equal((await db.ref('creditEconomy/wallets/other/balance').get()).val(),4);
  await call('adminConsole','admin',request);assert.equal(deletionAttempts,2,'finished retry never deletes twice');
  console.log('Firebase Admin/emulator: administrator privacy deletion, Auth failure recovery, anonymous history and idempotent retries passed (Auth mocked).');
 }finally{auth.getUser=oldGet;auth.deleteUser=oldDelete;}
 await db.ref().set(null);process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
