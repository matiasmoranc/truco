import test from 'node:test';
import assert from 'node:assert/strict';
import {createTableEngine,slimMatch,CodeTakenError,BOT_DELAY_MS,BOT_AFTER_BOT_MS} from '../src/table-engine.js';
import {createFirebaseBank} from '../src/firebase-bank.js';
import adminService from '../../functions/admin-service.cjs';
import playerService from '../../functions/player-service.cjs';
import teamBot from '../../functions/team-bot.cjs';
import teamReferee from '../../functions/team-referee.cjs';

// The Firebase bank over an in-memory Realtime Database.
function memoryBank(economy){
 const bank={economy,transactions:0,writes:0,
  async read(){return {etag:'x',value:bank.economy};},
  async transaction(path,update){
   bank.transactions++;
   // Mimic RTDB: values round-trip through JSON and nulls disappear.
   const current=bank.economy?JSON.parse(JSON.stringify(bank.economy,(k,v)=>v===null?undefined:v)):null;
   const next=update(current);if(next===undefined)return {committed:false};
   bank.writes++;bank.economy=JSON.parse(JSON.stringify(next));return {committed:true};
  }};
 return bank;
}
const wallets=()=>({wallets:{a:{balance:12,locked:0,lastGrantAt:1},b:{balance:7,locked:0,lastGrantAt:1},c:{balance:9,locked:0,lastGrantAt:1},d:{balance:9,locked:0,lastGrantAt:1}}});
function setup(extra={}){
 let now=1000;const bank=memoryBank(extra.economy||wallets());
 const engine=createTableEngine({code:'ABCDE',bank:createFirebaseBank(bank),clock:()=>now});
 return {bank,engine,advance:ms=>{now+=ms;},now:()=>now};
}
const total=economy=>Object.values(economy.wallets).reduce((n,w)=>n+w.balance+w.locked,0);

test('Create and join reserve stakes in the ledger; ordinary plays never touch it',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1',secret:null});
 assert.deepEqual(bank.economy.wallets.a,{balance:7,locked:5,lastGrantAt:1});
 assert.equal(engine.lobbyEntry().status,'waiting');
 advance(100);await engine.join({uid:'b',name:'Ricky'},{});
 assert.equal(bank.economy.wallets.b.locked,5);assert.equal(engine.lobbyEntry(),null);
 const writes=bank.writes,room=engine.publicRoom();
 assert.equal(room.status,'started');
 const turn=room.turn,uid=engine.match.players[turn].uid,card=engine.handFor(uid).hand[0];
 advance(100);await engine.act(uid,{command:{kind:'play',cardId:card.id},requestId:'r1',expectedMatchId:'game1'});
 assert.equal(engine.handFor(uid).hand.length,2);
 advance(100);await engine.act('a',{command:{kind:'chat',text:'Buena'},requestId:'r2'});
 advance(100);await engine.tick();
 assert.equal(bank.writes,writes,'plays, chat and ticks stay in memory');
 // Ledger copy has no private data.
 const stored=JSON.stringify(bank.economy.matches.game1);
 for(const secret of ['"hands"','drawPool','originals','truth','requests'])assert.ok(!stored.includes(secret),secret);
 assert.equal(bank.economy.matches.game1.live,'cloudflare');
});

test('Hands are private: other players and outsiders do not receive them',async()=>{
 const {engine}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:1,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 const a=engine.handFor('a').hand.map(c=>c.id),b=engine.handFor('b').hand.map(c=>c.id);
 assert.equal(a.length,3);assert.equal(b.length,3);assert.ok(a.every(id=>!b.includes(id)));
 assert.equal(engine.handFor('c'),null);
 const json=JSON.stringify(engine.publicRoom());for(const id of [...a,...b])assert.ok(!json.includes('"'+id+'"')||engine.publicRoom().muestra?.id===id);
});

