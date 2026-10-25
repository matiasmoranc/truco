// The list of open tables. Table objects push changes here; every client in
// the lobby receives each change as soon as it happens.
import {DurableObject} from 'cloudflare:workers';
import {verifyIdToken} from './firebase.js';
import {tableStub} from './routing.js';
import botSeat from '../../functions/bot-seat.cjs';

const {isHouseUid,houseUid}=botSeat;

const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};

// Open 1 vs 1 tables hosted by house players, so there is always someone to play.
// Each one waits 20 minutes and closes; the lobby opens new ones with
// other names, keeping between 2 and 4 open, each one 20 minutes, staggered apart.
const HOUSE_NAMES=['Nacho_Pereira','Facu.Rodriguez','ElGordoMartinez','Santi_Fernandez','Gonza_Silva22','Juanma.Sosa','PepeCabrera','Rodri_Acosta','Mati.Olivera','ChinoNunez','Andres_Viera','Bruno.Correa94','Lu_Gonzalez','Caro.Suarez','Vale_Rodriguez'];
const HOUSE_MIN=2,HOUSE_MAX=4,HOUSE_TICK_MS=60000,HOUSE_TARGET_MS=30*60000;
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode=()=>Array.from(crypto.getRandomValues(new Uint32Array(5)),n=>CODE_ALPHABET[n%CODE_ALPHABET.length]).join('');
const pick=weights=>{let r=Math.random()*weights.reduce((n,[,w])=>n+w,0);for(const [value,w] of weights){if((r-=w)<0)return value;}return weights[0][0];};
// Mostly 20-point games, some of 10 and 30; mostly 1 credit, some of 2.
const housePoints=()=>pick([[20,6],[10,2],[30,2]]);
const houseStake=()=>pick([[1,3],[2,1]]);

export class Lobby extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  this.rooms={};
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  ctx.blockConcurrencyWhile(async()=>{
   this.rooms=(await ctx.storage.get('rooms'))||{};
   this.house=(await ctx.storage.get('house'))||{target:0,targetAt:0,recent:[]};
   if(this.env.INTERNAL_SECRET&&!(await ctx.storage.getAlarm()))await ctx.storage.setAlarm(Date.now()+5000);
  });
 }
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/update'&&request.method==='POST'){
   const {code,room}=await request.json();
   if(room)this.rooms[code]=room;else delete this.rooms[code];
   await this.ctx.storage.put('rooms',this.rooms);
   for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.uid)send(ws,{t:'lobby-update',code,room:room||null});
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
  try{await this.keepHouseTables();}catch(error){console.error('house tables',error);}
  await this.ctx.storage.setAlarm(Date.now()+HOUSE_TICK_MS);
 }
 async keepHouseTables(){
  const now=Date.now(),house=this.house;
  if(!house.target||now-house.targetAt>=HOUSE_TARGET_MS){house.target=HOUSE_MIN+Math.floor(Math.random()*(HOUSE_MAX-HOUSE_MIN+1));house.targetAt=now;}
  const open=Object.values(this.rooms).filter(r=>r?.status==='waiting'&&isHouseUid(r.players?.player1?.uid));
  const missing=house.target-open.length;if(missing<=0){await this.ctx.storage.put('house',house);return;}
  // With some open, at most one new table every 4 minutes, so they close at different times.
  if(open.length&&now-(house.lastAt||0)<4*60000){await this.ctx.storage.put('house',house);return;}
  for(let i=0;i<1;i++){
   const busy=new Set(open.map(r=>r.players.player1.name));
   // Names not at a table now, the least recently used first.
   const free=HOUSE_NAMES.filter(n=>!busy.has(n)).sort((a,b)=>house.recent.indexOf(a)-house.recent.indexOf(b));
   const name=free.filter(n=>!house.recent.includes(n))[0]||free[Math.floor(Math.random()*Math.min(free.length,4))];if(!name)break;
   for(let attempt=0;attempt<3;attempt++){
    const code=randomCode();
    const response=await tableStub(this.env,code).fetch(new Request('https://table/house-create',{method:'POST',headers:{'x-table-code':code,'x-internal-secret':this.env.INTERNAL_SECRET},body:JSON.stringify({uid:houseUid(name),name,stake:houseStake(),targetPoints:housePoints()})}));
    if(response.ok){house.lastAt=now;house.recent=[...house.recent.filter(n=>n!==name),name].slice(-HOUSE_NAMES.length);open.push({players:{player1:{name}}});break;}
    const body=await response.json().catch(()=>({}));if(body.code!=='code-taken'){console.error('house table failed',body.error);break;}
   }
  }
  await this.ctx.storage.put('house',house);
 }
 async webSocketMessage(ws,raw){
  let message;try{message=JSON.parse(raw);}catch{return;}
  if(message?.t!=='auth')return;
  try{
   const user=await verifyIdToken(message.token,this.env.FIREBASE_PROJECT_ID,this.env);
   ws.serializeAttachment({uid:user.uid});
   send(ws,{t:'res',id:message.id,ok:true,data:{uid:user.uid}});
   send(ws,{t:'lobby',rooms:this.rooms});
   // Tells the client where to read its balance and claim daily credits.
   send(ws,{t:'config',creditsBackend:this.env.CREDITS_BACKEND==='bank'?'bank':'firebase'});
  }catch(error){send(ws,{t:'res',id:message.id,ok:false,error:error.message});}
 }
}
