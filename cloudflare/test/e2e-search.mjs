// End-to-end check of "Buscar gente en línea" against `wrangler dev` (DEV_MODE=1): the creator changes the
// points while waiting (the lobby sees it), and a bot takes the empty seat and plays.
// Usage: node test/e2e-search.mjs [http://127.0.0.1:8787]
const base=(process.argv[2]||'http://127.0.0.1:8787').replace(/^http/,'ws');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode=()=>Array.from({length:5},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
function client(path,token){
 const ws=new WebSocket(base+path);let seq=0;const pending=new Map(),events=[];let waiters=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.t==='res'){const p=pending.get(m.id);pending.delete(m.id);m.ok?p.resolve(m.data):p.reject(new Error(m.error));return;}events.push(m);waiters=waiters.filter(w=>!w(m));});
 const open=new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
 const call=(t,data={})=>{const id=String(++seq);return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({t,id,...data}));});};
 const next=(pred,ms=8000)=>new Promise((resolve,reject)=>{const found=events.find(pred);if(found)return resolve(found);const timer=setTimeout(()=>reject(new Error('timeout')),ms);waiters.push(m=>{if(pred(m)){clearTimeout(timer);resolve(m);return true;}return false;});});
 return {ws,call,next,events,ready:open.then(()=>call('auth',{token}))};
}
const lobby=client('/lobby','dev:watcher');await lobby.ready;await lobby.next(m=>m.t==='lobby');
// 1 vs 1: create, change points, bot sits down and plays.
const code=newCode(),a=client('/tables/'+code,'dev:alice');await a.ready;
const created=await a.call('create',{stake:0,targetPoints:20,visibility:'public',mode:'1v1'});
console.log('created',created.room.status,created.room.targetPoints);
await lobby.next(m=>m.t==='lobby-update'&&m.code===code&&m.room?.targetPoints===20);
await a.call('act',{command:{kind:'set-points',value:30},requestId:'s1',expectedMatchId:created.room.creditMatch.id});
const seen=await lobby.next(m=>m.t==='lobby-update'&&m.code===code&&m.room?.targetPoints===30);
console.log('lobby sees 30 points:',seen.room.targetPoints);
const withBot=await a.call('act',{command:{kind:'add-bot'},requestId:'b1',expectedMatchId:created.room.creditMatch.id});
console.log('after add-bot:',withBot.room.status,withBot.room.players?.player2?.name,'target',withBot.room.targetPoints);
await lobby.next(m=>m.t==='lobby-update'&&m.code===code&&m.room===null);
console.log('lobby removed the table');
// The bot plays when it is its turn: wait for any bot move (a card or a call) within a few seconds.
const start=withBot.room;
if(start.turn==='player1'){const st=await a.next(m=>m.t==='state'&&m.hand?.hand?.length===3);await a.call('act',{command:{kind:'play',cardId:st.hand.hand[0].id},requestId:'p1',expectedMatchId:start.creditMatch.id});}
const botMoved=await a.next(m=>m.t==='state'&&(m.room?.trickCards?.length>=(start.turn==='player1'?2:1)||m.room?.pendingBet||m.room?.flors&&Object.keys(m.room.flors).length),12000);
console.log('bot played:',!!botMoved);
// 2 vs 2: points change too.
const code2=newCode(),c=client('/tables/'+code2,'dev:carla');await c.ready;
const created2=await c.call('create',{stake:0,targetPoints:20,visibility:'public',mode:'2v2'});
await c.call('act',{command:{kind:'set-points',value:10},requestId:'s2',expectedMatchId:created2.room.creditMatch.id});
const seen2=await lobby.next(m=>m.t==='lobby-update'&&m.code===code2&&m.room?.targetPoints===10);
console.log('2v2 lobby sees 10 points:',seen2.room.targetPoints);
for(const seat of ['player2','player3','player4'])await c.call('act',{command:{kind:'add-bot',seat},requestId:'b'+seat,expectedMatchId:created2.room.creditMatch.id});
const full=await c.next(m=>m.t==='state'&&m.room?.status&&m.room.status!=='waiting',8000);
console.log('2v2 with bots:',full.room.status);
console.log('OK');process.exit(0);
