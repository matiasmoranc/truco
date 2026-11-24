import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD,HEAR_RADIUS,clampPosition,spawnPosition,acceptMove,acceptSay,hears,allowListed,liveTableEntry,presenceActive,weekKey,topOf,spokenWords,acceptOrder,BAR_MAX,barOpen,barFull,cleanProblem,barTables,barLayout,cleanLook,acceptGesture,acceptInvite,inviteOpen,cleanArming,barRequest,REQUEST_MS,barStaff,barHouseCount} from '../src/bar-core.js';

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
 assert.deepEqual(e,{mode:'1v1',players:{player1:{uid:'a',name:'Ana'},player2:{uid:'b',name:'Beto'}},scores:{player1:7,player2:3},targetPoints:20,finished:false,call:'retruco',house:false,here:{player1:true,player2:true},hand:1,dealer:null,muestra:null,played:[],says:[],sign:null,tricks:[],flor:[],over:false,turn:null});
 assert.deepEqual(liveTableEntry(m,{player2:{uid:'b',online:false}}).here,{player1:true,player2:false},'who left the table');
 assert.equal(liveTableEntry(m,{player2:{uid:'x',online:false}}).here.player2,true,'presence of someone else does not count');
 assert.ok(!JSON.stringify(e).includes('espada'));
 assert.equal(liveTableEntry({...m,status:'waiting'}),null);
 assert.equal(liveTableEntry({...m,closedAt:5}),null);
 assert.equal(liveTableEntry({...m,session:{room:{...m.session.room,status:'closed'}}}),null);
 assert.equal(liveTableEntry({...m,status:'settled'}).finished,true);
 assert.equal(liveTableEntry({...m,mode:'2v2'}).mode,'2v2');
});

test('BAR: the table shows the cards already played this hand, the muestra and who deals, never a hand',()=>{
 const card=(rank,suit)=>({id:'x',rank,suit,label:String(rank)});
 const room={status:'started',scores:{player1:0,player2:0},handNumber:3,dealer:'player2',muestra:card(11,'♣'),
  tricks:[{winner:'player2',played:[{playerId:'player1',card:card(2,'♥')},{playerId:'player2',card:card(10,'♠')}]}],
  trickCards:[{playerId:'player2',card:card(7,'♦')}]};
 const m={mode:'1v1',status:'active',players:{player1:{uid:'a',name:'A'},player2:{uid:'b',name:'B'}},session:{room,hands:{player1:[card(1,'♠')]}}};
 const e=liveTableEntry(m);
 assert.equal(e.hand,3);assert.equal(e.dealer,'player2');assert.deepEqual(e.muestra,{r:11,s:'♣'});
 assert.deepEqual(e.played,[{p:'player1',r:2,s:'♥',t:0},{p:'player2',r:10,s:'♠',t:0},{p:'player2',r:7,s:'♦',t:1}]);
 assert.deepEqual(e.tricks,['player2']);assert.deepEqual(e.flor,[]);assert.equal(e.over,false);
 const sung=liveTableEntry({...m,session:{room:{...room,flors:{player1:33},pendingNextHand:{id:'n'}}}});
 assert.deepEqual(sung.flor,['player1']);assert.equal(sung.over,true);assert.ok(!JSON.stringify(sung).includes('33'),'the points of the flor are not sent');
 // While a trick is being resolved its cards are in both lists: each card shows once.
 assert.equal(liveTableEntry({...m,session:{room:{...room,trickCards:room.tricks[0].played}}}).played.length,2);
 assert.ok(!JSON.stringify(e).includes('"r":1,'),'the card someone holds is never sent');
});

test('BAR: online means the game on screen lately, like the admin',()=>{
 const now=1_000_000;
 assert.equal(presenceActive(null,now),false);
 assert.equal(presenceActive({s1:{at:now-30000}},now),true);
 assert.equal(presenceActive({s1:{at:now-91000}},now),false,'a game left in the background stops pulsing');
 assert.equal(presenceActive({s1:{at:now-200000},s2:{at:now-1000}},now),true);
 assert.equal(presenceActive({s1:{at:'x'}},now),false);
});

