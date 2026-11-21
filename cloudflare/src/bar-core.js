// The BAR (trucouruguayo.uy/bar): people walk around a drawn bar and chat with whoever stands
// near them. Pure rules shared by the Bar object and its tests: the floor size, where people
// appear, how often they may move or talk, what a message may contain and who hears it.
import chatModeration from '../../functions/chat-moderation.cjs';

const {blockedChatReason}=chatModeration;

// World units, the same ones bar/bar.js draws with.
export const WORLD={w:1600,h:2400};
// Who hears a message: people within this distance of the one who says it.
export const HEAR_RADIUS=115;
export const MOVE_MIN_MS=90;
export const SAY_MIN_MS=700,SAY_WINDOW_MS=15000,SAY_WINDOW_MAX=6,SAY_MAX_CHARS=140;

const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
// Everyone stays in front of the counter (y 190 on); the staff (BAR_STAFF) can also go behind it.
export const clampPosition=(x,y,top=190)=>({x:Math.round(clamp(x,20,WORLD.w-20)),y:Math.round(clamp(y,top,WORLD.h-20))});
export const BEHIND_COUNTER_TOP=40;
export const barStaff=(env,uid)=>!!uid&&String(env?.BAR_STAFF||'').split(',').map(s=>s.trim()).includes(uid);

// New people come in by the door (right wall, near the counter), a little apart from each other.
export function spawnPosition(random=Math.random){return clampPosition(1480-random()*80,300+random()*120);}

