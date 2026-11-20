// The BAR (trucouruguayo.uy/bar): people walk around a drawn bar and chat with whoever stands
// near them. Pure rules shared by the Bar object and its tests: the floor size, where people
// appear, how often they may move or talk, what a message may contain and who hears it.
import chatModeration from '../../functions/chat-moderation.cjs';

const {blockedChatReason}=chatModeration;

// World units, the same ones bar/bar.js draws with.
export const WORLD={w:1600,h:2400};
// Who hears a message: people within this distance of the one who says it.
export const HEAR_RADIUS=230;
export const MOVE_MIN_MS=90;
export const SAY_MIN_MS=700,SAY_WINDOW_MS=15000,SAY_WINDOW_MAX=6,SAY_MAX_CHARS=140;

const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export const clampPosition=(x,y)=>({x:Math.round(clamp(x,20,WORLD.w-20)),y:Math.round(clamp(y,190,WORLD.h-20))});

// New people come in by the door (right wall, near the counter), a little apart from each other.
export function spawnPosition(random=Math.random){return clampPosition(1480-random()*80,300+random()*120);}

// A step: a finite point, not more often than MOVE_MIN_MS. Returns the new position or null.
export function acceptMove(person,message,now){
 const x=Number(message?.x),y=Number(message?.y);
 if(!Number.isFinite(x)||!Number.isFinite(y))return null;
 if(now-(person.movedAt||0)<MOVE_MIN_MS)return null;
 return clampPosition(x,y);
}

// Links, e-mails and phone numbers stay out of a chat with strangers.
const LINK=/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|uy|ar|br|io|me|ly|gg|tv|app|link)\b)/i;
const EMAIL=/[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE=/(\+?\d[\s.-]?){7,}/;

// A message: trimmed, one line, short, clean and not too fast. Returns {text, said} or {error}.
export function acceptSay(person,raw,now){
 const text=String(raw??'').replace(/\s+/g,' ').trim().slice(0,SAY_MAX_CHARS);
 if(!text)return {error:'Escribí algo.'};
 if(LINK.test(text)||EMAIL.test(text)||PHONE.test(text))return {error:'En el bar no se pueden mandar links, correos ni teléfonos.'};
 if(blockedChatReason(text))return {error:'Ese mensaje no se puede mandar.'};
 const recent=(person.said||[]).filter(t=>now-t<SAY_WINDOW_MS);
 if(recent.length&&now-recent[recent.length-1]<SAY_MIN_MS)return {error:'Más despacio.'};
 if(recent.length>=SAY_WINDOW_MAX)return {error:'Más despacio: esperá unos segundos.'};
 return {text,said:[...recent,now]};
}

export const hears=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=HEAR_RADIUS;

// Who may come in while the BAR is being tried: administrators and the uids in BAR_ALLOW.
export function allowListed(env,uid){
 return String(env?.BAR_ALLOW||'').split(',').map(s=>s.trim()).filter(Boolean).includes(uid);
}

// What a table in play tells the BAR: the people seated, the score and the last call. No cards.
export function liveTableEntry(m){
 if(!m||m.closedAt||m.status==='waiting'||m.status==='refunded')return null;
 const room=m.session?.room;if(!room||room.status==='closed')return null;
 const players={};for(const [seat,p] of Object.entries(m.players||{}))if(p?.uid)players[seat]={uid:p.uid,name:p.name||''};
 const bet=room.pendingBet;
 return {mode:m.mode==='2v2'?'2v2':'1v1',players,scores:{player1:Number(room.scores?.player1)||0,player2:Number(room.scores?.player2)||0},
  targetPoints:Number(room.targetPoints)||null,finished:room.status==='complete'||m.status==='settled',
  call:bet?.called&&typeof bet.called==='string'?bet.called:null,house:!!m.house};
}
