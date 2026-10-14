const test=require('node:test'),assert=require('node:assert/strict');
const {prepareSelfDeletion,prepareAdminPrivacyDeletion,erasePlayerData}=require('../functions/self-deletion.cjs');
const root=()=>({profiles:{u:{name:'Mati'},r:{name:'Rival'}},usernames:{mati:'u',rival:'r'},userBlocks:{u:{r:true},r:{u:true}},creditEconomy:{wallets:{u:{balance:10,locked:0},r:{balance:5,locked:0}},matches:{m:{player1:'u',player2:'r',players:{player1:{uid:'u',name:'Mati'},player2:{uid:'r',name:'Rival'}},status:'settled'}}},problemReports:{report:{uid:'u',message:'personal'},other:{uid:'r',message:'other'}},rooms:{old:{public:{status:'closed',players:{player1:{uid:'u'}}}}},hands:{old:{u:{cards:[]}}},adminMetrics:{presence:{u:{}},days:{d:{users:{u:true,r:true}}}}});
test('Self deletion accepts own UID, including administrators, and locks writes',()=>{
 const r=root();r.administrators={u:true};const p=prepareSelfDeletion(r,{uid:'u',requestId:'req',now:1000});
 assert.equal(p.userAccess.u.blocked,true);assert.equal(p.creditEconomy.wallets.u.deleting,true);assert.equal(r.userAccess,undefined);
});
test('Reserved credits and active tables prevent account deletion',()=>{
 const r=root();r.creditEconomy.wallets.u.locked=1;assert.throws(()=>prepareSelfDeletion(r,{uid:'u',requestId:'req',now:1000}),/créditos/);
 r.creditEconomy.wallets.u.locked=0;r.rooms.old.public.status='started';assert.throws(()=>prepareSelfDeletion(r,{uid:'u',requestId:'req',now:1000}),/activa/);
});
test('Deletion removes personal records and preserves opponents and anonymized results',()=>{
 const r=prepareSelfDeletion(root(),{uid:'u',requestId:'req',now:1000});
 const n=erasePlayerData(r,{uid:'u',anonymousId:'deleted_random',now:2000});
 assert.equal(n.profiles.u,undefined);assert.equal(n.usernames.mati,undefined);assert.equal(n.userBlocks.u,undefined);assert.equal(n.userBlocks.r.u,undefined);assert.equal(n.problemReports.report,undefined);assert.equal(n.rooms.old,undefined);assert.equal(n.hands.old,undefined);assert.equal(n.adminMetrics.days.d.users.u,undefined);
 assert.deepEqual(n.profiles.r,{name:'Rival'});assert.equal(n.creditEconomy.wallets.r.balance,5);assert.equal(n.creditEconomy.wallets.u,undefined);assert.equal(n.creditEconomy.wallets.deleted_random.balance,0);
 assert.equal(n.creditEconomy.matches.m.player1,'deleted_random');assert.equal(n.creditEconomy.matches.m.players.player1.name,'Jugador eliminado');
 assert.deepEqual(erasePlayerData(n,{uid:'u',anonymousId:'deleted_random',now:2000}),n);
});

test('Administrator privacy deletion uses the same cleanup and queues recoverable completion',()=>{
 const original=root(),request={uid:'u',actor:'admin',requestId:'req',confirmName:'Mati',reason:'Solicitud verificada por soporte',now:1000,anonymousId:'deleted_fixture'};
 const prepared=prepareAdminPrivacyDeletion(original,request);
 assert.deepEqual(prepared.accountDeletionJobs.u,{anonymousId:'deleted_fixture',requestId:'req',at:1000});
 assert.equal(original.accountDeletionJobs,undefined);
 assert.deepEqual(prepareAdminPrivacyDeletion(prepared,{...request,anonymousId:'deleted_other'}),prepared);
 assert.throws(()=>prepareAdminPrivacyDeletion(prepared,{...request,requestId:'other'}),/otra eliminación/);
 const clean=erasePlayerData(prepared,{uid:'u',anonymousId:'deleted_fixture',now:2000});
 assert.equal(clean.userBlocks.u,undefined);assert.equal(clean.problemReports.report,undefined);
 assert.equal(clean.creditEconomy.matches.m.player1,'deleted_fixture');assert.equal(clean.creditEconomy.wallets.r.balance,5);
 clean.userAccess.u.deletionRequestId='req';delete clean.accountDeletionJobs.u;
 assert.deepEqual(prepareAdminPrivacyDeletion(clean,request),clean);
});
test('Administrator privacy deletion never allows deleting administrators or bypassing active reserves',()=>{
 const request={uid:'u',actor:'admin',requestId:'req',confirmName:'Mati',reason:'Solicitud verificada',now:1000,anonymousId:'deleted_fixture'};
 const admin=root();admin.administrators={u:true};assert.throws(()=>prepareAdminPrivacyDeletion(admin,request),/administradores/);
 admin.accountDeletionJobs={u:{requestId:'req'}};assert.throws(()=>prepareAdminPrivacyDeletion(admin,request),/administradores/);
 const reserved=root();reserved.creditEconomy.wallets.u.locked=1;assert.throws(()=>prepareAdminPrivacyDeletion(reserved,request),/créditos/);
 assert.throws(()=>prepareAdminPrivacyDeletion(root(),{...request,confirmName:'Other'}),/nombre/);
 assert.throws(()=>prepareAdminPrivacyDeletion(root(),{...request,requestId:undefined}),/solicitud/);
 const owner=root();owner.rooms.owner={public:{table:{uid:'u'},status:'started',players:{player1:{uid:'r'}}}};assert.throws(()=>prepareAdminPrivacyDeletion(owner,request),/mesa activa/);
});