// A step: a finite point, not more often than MOVE_MIN_MS, with where the person faces (radians)
// and whether they sit on a chair. Returns {x, y, a, s} or null.
export function acceptMove(person,message,now){
 const x=Number(message?.x),y=Number(message?.y);
 if(!Number.isFinite(x)||!Number.isFinite(y))return null;
 if(now-(person.movedAt||0)<MOVE_MIN_MS)return null;
 const turn=Number(message?.a),a=Number.isFinite(turn)?Math.round(Math.atan2(Math.sin(turn),Math.cos(turn))*100)/100:0;
 return {...clampPosition(x,y,person?.staff?BEHIND_COUNTER_TOP:190),a,s:message?.s===true};
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

// Behind the counter (only the staff gets there) one talks and hears twice as far; a conversation goes both ways.
export const reachOf=p=>p?.staff&&p.y<190?HEAR_RADIUS*2:HEAR_RADIUS;
export const hears=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=Math.max(reachOf(a),reachOf(b));

// Who may come in while the BAR is being tried: administrators and the uids in BAR_ALLOW.
export function allowListed(env,uid){
 return String(env?.BAR_ALLOW||'').split(',').map(s=>s.trim()).filter(Boolean).includes(uid);
}

// A card as the BAR draws it: rank and suit only.
const cardOf=card=>card&&Number.isFinite(Number(card.rank))&&typeof card.suit==='string'?{r:Number(card.rank),s:card.suit}:null;
const list=v=>Array.isArray(v)?v:Object.values(v||{});
// The cards already on the table this hand, in order, with their trick: what anyone at the table sees.
export function playedCards(room){
 const out=[],seen=new Set(),add=(item,t)=>{const c=cardOf(item?.card);if(!c||!item.playerId)return;const key=item.playerId+'|'+c.r+c.s;if(seen.has(key))return;seen.add(key);out.push({p:item.playerId,...c,t});};
 const tricks=list(room?.tricks);tricks.forEach((trick,i)=>list(trick?.played||trick?.cards).forEach(item=>add(item,i)));
 list(room?.trickCards).forEach(item=>add(item,tricks.length));
 return out.slice(0,12);
}
// What a table in play tells the BAR: the people seated, the score, the last call and what is public on
// the table (the cards already played, the muestra, who deals). Never the cards someone holds.
// presence: which seats still have the table open, so the bar sees people leave a finished game.
// What the players say out loud this hand (the table's own feed, which everyone at it sees): the calls
// (truco, envido, flor), the answers and the points sung, each with who said it. Never anything private.
export function spokenWords(text=''){
 if(/\bdice QUIERO\b/i.test(text))return 'Quiero';
 if(/\bresponde:\s*tiene\b/i.test(text))return 'Tiene';
 if(/\bla m[ií]a es flor\b/i.test(text))return 'La mía es flor';
 if(/se fue al mazo/i.test(text))return 'Me voy al mazo';
 if(/\bcantó flor\b/i.test(text))return '¡Flor!';
 const points=text.match(/\bcanta (\d+) (tantos?|son mejores|son iguales|de flor)\b/i);
 if(points)return points[1]+' '+points[2];
 if(/: son buenas\./i.test(text))return 'Son buenas';
 if(!/\b(canta|dice|responde|quiere)\b/i.test(text))return null;
 if(/no quiere/i.test(text))return 'No quiero';
 if(/quiere/i.test(text))return 'Quiero';
 const call=['contra flor al resto','con flor envido','falta envido','real envido','envido','vale cuatro','retruco','truco','flor'].find(c=>text.toLowerCase().includes(c));
 return call?'¡'+call[0].toUpperCase()+call.slice(1)+'!':null;
}
function saysOf(room,players){
 const out=[];
 for(const item of Array.isArray(room.feed)?room.feed.slice(0,6):[]){
  const text=String(item?.text||'');if(/^Nueva mano\b/.test(text))break;
  const seat=Object.keys(players).filter(q=>{const n=room.players?.[q]?.name||players[q].name;return n&&(text.startsWith(n+' ')||text.startsWith(n+':'));})
   .sort((x,y)=>String(players[y].name).length-String(players[x].name).length)[0];
  const w=seat&&spokenWords(text);
  if(w)out.unshift({id:String(Number(item.time)||0)+seat,p:seat,w});
 }
 return out.slice(-4);
}
// A 2 vs 2 signal between partners: only that one was made, never which.
const signOf=room=>room.teamSignal?.id&&room.teamSignal.handNumber===room.handNumber&&typeof room.teamSignal.from==='string'?{id:String(room.teamSignal.id).slice(0,40),p:room.teamSignal.from}:null;
export function liveTableEntry(m,presence={}){
 if(!m||m.closedAt||m.status==='waiting'||m.status==='refunded')return null;
 const room=m.session?.room;if(!room||room.status==='closed')return null;
 const players={};for(const [seat,p] of Object.entries(m.players||{}))if(p?.uid)players[seat]={uid:p.uid,name:p.name||''};
 const bet=room.pendingBet;
 return {mode:m.mode==='2v2'?'2v2':'1v1',players,scores:{player1:Number(room.scores?.player1)||0,player2:Number(room.scores?.player2)||0},
  targetPoints:Number(room.targetPoints)||null,finished:room.status==='complete'||m.status==='settled',
  call:bet?.called&&typeof bet.called==='string'?bet.called:null,house:!!m.house,
  here:Object.fromEntries(Object.entries(players).map(([seat,p])=>[seat,presence?.[seat]?.uid===p.uid?presence[seat].online!==false:true])),
  hand:Number(room.handNumber)||1,dealer:typeof room.dealer==='string'?room.dealer:null,muestra:cardOf(room.muestra),played:playedCards(room),says:saysOf(room,players),sign:signOf(room)};
}

// Online in the bar means the same as "Jugando" in the admin: the game on screen, with a pulse in the
// last 90 seconds (adminMetrics/presence/<uid>/<session> = {at}). A game left open in the background
// or in a forgotten tab keeps its socket, but stops pulsing, so it no longer counts.
export const PRESENCE_ACTIVE_MS=90000;
export const presenceActive=(sessions,now)=>Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now+5000&&now-s.at<PRESENCE_ACTIVE_MS);

