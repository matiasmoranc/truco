// The list of open tables. Table objects push changes here; every client in
// the lobby receives each change as soon as it happens.
import {DurableObject} from 'cloudflare:workers';
import {verifyIdToken,createDatabase,createDevDatabase,isAdministrator} from './firebase.js';
import {tableStub,lobbyStub} from './routing.js';
import {barOpen,presenceActive,weekKey,topOf,barTables,barLayout,barRequest} from './bar-core.js';
import {levelFor} from '../../levels.js';
import botSeat from '../../functions/bot-seat.cjs';

const {isHouseUid,houseUid}=botSeat;

const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};

// Open 1 vs 1 tables hosted by house players, so there is always someone to play.
// Each one waits 10 minutes and closes; the lobby opens new ones with
// other names, keeping between 12 and 16 open, each one 10 minutes, staggered apart.
// House players are bots and their names say so: "Bot Juan". Real names cannot have spaces.
const HOUSE_NAMES=['Bot Juan','Bot Pepe','Bot Nacho','Bot Facu','Bot Santi','Bot Gonza','Bot Rodri','Bot Mati','Bot Chino','Bot Bruno','Bot Lucho','Bot Seba','Bot Pablo','Bot Tincho','Bot Rafa','Bot Marce','Bot Gaby','Bot Diego','Bot Fede','Bot Andrés','Bot Lu','Bot Caro','Bot Vale','Bot Ceci','Bot Sofi','Bot Agus','Bot Negro','Bot Pocho','Bot Tito','Bot Coco'];
// Besides the bots, 2 or 3 of the open house tables are hosted by house players with everyday names
// (and the usual profile icons), rotating so they are not always the same ones.
const HOUSE_PEOPLE=['Nacho_Pereira','Facu.Rodriguez','ElGordoMartinez','Santi_Fernandez','Gonza_Silva22','Juanma.Sosa','PepeCabrera','Rodri_Acosta','Mati.Olivera','ChinoNunez','Andres_Viera','Bruno.Correa94','Lu_Gonzalez','Caro.Suarez','Vale_Rodriguez','Diego.Pintos','Fede_Cardozo','Lucho.Ramos','Seba_Techera','Pablo.Benitez','Nico_Olivera88','Tincho.Silva','Rafa_Dominguez','Marce.Lopez','Gaby_Ferreira','Ceci.Alvarez','Sofi_Martinez','JuanPa.Rocha','NegroCabrera','Agus.Morales'];
// Off for now (2026-11-15): only bots, to test whether players create tables. To turn it back on: 2 and 3.
const HOUSE_PEOPLE_MIN=0,HOUSE_PEOPLE_MAX=0;
const isBotName=name=>String(name||'').startsWith('Bot ');
// The lobby checks every 30 seconds and opens one new table at most each time: tables still open and
// close at different times, and with 10 minutes each this keeps up to 20 open, enough for 12 to 16.
const HOUSE_MIN=12,HOUSE_MAX=16,HOUSE_TICK_MS=30000,HOUSE_TARGET_MS=30*60000;
const HOUSE_GAP_MS=25000;
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode=()=>Array.from(crypto.getRandomValues(new Uint32Array(5)),n=>CODE_ALPHABET[n%CODE_ALPHABET.length]).join('');
const pick=weights=>{let r=Math.random()*weights.reduce((n,[,w])=>n+w,0);for(const [value,w] of weights){if((r-=w)<0)return value;}return weights[0][0];};
// Mostly 20-point games, some of 10 and 30; tables are played without credits.
const housePoints=()=>pick([[20,6],[10,2],[30,2]]);
// The board in the BAR is read again at most every 2 minutes, and only while someone is in the BAR.
const BOARD_EVERY_MS=120000;

