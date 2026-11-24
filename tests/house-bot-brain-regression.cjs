const {test}=require('node:test');const assert=require('node:assert/strict');
const duel=require('../functions/duel-bot.cjs');
const {versusStats}=require('../functions/social-service.cjs');

const card=(suit,rank)=>({id:suit+'-'+rank,rank,suit:{oro:'♦',copa:'♥',espada:'♠',basto:'♣'}[suit]});
// The bot (player1) to move at the start of a hand, with these cards and tantos.
function table({hand,tantos,scores={player1:0,player2:0},target=30,bet=null,trucoLevel=1,trickNo=1}){
 return {hands:{player1:hand,player2:[card('oro',4),card('copa',5),card('basto',6)]},originals:{player1:hand},truth:{player1:tantos,player2:20},
  room:{status:'started',turn:'player1',mano:'player1',handNumber:1,trickNo,playedCount:0,tricks:[],trickCards:[],scores,targetPoints:target,
   muestra:card('oro',10),flors:{},trucoLevel,pendingBet:bet,envidoClosed:false,players:{player1:{uid:'house_Bot_Pepe',name:'Bot Pepe'},player2:{uid:'u',name:'Ana'}}}};
}
const weak=[card('copa',4),card('basto',5),card('espada',6)];
const sings=(s,random)=>duel.botCommands(s,'player1',random).filter(c=>c.kind==='call'&&['envido','real','falta'].includes(c.value)).map(c=>c.value);

test('House bot envido: always with 27 or more, never with 22 to 26, a bluff 3 times in 10 under 22',()=>{
 assert.deepEqual(sings(table({hand:weak,tantos:27}),()=>0.99),['envido']);
 assert.deepEqual(sings(table({hand:weak,tantos:31}),()=>0.99),['real']);
 for(const t of [22,24,26])assert.deepEqual(sings(table({hand:weak,tantos:t}),()=>0),[]);
 assert.deepEqual(sings(table({hand:weak,tantos:20}),()=>0.29),['envido']);
 assert.deepEqual(sings(table({hand:weak,tantos:20}),()=>0.31),[]);
});

test('House bot reads the score: behind or with the rival about to win it takes chances and sings the falta envido',()=>{
 assert.equal(duel.scoreMood(table({hand:weak,tantos:20,scores:{player1:5,player2:20}}),'player1').risk,1);
 assert.equal(duel.scoreMood(table({hand:weak,tantos:20,scores:{player1:20,player2:5}}),'player1').risk,-1);
 assert.equal(duel.scoreMood(table({hand:weak,tantos:20,scores:{player1:10,player2:10}}),'player1').risk,0);
 // 30 tantos: falta envido when behind, an ordinary envido when the game is even.
 assert.deepEqual(sings(table({hand:weak,tantos:30,scores:{player1:5,player2:26}}),()=>0.99),['falta']);
 assert.deepEqual(sings(table({hand:weak,tantos:30,scores:{player1:10,player2:10}}),()=>0.99),['envido']);
 // A falta envido against it: well behind it wants it with 29, well ahead it wants 32.
 const falta={type:'envido',caller:'player2',responder:'player1',called:'falta',calls:['falta'],stake:5};
 const answer=(t,scores)=>duel.botCommands(table({hand:weak,tantos:t,scores,bet:falta}),'player1',()=>0.99)[0].value;
 assert.equal(answer(29,{player1:5,player2:20}),'yes');
 assert.equal(answer(29,{player1:10,player2:10}),'no');
 assert.equal(answer(31,{player1:22,player2:5}),'no');
});

