const {test}=require('node:test');const assert=require('node:assert/strict');
const M=require('../functions/admin-messages.cjs');
test('Admin messages are trimmed, required and limited in length',()=>{
 assert.equal(M.cleanText('  Hola  '),'Hola');
 assert.throws(()=>M.cleanText('   '),/Escribí/);assert.throws(()=>M.cleanText('x'.repeat(M.MAX_TEXT+1)),/hasta/);
});
test('Sending writes the player inbox and the conversation; answering marks read and stores the reply',()=>{
 const sent=M.sendUpdates({uid:'u1',id:'m1',text:'Hola',now:5,actor:'adm'});
 assert.deepEqual(sent,{'adminMessages/u1/m1':{text:'Hola',at:5},'adminThreads/u1/m1':{from:'admin',text:'Hola',at:5,actor:'adm'}});
 const read=M.answerUpdates({uid:'u1',messageId:'m1',replyId:'r1',text:'',now:9});
 assert.deepEqual(Object.keys(read),['adminMessages/u1/m1/readAt','adminThreads/u1/m1/readAt']);
 const answered=M.answerUpdates({uid:'u1',messageId:'m1',replyId:'r1',text:'Gracias',now:9});
 assert.deepEqual(answered['adminThreads/u1/r1'],{from:'player',text:'Gracias',at:9,replyTo:'m1',seen:false});
});
test('The panel lists conversations newest first with unseen answers counted',()=>{
 const list=M.threadList({a:{m1:{from:'admin',text:'Hola',at:1}},b:{m2:{from:'admin',text:'Hey',at:2},r:{from:'player',text:'Sí',at:3,seen:false}}},{b:'Beto'});
 assert.deepEqual(list.map(t=>[t.uid,t.unread,t.name]),[['b',1,'Beto'],['a',0,'']]);
 assert.deepEqual(list[0].messages.map(m=>m.from),['admin','player']);
});
