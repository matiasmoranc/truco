// One Durable Object per table code. Players hold a WebSocket to it; every
// action is validated in memory and the new state is pushed to all seats.
import {DurableObject} from 'cloudflare:workers';
import tableService from '../../functions/table-service.cjs';
import {createTableEngine,CodeTakenError} from './table-engine.js';
import {createDatabase,createDevDatabase,verifyIdToken,playerIdentity,usersBlockEachOther} from './firebase.js';
import {createFirebaseBank} from './firebase-bank.js';
import {lobbyStub,bankStub} from './routing.js';

const {passwordHash}=tableService;
const CLEANUP_MS=30*60*1000;
const ACTIONS_PER_MINUTE=120,SEATINGS_PER_MINUTE=15;
const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};

export class TableRoom extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  this.db=env.DEV_MODE==='1'?createDevDatabase(()=>lobbyStub(env)):createDatabase(env);
  // Credits: the Bank Durable Object, or creditEconomy in Firebase (see CREDITS_BACKEND).
  // maintenance: while credits are copied, no table may move them anywhere.
  this.bank=env.CREDITS_BACKEND==='bank'?{prefetch:()=>null,apply:spec=>bankStub(env).apply(spec)}
   :env.CREDITS_BACKEND==='maintenance'?{prefetch:()=>null,apply:async()=>{throw new Error('Estamos actualizando los créditos. Volvé a intentar en unos minutos.');}}
   :createFirebaseBank(this.db);
  this.queue=Promise.resolve();
  this.identities=new Map();
  this.limits=new Map();
  this.code=null;this.engine=null;this.lastLobby='null';
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  ctx.blockConcurrencyWhile(async()=>{
   const saved=await ctx.storage.get('state');
   if(saved?.code){this.setCode(saved.code);this.engine.load(saved);this.lastLobby=saved.lastLobby||'null';}
  });
 }
 setCode(code){
  if(this.code===code)return;
  this.code=code;
  this.engine=createTableEngine({code,bank:this.bank});
 }
 serial(task){const run=this.queue.then(task,task);this.queue=run.catch(()=>{});return run;}

 async fetch(request){
  const code=request.headers.get('x-table-code');
  if(!/^[A-Z2-9]{5}$/.test(code||''))return new Response('Mesa inválida.',{status:400});
  if(!this.code)this.setCode(code);
  const url=new URL(request.url);
  if(url.pathname.endsWith('/admin-close')&&request.method==='POST'){
   const body=await request.json();
   try{
    await this.serial(async()=>{await this.engine.adminClose(body);await this.commit();});
    return Response.json({ok:true});
   }catch(error){return Response.json({ok:false,error:error.message},{status:409});}
  }
  if(request.headers.get('upgrade')!=='websocket')return new Response('Se esperaba WebSocket.',{status:426});
  const pair=new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({uid:null});
  return new Response(null,{status:101,webSocket:pair[0]});
 }

 async webSocketMessage(ws,raw){
  let message;try{message=JSON.parse(raw);}catch{return;}
  if(!message||typeof message.t!=='string')return;
  const reply=(ok,payload)=>send(ws,ok?{t:'res',id:message.id,ok:true,data:payload}:{t:'res',id:message.id,ok:false,error:payload});
  try{
   const data=await this.serial(()=>this.handle(ws,message));
   reply(true,data);
  }catch(error){
   // Bank RPC errors arrive as plain errors with the same message.
   if(error instanceof CodeTakenError||error?.message==='code-taken'){send(ws,{t:'res',id:message.id,ok:false,error:'code-taken',code:'code-taken'});return;}
   reply(false,error?.message||'No pudimos procesar la jugada.');
  }
 }

 async handle(ws,message){
  const attachment=ws.deserializeAttachment()||{};
  if(message.t==='auth'){
   const user=await verifyIdToken(message.token,this.env.FIREBASE_PROJECT_ID,this.env);
   ws.serializeAttachment({uid:user.uid});
   // A non-member is about to create or join: start the profile checks now.
   if(!this.engine.playerFor(user.uid))this.identity(user.uid).catch(()=>{});
   if(this.engine.setOnline(user.uid,true))await this.commit();
   else this.sendState(ws,user.uid);
   return {uid:user.uid};
  }
  const uid=attachment.uid;
  if(!uid)throw new Error('Iniciá sesión con tu cuenta.');
  if(message.t==='peek'){this.sendState(ws,uid);return {room:this.engine.publicRoom()};}
  if(message.t==='create'){
   this.rateLimit(uid,'seat',SEATINGS_PER_MINUTE);
   const {stake,targetPoints,visibility,password,mode='1v1'}=message;
   if(!['public','password'].includes(visibility))throw new Error('Elegí mesa pública o con clave.');
   const secret=visibility==='password'?passwordHash(password):null;
   // Profile checks and the ledger read run together; the transaction reuses the read.
   const [user,initial]=await Promise.all([this.identity(uid),this.bank.prefetch()]);
   await this.engine.create(user,{id:crypto.randomUUID(),stake,targetPoints,mode,secret,initial});
   this.engine.setOnline(uid,true);
   await this.commit();return this.result(uid);
  }
  if(message.t==='join'){
   this.rateLimit(uid,'seat',SEATINGS_PER_MINUTE);
   const match=this.engine.match;
   if(!match)throw new Error('La mesa ya no está disponible.');
   if(!this.engine.playerFor(uid)){
    const [user,blocked,initial]=await Promise.all([this.identity(uid),this.blockedWithPlayers(uid),this.bank.prefetch()]);
    if(blocked)throw new Error('No pueden entrar a la misma mesa porque uno bloqueó al otro.');
    await this.engine.join(user,{password:message.password||'',team:message.team,initial});
   }
   this.engine.setOnline(uid,true);
   await this.commit();return this.result(uid);
  }
  if(message.t==='act'){
   this.rateLimit(uid,'act',ACTIONS_PER_MINUTE);
   const {command,requestId,expectedMatchId}=message;
   if(!command||typeof command.kind!=='string'||(requestId!=null&&(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId))))throw new Error('Jugada inválida.');
   if(command.kind==='rematch'&&this.engine.match){
    const people=Object.values(this.engine.match.players||{}).filter(Boolean);
    for(let a=0;a<people.length;a++)for(let b=a+1;b<people.length;b++)if(await usersBlockEachOther(this.db,people[a].uid,people[b].uid))throw new Error('No pueden iniciar una revancha porque hay jugadores bloqueados.');
   }
   await this.engine.act(uid,{command,requestId,expectedMatchId});
   await this.commit();return this.result(uid);
  }
  throw new Error('Mensaje desconocido.');
 }

 // Entry receipt: the caller gets its private hand with the room, so the table renders without another round trip.
 result(uid){const m=this.engine.match;return {code:this.code,room:this.engine.publicRoom(),privateHand:this.engine.handFor(uid),player1:m?.player1||null,player2:m?.player2||null};}

 identity(uid){
  const cached=this.identities.get(uid);
  if(cached&&Date.now()-cached.at<60000)return cached.promise;
  const promise=playerIdentity(this.db,uid);this.identities.set(uid,{promise,at:Date.now()});
  promise.catch(()=>this.identities.delete(uid));return promise;
 }
 async blockedWithPlayers(uid){
  const people=Object.values(this.engine.match?.players||{}).filter(Boolean);
  return (await Promise.all(people.map(p=>usersBlockEachOther(this.db,uid,p.uid)))).some(Boolean);
 }
 rateLimit(uid,bucket,limit){
  const key=uid+':'+bucket,now=Date.now(),entry=this.limits.get(key);
  if(!entry||now-entry.start>=60000){this.limits.set(key,{start:now,count:1});return;}
  if(++entry.count>limit)throw new Error('Demasiadas acciones seguidas. Esperá un momento.');
 }

 sendState(ws,uid){send(ws,{t:'state',room:this.engine.publicRoom(),hand:this.engine.handFor(uid)});}
 sockets(){return this.ctx.getWebSockets();}

 // Persist, push the new state to every seat, refresh the lobby and re-arm the timer.
 async commit(){
  for(const ws of this.sockets()){const uid=ws.deserializeAttachment()?.uid;if(uid)this.sendState(ws,uid);}
  const entry=JSON.stringify(this.engine.lobbyEntry());
  const lobbyChanged=entry!==this.lastLobby;this.lastLobby=entry;
  await this.ctx.storage.put('state',{code:this.code,lastLobby:this.lastLobby,...this.engine.snapshot()});
  if(lobbyChanged)this.ctx.waitUntil(lobbyStub(this.env).fetch('https://lobby/update',{method:'POST',body:JSON.stringify({code:this.code,room:JSON.parse(entry)})}).catch(error=>console.error('lobby update failed',error)));
  await this.arm();
 }
 async arm(){
  let at=this.engine.nextDeadline();
  if(this.engine.isFinished())at=Math.min(at??Infinity,Date.now()+CLEANUP_MS);
  if(at!=null&&Number.isFinite(at))await this.ctx.storage.setAlarm(at);else await this.ctx.storage.deleteAlarm();
 }

 async alarm(){
  await this.serial(async()=>{
   if(!this.engine)return;
   if(this.engine.isFinished()&&!this.sockets().some(ws=>ws.deserializeAttachment()?.uid)){
    const closedAt=this.engine.match?.closedAt||this.engine.match?.settledAt||this.engine.match?.refundedAt||0;
    if(Date.now()-closedAt>=CLEANUP_MS){
     if(this.lastLobby!=='null')await lobbyStub(this.env).fetch('https://lobby/update',{method:'POST',body:JSON.stringify({code:this.code,room:null})}).catch(()=>{});
     await this.ctx.storage.deleteAll();this.engine.load(null);this.lastLobby='null';return;
    }
   }
   const before=JSON.stringify(this.engine.snapshot());
   try{await this.engine.tick();}catch(error){console.error('tick failed',this.code,error);}
   if(JSON.stringify(this.engine.snapshot())!==before)await this.commit();else await this.arm();
  });
 }

 async webSocketClose(ws){await this.disconnected(ws);}
 async webSocketError(ws){await this.disconnected(ws);}
 async disconnected(ws){
  const uid=ws.deserializeAttachment()?.uid;if(!uid)return;
  await this.serial(async()=>{
   const stillHere=this.sockets().some(other=>other!==ws&&other.readyState===WebSocket.READY_STATE_OPEN&&other.deserializeAttachment()?.uid===uid);
   if(!stillHere&&this.engine.setOnline(uid,false))await this.commit();
  });
 }
}
