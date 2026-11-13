'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTable,joinTable,tableOperation,publicTable}=require('../functions/table-service.cjs');
const wallets=()=>({wallets:{a:{balance:10,locked:0,lastGrantAt:1},b:{balance:10,locked:0,lastGrantAt:1},c:{balance:10,locked:0,lastGrantAt:1},d:{balance:10,locked:0,lastGrantAt:1}}});
const room2v2=()=>{let l=createTable(wallets(),{code:'SALA2',id:'t2',uid:'a',name:'Ana',stake:2,targetPoints:20,mode:'2v2',now:0});
 l=joinTable(l,{code:'SALA2',uid:'b',name:'Beto',now:10});l=joinTable(l,{code:'SALA2',uid:'c',name:'Caro',now:20});return l;};
const op=(l,uid,command,now,extra={})=>tableOperation(l,{code:'SALA2',uid,command,now,requestId:'r'+now,...extra});
const lines=l=>Object.values(publicTable(l.matches.t2).lobbyChat||{}).map(x=>x.system?'· '+x.text:x.sender+': '+x.text);

test('2v2 waiting room: chat, arrivals and departures are visible to everyone',()=>{
 let l=op(room2v2(),'b',{kind:'chat',text:' hola! '},30);
 assert.deepEqual(lines(l),['· Beto entró a la sala','· Caro entró a la sala','player3: hola!'.replace('player3',Object.keys(l.matches.t2.players).find(s=>l.matches.t2.players[s].uid==='b')+'')]);
 assert.throws(()=>op(l,'c',{kind:'chat',text:'x'.repeat(41)},40),/no se puede enviar/);
 // A guest who leaves frees only their seat and gets the stake back; the room stays open.
 l=op(l,'c',{kind:'cancel'},50);
 const m=l.matches.t2;
 assert.equal(m.status,'waiting');assert.equal(Object.values(m.players).some(p=>p.uid==='c'),false);
 assert.deepEqual(l.wallets.c,{balance:10,locked:0,lastGrantAt:1});assert.equal(l.wallets.a.locked,2);
 assert.match(lines(l).at(-1),/Caro salió de la sala/);
 // Someone else can take the free seat.
 l=joinTable(l,{code:'SALA2',uid:'d',name:'Dani',now:60});assert.equal(l.matches.t2.status,'waiting');
});

test('2v2 waiting room: the creator leaving closes it for everyone and refunds all',()=>{
 const l=op(room2v2(),'a',{kind:'cancel'},30),room=publicTable(l.matches.t2);
 assert.equal(room.status,'closed');assert.equal(room.closeReason,'creator-left');
 for(const u of ['a','b','c'])assert.deepEqual(l.wallets[u],{balance:10,locked:0,lastGrantAt:1});
});

test('2v2 waiting room: a disconnected guest loses the seat, a disconnected creator closes the room',()=>{
 const seatOf=(l,uid)=>Object.keys(l.matches.t2.players).find(s=>l.matches.t2.players[s].uid===uid);
 let l=room2v2();const b=seatOf(l,'b');
 const away=(seat,uid,at)=>({[seat]:{uid,matchNumber:1,online:false,disconnectedAt:at}});
 // 100 s offline (times in ms): still seated. 2 minutes: the seat is freed.
 assert.ok(seatOf(op(l,'a',{kind:'tick'},200000,{presence:away(b,'b',100000)}),'b'));
 l=op(l,'a',{kind:'tick'},221000,{presence:away(b,'b',100000)});
 assert.equal(seatOf(l,'b'),undefined);assert.match(lines(l).at(-1),/Beto se desconectó/);assert.equal(l.wallets.b.locked,0);
 const closed=op(room2v2(),'c',{kind:'tick'},230000,{presence:away('player1','a',100000)});
 assert.equal(publicTable(closed.matches.t2).closeReason,'creator-left');
});

test('2v2: the waiting-room chat carries into the match',()=>{
 let l=op(room2v2(),'b',{kind:'chat',text:'vamos'},30);
 l=joinTable(l,{code:'SALA2',uid:'d',name:'Dani',now:40});
 const room=publicTable(l.matches.t2);
 assert.equal(l.matches.t2.status,'reserved');
 assert.deepEqual(Object.values(room.chatMessages||{}).map(x=>x.text),['vamos']);
});

test('1v1 waiting room: a creator disconnected for a while closes it',()=>{
 const l=createTable(wallets(),{code:'SALAB',id:'t1',uid:'a',name:'Ana',stake:2,targetPoints:20,now:0});
 const tick=(at,presence)=>tableOperation(l,{code:'SALAB',uid:'a',command:{kind:'tick'},now:at,presence});
 const away={player1:{uid:'a',matchNumber:1,online:false,disconnectedAt:100000}};
 assert.equal(tick(200000,away).matches.t1.status,'waiting');
 const closed=tick(221000,away);
 assert.equal(closed.matches.t1.status,'refunded');assert.equal(publicTable(closed.matches.t1).closeReason,'creator-left');
 assert.equal(closed.wallets.a.locked,0);
});
