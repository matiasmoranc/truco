import test from 'node:test';
import assert from 'node:assert/strict';
import {createBankCore,dailyGrant,CREDIT_DAY_MS} from '../src/bank-core.js';
import {createFirebaseBank} from '../src/firebase-bank.js';
import {createTableEngine} from '../src/table-engine.js';
import {memoryStore} from './memory-store.js';

const wallets=()=>({wallets:{a:{balance:12,locked:0,lastGrantAt:1},b:{balance:7,locked:0,lastGrantAt:1},c:{balance:9,locked:0,lastGrantAt:1},d:{balance:9,locked:0,lastGrantAt:1}},adminAudit:{old:{actor:'x',at:1}}});
const total=ledger=>Object.values(ledger.wallets).reduce((n,w)=>n+w.balance+w.locked,0);

async function freshBank(){const core=createBankCore(memoryStore());await core.importLedger(wallets());return core;}
function rtdbBank(){
 const db={economy:wallets(),async read(){return {etag:'x',value:db.economy};},
  async transaction(path,update){const next=update(JSON.parse(JSON.stringify(db.economy)));if(next!==undefined)db.economy=JSON.parse(JSON.stringify(next));return {committed:next!==undefined};}};
 return {db,bank:createFirebaseBank(db)};
}
async function playScript(bank){
 let now=1000;const engine=createTableEngine({code:'ABCDE',bank,clock:()=>now});
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:2,targetPoints:10,mode:'1v1',secret:null});
 now+=100;await engine.join({uid:'b',name:'Ricky'},{});
 now+=100;await engine.act('b',{command:{kind:'abandon'},requestId:'q1'});
 now+=100;await engine.act('a',{command:{kind:'rematch',value:'request'},requestId:'r1'});
 now+=100;await engine.act('b',{command:{kind:'rematch',value:'accept'},requestId:'r2'});
 return engine;
}
const comparable=ledger=>{const {walletMovements,peaks,...rest}=JSON.parse(JSON.stringify(ledger));return rest;};

test('The bank and the Firebase economy end with identical accounting for the same games',async()=>{
 const core=await freshBank(),fire=rtdbBank();
 // Rematch ids include the clock and are equal; history keys too.
 await playScript(core);await playScript(fire.bank);
 assert.deepEqual(comparable((await core.exportLedger()).ledger),comparable(fire.db.economy));
});

test('A table step reads and writes only that table rows and records movements and peaks',async()=>{
 const store=memoryStore(),core=createBankCore(store);await core.importLedger(wallets());
 const before=new Map(store.rows);
 const engine=createTableEngine({code:'ABCDE',bank:core,clock:()=>5000});
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 const changed=[...store.rows.keys()].filter(k=>JSON.stringify(before.get(k))!==JSON.stringify(store.rows.get(k)));
 assert.deepEqual(changed.filter(k=>!k.startsWith('mv:')).sort(),['h:game1','m:game1','meta:version','p:a','t:ABCDE','w:a']);
 const {ledger,version}=await core.exportLedger();
 assert.equal(version,2);assert.deepEqual(ledger.wallets.a,{balance:7,locked:5,lastGrantAt:1});
 const moves=Object.values(ledger.walletMovements.a);assert.equal(moves.length,1);
 assert.deepEqual({...moves[0],at:0},{at:0,before:12,after:7,reservedBefore:0,reservedAfter:5});
 assert.deepEqual(ledger.peaks.a,{balance:12,startedAt:5000});
 assert.equal(ledger.matches.game1.live,'cloudflare');assert.equal(ledger.matches.game1.session,undefined);
});

test('A full game pays the pot once and keeps the total',async()=>{
 const core=await freshBank();const engine=await playScript(core);
 const {ledger}=await core.exportLedger();
 assert.equal(total(ledger),total(wallets()));
 assert.equal(ledger.matches.game1.status,'settled');assert.equal(ledger.tables.ABCDE,engine.match.id);
 assert.equal(ledger.wallets.a.locked,2);assert.equal(ledger.wallets.b.locked,2);
});