test('Abandon settles the pot once in the ledger with a history receipt',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 advance(500);await engine.act('b',{command:{kind:'abandon'},requestId:'q1'});
 assert.equal(engine.match.status,'settled');
 assert.deepEqual(bank.economy.wallets.a,{balance:17,locked:0,lastGrantAt:1});
 assert.deepEqual(bank.economy.wallets.b,{balance:2,locked:0,lastGrantAt:1});
 assert.equal(total(bank.economy),total(wallets()));
 assert.ok(Object.keys(bank.economy.history.game1).length>=1);
 // The player history keeps working from the slim receipt.
 const history=playerService.personalHistory(bank.economy,'a');
 assert.equal(history.matches[0].delta,5);assert.equal(history.matches[0].reason,'abandon');
});

test('A full game played by folding ends through the timers and pays once',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 for(let n=0;n<40&&engine.match.status==='reserved';n++){
  const room=engine.publicRoom();
  if(room.status==='started'&&!room.pendingNextHand&&!room.resolvingTrick&&!room.pendingBet){
   try{await engine.act('b',{command:{kind:'fold'},requestId:'f'+n});}catch{}
  }
  advance(6000);await engine.tick();
 }
 assert.equal(engine.match.status,'settled');
 assert.equal(bank.economy.wallets.a.balance,17);assert.equal(bank.economy.wallets.b.balance,2);
});

test('Waiting tables expire through the alarm and refund the host',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 assert.equal(engine.nextDeadline(),1000+600000);
 advance(600000);await engine.tick();
 assert.equal(engine.match.status,'refunded');assert.deepEqual(bank.economy.wallets.a,{balance:12,locked:0,lastGrantAt:1});
 assert.ok(engine.isFinished());
});

test('Disconnection for 45 seconds forfeits; presence is public',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 engine.setOnline('a',true);engine.setOnline('b',true);advance(1000);engine.setOnline('b',false);
 assert.equal(engine.publicRoom().connectionPresence.player2.online,false);
 advance(44000);await engine.tick();assert.equal(engine.match.status,'reserved');
 advance(1000);await engine.tick();assert.equal(engine.match.status,'settled');
 assert.equal(bank.economy.wallets.a.balance,17);
});

test('Rematch reserves new stakes in the ledger',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:2,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 await engine.act('b',{command:{kind:'abandon'},requestId:'q1'});
 advance(10);await engine.act('a',{command:{kind:'rematch',value:'request'},requestId:'r1'});
 advance(10);await engine.act('b',{command:{kind:'rematch',value:'accept'},requestId:'r2'});
 assert.notEqual(engine.match.id,'game1');assert.equal(engine.match.status,'reserved');
 assert.equal(bank.economy.wallets.a.locked,2);assert.equal(bank.economy.wallets.b.locked,2);
 assert.equal(bank.economy.tables.ABCDE,engine.match.id);
 assert.equal(total(bank.economy),total(wallets()));
});

test('2v2 tables reserve each seat and start with four players',async()=>{
 const {bank,engine}=setup();
 await engine.create({uid:'a',name:'A'},{id:'team1',stake:1,targetPoints:10,mode:'2v2'});
 await engine.join({uid:'b',name:'B'},{team:'player2'});
 await engine.join({uid:'c',name:'C'},{team:'player1'});
 assert.equal(engine.lobbyEntry().status,'waiting');
 await engine.join({uid:'d',name:'D'},{team:'player2'});
 assert.equal(engine.match.status,'reserved');assert.equal(engine.lobbyEntry(),null);
 for(const uid of ['a','b','c','d'])assert.equal(bank.economy.wallets[uid].locked,1);
 assert.ok(engine.handFor('a').partnerHand);
});

test('Code already used in the ledger is reported so the client picks another',async()=>{
 const economy=wallets();economy.tables={ABCDE:'old'};economy.matches={old:{id:'old',status:'settled'}};
 const {engine}=setup({economy});
 await assert.rejects(engine.create({uid:'a',name:'Mati'},{id:'game1',stake:1,targetPoints:10,mode:'1v1'}),CodeTakenError);
 assert.equal(engine.match,null);
});

test('Insufficient credits reject the join without charging anyone',async()=>{
 const {bank,engine}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:8,targetPoints:10,mode:'1v1'});
 await assert.rejects(engine.join({uid:'b',name:'Ricky'},{}),/créditos/);
 assert.deepEqual(bank.economy.wallets.b,{balance:7,locked:0,lastGrantAt:1});
 assert.equal(engine.match.status,'waiting');
});