// ---------- the board: the best players ----------
// A week goes from Monday 00:00 to the next Monday 00:00, Uruguay time (UTC-3, no summer time).
// Its key is that Monday's date: "2026-11-16".
const UY_OFFSET_MS=3*3600000;
export function weekKey(now){
 const d=new Date(now-UY_OFFSET_MS),back=(d.getUTCDay()+6)%7;
 return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-back)).toISOString().slice(0,10);
}
// Top rows from {uid: number}, highest first (ties: the uid, so the order never jumps around).
export function topOf(values,count=10){
 return Object.entries(values||{}).map(([uid,v])=>[uid,Number(v)||0]).filter(([,v])=>v>0)
  .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,count);
}

// ---------- the room: where each table stands ----------
// Every BAR (2D or 3D, on every phone) must show each table in the same place: people sit on chairs by
// their position, so if one phone puts a table here and another puts a different one there, someone
// seated at a free 1 vs 1 shows up at a 2 vs 2 for everyone else. The lobby lays the room out and sends
// it; the pages only draw it. Cells are 0..BAR_CELLS-1 (5 per row, under the counter).
export const BAR_CELLS=30;
const isHouseUid=uid=>String(uid||'').startsWith('house_');
const isBotUid=uid=>/^(bot:|house_)/.test(String(uid||''));
const kindOfLive=t=>t?.mode==='2v2'||Object.keys(t?.players||{}).length>2?'2v2':'1v1';
// The tables the BAR shows, code → '1v1' | '2v2':
// - waiting tables with a person (a bot waiting alone is not shown),
// - two tables of the house at 20 points to sit down and play (the ones already shown first),
// - tables in play, and a game over until every person at it has left.
export function barTables(rooms,live,shown=new Set()){
 const all=new Map(),onlyHouse=room=>Object.values(room.players||{}).every(p=>!p?.uid||isHouseUid(p.uid));
 for(const [code,room] of Object.entries(rooms||{}))if(room?.status==='waiting'&&!onlyHouse(room))all.set(code,room.mode==='2v2'?'2v2':'1v1');
 Object.entries(rooms||{}).filter(([,room])=>room?.status==='waiting'&&room.mode!=='2v2'&&onlyHouse(room)&&Number(room.targetPoints)===20)
  .sort(([a],[b])=>(shown.has(b)-shown.has(a))||a.localeCompare(b)).slice(0,2).forEach(([code])=>all.set(code,'1v1'));
 for(const [code,t] of Object.entries(live||{}))if(t&&!(t.finished&&!Object.entries(t.players||{}).some(([seat,p])=>p?.uid&&!isBotUid(p.uid)&&t.here?.[seat]!==false)))all.set(code,kindOfLive(t));
 return all;
}
// The layout: {cells:{"<cell>":{k:'1v1'|'2v2',c:code|null}}}. A table keeps its cell while it is shown
// (and takes the kind it has now: a waiting table can change from 1 vs 1 to 2 vs 2). A new table takes
// the free table of its kind (the one its creator sat at in the BAR), and a new free one is brought.
// There is always one free table of each kind; a table that is gone is taken away.
// A free table asked from the waiter at the back has its points and who asked: {k,c:null,p,by,at}. It stays
// free for anyone until someone opens a table of that kind and points (it takes that cell), or for 10 minutes.
export const REQUEST_MS=10*60000,REQUEST_MAX=4;
const isRequest=v=>!v?.c&&Number.isFinite(v?.p);
export function barLayout(prev,tables,{points=new Map(),now=Date.now()}={}){
 const before=prev?.cells||{},cells={},used=new Set(),free={},asked=[];
 for(const [cell,v] of Object.entries(before)){const i=Number(cell);if(v?.c&&tables.has(v.c)&&i>=0&&i<BAR_CELLS){cells[i]={k:tables.get(v.c),c:v.c};used.add(i);}}
 for(const [cell,v] of Object.entries(before)){const i=Number(cell);if(used.has(i)||!(i>=0&&i<BAR_CELLS)||!(v?.k==='1v1'||v?.k==='2v2'))continue;
  if(isRequest(v)){if(now-v.at<REQUEST_MS){asked.push([i,v]);used.add(i);}}
  else if(!v?.c)free[v.k]??=i;}
 const next=()=>{for(let i=0;i<BAR_CELLS;i++)if(!used.has(i)&&free['1v1']!==i&&free['2v2']!==i)return i;return null;};
 const placed=new Set(Object.values(cells).map(v=>v.c));
 for(const [code,k] of [...tables].filter(([code])=>!placed.has(code)).sort(([a],[b])=>a.localeCompare(b))){
  // A table opened at the points of one asked for takes that one (the oldest first).
  const p=Number(points.get(code)),j=asked.findIndex(([,v])=>v.k===k&&v.p===p);
  let i;if(j>=0){i=asked[j][0];asked.splice(j,1);}else{i=free[k];if(i!=null)delete free[k];else i=next();}
  if(i==null)continue;cells[i]={k,c:code};used.add(i);
 }
 for(const [i,v] of asked)cells[i]={k:v.k,c:null,p:v.p,by:v.by,at:v.at};
 for(const k of ['1v1','2v2']){if(free[k]==null){const i=next();if(i==null)continue;free[k]=i;}cells[free[k]]={k,c:null};}
 return {cells};
}
// Asking the waiter at the back for a free table: one per person (a new one replaces theirs), at most 4.
export function barRequest(prev,{uid,k,p,now=Date.now()}){
 if(!uid||!(k==='1v1'||k==='2v2')||![10,20,30,40].includes(p))return null;
 const cells={...(prev?.cells||{})};
 for(const [cell,v] of Object.entries(cells))if(isRequest(v)&&(v.by===uid||now-v.at>=REQUEST_MS))delete cells[cell];
 if(Object.values(cells).filter(isRequest).length>=REQUEST_MAX)return null;
 let i=0;while(i<BAR_CELLS&&cells[i])i++;
 if(i>=BAR_CELLS)return null;
 cells[i]={k,c:null,p,by:uid,at:now};
 return {cells};
}