test('Daily credits follow the database rule: only from zero, once per Uruguay day',async()=>{
 const day=Date.UTC(2026,9,21,12);
 assert.deepEqual(dailyGrant(null,day),{balance:5,locked:0,lastGrantAt:day});
 assert.throws(()=>dailyGrant({balance:1,locked:0},day),/saldo/);
 assert.throws(()=>dailyGrant({balance:0,locked:2},day),/saldo/);
 assert.throws(()=>dailyGrant({balance:0,locked:0,lastGrantAt:day-3600000},day),/hoy/);
 // 03:00 UTC is midnight in Uruguay: a grant before it allows a new one after it.
 const midnight=Date.UTC(2026,9,22,3);
 assert.equal(dailyGrant({balance:0,locked:0,lastGrantAt:midnight-1},midnight).balance,5);
 assert.throws(()=>dailyGrant({balance:0,locked:0,deletedAt:1},day),/eliminada/);
 const core=await freshBank();
 await assert.rejects(core.claim('a',day),/saldo/);
 const fresh=await core.claim('nuevo',day);assert.equal(fresh.balance,5);
 await assert.rejects(core.claim('nuevo',day+CREDIT_DAY_MS/2),/saldo/);
 assert.equal((await core.wallet('nuevo')).balance,5);
});

test('Whole-ledger edits need the version they read and cannot delete accounting',async()=>{
 const core=await freshBank();
 const {version,ledger}=await core.exportLedger();
 ledger.wallets.a.balance=20;
 const done=await core.replace(version,ledger);assert.equal(done.version,version+1);assert.deepEqual(Object.keys(done.wallets),['a']);
 await assert.rejects(core.replace(version,ledger),/cambiaron/);
 const now=await core.exportLedger();delete now.ledger.adminAudit.old;
 await assert.rejects(core.replace(now.version,now.ledger),/eliminación contable/);
 assert.equal((await core.wallet('a')).balance,20);
});

test('Import copies every branch once and refuses to overwrite a bank in use',async()=>{
 const source={...wallets(),walletMovements:{a:{k1:{at:1,before:0,after:12,reservedBefore:0,reservedAfter:0}}},peaks:{a:{balance:12,startedAt:1}},history:{m:{'1_1':{at:1,changes:[]}}},adRewards:{s1:{uid:'a'}}};
 const core=createBankCore(memoryStore());await core.importLedger(source);
 const {ledger}=await core.exportLedger();
 assert.deepEqual(ledger,source);
 await assert.rejects(core.importLedger(source),/ya tiene datos/);
});

test('A row patch survives games at other tables but not edits to the same rows',async()=>{
 const core=await freshBank();
 const base=(await core.exportLedger()).ledger;
 // Another table moves c's credits after the export.
 const engine=createTableEngine({code:'ZZZZZ',bank:core,clock:()=>9000});
 await engine.create({uid:'c',name:'C'},{id:'other',stake:1,targetPoints:10,mode:'1v1'});
 const edit=structuredClone(base);edit.wallets.a.balance=30;edit.adminAudit.req1={actor:'adm',action:'credits',at:9};
 const done=await core.patch(base,edit);assert.deepEqual(Object.keys(done.wallets),['a']);
 const now=(await core.exportLedger()).ledger;
 assert.equal(now.wallets.a.balance,30);assert.equal(now.wallets.c.locked,1);assert.ok(now.adminAudit.req1);
 assert.equal(Object.values(now.walletMovements.a).at(-1).after,30);
 // The same row edited from a stale copy is refused.
 const stale=structuredClone(base);stale.wallets.a.balance=1;
 await assert.rejects(core.patch(base,stale),/cambiaron/);
 // Accounting rows cannot be removed; table pointers can.
 const removal=structuredClone(now);delete removal.adminAudit.old;
 await assert.rejects(core.patch(now,removal),/eliminación contable/);
 const pointer=structuredClone(now);delete pointer.tables.ZZZZZ;
 await core.patch(now,pointer);assert.equal((await core.exportLedger()).ledger.tables?.ZZZZZ,undefined);
 const negative=structuredClone((await core.exportLedger()).ledger);const fresh=structuredClone(negative);fresh.wallets.b.balance=-1;
 await assert.rejects(core.patch(negative,fresh),/Saldo inválido/);
});
