const test=require('node:test');const assert=require('node:assert/strict');
const {reservationAlerts,repairReservation,personalHistory}=require('../functions/player-service.cjs');
const {createTable}=require('../functions/table-service.cjs');
const {recordHistory}=require('../functions/history-service.cjs');
function waiting(){return createTable({wallets:{a:{balance:5,locked:0}}},{code:'ABCDE',id:'match1',uid:'a',name:'Jona',stake:2,targetPoints:10,now:100});}
test('A live reservation is not reported as stuck; expired waiting stake is refunded once',()=>{
 const a=waiting();assert.equal(reservationAlerts(a,200).length,0);assert.equal(reservationAlerts(a,600101)[0].repairable,true);
 const b=repairReservation(a,{uid:'a',now:600101});assert.equal(b.wallets.a.balance,5);assert.equal(b.wallets.a.locked,0);assert.equal(b.matches.match1.status,'refunded');assert.throws(()=>repairReservation(b,{uid:'a',now:600102}));
});
test('An orphan reservation is flagged and cannot be blindly refunded',()=>{
 const a={wallets:{a:{balance:1,locked:2}},matches:{}};assert.equal(reservationAlerts(a,100)[0].repairable,false);assert.throws(()=>repairReservation(a,{uid:'a',now:100}));
});
test('Personal history includes old rematches, only own movements, and recovered peak',()=>{
 const a=waiting();a.matches.match1.status='settled';a.matches.match1.winner='a';a.matches.match1.player2='b';a.matches.unrelated={id:'unrelated',player1:'c',player2:'d',status:'settled'};a.matches.match2={...a.matches.match1,id:'match2',matchNumber:2,winner:'b'};a.tables.ABCDE='match2';a.history={match1:{e:{at:100,changes:[{uid:'a',before:15,after:13},{uid:'b',before:50,after:48}]}}};
 const r=personalHistory(a,'a');assert.equal(r.matches.length,2);assert.equal(r.peak,15);assert.equal(r.matches.find(m=>m.id==='match1').delta,2);assert.equal(r.matches.find(m=>m.id==='match2').delta,-2);assert.equal(r.matches.find(m=>m.id==='match1').history[0].changes.length,1);
});
test('History receipts capture reservation and unchanged retry creates no second event',()=>{
 const a={wallets:{a:{balance:5,locked:0}},matches:{}};const b=recordHistory(a,waiting(),100);assert.equal(b.history.match1['1_100'].changes[0].after,3);assert.deepEqual(recordHistory(b,b,101),b);assert.equal(a.wallets.a.balance,5);
});
