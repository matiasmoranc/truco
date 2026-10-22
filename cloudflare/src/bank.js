// The credit bank as a single Durable Object: tables call apply() by RPC, players
// keep a socket for their live balance and the daily claim, and Cloud Functions
// reach the whole ledger through the Worker's internal routes.
import {DurableObject} from 'cloudflare:workers';
import {createBankCore} from './bank-core.js';
import {createBankMirror} from './bank-mirror.js';
import {createDatabase,createDevDatabase,verifyIdToken,playerIdentity} from './firebase.js';
import {lobbyStub} from './routing.js';

const send=(ws,message)=>{try{ws.send(JSON.stringify(message));}catch{}};
const CHUNK=128;
const MIRROR_DELAY_MS=2000,MIRROR_RETRY_MS=30000;

// Durable Object storage behind the core's store interface. Puts and deletes are
// issued without awaiting in between, so the runtime commits them as one batch.
function durableStore(storage){
 return {
  async get(keys){
   const found=new Map();
   for(let i=0;i<keys.length;i+=CHUNK)for(const [k,v] of await storage.get(keys.slice(i,i+CHUNK)))found.set(k,v);
   return found;
  },
  async put(entries,removed=[]){
   const pending=[],list=Object.entries(entries);
   for(let i=0;i<list.length;i+=CHUNK)pending.push(storage.put(Object.fromEntries(list.slice(i,i+CHUNK))));
   for(let i=0;i<removed.length;i+=CHUNK)pending.push(storage.delete(removed.slice(i,i+CHUNK)));
   await Promise.all(pending);
  },
  async list(prefix){return storage.list({prefix});}
 };
}

export class Bank extends DurableObject{
 constructor(ctx,env){
  super(ctx,env);
  const store=durableStore(ctx.storage);
  this.db=env.DEV_MODE==='1'?createDevDatabase(()=>lobbyStub(env)):createDatabase(env);
  this.mirror=createBankMirror(store,this.db);
  this.core=createBankCore(store,{beforeCommit:(writes,removed)=>this.mirror.beforeCommit(writes,removed)});
  this.queue=Promise.resolve();
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
 }
 serial(task){const run=this.queue.then(task,task);this.queue=run.catch(()=>{});return run.finally(()=>this.scheduleMirror());}

 // The backup copy goes to Firebase shortly after each change, batched.
 async scheduleMirror(){
  if(await this.ctx.storage.getAlarm()==null&&await this.mirror.hasPending())await this.ctx.storage.setAlarm(Date.now()+MIRROR_DELAY_MS);
 }
 async alarm(){
  await this.queue;
  try{
   const result=await this.mirror.flush();
   if(result.remaining)await this.ctx.storage.setAlarm(Date.now()+MIRROR_DELAY_MS);
  }catch(error){
   console.error('bank backup failed',error.message);
   await this.ctx.storage.setAlarm(Date.now()+MIRROR_RETRY_MS);
  }
 }

 // Live balances for everyone watching a changed wallet.
 pushWallets(wallets){
  const uids=Object.keys(wallets||{});if(!uids.length)return;
  for(const ws of this.ctx.getWebSockets()){const uid=ws.deserializeAttachment()?.uid;if(uid&&Object.hasOwn(wallets,uid))send(ws,{t:'wallet',wallet:wallets[uid]});}
 }

 // RPC from a table: one accounting step.
 async apply(spec){
  return this.serial(async()=>{
   if(this.env.DEV_MODE==='1')await this.seedDevWallets(spec);
   const result=await this.core.apply(spec);
   this.pushWallets(result.wallets);
   return {full:result.full,closedBy:result.closedBy};
  });
 }
 // Local development: players start with 100 test credits.
 async seedDevWallets(spec){
  const uids=[...Object.values(spec.match?.players||{}).map(p=>p?.uid),spec.args?.uid].filter(Boolean);
  const {version,ledger}=await this.core.exportLedger();
  const missing=uids.filter(uid=>!ledger.wallets?.[uid]);if(!missing.length)return;
  for(const uid of missing)(ledger.wallets??={})[uid]={balance:100,locked:0};
  await this.core.replace(version,ledger,{allowEmpty:true,trail:false});
 }

 async fetch(request){
  const url=new URL(request.url);
  if(url.hostname==='bank'){
   try{
    if(url.pathname==='/export')return Response.json(await this.serial(()=>this.core.exportLedger()));
    if(url.pathname==='/wallet')return Response.json({wallet:await this.core.wallet(url.searchParams.get('uid'))});
    if(url.pathname==='/patch'&&request.method==='POST'){
     const {base,next}=await request.json();
     const done=await this.serial(()=>this.core.patch(base,next));
     this.pushWallets(done.wallets);return Response.json({ok:true});
    }
    if(url.pathname==='/mirror')return Response.json({pending:await this.mirror.hasPending()});
    // Rehearsals only (the Worker refuses it while the bank is active).
    if(url.pathname==='/reset'&&request.method==='POST'){
     await this.serial(async()=>{await this.ctx.storage.deleteAll();await this.mirror.queueReset();});
     return Response.json({ok:true});
    }
    if(url.pathname==='/import'&&request.method==='POST'){
     const {ledger}=await request.json();
     return Response.json(await this.serial(()=>this.core.importLedger(ledger)));
    }
   }catch(error){return Response.json({ok:false,error:error.message,code:error.code||null},{status:409});}
   return new Response('No encontrado.',{status:404});
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
  try{
   if(message.t==='auth'){
    const user=await verifyIdToken(message.token,this.env.FIREBASE_PROJECT_ID,this.env);
    ws.serializeAttachment({uid:user.uid});
    send(ws,{t:'wallet',wallet:await this.core.wallet(user.uid)});
    send(ws,{t:'res',id:message.id,ok:true,data:{uid:user.uid}});return;
   }
   const uid=ws.deserializeAttachment()?.uid;
   if(!uid)throw new Error('Iniciá sesión con tu cuenta.');
   if(message.t==='claim'){
    // Same requirements as the old database rule: a saved name and an unblocked account.
    await playerIdentity(this.db,uid);
    const wallet=await this.serial(()=>this.core.claim(uid,Date.now()));
    this.pushWallets({[uid]:wallet});
    send(ws,{t:'res',id:message.id,ok:true,data:{wallet}});return;
   }
   throw new Error('Mensaje desconocido.');
  }catch(error){send(ws,{t:'res',id:message.id,ok:false,error:error.message});}
 }
}