// ---------- people: how each one looks, gestures, invitations ----------
// A look is chosen in the BAR and kept per account: indices into the page's palettes and a few words.
export const LOOK_OPTIONS={g:['m','f'],h:['short','long','ponytail','bun','curly','bald','bob','braids','afro','mohawk','fade','quiff','messy','fringe','wavy',
  'buzz','sidepart','spiky','undercut','manbun','mullet','shortwavy','shaggy','longcurly','dreads','pixie','bangs','halfup','pigtails','braid','lowbun'],
 o:['remera','camisa','buzo','campera','musculosa','rayas','vestido','pollera','chomba','camiseta','polera','saco','estampada','mangalarga','raglan','cuellov','buzocierre','sueter'],
 a:['','gorra','sombrero','boina','gorro','vincha','piluso','atras','plana','bombin','panama','gaucho','bandana'],
 e:['','lentes','sol','redondos','aviador','gatito','gruesos','clubmaster','solredondos','deportivos'],n:['','bufanda','cadena','perlas','medalla'],f:['','barba','bigote','candado','tres','larga','patillas','chivita','manubrio'],
 q:['jean','chino','jogging','bermuda','cargo','vestir','roto','short'],y:['champion','alta','bota','mocasin','zapato','alpargata','botin','running'],steps:5,skin:10,hair:11,shirt:18,pants:10,shoes:8};