test('Admin close refunds a live match and the table closes',async()=>{
 const {bank,engine}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 await engine.adminClose({actor:'admin1',requestId:'adm1',reason:'Prueba'},adminService.adminLedgerChange);
 assert.equal(engine.publicRoom().status,'closed');
 assert.equal(bank.economy.wallets.a.balance,12);assert.equal(bank.economy.wallets.b.balance,7);
 assert.ok(bank.economy.adminAudit.adm1);
});

test('A match closed in the ledger by someone else closes the live table',async()=>{
 const {bank,engine}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:5,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 bank.economy.matches.game1.status='refunded';
 await engine.act('a',{command:{kind:'abandon'},requestId:'x'});
 assert.equal(engine.publicRoom().status,'closed');
});

test('Slim receipt keeps the fields history and admin need',()=>{
 const slim=slimMatch({id:'x',code:'ABCDE',status:'settled',players:{},requests:{a:true},session:{hands:{},room:{status:'complete',scores:{player1:10},matchResult:{reason:'abandon'},feed:[1]}}});
 assert.deepEqual(slim.session.room.scores,{player1:10});assert.equal(slim.requests,undefined);assert.equal(slim.session.hands,undefined);
});

test('Leaving a finished match closes it with the match-left reason',async()=>{
 const {engine}=setup();
 await engine.create({uid:'a',name:'Mati'},{id:'game1',stake:1,targetPoints:10,mode:'1v1'});
 await engine.join({uid:'b',name:'Ricky'},{});
 await engine.act('b',{command:{kind:'abandon'},requestId:'q1'});
 await engine.act('a',{command:{kind:'cancel'},requestId:'c1'});
 assert.equal(engine.publicRoom().status,'closed');assert.equal(engine.publicRoom().closeReason,'match-left');
});

test('In maintenance no table can move credits, and the ledger stays untouched',async()=>{
 const {bank}=setup();const before=JSON.stringify(bank.economy);
 const engine=createTableEngine({code:'ABCDE',bank:{prefetch:()=>null,apply:async()=>{throw new Error('Estamos actualizando los créditos. Volvé a intentar en unos minutos.');}}});
 await assert.rejects(engine.create({uid:'a',name:'Mati'},{id:'g',stake:1,targetPoints:10,mode:'1v1'}),/actualizando/);
 assert.equal(engine.match,null);assert.equal(JSON.stringify(bank.economy),before);
});

// "Usar bot" in 2v2 tables: bots fill empty seats, play on their own and never touch a wallet.
async function playOut(engine,advance,{maxSteps=20000}={}){
 const humans=Object.entries(engine.match.players).filter(([,p])=>!p.bot);
 for(let i=0;i<maxSteps;i++){
  const m=engine.match;if(m.status!=='reserved')return m;
  const human=humans.find(([seat])=>teamBot.mustAct(m.session,seat));
  if(human){
   const [seat,{uid}]=human;let moved=false;
   for(const command of teamBot.botCommands(m.session,seat)){try{await engine.act(uid,{command,requestId:'h'+i,expectedMatchId:m.id});moved=true;break;}catch{}}
   assert.ok(moved,'the human seat found no legal move');
  }else{advance(2000);await engine.tick();}
 }
 throw new Error('the match did not finish');
}

test('Only the creator seats bots, and a full bot table starts charging only people',async()=>{
 const {bank,engine}=setup();
 await engine.create({uid:'a',name:'A'},{id:'bots1',stake:1,targetPoints:10,mode:'2v2'});
 await engine.join({uid:'b',name:'B'},{team:'player2'});
 await assert.rejects(engine.act('b',{command:{kind:'add-bot',seat:'player3'},requestId:'x1',expectedMatchId:'bots1'}),/creó la mesa/);
 await engine.act('a',{command:{kind:'add-bot',seat:'player3'},requestId:'x2',expectedMatchId:'bots1'});
 await assert.rejects(engine.act('a',{command:{kind:'add-bot',seat:'player3'},requestId:'x3',expectedMatchId:'bots1'}),/ocupado/);
 assert.equal(engine.match.status,'waiting');assert.equal(engine.match.players.player3.name,'Bot');
 await engine.act('a',{command:{kind:'add-bot',seat:'player4'},requestId:'x4',expectedMatchId:'bots1'});
 assert.equal(engine.match.status,'reserved');assert.equal(engine.lobbyEntry(),null);
 assert.deepEqual(Object.keys(bank.economy.wallets).sort(),['a','b','c','d']);
 assert.equal(bank.economy.wallets.a.locked,1);assert.equal(bank.economy.wallets.b.locked,1);
});

