// The BAR room: everyone inside walks around the drawn bar and talks to whoever stands near.
// Nothing is stored: positions and messages live only in the open sockets. It is its own
// object, apart from the lobby and the tables, so trying it never touches a game.
import {DurableObject} from 'cloudflare:workers';
import {verifyIdToken,createDatabase,createDevDatabase,playerIdentity,usersBlockEachOther,isAdministrator} from './firebase.js';
import {lobbyStub} from './routing.js';
import {allowListed,spawnPosition,acceptMove,acceptSay,hears} from './bar-core.js';

const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};
const BLOCK_CACHE_MS=10*60000;

export class Bar extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  this.blocks=new Map();
 }
 database(){return this.db??=this.env.DEV_MODE==='1'?createDevDatabase(()=>lobbyStub(this.env)):createDatabase(this.env);}
 async fetch(request){
  if(request.headers.get('upgrade')!=='websocket')return new Response('Se esperaba WebSocket.',{status:426});
  const pair=new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({uid:null});
  return new Response(null,{status:101,webSocket:pair[0]});
 }
 inside(){return this.ctx.getWebSockets().map(ws=>({ws,p:ws.deserializeAttachment()})).filter(e=>e.p?.uid);}
 walker(p){return {uid:p.uid,name:p.name,x:p.x,y:p.y,a:p.a||0,s:!!p.s};}
 async webSocketMessage(ws,raw){
  let message;try{message=JSON.parse(raw);}catch{return;}
  const person=ws.deserializeAttachment()||{};
  if(message?.t==='auth'){await this.auth(ws,message);return;}
  if(!person.uid)return;
  const now=Date.now();
  if(message.t==='move'){
   const at=acceptMove(person,message,now);if(!at)return;
   ws.serializeAttachment({...person,...at,movedAt:now});
   for(const {ws:other} of this.inside())if(other!==ws)send(other,{t:'walk',uid:person.uid,x:at.x,y:at.y,a:at.a,s:at.s});
   return;
  }
  if(message.t==='say'){
   const result=acceptSay(person,message.text,now);
   if(result.error){send(ws,{t:'say-error',error:result.error});return;}
   ws.serializeAttachment({...person,said:result.said});
   const near=this.inside().filter(e=>e.ws===ws||hears(person,e.p));
   const said={t:'said',uid:person.uid,name:person.name,text:result.text,at:now};
   for(const e of near)if(e.ws===ws||!(await this.blocked(person.uid,e.p.uid)))send(e.ws,said);
   return;
  }
  // A report keeps the message and who sent it, for the administrator to read.
  if(message.t==='report'&&typeof message.uid==='string'){
   const text=String(message.text||'').slice(0,200);
   await this.database().put('barReports/'+now+'_'+person.uid,{reporter:person.uid,reporterName:person.name,uid:message.uid.slice(0,128),name:String(message.name||'').slice(0,40),text,at:now}).catch(error=>console.error('bar report',error));
   send(ws,{t:'reported'});
  }
 }
 async auth(ws,message){
  try{
   const user=await verifyIdToken(message.token,this.env.FIREBASE_PROJECT_ID,this.env),db=this.database();
   if(!allowListed(this.env,user.uid)&&!(await isAdministrator(db,user.uid).catch(()=>false))){send(ws,{t:'res',id:message.id,ok:false,error:'El bar todavía no está abierto.',code:'bar-closed'});return;}
   const {name}=await playerIdentity(db,user.uid);
   // One body per person: an older tab of the same account leaves.
   for(const e of this.inside())if(e.p.uid===user.uid&&e.ws!==ws){send(e.ws,{t:'replaced'});try{e.ws.close(4000,'Abriste el bar en otra pestaña.');}catch{}}
   const at=spawnPosition(),person={uid:user.uid,name,...at,movedAt:0,said:[]};
   ws.serializeAttachment(person);
   send(ws,{t:'res',id:message.id,ok:true,data:this.walker(person)});
   send(ws,{t:'walkers',list:this.inside().map(e=>this.walker(e.p))});
   for(const e of this.inside())if(e.ws!==ws)send(e.ws,{t:'walker',walker:this.walker(person)});
  }catch(error){send(ws,{t:'res',id:message.id,ok:false,error:error.message});}
 }
 // People who blocked each other in the game do not hear each other in the bar either.
 async blocked(a,b){
  const key=a<b?a+'|'+b:b+'|'+a,hit=this.blocks.get(key);
  if(hit&&Date.now()-hit.at<BLOCK_CACHE_MS)return hit.value;
  const value=await usersBlockEachOther(this.database(),a,b).catch(()=>false);
  this.blocks.set(key,{value,at:Date.now()});return value;
 }
 async webSocketClose(ws){this.left(ws);}
 async webSocketError(ws){this.left(ws);}
 left(ws){
  const uid=ws.deserializeAttachment()?.uid;if(!uid)return;
  if(this.inside().some(e=>e.ws!==ws&&e.p.uid===uid&&e.ws.readyState===WebSocket.READY_STATE_OPEN))return;
  for(const e of this.inside())if(e.ws!==ws)send(e.ws,{t:'left',uid});
 }
}
