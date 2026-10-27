const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requireAdmin,adminLedgerChange}=require('../functions/admin-service.cjs');
const {createTable,joinTable}=require('../functions/table-service.cjs');
const base=()=>({wallets:{a:{balance:10,locked:0,lastGrantAt:99},b:{balance:10,locked:0,lastGrantAt:99}}});
const args={actor:'owner',requestId:'receipt1',reason:'Corrección de prueba',now:100};
test('Only explicitly authorized administrators pass the guard',()=>{
 for(const [auth,role] of [[null,true],[{uid:'a'},false],[{uid:'a'},'true'],[{uid:'a'},null]])assert.throws(()=>requireAdmin(auth,role));
 assert.doesNotThrow(()=>requireAdmin({uid:'owner'},true));
});
test('Credit edits preserve reservations and grant date and reject stale balances',()=>{
 const ledger=base();ledger.wallets.a.locked=3;
 const updated=adminLedgerChange(ledger,{...args,action:'credits',uid:'a',balance:20,expectedBalance:10});
 assert.equal(updated.wallets.a.balance,20);assert.equal(updated.wallets.a.locked,3);assert.equal(updated.wallets.a.lastGrantAt,99);assert.equal(ledger.wallets.a.balance,10);
 assert.equal(updated.adminAudit.receipt1.before,10);assert.equal(updated.adminAudit.receipt1.after,20);
 assert.throws(()=>adminLedgerChange(updated,{...args,requestId:'receipt2',action:'credits',uid:'a',balance:30,expectedBalance:10}));
});
test('Duplicate requests cannot be reused for a different user or amount',()=>{
 const command={...args,action:'credits',uid:'a',balance:20,expectedBalance:10};
 const updated=adminLedgerChange(base(),command);assert.deepEqual(adminLedgerChange(updated,command),updated);
 assert.throws(()=>adminLedgerChange(updated,{...command,balance:100}));
 assert.throws(()=>adminLedgerChange(updated,{...command,uid:'b'}));
});
test('Invalid amounts and missing reasons are rejected',()=>{
 for(const balance of [-1,1.5,NaN,Infinity,1000000001])assert.throws(()=>adminLedgerChange(base(),{...args,action:'credits',uid:'a',balance,expectedBalance:10}));
 assert.throws(()=>adminLedgerChange(base(),{...args,reason:'',action:'credits',uid:'a',balance:20,expectedBalance:10}));
});
test('Closing an active table refunds both stakes exactly once',()=>{
 let ledger=createTable(base(),{code:'ABCDE',id:'m1',uid:'a',name:'A',stake:3,targetPoints:10,now:100});
 ledger=joinTable(ledger,{code:'ABCDE',uid:'b',name:'B',now:101});
 const command={...args,action:'close-table',code:'ABCDE'};
 const updated=adminLedgerChange(ledger,command);
 assert.equal(updated.wallets.a.balance,10);assert.equal(updated.wallets.b.balance,10);
 assert.equal(updated.wallets.a.locked,0);assert.equal(updated.wallets.b.locked,0);assert.equal(updated.matches.m1.session.room.status,'closed');
 assert.deepEqual(adminLedgerChange(updated,command),updated);
 assert.equal(adminLedgerChange(updated,{...command,requestId:'receipt2'}).wallets.a.balance,10);
});
test('Closing a waiting table returns only the host stake',()=>{
 const ledger=createTable(base(),{code:'ABCDE',id:'m1',uid:'a',name:'A',stake:3,targetPoints:10,now:100});
 const result=adminLedgerChange(ledger,{...args,action:'close-table',code:'ABCDE'});
 assert.equal(result.wallets.a.balance,10);assert.equal(result.wallets.b.balance,10);assert.equal(result.matches.m1.status,'refunded');
});
const {prepareUserDeletion,finishUserDeletion}=require('../functions/admin-service.cjs');
const deletionRoot=()=>({profiles:{a:{name:'Mati'},b:{name:'Ricky'}},usernames:{mati:'a',ricky:'b'},creditEconomy:base()});
const deletion={...args,uid:'a',confirmName:'Mati'};
test('Deletion blocks access and reservations before removing Auth and preserves financial history',()=>{
 const root=deletionRoot();root.creditEconomy.matches={past:{player1:'a',player2:'b',status:'settled'}};
 const prepared=prepareUserDeletion(root,deletion);assert.equal(prepared.userAccess.a.blocked,true);assert.equal(prepared.creditEconomy.wallets.a.deleting,true);
 assert.throws(()=>createTable(prepared.creditEconomy,{code:'ABCDE',id:'new',uid:'a',name:'A',stake:1,targetPoints:10,now:101}));
 const result=finishUserDeletion(prepared,{uid:'a',requestId:args.requestId,now:102});
 assert.equal(result.profiles.a,undefined);assert.equal(result.usernames.mati,undefined);assert.equal(result.profiles.b.name,'Ricky');assert.equal(result.creditEconomy.wallets.a.balance,0);assert.equal(result.creditEconomy.matches.past.status,'settled');
 assert.equal(result.adminUserAudit.receipt1.status,'complete');assert.deepEqual(finishUserDeletion(result,{uid:'a',requestId:args.requestId,now:103}),result);
});
test('Deletion rejects administrators, wrong confirmation and users with reserved credits',()=>{
 assert.throws(()=>prepareUserDeletion(deletionRoot(),{...deletion,actor:'a'}));
 const admin=deletionRoot();admin.administrators={a:true};assert.throws(()=>prepareUserDeletion(admin,deletion));
 assert.throws(()=>prepareUserDeletion(deletionRoot(),{...deletion,confirmName:'mati'}));
 const reserved=deletionRoot();reserved.creditEconomy.wallets.a.locked=1;assert.throws(()=>prepareUserDeletion(reserved,deletion));
});
test('Repeated deletion preparation is idempotent and cannot be reassigned',()=>{
 const root=prepareUserDeletion(deletionRoot(),deletion);assert.deepEqual(prepareUserDeletion(root,deletion),root);
 assert.throws(()=>prepareUserDeletion(root,{...deletion,uid:'b'}));
 assert.throws(()=>adminLedgerChange(root.creditEconomy,{...args,requestId:'credit2',action:'credits',uid:'a',balance:50,expectedBalance:10}));
});

