import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD,HEAR_RADIUS,clampPosition,spawnPosition,acceptMove,acceptSay,hears,allowListed,liveTableEntry} from '../src/bar-core.js';

test('BAR: steps stay on the floor and not faster than allowed',()=>{
 assert.deepEqual(clampPosition(-50,99999),{x:20,y:WORLD.h-20});
 assert.equal(acceptMove({movedAt:1000},{x:10,y:10},1050),null);
 assert.equal(acceptMove({movedAt:0},{x:'a',y:10},5000),null);
 assert.deepEqual(acceptMove({movedAt:0},{x:500.4,y:600},5000),{x:500,y:600,a:0,s:false});
 assert.deepEqual(acceptMove({movedAt:0},{x:500,y:600,a:7,s:true},5000),{x:500,y:600,a:0.72,s:true},'the turn is kept within one circle');
 assert.equal(acceptMove({movedAt:0},{x:500,y:600,s:'yes'},5000).s,false);
 const at=spawnPosition(()=>0.5);assert.ok(at.x>1300&&at.y>=190);
});

test('BAR: messages are short and clean, without links, phones or insults, and not too fast',()=>{
 const p={said:[]};
 assert.deepEqual(acceptSay(p,'  hola   che ',1000),{text:'hola che',said:[1000]});
 assert.ok(acceptSay(p,'   ',1000).error);
 assert.ok(acceptSay(p,'mirá www.algo.com',1000).error);
 assert.ok(acceptSay(p,'escribime a juan@mail.com',1000).error);
 assert.ok(acceptSay(p,'llamame 099 123 456',1000).error);
 assert.ok(acceptSay(p,'sos un pelotudo',1000).error);
 assert.equal(acceptSay(p,'x'.repeat(500),1000).text.length,140);
 assert.ok(acceptSay({said:[1000]},'otra',1200).error,'too soon after the last one');
 assert.ok(acceptSay({said:[1,2000,4000,6000,8000,10000]},'otra',12000).error,'too many in a row');
 assert.equal(acceptSay({said:[1,2000]},'otra',20000).said.length,1,'old ones are forgotten');
});

test('BAR: only people near hear a message',()=>{
 assert.equal(hears({x:0,y:0},{x:HEAR_RADIUS,y:0}),true);
 assert.equal(hears({x:0,y:0},{x:HEAR_RADIUS+1,y:0}),false);
});

test('BAR: the allow list is a comma-separated list of uids',()=>{
 assert.equal(allowListed({BAR_ALLOW:'a, b ,c'},'b'),true);
 assert.equal(allowListed({BAR_ALLOW:''},''),false);
 assert.equal(allowListed({},'a'),false);
});

test('BAR: a table in play shows who sits, the score and the last call, never cards',()=>{
 const m={mode:'1v1',status:'active',players:{player1:{uid:'a',name:'Ana',secret:'x'},player2:{uid:'b',name:'Beto'}},
  session:{room:{status:'started',scores:{player1:7,player2:3},targetPoints:20,pendingBet:{type:'truco',called:'retruco'},hands:{player1:['1-espada']}}}};
 const e=liveTableEntry(m);
 assert.deepEqual(e,{mode:'1v1',players:{player1:{uid:'a',name:'Ana'},player2:{uid:'b',name:'Beto'}},scores:{player1:7,player2:3},targetPoints:20,finished:false,call:'retruco',house:false});
 assert.ok(!JSON.stringify(e).includes('espada'));
 assert.equal(liveTableEntry({...m,status:'waiting'}),null);
 assert.equal(liveTableEntry({...m,closedAt:5}),null);
 assert.equal(liveTableEntry({...m,session:{room:{...m.session.room,status:'closed'}}}),null);
 assert.equal(liveTableEntry({...m,status:'settled'}).finished,true);
 assert.equal(liveTableEntry({...m,mode:'2v2'}).mode,'2v2');
});