test('House bot memory: two envido bluffs found out and it believes the rival less',()=>{
 let mem=null;const s=table({hand:weak,tantos:20});
 // Two hands where the rival sang envido and then declared 21 and "son buenas".
 for(const [hand,said] of [[1,21],[2,undefined]]){
  const called={...s,room:{...s.room,handNumber:hand,pendingBet:{type:'envido',caller:'player2',responder:'player1',called:'envido',stake:2}}};
  mem=duel.observe(mem,{...s,room:{...s.room,handNumber:hand}},called,'player1');
  const settled={...s,room:{...s.room,handNumber:hand,pendingBet:null,envidoClosed:true,envidoAudit:{handNumber:hand,reveals:said==null?{player1:28}:{player1:28,player2:said}}}};
  mem=duel.observe(mem,called,settled,'player1');
 }
 assert.equal(mem.bluffs,2);assert.equal(duel.suspicion(mem),1);
 // An envido with 24: it says no to an honest rival, quiero to one who bluffed twice.
 const envido={type:'envido',caller:'player2',responder:'player1',called:'envido',calls:['envido'],stake:2};
 const s2=table({hand:weak,tantos:24,bet:envido});
 assert.equal(duel.botCommands(s2,'player1',()=>0.99,null)[0].value,'no');
 assert.equal(duel.botCommands(s2,'player1',()=>0.99,mem)[0].value,'yes');
 // An honest envido (declared 30) takes half a bluff back.
 const called={...s,room:{...s.room,handNumber:3,pendingBet:{type:'envido',caller:'player2',responder:'player1',called:'envido',stake:2}}};
 mem=duel.observe(mem,{...s,room:{...s.room,handNumber:3}},called,'player1');
 mem=duel.observe(mem,called,{...s,room:{...s.room,handNumber:3,pendingBet:null,envidoAudit:{handNumber:3,reveals:{player1:25,player2:30}}}},'player1');
 assert.equal(mem.bluffs,1.5);
});

test('House bot memory: a truco it accepted and the rival went to the deck is a bluff',()=>{
 const s=table({hand:weak,tantos:20});let mem=null;
 const called={...s,room:{...s.room,trickNo:2,pendingBet:{type:'truco',caller:'player2',responder:'player1',stake:2}}};
 mem=duel.observe(mem,s,called,'player1');
 const accepted={...s,room:{...s.room,trickNo:2,trucoLevel:2,pendingBet:null}};
 mem=duel.observe(mem,called,accepted,'player1');
 const folded={...s,room:{...s.room,handNumber:2,trucoLevel:1,callNotice:{kind:'fold',from:'player2',handNumber:1}}};
 mem=duel.observe(mem,accepted,folded,'player1');
 assert.equal(mem.bluffs,1);
});

test('Head to head counts each bot of the house apart, never the 2 vs 2 seat bots',()=>{
 const match=(id,p2,winner)=>({id,status:'settled',mode:'1v1',players:{player1:{uid:'me',name:'Yo'},player2:{uid:p2,name:p2==='house_Bot_Pepe'?'Bot Pepe':'Bot'}},winner,settledAt:id.length,session:{room:{scores:{player1:20,player2:12}}}});
 const ledger={matches:{a:match('a','house_Bot_Pepe','me'),bb:match('bb','house_Bot_Pepe','house_Bot_Pepe'),ccc:match('ccc','house_Bot_Pepe','me'),dddd:match('dddd','bot:player2','me')}};
 const out=versusStats(ledger,'me');
 assert.deepEqual(Object.keys(out),['house_Bot_Pepe']);
 assert.equal(out.house_Bot_Pepe.house,true);assert.equal(out.house_Bot_Pepe.won,2);assert.equal(out.house_Bot_Pepe.lost,1);
 assert.equal(out.house_Bot_Pepe.name,'Bot Pepe');
});

test('A game against a bot of the house starts without the friends notebook',()=>{
 const T=require('../functions/table-service.cjs'),{houseUid}=require('../functions/bot-seat.cjs');
 let l=T.createTable({wallets:{u2:{balance:5,locked:0}},matches:{},tables:{}},{code:'ABCDE',id:'m1',uid:houseUid('Bot Pepe'),name:'Bot Pepe',stake:0,targetPoints:20,house:true,now:1000});
 l=T.joinTable(l,{code:'ABCDE',uid:'u2',name:'Ana',now:2000});
 assert.equal(l.matches.m1.session.room.introUntil,undefined);
});
