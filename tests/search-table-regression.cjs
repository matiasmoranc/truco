'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createTable,joinTable,tableOperation,publicTable}=require('../functions/table-service.cjs');
const base=()=>({wallets:{a:{balance:10,locked:0},b:{balance:10,locked:0}}});
const make=(mode='1v1')=>createTable(base(),{code:'ABCDE',id:'m1',uid:'a',name:'Ana',stake:0,targetPoints:20,mode,now:1000});
const act=(l,uid,command,now=2000)=>tableOperation(l,{code:'ABCDE',uid,command,requestId:'r'+now,now});

test('"Buscar gente en línea": the creator changes the points while waiting, and the table shows them',()=>{
 let l=act(make(),'a',{kind:'set-points',value:30});
 assert.equal(l.matches.m1.targetPoints,30);assert.equal(publicTable(l.matches.m1).targetPoints,30);
 assert.throws(()=>act(make(),'a',{kind:'set-points',value:25}),/Puntaje/);
 const joined=joinTable(make(),{code:'ABCDE',uid:'b',name:'Beto',now:1500});
 assert.throws(()=>act(joined,'b',{kind:'set-points',value:10}));
 const two=act(make('2v2'),'a',{kind:'set-points',value:10});assert.equal(two.matches.m1.targetPoints,10);
});

test('"Buscar gente en línea": with nobody joining, a bot takes the other seat and the match starts',()=>{
 const l=act(make(),'a',{kind:'add-bot'}),m=l.matches.m1;
 assert.equal(m.status,'reserved');assert.equal(m.house,'player2');
 assert.match(m.players.player2.uid,/^house_Bot_/);assert.match(m.players.player2.name,/^Bot /);
 assert.ok(m.session);assert.equal(m.session.room.targetPoints,20);
 // Once someone else is seated there is nothing to fill.
 const joined=joinTable(make(),{code:'ABCDE',uid:'b',name:'Beto',now:1500});
 assert.throws(()=>act(joined,'a',{kind:'add-bot'}));
});