const {legacyTableActive,closeLegacyTable}=require('../functions/admin-service.cjs');
test('Expired waiting and finished legacy rooms do not block deletion and are closed atomically',()=>{
 const root=deletionRoot();root.rooms={old:{public:{status:'waiting',createdAt:1,players:{player1:{uid:'a'}}}},finished:{public:{status:'started',targetPoints:20,scores:{player1:20},players:{player1:{uid:'a'}}}}};
 const updated=prepareUserDeletion(root,{...deletion,now:600001});
 assert.equal(updated.rooms.old.public.status,'closed');assert.equal(updated.rooms.finished.public.status,'closed');
 assert.equal(root.rooms.old.public.status,'waiting');
});
test('A real legacy game remains protected and can be explicitly closed by its code',()=>{
 const root=deletionRoot();root.rooms={LIVE:{public:{status:'started',players:{player1:{uid:'a'},player2:{uid:'b'}}}}};
 assert.equal(legacyTableActive(root.rooms.LIVE.public,100),true);
 assert.throws(()=>prepareUserDeletion(root,deletion),/LIVE/);
 const command={...args,code:'LIVE'};const closed=closeLegacyTable(root,command);
 assert.equal(closed.rooms.LIVE.public.status,'closed');assert.deepEqual(closeLegacyTable(closed,command),closed);
 assert.doesNotThrow(()=>prepareUserDeletion(closed,{...deletion,requestId:'delete2'}));
 assert.equal(closed.creditEconomy.wallets.a.balance,10);
 assert.throws(()=>closeLegacyTable(closed,{...command,code:'OTHER'}));
});
test('Legacy closure cannot bypass the credit ledger or treat a fresh waiting table as expired',()=>{
 assert.equal(legacyTableActive({status:'waiting',createdAt:1,players:{player1:{uid:'a'}}},600000),true);
 const root=deletionRoot();root.rooms={LIVE:{public:{status:'started',managedCredits:true}}};
 assert.throws(()=>closeLegacyTable(root,{...args,code:'LIVE'}));
 delete root.rooms.LIVE.public.managedCredits;root.creditEconomy.tables={LIVE:'m1'};
 assert.throws(()=>closeLegacyTable(root,{...args,code:'LIVE'}));
});

