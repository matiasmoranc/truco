// The list of open tables. Table objects push changes here; every client in
// the lobby receives each change as soon as it happens.
import {DurableObject} from 'cloudflare:workers';
import {verifyIdToken} from './firebase.js';

const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};

export class Lobby extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  this.rooms={};
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  ctx.blockConcurrencyWhile(async()=>{this.rooms=(await ctx.storage.get('rooms'))||{};});
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
