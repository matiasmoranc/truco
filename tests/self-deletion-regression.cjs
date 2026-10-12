const test=require('node:test'),assert=require('node:assert/strict');
const {prepareSelfDeletion,erasePlayerData}=require('../functions/self-deletion.cjs');
const root=()=>({profiles:{u:{name:'Mati'},r:{name:'Rival'}},usernames:{mati:'u',rival:'r'},creditEconomy:{wallets:{u:{balance:10,locked:0},r:{balance:5,locked:0}},matches:{m:{player1:'u',player2:'r',players:{player1:{uid:'u',name:'Mati'},player2:{uid:'r',name:'Rival'}},status:'settled'}}},problemReports:{report:{uid:'u',message:'personal'},other:{uid:'r',message:'other'}},rooms:{old:{public:{status:'closed',players:{player1:{uid:'u'}}}}},hands:{old:{u:{cards:[]}}},adminMetrics:{presence:{u:{}},days:{d:{users:{u:true,r:true}}}}});
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
 assert.equal(n.profiles.u,undefined);assert.equal(n.usernames.mati,undefined);assert.equal(n.problemReports.report,undefined);assert.equal(n.rooms.old,undefined);assert.equal(n.hands.old,undefined);assert.equal(n.adminMetrics.days.d.users.u,undefined);
 assert.deepEqual(n.profiles.r,{name:'Rival'});assert.equal(n.creditEconomy.wallets.r.balance,5);assert.equal(n.creditEconomy.wallets.u,undefined);assert.equal(n.creditEconomy.wallets.deleted_random.balance,0);
 assert.equal(n.creditEconomy.matches.m.player1,'deleted_random');assert.equal(n.creditEconomy.matches.m.players.player1.name,'Jugador eliminado');
 assert.deepEqual(erasePlayerData(n,{uid:'u',anonymousId:'deleted_random',now:2000}),n);
});