test('A person with three bots plays a whole match; the bank covers the bots and the rematch starts at once',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'A'},{id:'bots2',stake:2,targetPoints:10,mode:'2v2'});
 for(const seat of ['player2','player3','player4'])await engine.act('a',{command:{kind:'add-bot',seat},requestId:'s'+seat,expectedMatchId:'bots2'});
 assert.equal(engine.publicRoom().status,'started');
 const m=await playOut(engine,advance);
 assert.equal(m.status,'settled');
 const won=m.session.room.matchResult.winner==='player1';
 assert.deepEqual(bank.economy.wallets.a,{balance:won?14:10,locked:0,lastGrantAt:1});
 assert.deepEqual(m.winners,won?['a']:[]);
 assert.ok(!Object.keys(bank.economy.wallets).some(uid=>uid.startsWith('bot:')));
 await engine.act('a',{command:{kind:'rematch',value:'request'},requestId:'again',expectedMatchId:m.id});
 assert.equal(engine.match.status,'reserved');assert.equal(engine.match.matchNumber,2);
 assert.equal(bank.economy.wallets.a.locked,2);
});

test('Two people against two bots: only the people pay and collect',async()=>{
 const {bank,engine,advance}=setup();
 await engine.create({uid:'a',name:'A'},{id:'bots3',stake:1,targetPoints:10,mode:'2v2'});
 await engine.join({uid:'b',name:'B'},{team:'player1'});
 for(const seat of ['player2','player4'])await engine.act('a',{command:{kind:'add-bot',seat},requestId:'s'+seat,expectedMatchId:'bots3'});
 const m=await playOut(engine,advance);
 const won=m.session.room.matchResult.winner==='player1';
 assert.equal(bank.economy.wallets.a.balance,won?13:11);assert.equal(bank.economy.wallets.b.balance,won?8:6);
 assert.equal(bank.economy.wallets.a.locked+bank.economy.wallets.b.locked,0);
});

test('A bot partner waits up to 12 s for the pie\'s signal, obeys "vení" and otherwise plays on its own',async()=>{
 let obeyed=false,waited=false;
 // The bot partner must open a trick for its team, which a match may never deal: play new matches until both cases show up.
 for(let attempt=0;attempt<6&&!(obeyed&&waited);attempt++){
 const {engine,advance,now}=setup();
 await engine.create({uid:'a',name:'A'},{id:'sig1',stake:1,targetPoints:30,mode:'2v2'});
 for(const seat of ['player2','player3','player4'])await engine.act('a',{command:{kind:'add-bot',seat},requestId:'s'+seat,expectedMatchId:'sig1'});
 for(let i=0;i<20000&&engine.match.status==='reserved'&&!(obeyed&&waited);i++){
  const m=engine.match,s=m.session,r=s.room;
  if(teamBot.awaitsSignal(s,'player3')&&!teamBot.signalFor(r,'player3')){
   const played=r.playedBy?.player3||0,start=r.turnClock.startedAt;
   advance(start+teamBot.SIGNAL_WAIT_MS-1000-now());await engine.tick();
   assert.equal(engine.match.session.room.playedBy?.player3||0,played,'the bot played before 12 s');
   if(!obeyed){
    const lowest=[...s.hands.player3].sort((x,y)=>teamReferee.strength(x,r.muestra)-teamReferee.strength(y,r.muestra))[0];
    await engine.act('a',{command:{kind:'team-signal',value:'veni'},requestId:'v'+i,expectedMatchId:m.id});
    advance(BOT_DELAY_MS+100);await engine.tick();
    const after=engine.match.session.room;
    if((after.playedBy?.player3||0)>played){assert.equal(after.trickCards.find(c=>c.playerId==='player3')?.card.id??after.tricks.at(-1).cards.find(c=>c.playerId==='player3').card.id,lowest.id);obeyed=true;}
   }else{
    const waiting=JSON.stringify(engine.match.session);advance(1100);await engine.tick();
    assert.notEqual(JSON.stringify(engine.match.session),waiting,'the bot did not move after 12 s');
    waited=true;
   }
   continue;
  }
  if(teamBot.mustAct(s,'player1')){for(const command of teamBot.botCommands(s,'player1')){try{await engine.act('a',{command,requestId:'h'+i,expectedMatchId:m.id});break;}catch{}}}
  else{advance(2000);await engine.tick();}
 }
 }
 assert.ok(obeyed,'the bot never obeyed vení');assert.ok(waited,'the bot never played on its own after waiting');
});