export class Lobby extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  this.rooms={};this.live={};this.names=new Map();this.presence=new Map();
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  ctx.blockConcurrencyWhile(async()=>{
   this.rooms=(await ctx.storage.get('rooms'))||{};
   this.live=(await ctx.storage.get('live'))||{};
   this.layout=(await ctx.storage.get('barLayout'))||null;
   this.house=(await ctx.storage.get('house'))||{target:0,targetAt:0,recent:[]};
   if(this.env.INTERNAL_SECRET&&!(await ctx.storage.getAlarm()))await ctx.storage.setAlarm(Date.now()+5000);
  });
 }
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/update'&&request.method==='POST'){
   const {code,room,live}=await request.json();
   // Open tables: every client in the lobby gets each change, as before.
   if(JSON.stringify(this.rooms[code]??null)!==JSON.stringify(room??null)){
    if(room)this.rooms[code]=room;else delete this.rooms[code];
    await this.ctx.storage.put('rooms',this.rooms);
    for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.uid)send(ws,{t:'lobby-update',code,room:room||null});
   }
   // Tables in play: only BAR sockets hear about them (see bar-core.js liveTableEntry).
   const {at:_,...previous}=this.live[code]||{};
   if(JSON.stringify(this.live[code]?previous:null)!==JSON.stringify(live??null)){
    if(live)this.live[code]={...live,at:Date.now()};else delete this.live[code];
    await this.ctx.storage.put('live',this.live);
    for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.bar)send(ws,{t:'bar-table',code,live:live||null});
   }
   await this.updateLayout();
   this.barOnlineSoon();
   return new Response('ok');
  }
  if(url.pathname==='/dev-ledger'&&this.env.DEV_MODE==='1'){
   const stored=(await this.ctx.storage.get('devLedger'))||{etag:0,value:null};
   if(request.method==='GET')return Response.json(stored);
   const {etag,value}=await request.json();
   if(etag!==stored.etag)return new Response('conflict',{status:412});
   await this.ctx.storage.put('devLedger',{etag:etag+1,value:JSON.parse(JSON.stringify(value))});
   return new Response('ok');
  }
  if(request.headers.get('upgrade')!=='websocket')return new Response('Se esperaba WebSocket.',{status:426});
  const pair=new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({uid:null});
  return new Response(null,{status:101,webSocket:pair[0]});
 }
 async alarm(){
  try{await this.dropStaleRooms();}catch(error){console.error('stale rooms',error);}
  try{await this.keepHouseTables();}catch(error){console.error('house tables',error);}
  try{await this.sendBarOnline();}catch(error){console.error('bar online',error);}
  try{await this.refreshBoard();}catch(error){console.error('bar board',error);}
  // A free table asked from the waiter and never used is taken away after 10 minutes.
  await this.updateLayout();
  await this.ctx.storage.setAlarm(Date.now()+HOUSE_TICK_MS);
 }
 // A waiting table lasts 10 minutes (a house table 20): anything listed well past that is gone.
 async dropStaleRooms(){
  const now=Date.now(),stale=Object.entries(this.rooms).filter(([,r])=>Number.isFinite(r?.createdAt)&&now-r.createdAt>=10*60000+3*60000).map(([code])=>code);
  // A table in play reports every move; one silent for 30 minutes is gone.
  // A game over quiet for 90 s is left (whoever stays on its result screen keeps it alive by nothing else).
  const quiet=Object.entries(this.live).filter(([,t])=>!(now-t.at<(t.finished?90000:30*60000))).map(([code])=>code);
  if(quiet.length){for(const code of quiet)delete this.live[code];await this.ctx.storage.put('live',this.live);
   for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.bar)for(const code of quiet)send(ws,{t:'bar-table',code,live:null});}
  if(stale.length){for(const code of stale)delete this.rooms[code];await this.ctx.storage.put('rooms',this.rooms);
   for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.uid)for(const code of stale)send(ws,{t:'lobby-update',code,room:null});}
  if(quiet.length||stale.length)await this.updateLayout();
 }
 async keepHouseTables(){
  const now=Date.now(),house=this.house;
  if(!house.target||now-house.targetAt>=HOUSE_TARGET_MS){house.target=HOUSE_MIN+Math.floor(Math.random()*(HOUSE_MAX-HOUSE_MIN+1));house.people=HOUSE_PEOPLE_MIN+Math.floor(Math.random()*(HOUSE_PEOPLE_MAX-HOUSE_PEOPLE_MIN+1));house.targetAt=now;}
  house.people=Math.min(house.people??HOUSE_PEOPLE_MIN,HOUSE_PEOPLE_MAX);
  const open=Object.values(this.rooms).filter(r=>r?.status==='waiting'&&isHouseUid(r.players?.player1?.uid));
  const missing=house.target-open.length;if(missing<=0){await this.ctx.storage.put('house',house);return;}
  // With some open, at most one new table every 30 seconds, so they close at different times.
  if(open.length&&now-(house.lastAt||0)<HOUSE_GAP_MS){await this.ctx.storage.put('house',house);return;}
  for(let i=0;i<1;i++){
   const busy=new Set(open.map(r=>r.players.player1.name));
   // Names not at a table now, the least recently used first.
   // Everyday names until 2 or 3 of the open tables have one; the rest are bots.
   const pool=open.filter(r=>!isBotName(r.players.player1.name)).length<house.people?HOUSE_PEOPLE:HOUSE_NAMES;
   const free=pool.filter(n=>!busy.has(n)).sort((a,b)=>house.recent.indexOf(a)-house.recent.indexOf(b));
   const name=free.filter(n=>!house.recent.includes(n))[0]||free[Math.floor(Math.random()*Math.min(free.length,4))];if(!name)break;
   for(let attempt=0;attempt<3;attempt++){
    const code=randomCode();
    // At least two open at 20 points (the BAR shows two of them to sit and play).
    const points=open.filter(r=>Number(r.targetPoints)===20).length<2?20:housePoints();
    const response=await tableStub(this.env,code).fetch(new Request('https://table/house-create',{method:'POST',headers:{'x-table-code':code,'x-internal-secret':this.env.INTERNAL_SECRET},body:JSON.stringify({uid:houseUid(name),name,stake:0,targetPoints:points})}));
    if(response.ok){house.lastAt=now;house.recent=[...house.recent.filter(n=>n!==name),name].slice(-(HOUSE_NAMES.length+HOUSE_PEOPLE.length));open.push({players:{player1:{name}},targetPoints:points});break;}
    const body=await response.json().catch(()=>({}));if(body.code!=='code-taken'){console.error('house table failed',body.error);break;}
   }
  }
  await this.ctx.storage.put('house',house);
 }
 async webSocketMessage(ws,raw){
  let message;try{message=JSON.parse(raw);}catch{return;}
  // In the BAR: a free table asked from the waiter at the back (bar-core.js barRequest).
  if(message?.t==='bar-request'){const who=ws.deserializeAttachment();if(!who?.bar||!who.uid){send(ws,{t:'bar-request',ok:false,error:'auth'});return;}
   if(!this.layout)await this.updateLayout();
   const next=barRequest(this.layout,{uid:who.uid,k:message.k,p:Number(message.p)});
   send(ws,{t:'bar-request',ok:!!next});if(!next)return;
   this.layout=next;await this.ctx.storage.put('barLayout',next);
   for(const s of this.ctx.getWebSockets())if(s.deserializeAttachment()?.bar)send(s,{t:'bar-layout',cells:next.cells});
   return;}
  if(message?.t!=='auth')return;
  try{
   const user=await verifyIdToken(message.token,this.env.FIREBASE_PROJECT_ID,this.env);
   // The BAR asks for the tables in play and who is online; only people on its list get them.
   const bar=message.bar===true;
   if(bar&&!(await this.barAllowed(user.uid))){send(ws,{t:'res',id:message.id,ok:false,error:'El bar todavía no está abierto.',code:'bar-closed'});return;}
   ws.serializeAttachment(bar?{uid:user.uid,bar:true}:{uid:user.uid});
   send(ws,{t:'res',id:message.id,ok:true,data:{uid:user.uid}});
   send(ws,{t:'lobby',rooms:this.rooms});
   // Tells the client where to read its balance and claim daily credits.
   send(ws,{t:'config',creditsBackend:this.env.CREDITS_BACKEND==='bank'?'bank':'firebase'});
   if(!bar)this.barOnlineSoon();
   // The tables and where they stand go first; who is online (slow: it reads each person) comes after.
   if(bar){send(ws,{t:'bar-live',tables:Object.fromEntries(Object.entries(this.live).map(([code,{at,...t}])=>[code,t]))});
    if(!this.layout)await this.updateLayout();send(ws,{t:'bar-layout',cells:this.layout?.cells||{}});
    this.ctx.waitUntil(this.sendBarOnline(ws).catch(error=>console.error('bar online',error)));
    if(this.board)send(ws,{t:'bar-board',board:this.board});else this.ctx.waitUntil(this.refreshBoard().catch(error=>console.error('bar board',error)));}
  }catch(error){send(ws,{t:'res',id:message.id,ok:false,error:error.message});}
 }
 // Someone closing the game (their lobby socket) leaves the bar too.
 async webSocketClose(ws){if(ws.deserializeAttachment()?.uid)this.barOnlineSoon();}
 async webSocketError(ws){if(ws.deserializeAttachment()?.uid)this.barOnlineSoon();}
 // The BAR mirrors the game: who is online changes are sent within a second, at most one send per second.
 // Where each table stands in the BAR (see bar-core.js barLayout): the same for every page. Only the BAR
 // uses it; a failure here never touches the game (the update it follows is already done).
 async updateLayout(){
  try{
   const shown=new Set(Object.values(this.layout?.cells||{}).map(v=>v.c).filter(Boolean));
   // A house table never takes a table someone asked for.
   const points=new Map(Object.entries(this.rooms).filter(([,r])=>!isHouseUid(r?.players?.player1?.uid)).map(([code,r])=>[code,Number(r?.targetPoints)]));
   const next=barLayout(this.layout,barTables(this.rooms,this.live,shown),{points});
   if(JSON.stringify(next)===JSON.stringify(this.layout))return;
   this.layout=next;await this.ctx.storage.put('barLayout',next);
   for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.bar)send(ws,{t:'bar-layout',cells:next.cells});
  }catch(error){console.error('bar layout',error);}
 }
 barOnlineSoon(){
  if(this.barOnlineTimer||!this.ctx.getWebSockets().some(ws=>ws.deserializeAttachment()?.bar))return;
  this.barOnlineTimer=setTimeout(()=>{this.barOnlineTimer=null;this.sendBarOnline().catch(error=>console.error('bar online',error));},1000);
 }
 database(){return this.db??=this.env.DEV_MODE==='1'?createDevDatabase(()=>lobbyStub(this.env)):createDatabase(this.env);}
 async barAllowed(uid){return barOpen(this.env,uid)||await isAdministrator(this.database(),uid).catch(()=>false);}
 // People with the game open in the lobby and not seated at a table, for the BAR (names read once and kept).
 // The board in the BAR: the 10 with the most wins, the most wins this week and the highest level.
 async refreshBoard(){
  const now=Date.now();
  if(!this.ctx.getWebSockets().some(ws=>ws.deserializeAttachment()?.bar)||now-(this.boardAt||0)<BOARD_EVERY_MS)return;
  this.boardAt=now;
  const db=this.database();let week,points;
  if(this.env.DEV_MODE==='1'){
   // Local test: made-up players whose numbers change every 2 minutes.
   const m=Math.floor(now/BOARD_EVERY_MS),fake=k=>Object.fromEntries(Array.from({length:12},(_,i)=>['dev'+i,(i*7+m*(i%3)+k)%40+1]));
   week=fake(2);points=Object.fromEntries(Object.entries(fake(3)).map(([u,v])=>[u,v*25]));
  }else{
   const [k,p]=await Promise.all([db.top('weeklyWins/'+weekKey(now),'$value',10),db.top('levels','points',10)]);
   week=k;points=Object.fromEntries(Object.entries(p).map(([u,v])=>[u,v?.points]));
  }
  const lists={week:topOf(week),level:topOf(points)};
  const uids=[...new Set(Object.values(lists).flat().map(([uid])=>uid))];
  await Promise.all(uids.filter(uid=>!this.names.has(uid)).map(async uid=>{const name=this.env.DEV_MODE==='1'?'Jugador'+uid.slice(3):await db.get('profiles/'+uid+'/name').catch(()=>null);if(typeof name==='string'&&name)this.names.set(uid,name);}));
  const row=([uid,n],level)=>this.names.has(uid)?{uid,name:this.names.get(uid),n:level?levelFor(n).level:n}:null;
  const board={week:lists.week.map(r=>row(r)).filter(Boolean),level:lists.level.map(r=>row(r,true)).filter(Boolean)};
  if(JSON.stringify(board)===JSON.stringify(this.board))return;
  this.board=board;
  for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.bar)send(ws,{t:'bar-board',board});
 }
 async sendBarOnline(only){
  const sockets=this.ctx.getWebSockets(),bars=only?[only]:sockets.filter(ws=>ws.deserializeAttachment()?.bar);
  if(!bars.length)return;
  const seated=new Set();
  // Seated: at an open table or in a game; once a game is over, whoever left its table is free again.
  for(const t of [...Object.values(this.live),...Object.values(this.rooms)])for(const [seat,p] of Object.entries(t?.players||{}))if(p?.uid&&!(t.finished&&t.here?.[seat]===false))seated.add(p.uid);
  const uids=[...new Set(sockets.map(ws=>ws.deserializeAttachment()).filter(a=>a?.uid&&!a.bar&&!seated.has(a.uid)&&!isHouseUid(a.uid)).map(a=>a.uid))].slice(0,80);
  const db=this.database(),now=Date.now();
  // Same rule as the admin's "Jugando": the game on screen lately (read again at most every 15 s per person).
  await Promise.all(uids.filter(uid=>!(now-(this.presence.get(uid)?.read||0)<15000)).map(async uid=>{const sessions=await db.get('adminMetrics/presence/'+uid).catch(()=>undefined);if(sessions!==undefined)this.presence.set(uid,{read:now,sessions});}));
  for(const uid of [...this.presence.keys()])if(!uids.includes(uid))this.presence.delete(uid);
  const shown=uids.filter(uid=>this.env.DEV_MODE==='1'||presenceActive(this.presence.get(uid)?.sessions,now));
  await Promise.all(shown.filter(uid=>!this.names.has(uid)).map(async uid=>{const name=await db.get('profiles/'+uid+'/name').catch(()=>null);if(typeof name==='string'&&name)this.names.set(uid,name);}));
  const people=shown.filter(uid=>this.names.has(uid)).map(uid=>({uid,name:this.names.get(uid)}));
  for(const ws of bars)send(ws,{t:'bar-online',people});
 }
}
