// The BAR room: everyone inside walks around the drawn bar and talks to whoever stands near.
// Positions and messages live only in the open sockets; the only thing kept is how each person
// chose to look (look:<uid>). It is its own object, apart from the lobby and the tables, so trying
// it never touches a game.
import {DurableObject} from 'cloudflare:workers';
import chatLog from '../../functions/chat-log.cjs';
import {verifyIdToken,createDatabase,createDevDatabase,playerIdentity,usersBlockEachOther,isAdministrator} from './firebase.js';
import {lobbyStub} from './routing.js';
import {spawnPosition,acceptMove,acceptSay,hears,cleanLook,acceptGesture,acceptInvite,inviteOpen,cleanArming,acceptOrder,BAR_MAX,barOpen,barFull,cleanProblem,barStaff} from './bar-core.js';

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
  // How many people are inside, for the "Lobby Virtual" button (it says when the BAR is full).
  if(new URL(request.url).pathname==='/bar/status'){
   const origin=request.headers.get('origin');
   return Response.json({inside:this.uids().size,max:BAR_MAX},{headers:{'cache-control':'no-store',...(origin?{'access-control-allow-origin':origin,vary:'origin'}:{})}});
  }
  if(request.headers.get('upgrade')!=='websocket')return new Response('Se esperaba WebSocket.',{status:426});
  const pair=new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({uid:null});
  return new Response(null,{status:101,webSocket:pair[0]});
 }
 uids(){return new Set(this.inside().map(e=>e.p.uid));}
 inside(){return this.ctx.getWebSockets().map(ws=>({ws,p:ws.deserializeAttachment()})).filter(e=>e.p?.uid);}
 walker(p){return {uid:p.uid,name:p.name,x:p.x,y:p.y,a:p.a||0,s:!!p.s,look:p.look||null,arm:p.arm||null,hold:p.hold||null,food:p.food||null,left:p.left||null,...(p.staff?{staff:true}:{})};}
 others(ws,message){for(const {ws:other} of this.inside())if(other!==ws)send(other,message);}
 async webSocketMessage(ws,raw){
  let message;try{message=JSON.parse(raw);}catch{return;}
  const person=ws.deserializeAttachment()||{};
  if(message?.t==='auth'){await this.auth(ws,message);return;}
  if(!person.uid)return;
  const now=Date.now();
  if(message.t==='move'){
   const at=acceptMove(person,message,now);if(!at)return;
   ws.serializeAttachment({...person,...at,movedAt:now});
   this.others(ws,{t:'walk',uid:person.uid,x:at.x,y:at.y,a:at.a,s:at.s});
   return;
  }
  if(message.t==='say'){
   const result=acceptSay(person,message.text,now);
   if(result.error){send(ws,{t:'say-error',error:result.error});return;}
   ws.serializeAttachment({...person,said:result.said});
   const near=this.inside().filter(e=>e.ws===ws||hears(person,e.p));
   const said={t:'said',uid:person.uid,name:person.name,text:result.text,at:now};
   const heard=[];for(const e of near)if(e.ws===ws||!(await this.blocked(person.uid,e.p.uid))){send(e.ws,said);if(e.ws!==ws&&e.p.uid!==person.uid)heard.push(e.p.name);}
   // A copy for the admin panel (Chats, "Lobby Virtual"), kept 30 days like the tables' chat.
   const record=chatLog.chatLogRecord({at:now,code:'BAR',uid:person.uid,name:person.name,text:result.text,mode:'bar',id:message.id||crypto.randomUUID(),x:person.x,y:person.y,near:[...new Set(heard)]});
   if(record)this.ctx.waitUntil(this.database().put(record.path,record.value).catch(error=>console.warn('bar chat log',error.message)));
   return;
  }
  // How I look: kept for next time and shown to everyone now.
  if(message.t==='look'){
   const look=cleanLook(message.look);if(!look)return;
   ws.serializeAttachment({...person,look});
   await this.ctx.storage.put('look:'+person.uid,look).catch(error=>console.error('bar look',error));
   this.others(ws,{t:'look',uid:person.uid,look});
   return;
  }
  // The looks of people at the tables or the counter who are not in the BAR page (up to 60 at a time).
  if(message.t==='looks'&&Array.isArray(message.uids)){
   const uids=[...new Set(message.uids.filter(u=>typeof u==='string'&&u.length<=128))].slice(0,60);
   const found=uids.length?await this.ctx.storage.get(uids.map(u=>'look:'+u)).catch(()=>new Map()):new Map();
   send(ws,{t:'looks',looks:Object.fromEntries(uids.map(u=>[u,found.get('look:'+u)||null]))});
   return;
  }
  if(message.t==='gesture'){
   const g=acceptGesture(person,message.g,now);if(!g)return;
   ws.serializeAttachment({...person,gestureAt:now});
   this.others(ws,{t:'gesture',uid:person.uid,g});
   return;
  }
  // Ordering at the counter: everyone sees the barman serve it, the drink in the hand, the food on the counter.
  if(message.t==='order'){
   const got=acceptOrder(person,message.item,now);if(!got)return;
   ws.serializeAttachment({...person,...got,orderedAt:now});
   for(const {ws:other} of this.inside())send(other,{t:'order',uid:person.uid,item:message.item,x:got.food?.x??Math.round(person.x)});
   return;
  }
  // Leaving the drink on the counter, where one stands (it stays there while one is at the counter).
  if(message.t==='leave'){
   if(!person.hold)return;const left={item:person.hold,x:Math.round(Number(person.x)||0)};
   ws.serializeAttachment({...person,hold:null,left});
   for(const {ws:other} of this.inside())send(other,{t:'leave',uid:person.uid,item:left.item,x:left.x});
   return;
  }
  // Gone from the counter: the food and the drink left there are cleared (or the drink in the hand).
  if(message.t==='drop'){
   const what=['food','left'].includes(message.what)?message.what:'hold';if(!person[what])return;
   ws.serializeAttachment({...person,[what]:null});
   this.others(ws,{t:'drop',uid:person.uid,what});
   return;
  }
  // Sitting at a free table to open it: the others see that it is being set up.
  if(message.t==='arming'){
   const arm=cleanArming(message.cell,message.points);
   ws.serializeAttachment({...person,arm});
   this.others(ws,{t:'arming',uid:person.uid,arm});
   return;
  }
  // "Jugamos un 1 vs 1": only to someone inside, and not between people who blocked each other.
  if(message.t==='invite'){
   const invite=acceptInvite(person,message.uid,message.points,now);if(!invite)return;
   const target=this.inside().find(e=>e.p.uid===invite.to);
   if(!target||await this.blocked(person.uid,invite.to)){send(ws,{t:'invite-failed',uid:invite.to});return;}
   ws.serializeAttachment({...person,invitedTo:invite.to,invitedAt:now});
   send(target.ws,{t:'invited',uid:person.uid,name:person.name,points:invite.points});
   return;
  }
  if(message.t==='invite-answer'&&typeof message.uid==='string'){
   const inviter=this.inside().find(e=>e.p.uid===message.uid);
   if(!inviter||!inviteOpen(inviter.p,person.uid,now))return;
   if(message.yes!==true)inviter.ws.serializeAttachment({...inviter.p,invitedTo:null});
   send(inviter.ws,{t:'invite-answer',uid:person.uid,name:person.name,yes:message.yes===true});
   return;
  }
  // "Reportar problema" on the sign: stored with the game's own reports (problemReports), marked as from the BAR.
  if(message.t==='problem'){
   const got=cleanProblem(message.text,message.requestId);
   if(got.error){send(ws,{t:'problem-result',ok:false,error:got.error});return;}
   if(now-(person.problemAt||0)<30000){send(ws,{t:'problem-result',ok:false,error:'Esperá un momento antes de mandar otro reporte.'});return;}
   ws.serializeAttachment({...person,problemAt:now});
   const report={uid:person.uid,name:person.name||'',message:got.message,matchId:null,code:null,localId:null,mode:'bar',at:now};
   try{await this.database().put('problemReports/'+person.uid+'_'+got.requestId,report);send(ws,{t:'problem-result',ok:true});}
   catch(error){console.error('bar problem report',error);send(ws,{t:'problem-result',ok:false,error:'No se pudo enviar. Probá de nuevo.'});}
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
   const admin=()=>isAdministrator(db,user.uid).catch(()=>false);
   if(!barOpen(this.env,user.uid)&&!(await admin())){send(ws,{t:'res',id:message.id,ok:false,error:'El bar todavía no está abierto.',code:'bar-closed'});return;}
   // At most BAR_MAX people at once (bots are never inside); an administrator can always come in.
   if(barFull(this.uids(),user.uid)&&!(await admin())){send(ws,{t:'res',id:message.id,ok:false,error:'Lobby lleno '+BAR_MAX+'/'+BAR_MAX+'. Probá en un rato.',code:'bar-full'});return;}
   const {name}=await playerIdentity(db,user.uid);
   const look=await this.ctx.storage.get('look:'+user.uid).catch(()=>null)||null;
   // One body per person: an older tab of the same account leaves.
   for(const e of this.inside())if(e.p.uid===user.uid&&e.ws!==ws){send(e.ws,{t:'replaced'});try{e.ws.close(4000,'Abriste el bar en otra pestaña.');}catch{}}
   const at=spawnPosition(),person={uid:user.uid,name,...at,movedAt:0,said:[],look,...(barStaff(this.env,user.uid)?{staff:true}:{})};
   ws.serializeAttachment(person);
   send(ws,{t:'res',id:message.id,ok:true,data:this.walker(person)});
   // Who came in and when (Uruguay day and hour), for the admin's "Lobby Virtual" tab: one record per person and day.
   {const uy=new Date(Date.now()-3*3600000),day=uy.toISOString().slice(0,10),hour=String(uy.getUTCHours()).padStart(2,'0');
    this.ctx.waitUntil(db.patch('barVisits/'+day+'/'+user.uid,{name:String(name||'').slice(0,40),last:Date.now(),['h'+hour]:true}).catch(error=>console.warn('bar visit',error.message)));}
   send(ws,{t:'walkers',list:this.inside().map(e=>this.walker(e.p))});
   this.others(ws,{t:'walker',walker:this.walker(person)});
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