test('A bot that follows another bot waits 3 s; after a person it answers in 1.5 s',async()=>{
 const {engine,advance}=setup();
 await engine.create({uid:'a',name:'A'},{id:'pace1',stake:1,targetPoints:30,mode:'2v2'});
 for(const seat of ['player2','player3','player4'])await engine.act('a',{command:{kind:'add-bot',seat},requestId:'s'+seat,expectedMatchId:'pace1'});
 const snap=()=>JSON.stringify(engine.match.session);
 const botTurn=()=>['player2','player3','player4'].some(q=>teamBot.mustAct(engine.match.session,q));
 let checkedBot=false,checkedHuman=false;
 for(let i=0;i<5000&&engine.match.status==='reserved'&&!(checkedBot&&checkedHuman);i++){
  const s=engine.match.session;
  if(teamBot.mustAct(s,'player1')){
   for(const command of teamBot.botCommands(s,'player1')){try{await engine.act('a',{command,requestId:'h'+i,expectedMatchId:engine.match.id});break;}catch{}}
   if(!checkedHuman&&botTurn()&&!teamBot.awaitsSignal(engine.match.session,'player3')){const before=snap();advance(BOT_DELAY_MS+100);await engine.tick();assert.notEqual(snap(),before,'a bot after a person waited too long');checkedHuman=true;}
   continue;
  }
  const before=snap();advance(BOT_DELAY_MS+100);await engine.tick();
  if(snap()!==before&&!checkedBot&&botTurn()&&!engine.match.session.room.resolvingTrick&&!teamBot.awaitsSignal(engine.match.session,'player3')){
   const moved=snap();advance(BOT_DELAY_MS+100);await engine.tick();assert.equal(snap(),moved,'a bot after a bot moved before 3 s');
   advance(BOT_AFTER_BOT_MS-(BOT_DELAY_MS+100)+100);await engine.tick();assert.notEqual(snap(),moved,'a bot after a bot did not move at 3 s');checkedBot=true;
  }
 }
 assert.ok(checkedBot&&checkedHuman);
});
test('Bots answer after 2 seconds, and wait longer after another bot',()=>{assert.equal(BOT_DELAY_MS,2000);assert.ok(BOT_AFTER_BOT_MS>BOT_DELAY_MS);});
test('A person plays a whole match against the house host of a lobby table',async()=>{
 const {default:duel}=await import('../../functions/duel-bot.cjs');
 const {bank,engine,advance}=setup();
 await engine.create({uid:'house_Nacho_Pereira',name:'Nacho_Pereira'},{id:'h1',stake:2,targetPoints:10,mode:'1v1',secret:null,house:true});
 assert.equal(bank.economy.wallets.house_Nacho_Pereira,undefined);
 assert.equal(engine.lobbyEntry().players.player1.name,'Nacho_Pereira');
 await engine.join({uid:'b',name:'Ricky'},{});
 assert.deepEqual(bank.economy.wallets.b,{balance:5,locked:2,lastGrantAt:1});
 assert.equal(engine.presence.player1.online,true);
 for(let step=0;step<3000&&engine.match.status==='reserved';step++){
  const s=engine.match.session;
  if(duel.mustAct(s,'player2')){
   for(const command of duel.botCommands(s,'player2')){const before=JSON.stringify(engine.match.session);try{await engine.act('b',{command,requestId:'r'+step+command.kind+(command.value||command.cardId||'')});}catch{continue;}if(JSON.stringify(engine.match.session)!==before)break;}
  }else{advance(4000);await engine.tick();}
 }
 assert.equal(engine.match.status,'settled');
 const won=engine.match.winner==='b';
 assert.deepEqual(bank.economy.wallets.b,{balance:won?9:5,locked:0,lastGrantAt:1});
 // A rematch request is turned down by the house after a moment.
 await engine.act('b',{command:{kind:'rematch',value:'request'},requestId:'again'});
 await engine.tick();advance(3000);await engine.tick();
 assert.equal(engine.match.session.room.rematch.status,'declined');
});
test('A house bot still plays when the table was put to sleep before its move',async()=>{
 const {default:duel}=await import('../../functions/duel-bot.cjs');
 const {bank,engine,advance,now}=setup();
 await engine.create({uid:'house_Lu',name:'Lu'},{id:'h2',stake:1,targetPoints:10,mode:'1v1',secret:null,house:true});
 await engine.join({uid:'b',name:'Ricky'},{});
 // Let the person play until it is the house's move.
 for(let i=0;i<20&&!duel.mustAct(engine.match.session,'player1');i++){
  const s=engine.match.session;
  if(duel.mustAct(s,'player2')){for(const command of duel.botCommands(s,'player2')){const before=JSON.stringify(engine.match.session);try{await engine.act('b',{command,requestId:'p'+i+JSON.stringify(command)});}catch{continue;}if(JSON.stringify(engine.match.session)!==before)break;}}
  else{advance(100);await engine.tick();}
 }
 assert.equal(duel.mustAct(engine.match.session,'player1'),true);
 const saved=JSON.parse(JSON.stringify(engine.snapshot())),before=JSON.stringify(saved.match.session);
 // A fresh engine (the table woke up) a few seconds later plays the house move at once.
 let later=now()+5000;const woken=createTableEngine({code:'ABCDE',bank:createFirebaseBank(bank),clock:()=>later});
 woken.load(saved);await woken.tick();
 assert.notEqual(JSON.stringify(woken.match.session),before);
});
test('The house answers a truco called after it played its last card',async()=>{
 const {default:duel}=await import('../../functions/duel-bot.cjs');
 let checked=false;
 for(let g=0;g<30&&!checked;g++){
  const {engine,advance}=setup();
  await engine.create({uid:'house_Lu',name:'Lu'},{id:'late'+g,stake:0,targetPoints:10,mode:'1v1',secret:null,house:true});
  await engine.join({uid:'b',name:'Ricky'},{});
  for(let step=0;step<3000&&engine.match.status==='reserved'&&!checked;step++){
   const s=engine.match.session,r=s.room;
   if(!duel.mustAct(s,'player2')){advance(500);await engine.tick();continue;}
   if(!r.pendingBet&&!s.hands.player1.length){
    for(const value of ['truco','retruco','vale4']){
     const before=JSON.stringify(s);
     try{await engine.act('b',{command:{kind:'call',value},requestId:'late'+g+step+value});}catch{continue;}
     if(JSON.stringify(engine.match.session)===before)continue;
     assert.equal(engine.match.session.room.pendingBet.responder,'player1');
     for(let k=0;k<20&&engine.match.session.room.pendingBet?.responder==='player1';k++){advance(500);await engine.tick();}
     assert.notEqual(engine.match.session.room.pendingBet?.responder,'player1');
     checked=true;break;
    }
    if(checked)break;
   }
   for(const command of duel.botCommands(s,'player2')){const before=JSON.stringify(engine.match.session);try{await engine.act('b',{command,requestId:'p'+g+step+JSON.stringify(command)});}catch{continue;}if(JSON.stringify(engine.match.session)!==before)break;}
  }
 }
 assert.ok(checked);
});
