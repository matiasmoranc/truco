'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {QUICK_MESSAGES,isQuickMessage,chatDay,chatLogRecord,chatLogList}=require('../functions/chat-log.cjs');
const root=path.join(__dirname,'..');

test('Chat log leaves out every quick message the game offers',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const offered=[...html.matchAll(/data-hold-message="([^"]*)"/g)].map(m=>m[1]);
 assert.ok(offered.length>0);
 for(const text of offered)assert.ok(QUICK_MESSAGES.includes(text),'falta en QUICK_MESSAGES: '+text);
 assert.equal(isQuickMessage('jajaja'),true);
 assert.equal(isQuickMessage('  Buena jugada  '),true);
 assert.equal(chatLogRecord({at:Date.now(),code:'ABCD',uid:'u1',name:'Ana',text:'¿Otra partida?'}),null);
});

test('Chat log stores typed messages by Uruguay day, newest first',()=>{
 const at=Date.UTC(2026,10,12,2,30);// 23:30 of the 11th in Uruguay
 assert.equal(chatDay(at),'2026-11-11');
 const a=chatLogRecord({at,code:'ABCD',uid:'u1',name:'Ana',text:'  qué mano tenías  ',mode:'2v2',id:'-Nx.1'});
 assert.match(a.path,/^chatLog\/2026-11-11\/[0-9a-z]+-[^.#$/[\]]+$/);
 assert.deepEqual(a.value,{at,code:'ABCD',uid:'u1',name:'Ana',text:'qué mano tenías',mode:'2v2'});
 const b=chatLogRecord({at:at+1000,code:'ABCD',uid:'u2',name:'Beto',text:'hola',id:'r2'});
 assert.equal(b.value.mode,undefined);
 const stored={};for(const r of [a,b]){const [,day,key]=r.path.split('/');(stored[day]??={})[key]=r.value;}
 assert.deepEqual(chatLogList(stored).map(m=>m.text),['hola','qué mano tenías']);
 assert.equal(chatLogRecord({at,code:'X',uid:'u',name:'n',text:'   '}),null);
});
