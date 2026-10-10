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

test('Closing a legacy table waits for the initial empty Firebase transaction cache',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../functions/index.cjs'),'utf8');
 const callback=source.split('let failure;const result=await db.ref().transaction(')[1].split(');\n')[0];
 const context={closeLegacyTable,data:{...args,code:'LIVE'},actor:args.actor,failure:'previous'};
 const transaction=require('node:vm').runInNewContext('('+callback+')',context);
 assert.equal(transaction(null),null);assert.equal(context.failure,null);
 const root=deletionRoot();root.rooms={LIVE:{public:{status:'started',players:{player1:{uid:'a'}}}}};
 const closed=transaction(root);assert.equal(closed.rooms.LIVE.public.status,'closed');assert.equal(context.failure,null);
 assert.equal(transaction(deletionRoot()),undefined);assert.match(context.failure,/mesa cambió/i);
});
