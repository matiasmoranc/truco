// End-to-end check against `wrangler dev` (DEV_MODE=1): two players create,
// join and play over WebSockets, and the lobby sees the table appear and leave.
// Usage: node test/e2e-local.mjs [http://127.0.0.1:8787]
const base=(process.argv[2]||'http://127.0.0.1:8787').replace(/^http/,'ws');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=Array.from({length:5},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');

function client(path,token){
 const ws=new WebSocket(base+path);let seq=0;const pending=new Map(),events=[];let waiters=[];
 ws.addEventListener('message',e=>{
  const m=JSON.parse(e.data);
  if(m.t==='res'){const p=pending.get(m.id);pending.delete(m.id);m.ok?p.resolve(m.data):p.reject(new Error(m.error));return;}
  events.push(m);waiters=waiters.filter(w=>!w(m));
 });
 const open=new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
 const call=(t,data={})=>{const id=String(++seq);return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({t,id,...data}));});};
 const next=(pred,ms=5000)=>new Promise((resolve,reject)=>{const found=events.find(pred);if(found)return resolve(found);const timer=setTimeout(()=>reject(new Error('timeout')),ms);waiters.push(m=>{if(pred(m)){clearTimeout(timer);resolve(m);return true;}return false;});});
 return {ws,call,next,events,ready:open.then(()=>call('auth',{token}))};
}
const timed=async(label,fn)=>{const t=performance.now();const r=await fn();console.log(label.padEnd(28),Math.round(performance.now()-t)+' ms');return r;};

const lobby=client('/lobby','dev:watcher');await lobby.ready;await lobby.next(m=>m.t==='lobby');
const a=client('/tables/'+code,'dev:alice');await a.ready;
const created=await timed('create table',()=>a.call('create',{stake:5,targetPoints:10,visibility:'public',mode:'1v1'}));
if(created.room.status!=='waiting')throw new Error('not waiting');
await timed('lobby sees table',()=>lobby.next(m=>m.t==='lobby-update'&&m.code===code&&m.room));
const b=client('/tables/'+code,'dev:bobby');await b.ready;
const joined=await timed('join table',()=>b.call('join',{}));
if(joined.room.status!=='started')throw new Error('not started: '+joined.room.status);
await lobby.next(m=>m.t==='lobby-update'&&m.code===code&&m.room===null);
const room=joined.room,players={player1:a,player2:b},uids={player1:'alice',player2:'bobby'};
const mover=players[room.turn];
const state=await mover.next(m=>m.t==='state'&&m.hand?.hand?.length===3);
const card=state.hand.hand[0];
const other=room.turn==='player1'?b:a;other.events.length=0;
await timed('play card (round trip)',()=>mover.call('act',{command:{kind:'play',cardId:card.id},requestId:'p1',expectedMatchId:room.creditMatch.id}));
await timed('rival sees card',()=>other.next(m=>m.t==='state'&&m.room?.trickCards?.length===1));
await timed('chat',()=>a.call('act',{command:{kind:'chat',text:'Hola'},requestId:'c1'}));
try{await mover.call('act',{command:{kind:'play',cardId:'forged'},requestId:'p2'});throw new Error('forged accepted');}catch(e){if(e.message==='forged accepted')throw e;console.log('forged card rejected:',e.message);}
// Rival's hand never reaches the other socket.
const leaked=other.events.some(m=>JSON.stringify(m).includes('"'+card.id+'"')&&m.hand?.hand?.some(c=>c.id===card.id));
if(leaked)throw new Error('hand leaked');
await timed('abandon + settle',()=>b.call('act',{command:{kind:'abandon'},requestId:'q1'}));
const end=await a.next(m=>m.t==='state'&&m.room?.creditResult);
console.log('winner uid',end.room.creditResult.winnerUid,'pot',end.room.creditResult.pot,'uids',uids.player1);
for(const c of [a,b,lobby])c.ws.close();
console.log('OK',code);
