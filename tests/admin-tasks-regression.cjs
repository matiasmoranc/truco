'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyTask,taskList,validId}=require('../functions/admin-tasks.cjs');
const who={uid:'a1',name:'Mati'};

test('A new task gets defaults, and a title is required',()=>{
 const t=applyTask(null,{kind:'create',fields:{title:'  Mandar la 1.0.11  ',due:'2026-11-20'}},{now:10,who});
 assert.deepEqual({...t},{title:'Mandar la 1.0.11',notes:'',status:'pendiente',priority:'media',area:'otros',due:'2026-11-20',createdAt:10,createdBy:'Mati',updatedAt:10,comments:{}});
 assert.throws(()=>applyTask(null,{kind:'create',fields:{title:'  '}},{now:1,who}),/título/);
 assert.throws(()=>applyTask(null,{kind:'create',fields:{title:'x',due:'2026-02-30'}},{now:1,who}),/Fecha/);
 assert.throws(()=>applyTask(null,{kind:'create',fields:{title:'x',status:'rara'}},{now:1,who}),/inválido/);
});

test('Changing the status leaves a line in the comments and marks when it was done',()=>{
 let t=applyTask(null,{kind:'create',fields:{title:'Revisar Cloudflare',priority:'alta',area:'servidor'}},{now:1,who});
 t=applyTask(t,{kind:'update',fields:{status:'hecha'}},{now:5,who});
 assert.equal(t.status,'hecha');assert.equal(t.doneAt,5);assert.equal(t.priority,'alta');assert.equal(t.title,'Revisar Cloudflare');
 const lines=Object.values(t.comments);assert.equal(lines.length,1);assert.equal(lines[0].kind,'status');assert.match(lines[0].text,/Hecha/);
 t=applyTask(t,{kind:'update',fields:{status:'pendiente',due:null}},{now:9,who});
 assert.equal(t.doneAt,undefined);assert.equal(t.due,null);assert.equal(Object.keys(t.comments).length,2);
 // Same status: no new line.
 t=applyTask(t,{kind:'update',fields:{notes:'Mirar escrituras'}},{now:12,who});assert.equal(Object.keys(t.comments).length,2);
});

test('Comments are added and removed; status lines stay; delete removes the task',()=>{
 let t=applyTask(null,{kind:'create',fields:{title:'Video 20'}},{now:1,who});
 t=applyTask(t,{kind:'comment',text:'Usar la voz de Mateo'},{now:2,who});
 const [id]=Object.keys(t.comments);assert.equal(t.comments[id].text,'Usar la voz de Mateo');
 assert.throws(()=>applyTask(t,{kind:'comment',text:' '},{now:3,who}),/comentario/);
 t=applyTask(t,{kind:'delete-comment',commentId:id},{now:4,who});assert.deepEqual(t.comments,{});
 t=applyTask(t,{kind:'update',fields:{status:'en-curso'}},{now:5,who});
 const [line]=Object.keys(t.comments);assert.throws(()=>applyTask(t,{kind:'delete-comment',commentId:line},{now:6,who}),/no se puede/);
 assert.equal(applyTask(t,{kind:'delete'},{now:7,who}),null);
 assert.throws(()=>applyTask(null,{kind:'update',fields:{}},{now:1,who}),/ya no existe/);
});

test('The list orders comments oldest first and skips bad entries',()=>{
 const list=taskList({abcdef1:{title:'A',comments:{x:{at:5,text:'b'},y:{at:2,text:'a'}}},'b.d':{title:'B'},abcdef2:{notitle:1},bad:null});
 assert.equal(list.length,1);assert.deepEqual(list[0].comments.map(c=>c.text),['a','b']);
 assert.equal(validId('__proto__'),false);assert.equal(validId('abc123def'),true);
});