test('BAR: the week of the board goes from Monday 00:00 to Monday 00:00, Uruguay time',()=>{
 const uy=(s)=>Date.parse(s+'-03:00');
 assert.equal(weekKey(uy('2026-11-16T00:00:00')),'2026-11-16','Monday at midnight starts the week');
 assert.equal(weekKey(uy('2026-11-15T23:59:59')),'2026-11-09','Sunday night is still the week before');
 assert.equal(weekKey(uy('2026-11-20T22:30:00')),'2026-11-16','Friday night (already Saturday in UTC)');
 assert.equal(weekKey(uy('2026-11-22T23:00:00')),'2026-11-16');
});

test('BAR: the board keeps the highest ten, in a fixed order',()=>{
 assert.deepEqual(topOf({a:3,b:5,c:0,d:'x',e:5},10),[['b',5],['e',5],['a',3]]);
 assert.equal(topOf(Object.fromEntries(Array.from({length:15},(_,i)=>['u'+i,i+1]))).length,10);
 assert.deepEqual(topOf(null),[]);
});

test('BAR: every page sees each table in the same place',()=>{
 const person=(uid,mode='1v1',extra={})=>({status:'waiting',mode,players:{player1:{uid,name:uid}},...extra});
 // An empty bar: one free table of each kind.
 let layout=barLayout(null,barTables({},{}));
 assert.deepEqual(layout,{cells:{0:{k:'1v1',c:null},1:{k:'2v2',c:null}}});
 // Someone sits at the free 1 vs 1 and opens a table: it is that same table; a new free one is brought.
 layout=barLayout(layout,barTables({AAAA:person('ana')},{}));
 assert.deepEqual(layout.cells[0],{k:'1v1',c:'AAAA'});
 assert.deepEqual(layout.cells[1],{k:'2v2',c:null});
 assert.deepEqual(layout.cells[2],{k:'1v1',c:null});
 // The game starts: the table stays where it was.
 const live={AAAA:{mode:'1v1',players:{player1:{uid:'ana'},player2:{uid:'beto'}},finished:false}};
 layout=barLayout(layout,barTables({},live));
 assert.deepEqual(layout.cells[0],{k:'1v1',c:'AAAA'});
 // A waiting table that changes to 2 vs 2 keeps its place and its kind follows.
 layout=barLayout(layout,barTables({BBBB:person('caro')},live));
 const at=Object.entries(layout.cells).find(([,v])=>v.c==='BBBB')[0];
 layout=barLayout(layout,barTables({BBBB:person('caro','2v2')},live));
 assert.deepEqual(layout.cells[at],{k:'2v2',c:'BBBB'});
 // The same rooms always give the same layout (any page, any time).
 assert.deepEqual(barLayout(layout,barTables({BBBB:person('caro','2v2')},live)),layout);
 // Gone: the table is taken away; still one free table of each kind and no cell twice.
 layout=barLayout(layout,barTables({},{}));
 const values=Object.values(layout.cells);
 assert.equal(values.filter(v=>v.c).length,0);
 assert.deepEqual(values.map(v=>v.k).sort(),['1v1','2v2']);
});