const pick=(list,v,fallback)=>list.includes(v)?v:fallback;
const index=(n,v)=>Number.isInteger(v)&&v>=0&&v<n?v:0;
export function cleanLook(input){
 if(!input||typeof input!=='object')return null;
 const O=LOOK_OPTIONS,g=pick(O.g,input.g,'m');
 // Looks saved before glasses and scarves had their own place (a:'lentes'|'bufanda', b:true for a beard).
 const e=input.e??(input.a==='lentes'?'lentes':''),n=input.n??(input.a==='bufanda'?'bufanda':''),f=input.f??(input.b===true?'barba':'');
 return {g,s:index(O.skin,input.s),h:pick(O.h,input.h,'short'),hc:index(O.hair,input.hc),t:index(O.shirt,input.t),o:pick(O.o,input.o,'remera'),
  p:index(O.pants,input.p),q:pick(O.q,input.q,'jean'),z:index(O.shoes,input.z),y:pick(O.y,input.y,'champion'),a:pick(O.a,input.a,''),e:pick(O.e,e,''),n:pick(O.n,n,''),ac:index(O.shirt,input.ac),d:index(O.shirt,input.d??input.ac),
  f:g==='m'?pick(O.f,f,''):'',r:input.r===true,k:Number.isInteger(input.k)&&input.k>=0&&input.k<O.steps?input.k:2,w:Number.isInteger(input.w)&&input.w>=0&&input.w<O.steps?input.w:2};
}
// Gestures everyone in the room sees; at most one every 1.2 seconds.
export const GESTURES=['wave','clap','cheers','party'];
export function acceptGesture(person,g,now){
 if(!GESTURES.includes(g)||now-(person.gestureAt||0)<1200)return null;
 return g;
}
// An invitation to play: one every 15 seconds; the answer counts for 2 minutes.
export const INVITE_EVERY_MS=15000,INVITE_ANSWER_MS=120000;
export function acceptInvite(person,to,points,now){
 if(typeof to!=='string'||!to||to===person.uid||now-(person.invitedAt||0)<INVITE_EVERY_MS)return null;
 return {to,points:[10,20,30,40].includes(points)?points:20};
}
export const inviteOpen=(inviter,to,now)=>inviter?.invitedTo===to&&now-(inviter.invitedAt||0)<INVITE_ANSWER_MS;
// Someone sitting at a free table, choosing the points: the table (its cell) is theirs for a moment.
export function cleanArming(cell,points){
 if(cell==null)return null;
 if(!Number.isInteger(cell)||cell<0||cell>=BAR_CELLS)return null;
 return {cell,points:[10,20,30,40].includes(points)?points:20};
}

// ---------- the counter: ordering from the barman ----------
// Drinks are carried in the hand; food stays on the counter where it was ordered. One order every 3 s.
export const DRINKS=['refresco','cafe','agua','cerveza','vino'],FOODS=['hamburguesa','papas','ensalada'];
export function acceptOrder(person,item,now){
 if(!DRINKS.includes(item)&&!FOODS.includes(item))return null;
 if(now-(person.orderedAt||0)<3000)return null;
 const x=Math.round(Number(person.x)||0);
 return DRINKS.includes(item)?{hold:item}:{food:{item,x}};
}

// ---------- who gets in: open to everyone with an account, at most BAR_MAX people at once ----------
// BAR_OPEN="1" opens it (set it to "0" to close it again at once); the allow list still works when closed.
export const BAR_MAX=50;
export const barOpen=(env,uid)=>env?.BAR_OPEN==='1'||allowListed(env,uid);
// Full when BAR_MAX different people are inside; someone already inside (another tab) can always come back.
export const barFull=(insideUids,uid,max=BAR_MAX)=>!insideUids.has(uid)&&insideUids.size>=max;
// A problem reported from the sign: the same as the game's "Reportar un problema" (5 to 1000 characters).
export function cleanProblem(text,requestId){
 const message=typeof text==='string'?text.trim():'';
 if(message.length<5||message.length>1000)return {error:'Escribí un mensaje de entre 5 y 1000 caracteres.'};
 if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))return {error:'No se pudo enviar. Probá de nuevo.'};
 return {message,requestId};
}