const {adminTableCurrent}=require('../functions/admin-service.cjs');
test('Admin current tables exclude settled games, expired waiting tables and completed rooms',()=>{
 const now=600001;
 assert.equal(adminTableCurrent({status:'settled'},now),false);
 assert.equal(adminTableCurrent({status:'waiting',createdAt:1},now),false);
 assert.equal(adminTableCurrent({status:'waiting',createdAt:2},now),true);
 assert.equal(adminTableCurrent({status:'reserved',session:{room:{status:'complete'}}},now),false);
 assert.equal(adminTableCurrent({status:'reserved',session:{room:{status:'started'}}},now),true);
 assert.equal(adminTableCurrent({status:'reserved',closedAt:10},now),false);
});

test('Closing a legacy table aborts rather than deleting an empty Firebase transaction cache',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../functions/index.cjs'),'utf8');
 const callback=source.split('let failure;const result=await loadedTransaction(db.ref(),')[1].split(/\);\r?\n/)[0];
 const context={closeLegacyTable,data:{...args,code:'LIVE'},actor:args.actor,failure:'previous'};
 const transaction=require('node:vm').runInNewContext('('+callback+')',context);
 assert.equal(transaction(null),undefined);assert.equal(context.failure,null);
 const root=deletionRoot();root.rooms={LIVE:{public:{status:'started',players:{player1:{uid:'a'}}}}};
 const closed=transaction(root);assert.equal(closed.rooms.LIVE.public.status,'closed');assert.equal(context.failure,null);
 assert.equal(transaction(deletionRoot()),undefined);assert.match(context.failure,/mesa cambió/i);
});

test('Completed and stale legacy tables do not block deletion; recent activity stays protected',()=>{
 const now=10*86400000,base={status:'started',createdAt:1,players:{player1:{uid:'a'}}};
 for(const room of [{...base},{...base,matchResult:{winner:'player1'}},{...base,targetPoints:'20',scores:{player1:'20'}},{...base,status:'complete'}]){
  const root=deletionRoot();root.rooms={OLD:{public:room}};assert.doesNotThrow(()=>prepareUserDeletion(root,{...deletion,now}));
 }
 assert.equal(legacyTableActive({...base,feed:[{time:now-1000}]},now),true);
 assert.equal(legacyTableActive({...base,turnClock:{startedAt:now-1000}},now),true);
 const root=deletionRoot();root.rooms={LIVE:{public:{...base,createdAt:now-1000}}};assert.throws(()=>prepareUserDeletion(root,{...deletion,now}),/LIVE/);
});