test('BAR: a free table asked from the waiter at the back',()=>{
 const t0=1000;
 let layout=barLayout(null,barTables({},{}),{now:t0});
 layout=barRequest(layout,{uid:'ana',k:'2v2',p:30,now:t0});
 assert.deepEqual(layout.cells[29],{k:'2v2',c:null,p:30,by:'ana',at:t0});
 // It stays as it is; the usual free tables too.
 assert.deepEqual(barLayout(layout,barTables({},{}),{now:t0+1}),layout);
 // A new one from the same person replaces it; bad kinds or points are refused.
 layout=barRequest(layout,{uid:'ana',k:'1v1',p:10,now:t0});
 assert.equal(Object.values(layout.cells).filter(v=>v.p).length,1);
 assert.equal(barRequest(layout,{uid:'beto',k:'3v3',p:10,now:t0}),null);
 assert.equal(barRequest(layout,{uid:'beto',k:'1v1',p:15,now:t0}),null);
 const cell=Object.entries(layout.cells).find(([,v])=>v.p)[0];
 // A 1 vs 1 at 20 points takes the usual free table; one at 10 takes the asked one.
 const room=(uid,points)=>({status:'waiting',mode:'1v1',targetPoints:points,players:{player1:{uid,name:uid}}});
 const rooms={A:room('caro',20),B:room('dani',10)},points=new Map([['A',20],['B',10]]);
 layout=barLayout(layout,barTables(rooms,{}),{points,now:t0+2});
 assert.equal(layout.cells[0].c,'A');
 assert.deepEqual(layout.cells[cell],{k:'1v1',c:'B'});
 assert.equal(Object.values(layout.cells).filter(v=>v.p).length,0);
 // At most 4 asked at once; unused, it is taken away after 10 minutes.
 for(const u of ['a','b','c','d'])layout=barRequest(layout,{uid:u,k:'1v1',p:40,now:t0})||layout;
 assert.equal(barRequest(layout,{uid:'e',k:'1v1',p:40,now:t0}),null);
 layout=barLayout(layout,barTables(rooms,{}),{points,now:t0+REQUEST_MS});
 assert.equal(Object.values(layout.cells).filter(v=>v.p).length,0);
});

test('BAR: which tables the room shows',()=>{
 const house=(code,points=20)=>[code,{status:'waiting',mode:'1v1',targetPoints:points,players:{player1:{uid:'house_x',name:'Bot'}}}];
 const rooms=Object.fromEntries([house('H1'),house('H2'),house('H3'),house('H4',30),['P1',{status:'waiting',mode:'2v2',players:{player1:{uid:'u1'}}}]]);
 assert.deepEqual([...barTables(rooms,{})].sort(),[['H1','1v1'],['H2','1v1'],['P1','2v2']]);
 assert.deepEqual([...barTables(rooms,{},new Set(['H3']))].map(([c])=>c).sort(),['H1','H3','P1'],'a house table already shown stays');
 const over={finished:true,mode:'1v1',players:{player1:{uid:'a'},player2:{uid:'bot:1'}},here:{player1:false,player2:true}};
 assert.equal(barTables({},{X:over}).has('X'),false,'a game over everyone left is gone');
 assert.equal(barTables({},{X:{...over,here:{player1:true}}}).has('X'),true);
});

test('BAR: a look keeps only known choices, and facial hair only on men',()=>{
 assert.deepEqual(cleanLook({g:'f',s:7,h:'braids',hc:10,t:14,o:'pollera',p:7,z:5,a:'boina',e:'sol',n:'perlas',ac:3,f:'barba',r:true,extra:'x'}),
  {g:'f',s:7,h:'braids',hc:10,t:14,o:'pollera',p:7,q:'jean',z:5,y:'champion',a:'boina',e:'sol',n:'perlas',ac:3,d:3,f:'',r:true,k:2,w:2});
 assert.deepEqual(cleanLook({g:'m',h:'quiff',o:'saco',q:'jogging',y:'bota',e:'aviador',a:'piluso',f:'tres',s:9,t:17,p:9,z:7}),
  {g:'m',s:9,h:'quiff',hc:0,t:17,o:'saco',p:9,q:'jogging',z:7,y:'bota',a:'piluso',e:'aviador',n:'',ac:0,d:0,f:'tres',r:false,k:2,w:2});
 assert.deepEqual(cleanLook({g:'x',s:99,h:'<b>',t:-1,o:'traje',q:'falda',y:'ojotas',a:'corona',e:'x',n:'x',f:'x',r:'yes'}),
  {g:'m',s:0,h:'short',hc:0,t:0,o:'remera',p:0,q:'jean',z:0,y:'champion',a:'',e:'',n:'',ac:0,d:0,f:'',r:false,k:2,w:2});
 assert.equal(cleanLook(null),null);
 const tall=cleanLook({g:'m',k:4,w:0,h:'mullet',a:'gaucho',e:'gatito',f:'manubrio',q:'cargo',y:'alpargata',o:'sueter'});
 assert.deepEqual([tall.k,tall.w,tall.h,tall.a,tall.e,tall.f,tall.q,tall.y,tall.o],[4,0,'mullet','gaucho','gatito','manubrio','cargo','alpargata','sueter']);
 assert.deepEqual([cleanLook({k:9,w:-1}).k,cleanLook({k:1.5}).k],[2,2]);
});

