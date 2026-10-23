// Authoritative state of one table, held in memory by its Durable Object.
// Game rules are the same tested modules the Cloud Functions used; the credit
// bank is only touched when credits move (create, join, end, rematch, cancel),
// never for an ordinary card or call.
import tableService from '../../functions/table-service.cjs';
import teamBot from '../../functions/team-bot.cjs';
import {ACTIVE,CodeTakenError} from './ledger-ops.js';

const {tableOperation,publicTable,privateTableHand}=tableService;
const {SIGNAL_WAIT_MS,mustAct,awaitsSignal,signalFor,botCommands}=teamBot;
export {CodeTakenError,slimMatch} from './ledger-ops.js';

export const WAIT_MS=600000;
export const DISCONNECT_MS=45000;
// A bot answers after a short pause, so people can follow the table; after
// another bot's move it waits longer, so a run of bot plays stays readable.
export const BOT_DELAY_MS=2000;
export const BOT_AFTER_BOT_MS=3000;
const PROBE_BALANCE=1000000;
const findPlayer=(m,uid)=>Object.keys(m?.players||{}).find(p=>m.players[p]?.uid===uid)||null;

export function createTableEngine({code,bank,clock=()=>Date.now()}){
 let m=null,presence={},botDueAt=null,botKey=null,lastMoveByBot=false;

 // The bot seat the table is waiting for, if any.
 const botSeat=()=>m?.status==='reserved'&&m.session?Object.keys(m.players||{}).find(p=>m.players[p]?.bot&&mustAct(m.session,p))||null:null;
 // When the bot moves: after a short pause, or, if its human partner may signal
 // it, once the signal arrives or 12 s after its turn started.
 function scheduleBot(){
  const seat=botSeat();if(!seat){botDueAt=null;botKey=null;return;}
  const r=m.session.room,signal=signalFor(r,seat),key=[seat,r.turnClock?.key||'',signal||''].join('|');
  if(key===botKey&&botDueAt!=null)return;
  const now=clock(),waitUntil=!signal&&awaitsSignal(m.session,seat)?(r.turnClock?.startedAt??now)+SIGNAL_WAIT_MS:0;
  botKey=key;botDueAt=Math.max(now+(lastMoveByBot?BOT_AFTER_BOT_MS:BOT_DELAY_MS),waitUntil);
 }
 // Tries the bot's moves best first; the referee rejects an illegal one unchanged.
 async function playBot(){
  const seat=botSeat();botDueAt=null;botKey=null;if(!seat)return false;
  let failure=null;
  for(const command of botCommands(m.session,seat)){
   try{await operate({uid:m.players[seat].uid,command,requestId:null,presence});lastMoveByBot=true;return true;}
   catch(error){failure=error;}
  }
  console.error('bot move failed',code,seat,failure?.message);
  return false;
 }

 // One accounting step in the bank (Firebase or Cloudflare). An administrator
 // may have closed the match in the ledger meanwhile: then the ledger wins.
 async function accounting(op,args,{creating=false,initial}={}){
  const now=clock();
  const result=await bank.apply({code,match:creating?null:m,op,args,now},{initial});
  if(result.closedBy){closeLocally(result.closedBy.closeReason||'admin',now);return;}
  m=result.full;
 }

 // Cheap in-memory run; escalates to the bank only if credits would move.
 async function operate(args,{forceLedger=false}={}){
  const op=(ledger,now)=>tableOperation(ledger,{...args,code,now});
  if(!m)throw new Error('La mesa ya no está disponible.');
  if(!forceLedger){
   const now=clock(),wallets={};
   for(const person of Object.values(m.players||{}))if(person)wallets[person.uid]={balance:PROBE_BALANCE,locked:ACTIVE.includes(m.status)?m.stake:0};
   const ledger={wallets:structuredClone(wallets),matches:{[m.id]:structuredClone(m)},tables:{[code]:m.id}};
   const next=op(ledger,now),nm=next.matches[next.tables[code]];
   const moved=next.tables[code]!==m.id||nm.status!==m.status||JSON.stringify(next.wallets)!==JSON.stringify(wallets);
   if(!moved){m=nm;return;}
  }
  await accounting('operation',args);
 }

 function closeLocally(reason,now){
  m={...m,status:m.status==='waiting'?'refunded':m.status,closedAt:now,closeReason:reason,revision:m.revision+1};
  if(m.session)m.session={...m.session,room:{...m.session.room,status:'closed',closeReason:reason}};
 }

 return {
  get match(){return m;},
  get presence(){return presence;},
  load(saved){m=saved?.match||null;presence=saved?.presence||{};botDueAt=null;botKey=null;scheduleBot();},
  snapshot(){return {match:m,presence};},
  playerFor(uid){return findPlayer(m,uid);},
  async create(user,{id,stake,targetPoints,mode,secret,initial}){
   if(m&&!(m.closedAt||['settled','refunded'].includes(m.status)))throw new CodeTakenError();
   const previous=m;m=null;presence={};
   try{await accounting('create',{id,uid:user.uid,name:user.name,stake,targetPoints,mode,secret},{creating:true,initial});}
   catch(error){if(!m)m=previous;throw error;}
  },
  async join(user,{password='',team,initial}){
   if(!m)throw new Error('La mesa ya no está disponible.');
   if(findPlayer(m,user.uid))return;
   await accounting('join',{uid:user.uid,name:user.name,password,team},{initial});
   scheduleBot();
  },
  async act(uid,{command,requestId,expectedMatchId}){
   if(!command||typeof command.kind!=='string')throw new Error('Jugada inválida.');
   const forceLedger=['rematch','cancel','abandon'].includes(command.kind);
   await operate({uid,command,requestId:command.kind==='tick'?null:requestId,expectedMatchId,presence},{forceLedger});
   if(!['tick','chat','mute'].includes(command.kind))lastMoveByBot=false;
   scheduleBot();
  },
  async tick(){
   if(!m||!ACTIVE.includes(m.status))return;
   if(!(botDueAt!=null&&clock()>=botDueAt&&await playBot()))await operate({uid:m.player1,command:{kind:'tick'},presence});
   scheduleBot();
  },
  async adminClose({actor,requestId,reason}){
   if(!m)throw new Error('La mesa ya no está disponible.');
   await accounting('admin',{actor,action:'close-table',requestId,reason});
  },
  // Returns true when the visible presence changed.
  setOnline(uid,online){
   const player=findPlayer(m,uid);if(!player)return false;
   const old=presence[player],now=clock();
   if(online&&old?.online===true&&old.matchNumber===m.matchNumber)return false;
   if(!online&&old?.online===false)return false;
   presence={...presence,[player]:online?{uid,matchNumber:m.matchNumber,online:true}:{uid,matchNumber:m.matchNumber,online:false,disconnectedAt:now}};
   return true;
  },
  publicRoom(){
   if(!m)return null;
   const room=publicTable(m);
   if(Object.keys(presence).length)room.connectionPresence=presence;
   return room;
  },
  handFor(uid){const player=findPlayer(m,uid);return player?privateTableHand(m,player):null;},
  lobbyEntry(){
   if(!m||m.status!=='waiting'||m.closedAt)return null;
   const room=publicTable(m);return room.status==='waiting'?room:null;
  },
  isFinished(){return !m||!!m.closedAt||m.status==='refunded'||m.session?.room?.status==='closed';},
  nextDeadline(){
   if(!m)return null;
   const now=clock(),times=[];
   if(m.status==='waiting')times.push(m.createdAt+WAIT_MS);
   const r=m.session?.room;
   if(m.status==='reserved'&&r){
    times.push(r.resolutionEndsAt,r.pendingNextHand?.endsAt,r.status==='revealing'?r.endReveal?.endsAt:null,r.openingDraw?.resolveAt,r.openingDraw?.endsAt);
    if(r.turnClock?.startedAt)times.push(r.turnClock.startedAt+45000);
    times.push(botDueAt);
    for(const p of Object.values(presence))if(p?.online===false&&Number.isFinite(p.disconnectedAt))times.push(p.disconnectedAt+DISCONNECT_MS);
    // Safety net for any timer the projection above does not know about.
    times.push(now+15000);
   }
   const future=times.filter(t=>Number.isFinite(t)).map(t=>Math.max(t,now+50));
   return future.length?Math.min(...future):null;
  }
 };
}
