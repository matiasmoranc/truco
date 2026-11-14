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

test('Chat log groups messages by table, rematches included, listing every player even if silent',()=>{
 const {chatLogGroups}=require('../functions/chat-log.cjs');
 const players={player1:{uid:'u1',name:'Ana'},player2:{uid:'u2',name:'Beto'}};
 const matches={
  m1:{id:'m1',code:'ABCDE',mode:'1v1',players,createdAt:1000,settledAt:5000},
  m2:{id:'m2',code:'ABCDE',mode:'1v1',players,createdAt:5000,settledAt:9000},
  m3:{id:'m3',code:'QWERT',mode:'2v2',players:{player1:{uid:'u3',name:'Caro'},player2:{uid:'u4',name:'Dani'},player3:{uid:'bot:x',name:'Bot'},player4:{uid:'u5',name:'Eli'}},createdAt:2000,settledAt:8000}
 };
 const msg=(at,code,uid,name,text)=>({at,code,uid,name,text,key:String(at)});
 const groups=chatLogGroups([msg(2000,'ABCDE','u1','Ana','hola'),msg(6000,'ABCDE','u1','Ana','otra?'),msg(3000,'QWERT','u3','Caro','vamos'),msg(10000,'ZZZZZ','u9','Zoe','sola')],matches);
 assert.equal(groups.length,3);
 const abc=groups.find(g=>g.code==='ABCDE');
 assert.deepEqual(abc.messages.map(m=>m.text),['hola','otra?']);assert.equal(abc.games,2);
 assert.deepEqual(abc.players.map(p=>[p.name,p.wrote]),[['Ana',true],['Beto',false]]);
 const qw=groups.find(g=>g.code==='QWERT');
 assert.equal(qw.mode,'2v2');assert.deepEqual(qw.players.map(p=>p.name),['Caro','Dani','Bot','Eli']);assert.equal(qw.players[2].bot,true);
 assert.deepEqual(groups.find(g=>g.code==='ZZZZZ').players.map(p=>p.name),['Zoe']);
 assert.equal(groups[0].code,'ZZZZZ','newest table first');
});