test('An hour-old abandoned legacy game cannot block deleting the user',()=>{
 const now=7200000,root=deletionRoot();root.rooms={BN6QZ:{public:{status:'started',createdAt:1,feed:[{time:now-3600000}],players:{player1:{uid:'a',name:'Old nickname'},player2:{uid:'b',name:'Test'}}}}};
 const changed=prepareUserDeletion(root,{...deletion,now});assert.equal(changed.rooms.BN6QZ.public.status,'closed');assert.equal(root.rooms.BN6QZ.public.status,'started');
 root.rooms.BN6QZ.public.feed[0].time=now-1000;assert.throws(()=>prepareUserDeletion(root,{...deletion,now}),/BN6QZ/);
});
test('Admin table events list created tables and finished games by Uruguay day, house games marked',()=>{
 const {tableEvents}=require('../functions/admin-service.cjs');
 const now=Date.parse('2026-10-26T15:00:00Z'),yesterday=now-86400000,old=now-100*86400000;
 const ledger={matches:{
  a:{code:'AAAAA',createdAt:yesterday,status:'settled',settledAt:yesterday+600000,winner:'u1',players:{player1:{uid:'u1',name:'Ana'},player2:{uid:'u2',name:'Beto'}},matchNumber:1},
  b:{code:'BBBBB',createdAt:now,status:'settled',settledAt:now,house:'player1',winner:'u3',players:{player1:{uid:'house_X',name:'X'},player2:{uid:'u3',name:'Caro'}}},
  c:{code:'CCCCC',createdAt:now,status:'refunded',players:{player1:{uid:'u4',name:'Dani'}},matchNumber:1},
  d:{code:'DDDDD',createdAt:old,status:'settled',settledAt:old,players:{}}}};
 const e=tableEvents(ledger,now);
 assert.deepEqual(e.created.map(x=>x.id),['c','a']);
 assert.deepEqual(e.finished.map(x=>[x.id,x.house,x.day,x.winner]),[['b',true,'2026-10-26','Caro'],['a',false,'2026-10-25','Ana']]);
});
test('Past wins per person, for the starting levels, leave bots and house players out',()=>{
 const {pastWins,finishedTables}=require('../functions/admin-service.cjs');
 assert.deepEqual(finishedTables({matches:{a:{status:'settled',players:{player1:{uid:'u1'},player2:{uid:'u2'}}},b:{status:'refunded',players:{player1:{uid:'u1'},player2:{uid:'u3'}}},c:{status:'settled',players:{player1:{uid:'u1'},player2:{uid:'house_X'}}},d:{status:'settled',players:{player1:{uid:'u2'},player2:{uid:'bot:player2'},player3:{uid:'u3'}}}}}),{u1:2,u2:2,u3:1});
 assert.deepEqual(pastWins({matches:{a:{status:'settled',winner:'u1'},b:{status:'settled',winner:'u1'},c:{status:'refunded',winner:'u2'},d:{status:'settled',winners:['u2','bot:player3']},e:{status:'settled',winner:'house_X'}}}),{u1:2,u2:1});
});
test('An administrator sets level points with the reason on record, never over a change made meanwhile',()=>{
 const {adminSetPoints,levelOfPoints}=require('../functions/admin-service.cjs');
 const root={levels:{a:{points:70,wins:7}}},change={actor:'owner',uid:'a',points:150,expected:70,requestId:'lv1',reason:'Compensación por un corte',now:5};
 const next=adminSetPoints(root,change);
 assert.equal(next.levels.a.points,150);assert.equal(next.levels.a.wins,7);assert.equal(root.levels.a.points,70);
 assert.deepEqual(next.adminUserAudit.lv1,{actor:'owner',uid:'a',action:'level',before:'Nivel 3 · 7 puntos',after:'Nivel 6 · 15 puntos',points:150,reason:'Compensación por un corte',at:5});
 assert.equal(adminSetPoints(next,change).levels.a.points,150);
 assert.throws(()=>adminSetPoints(root,{...change,expected:60}),/cambiaron/);
 assert.throws(()=>adminSetPoints(root,{...change,reason:'x'}),/motivo/);
 assert.throws(()=>adminSetPoints(root,{...change,points:-1}),/inválidos/);
 assert.throws(()=>adminSetPoints(next,{...change,points:200}),/reutilizada/);
 assert.equal(adminSetPoints({},{...change,expected:0,requestId:'lv2'}).levels.a.points,150);
 assert.deepEqual([0,29,30,120,150,350].map(levelOfPoints),[1,1,2,5,6,10]);
});
