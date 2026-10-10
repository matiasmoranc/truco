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
