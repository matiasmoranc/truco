const {test}=require('node:test');const assert=require('node:assert/strict');
const {createReferee,newSession}=require('../functions/game-referee.cjs');
const duel=require('../functions/duel-bot.cjs');
const T=require('../functions/table-service.cjs');
const {houseUid,isBotUid}=require('../functions/bot-seat.cjs');

// Plays a whole match with the house bot on both seats, the way the table does it:
// commands best first, keeping the first one that changes the game.
function playOut(target,seed){
 let s=Math.sin(seed)*10000,random=()=>{s=Math.sin(s+1)*10000;return s-Math.floor(s);};
 let now=1000;const players={player1:{uid:'house_a',name:'A'},player2:{uid:'u2',name:'B'}};
 let session=newSession('ABCDE',players,target,{id:'m',stake:1,pot:2,matchNumber:1},now);
 for(let step=0;step<4000;step++){
  const r=session.room;if(r.status==='complete')return {session,step};
  const seat=['player1','player2'].find(p=>duel.mustAct(session,p));
  if(!seat){now+=1000;session=createReferee(session,{now}).advance();continue;}
  let moved=false;
  for(const command of duel.botCommands(session,seat,random)){
   const before=JSON.stringify(session);
   try{session=createReferee(session,{now}).action(seat,command);}catch{continue;}
   if(JSON.stringify(session)!==before){moved=true;break;}
  }
  assert.ok(moved,'the bot found no legal move: '+JSON.stringify({turn:r.turn,bet:r.pendingBet,trick:r.trickNo}));
  now+=500;
 }
 throw new Error('the match did not end');
}
test('The house bot always finds a legal move and finishes 1 vs 1 matches',()=>{
 for(let seed=1;seed<=12;seed++){const {session}=playOut([10,20,30][seed%3],seed);assert.equal(session.room.status,'complete');}
});
test('House tables: no wallet for the host, a win pays twice the stake, a loss keeps nothing',()=>{
 assert.equal(isBotUid(houseUid('Nacho_Pereira')),true);
 const base={wallets:{u2:{balance:5,locked:0}},matches:{},tables:{}};
 let l=T.createTable(base,{code:'ABCDE',id:'m1',uid:houseUid('Nacho_Pereira'),name:'Nacho_Pereira',stake:2,targetPoints:20,house:true,now:1});
 assert.equal(l.matches.m1.house,'player1');assert.deepEqual(l.wallets,base.wallets);
 l=T.joinTable(l,{code:'ABCDE',uid:'u2',name:'Pinar',now:2});
 assert.deepEqual(l.wallets.u2,{balance:3,locked:2});
 const finish=(ledger,winner)=>{const n=structuredClone(ledger),room=n.matches.m1.session.room;Object.assign(room,{status:'complete',scores:{...room.scores,[winner]:20},matchResult:{winner},endReveal:{done:true}});return T.tableOperation(n,{code:'ABCDE',uid:'u2',command:{kind:'tick'},now:3});};
 assert.deepEqual(finish(l,'player2').wallets.u2,{balance:7,locked:0});
 assert.deepEqual(finish(l,'player1').wallets.u2,{balance:3,locked:0});
 // Nobody joined: the table closes without touching any wallet.
 const idle=T.tableOperation(T.createTable(base,{code:'BCDEF',id:'m2',uid:houseUid('Lu_Gonzalez'),name:'Lu_Gonzalez',stake:1,targetPoints:10,house:true,now:1}),{code:'BCDEF',uid:houseUid('Lu_Gonzalez'),command:{kind:'tick'},now:1300000});
 assert.equal(idle.matches.m2.status,'refunded');assert.deepEqual(idle.wallets,base.wallets);
});
test('A house table waits 20 minutes for a rival and says so to the lobby',()=>{
 const base={wallets:{u2:{balance:5,locked:0}},matches:{},tables:{}};
 const l=T.createTable(base,{code:'CDEFG',id:'m3',uid:houseUid('Caro.Suarez'),name:'Caro.Suarez',stake:1,targetPoints:20,house:true,now:0});
 assert.equal(T.publicTable(l.matches.m3).waitLimit,20*60000);
 assert.equal(T.tableOperation(l,{code:'CDEFG',uid:houseUid('Caro.Suarez'),command:{kind:'tick'},now:15*60000}).matches.m3.status,'waiting');
 assert.equal(T.joinTable(l,{code:'CDEFG',uid:'u2',name:'Pinar',now:19*60000}).matches.m3.status,'reserved');
 assert.throws(()=>T.joinTable(l,{code:'CDEFG',uid:'u2',name:'Pinar',now:20*60000}),/no está disponible/);
});

test('The lobby keeps 10 to 14 house tables with 30 different house players, and real tables are listed first',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const lobby=fs.readFileSync(path.join(__dirname,'..','cloudflare','src','lobby.js'),'utf8');
 const names=JSON.parse(lobby.match(/HOUSE_NAMES=(\[[^\]]*\])/)[1].replace(/'/g,'"'));
 assert.equal(names.length,30);assert.equal(new Set(names.map(n=>n.toLowerCase())).size,30);
 for(const name of names)assert.match(name,/^[A-Za-z0-9._-]{3,18}$/);
 assert.match(lobby,/HOUSE_MIN=10,HOUSE_MAX=14\b/);
 // One new table a minute at most can keep up to 20 open with 20 minutes each.
 assert.ok(Number(lobby.match(/HOUSE_GAP_MS=(\d+)/)[1])<60000);
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert.match(app,/\.sort\(\(a,b\) => houseTable\(a\[1\]\.public\)-houseTable\(b\[1\]\.public\)/);
});