test('BAR: a look saved before keeps its glasses, scarf and beard',()=>{
 const old=cleanLook({g:'m',s:2,h:'short',hc:1,t:3,o:'camisa',p:1,a:'lentes',b:true});
 assert.equal(old.e,'lentes');assert.equal(old.a,'');assert.equal(old.f,'barba');
 assert.equal(cleanLook({g:'f',a:'bufanda'}).n,'bufanda');
 assert.equal(cleanLook({g:'m',a:'sombrero'}).a,'sombrero');
});

test('BAR: gestures, invitations and choosing a table are limited',()=>{
 assert.equal(acceptGesture({},'wave',5000),'wave');
 assert.equal(acceptGesture({gestureAt:4500},'wave',5000),null,'too soon');
 assert.equal(acceptGesture({},'dance',5000),null);
 assert.deepEqual(acceptInvite({uid:'a'},'b',30,100000),{to:'b',points:30});
 assert.equal(acceptInvite({uid:'a'},'a',20,100000),null,'not yourself');
 assert.equal(acceptInvite({uid:'a',invitedAt:95000},'b',20,100000),null,'one every 15 s');
 assert.equal(acceptInvite({uid:'a'},'b',7,100000).points,20);
 assert.equal(inviteOpen({invitedTo:'b',invitedAt:1000},'b',60000),true);
 assert.equal(inviteOpen({invitedTo:'b',invitedAt:1000},'b',200000),false,'too late');
 assert.equal(inviteOpen({invitedTo:'c',invitedAt:1000},'b',2000),false);
 assert.deepEqual(cleanArming(3,40),{cell:3,points:40});
 assert.equal(cleanArming(null,20),null);
 assert.equal(cleanArming(99,20),null);
});

test('BAR: what the players say out loud, and who; a signal never says which',()=>{
 assert.equal(spokenWords('Ana canta truco.'),'¡Truco!');
 assert.equal(spokenWords('Ana canta real envido.'),'¡Real envido!');
 assert.equal(spokenWords('Beto dice QUIERO'),'Quiero');
 assert.equal(spokenWords('Beto no quiere. Ana suma 1.'),'No quiero');
 assert.equal(spokenWords('Ana canta 27 tantos.'),'27 tantos');
 assert.equal(spokenWords('Ana cantó flor.'),'¡Flor!');
 assert.equal(spokenWords('Ana se lleva la ronda.'),null);
 const room={status:'started',scores:{player1:0,player2:0},handNumber:2,
  feed:[{text:'Beto dice QUIERO',time:30},{text:'Ana canta truco.',time:20},{text:'Nueva mano. Empieza Ana.',time:10},{text:'Ana canta envido.',time:5}],
  teamSignal:{id:'s1',from:'player2',to:'player1',value:'grita',text:'Gritá',handNumber:2}};
 const m={mode:'1v1',status:'active',players:{player1:{uid:'a',name:'Ana'},player2:{uid:'b',name:'Beto'}},session:{room}};
 const e=liveTableEntry(m);
 assert.deepEqual(e.says,[{id:'20player1',p:'player1',w:'¡Truco!'},{id:'30player2',p:'player2',w:'Quiero'}],'only this hand, oldest first');
 assert.deepEqual(e.sign,{id:'s1',p:'player2'});
 assert.ok(!JSON.stringify(e).includes('grita'),'the signal itself is never sent');
});

