'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const table=require('../functions/table-service.cjs'),{recordHistory}=require('../functions/history-service.cjs'),{validateAccounting}=require('../functions/accounting-guard.cjs');
const code=fs.readFileSync('functions/index.cjs','utf8');
function handler(){return code.slice(code.indexOf('async function joinTableRequest('),code.indexOf('async function tableActionRequest('));}
function harness(mode='1v1'){
 let ledger=table.createTable({wallets:Object.fromEntries(['a','b','c','d'].map(uid=>[uid,{balance:10,locked:0}]))},{uid:'a',name:'A',id:'m',code:'ABCDE',stake:1,targetPoints:10,mode,now:Date.now()});const reads=[];
 const c={refuseOldTables:async()=>{},gameDatabase:{run:(_db,task)=>task()},restDb:{},gameTransport:{},warmGameDatabase:async()=>{},exports:{},onCall:(_o,f)=>f,options:{},HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},identity:async r=>{if(!r.auth)throw Error('auth');return {uid:r.auth.uid,name:r.auth.uid};},rateLimit:async()=>{},measured:(_s,_k,p)=>p,usersBlockEachOther:async()=>false,tableFor:table.tableFor,joinTable:table.joinTable,privateTableHand:table.privateTableHand,console:{info(){}},db:{ref:path=>({once:async()=>{reads.push(path);if(path==='creditEconomy')throw Error('Full ledger pre-read');const value=path.split('/').slice(1).reduce((x,k)=>x?.[k],ledger);return {val:()=>structuredClone(value)};}})},mutate:async update=>{const next=validateAccounting(ledger,recordHistory(ledger,update(ledger),Date.now()));ledger=next;return next;},publish:async(l,k)=>{const m=table.tableFor(l,k);return {code:k,room:table.publicTable(m),player1:m.player1,player2:m.player2};}};
 vm.createContext(c);vm.runInContext(handler(),c);return {call:uid=>c.exports.creditJoinTable({auth:uid?{uid}:null,data:{code:'ABCDE'}}),reads,ledger:()=>ledger};
}
test('Join receipt includes the confirmed room and only the joining player private payload',async()=>{
 const h=harness(),r=await h.call('b');assert.equal(r.privateHand.hand.length,3);assert.equal(r.privateHand.creditMatchId,r.room.creditMatch.id);assert.equal(r.privateHand.revision,r.room.revision);assert.equal(r.privateHand.handNumber,r.room.handNumber);assert.equal(r.room.hands,undefined);assert.equal(r.privateHand.partnerHand,undefined);assert.equal(h.reads.includes('creditEconomy'),false);
});
test('The fourth team join receives its hand and its partner, without private rival data',async()=>{
 const h=harness('2v2');await h.call('b');await h.call('c');const r=await h.call('d');assert.equal(r.room.status,'started');assert.equal(r.privateHand.hand.length,3);assert.equal(r.privateHand.partnerHand.length,3);assert.deepEqual(Object.keys(r.privateHand).sort(),['creditMatchId','hand','handNumber','partnerHand','revision']);assert.equal(r.room.partnerHand,undefined);
});
test('Unauthenticated joins do not read even the table index',async()=>{const h=harness();await assert.rejects(()=>h.call(null),/auth/);assert.equal(h.reads.length,0);});