test('BAR: ordering at the counter: a drink goes to the hand, food stays where it was asked',()=>{
 assert.deepEqual(acceptOrder({x:400.4},'cerveza',10000),{hold:'cerveza'});
 assert.deepEqual(acceptOrder({x:400.4},'papas',10000),{food:{item:'papas',x:400}});
 assert.equal(acceptOrder({},'pizza',10000),null);
 assert.equal(acceptOrder({orderedAt:9000},'agua',10000),null,'one every 3 s');
});

test('BAR: open to everyone with an account when switched on, and full at 50 people',()=>{
 assert.equal(barOpen({BAR_OPEN:'1'},'anyone'),true);
 assert.equal(barOpen({BAR_OPEN:'0',BAR_ALLOW:'a'},'anyone'),false,'closed: only the list');
 assert.equal(barOpen({BAR_OPEN:'0',BAR_ALLOW:'a'},'a'),true);
 const inside=new Set(Array.from({length:BAR_MAX},(_,i)=>'u'+i));
 assert.equal(barFull(inside,'new'),true,'50 inside: full');
 assert.equal(barFull(inside,'u3'),false,'someone already inside comes back');
 inside.delete('u0');assert.equal(barFull(inside,'new'),false);
 assert.deepEqual(cleanProblem('  se trabó la mesa  ','abcd1234-xy'),{message:'se trabó la mesa',requestId:'abcd1234-xy'});
 assert.ok(cleanProblem('hola','abcd1234').error,'too short');
 assert.ok(cleanProblem('algo pasó acá','x').error,'bad id');
});

test('BAR: only the staff walks behind the counter',()=>{
 const env={BAR_STAFF:'boss1'};
 assert.equal(barStaff(env,'boss1'),true);assert.equal(barStaff(env,'ana'),false);assert.equal(barStaff({},'boss1'),false);
 assert.equal(acceptMove({},{x:500,y:60},10000).y,190);
 assert.equal(acceptMove({staff:true},{x:500,y:60},10000).y,60);
 assert.equal(acceptMove({staff:true},{x:500,y:5},10000).y,40);
 // Behind the counter the staff talks and hears twice as far; in front, as everyone.
 const boss={staff:true,x:500,y:100},ana={x:500,y:300};
 assert.equal(hears(boss,ana),true);assert.equal(hears(ana,boss),true);
 assert.equal(hears({...boss,y:200},{x:500,y:400}),false);assert.equal(hears({x:500,y:100},ana),false);
});

test('BAR: 2 to 5 tables of the house wait for a rival; one taken comes back a while later',()=>{
 const house=code=>({status:'waiting',mode:'1v1',targetPoints:20,players:{player1:{uid:'house_'+code}}});
 const rooms=Object.fromEntries(['H1','H2','H3','H4','H5','H6','H7'].map(c=>[c,house(c)]));
 assert.equal(barTables(rooms,{}).size,2,'two by default');
 assert.equal(barTables(rooms,{},new Set(),{house:5}).size,5);
 // Already shown ones stay.
 assert.deepEqual([...barTables(rooms,{},new Set(['H7']),{house:2}).keys()].sort(),['H1','H7']);
 const h={};
 for(let i=0;i<40;i++){const n=barHouseCount({},0,()=>i/40);assert.ok(n>=2&&n<=5);}
 assert.equal(barHouseCount(h,0,()=>0.99),5);
 // Someone sat at one: one fewer until the refill time, never under 2.
 h.taken=[60000];assert.equal(barHouseCount(h,1000),4);
 assert.equal(barHouseCount(h,60001),5);
 h.taken=[9e9,9e9,9e9,9e9];assert.equal(barHouseCount(h,1000),2);
});
