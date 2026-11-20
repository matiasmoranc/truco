// The BAR (trucouruguayo.uy/bar, hidden while it is tried): a drawn bar seen from above with
// the real tables. Tables in play show who sits and the score; open tables have a free chair to
// sit on; one free table of 1 vs 1 and one of 2 vs 2 are always there, brought by the waiter,
// who also takes empty ones away when more than two are left. People with the game open but not
// playing stand at the counter. People inside the bar walk (tap the floor) and talk to whoever
// stands near them. The lobby socket (bar:true) gives the tables; the bar socket, the walkers.
import {firebaseConfig} from '/firebase-config.js?v=20261016-auth-domain';

const FIREBASE_VERSION='12.4.0';
const LOCAL=['localhost','127.0.0.1'].includes(location.hostname);
const LIVE_URL=(LOCAL?location.origin.replace(/^http/,'ws')+'/live':'wss://truco-live.mati-moran-castro.workers.dev');
const DEV_NAME=LOCAL?new URLSearchParams(location.search).get('dev'):null;
const WORLD={w:1600,h:2400},HEAR_RADIUS=230,WALK_SPEED=280;
const DOOR={x:1560,y:330};
const $=id=>document.getElementById(id);

// ---------- sockets ----------
class Channel{
 constructor(path,token,extra,onEvent,onStatus){Object.assign(this,{path,token,extra,onEvent,onStatus,seq:0,backoff:400,closed:false});this.connect();}
 connect(){
  const ws=new WebSocket(LIVE_URL+this.path);this.ws=ws;
  ws.onopen=async()=>{
   let token;try{token=await this.token();}catch(error){this.onStatus?.('auth-failed',error);return;}
   if(this.ws!==ws)return;const id=String(++this.seq);this.authId=id;
   ws.send(JSON.stringify({t:'auth',id,token,...this.extra}));
   clearInterval(this.pinger);this.pinger=setInterval(()=>{if(ws.readyState===1)ws.send('ping');},25000);
  };
  ws.onmessage=event=>{
   if(event.data==='pong')return;let m;try{m=JSON.parse(event.data);}catch{return;}
   if(m.t==='res'&&m.id===this.authId){if(m.ok){this.backoff=400;this.ready=true;this.onStatus?.('ready',m.data);}else{this.onStatus?.('refused',m);this.closed=true;ws.close();}return;}
   this.onEvent(m);
  };
  ws.onclose=event=>{
   if(this.ws!==ws)return;clearInterval(this.pinger);this.ready=false;
   if(this.closed||event.code===4000){this.onStatus?.(event.code===4000?'replaced':'closed');return;}
   this.onStatus?.('reconnecting');const wait=this.backoff;this.backoff=Math.min(this.backoff*2,6000);setTimeout(()=>this.connect(),wait);
  };
 }
 send(m){if(this.ready&&this.ws?.readyState===1)this.ws.send(JSON.stringify(m));}
}

// ---------- state ----------
const state={me:null,walkers:new Map(),rooms:{},live:{},online:[],slots:[],trips:[],mozo:null,muted:new Set(),
 cam:{x:0,y:0,s:.6},follow:true,lastCall:{},chat:[],nearIds:'',lastNearAt:0};
let lobby=null,bar=null,services=null;
if(LOCAL)Object.assign(globalThis,{barState:state,barWalk:(x,y)=>walkTo(x,y)});

// ---------- avatars ----------
const ICON_FILE={robot:'robot',persona:'persona',mate:'mate',espada:'espada',bandera:'bandera',gaucho:'escudo',termo:'termo'};
const images=new Map();
function image(src){let img=images.get(src);if(!img){img=new Image();img.decoding='async';img.src=src;images.set(src,img);}return img;}
const avatars=new Map();
function avatarOf(uid,name){
 if(String(name||'').startsWith('Bot ')||String(uid).startsWith('house_'))return image('/assets/profile/robot.webp');
 const hit=avatars.get(uid);if(hit)return hit.img;
 avatars.set(uid,{img:image('/assets/profile/persona.webp')});
 services?.then(async fb=>{const v=(await fb.get(fb.ref(fb.db,'avatars/'+uid))).val()||{};
  const src=v.photo&&v.use!=='icon'?v.photo:'/assets/profile/'+(ICON_FILE[v.icon]||'persona')+'.webp';avatars.set(uid,{img:image(src)});}).catch(()=>{});
 return avatars.get(uid).img;
}
const SHIRTS=['#7a2f2f','#2f6a8a','#2f7a4a','#8a6a2f','#6a2f7a','#b5572f','#3a5c8a','#4a5560','#8a3a5a','#2f8a7a'];
const shirtOf=uid=>{let h=7;for(const c of String(uid))h=(h*31+c.charCodeAt(0))>>>0;return SHIRTS[h%SHIRTS.length];};

// ---------- tables and the waiter ----------
// Grid cells for tables, under the counter. A slot keeps its cell while it exists.
const COLS=[200,500,800,1100,1400],ROW0=560,ROW_H=310,MAX_ROWS=6;
const cellAt=i=>({x:COLS[i%COLS.length],y:ROW0+Math.floor(i/COLS.length)*ROW_H});
const tableKind=t=>t?.mode==='2v2'||Object.keys(t?.players||{}).length>2?'2v2':'1v1';
function currentTables(){
 const all=new Map();
 // A bot waiting alone at its table is not shown: only tables with a person waiting or playing.
 for(const [code,room] of Object.entries(state.rooms))if(room?.status==='waiting'&&!Object.values(room.players||{}).every(p=>!p?.uid||String(p.uid).startsWith('house_')))all.set(code,{code,kind:room.mode==='2v2'?'2v2':'1v1',waiting:true,room});
 for(const [code,t] of Object.entries(state.live))if(t)all.set(code,{code,kind:tableKind(t),waiting:false,live:t});
 return all;
}
let slotSeq=0;
function freeCell(){const used=new Set(state.slots.map(s=>s.cell));for(let i=0;i<COLS.length*MAX_ROWS;i++)if(!used.has(i))return i;return null;}
function newSlot(kind,animate){
 const cell=freeCell();if(cell==null)return null;
 const slot={id:++slotSeq,kind,cell,...cellAt(cell),code:null,placed:!animate};
 state.slots.push(slot);if(animate)state.trips.push({type:'bring',slot});return slot;
}
function syncSlots(initial){
 const tables=currentTables();
 for(const slot of state.slots)if(slot.code&&!tables.has(slot.code))slot.code=null;
 const taken=new Set(state.slots.map(s=>s.code).filter(Boolean));
 // On the first load the tables are already there; later, a new one sits at a free table of its kind.
 const fresh=[...tables.values()].filter(t=>!taken.has(t.code)).sort((a,b)=>(a.waiting-b.waiting)||a.code.localeCompare(b.code));
 for(const t of fresh){
  const free=state.slots.find(s=>!s.code&&s.kind===t.kind&&!s.leaving);
  const slot=free||newSlot(t.kind,!initial);if(slot)slot.code=t.code;
 }
 for(const kind of ['1v1','2v2'])if(!state.slots.some(s=>!s.code&&s.kind===kind&&!s.leaving)&&!state.trips.some(t=>t.type==='bring'&&t.slot.kind===kind&&!t.slot.code))newSlot(kind,!initial);
 // More than two empty tables: the waiter takes one away, keeping one free of each kind.
 const empty=state.slots.filter(s=>!s.code&&!s.leaving&&s.placed);
 if(empty.length>2&&!state.trips.some(t=>t.type==='take')){
  const spare=empty.reverse().find(s=>empty.filter(o=>o.kind===s.kind).length>1);
  if(spare){spare.leaving=true;state.trips.push({type:'take',slot:spare});}
 }
 renderCount();
}
// One trip at a time: from the door to the table and back.
function stepMozo(now){
 if(!state.mozo&&state.trips.length){
  const trip=state.trips.shift();
  if(trip.type==='take'&&trip.slot.code){trip.slot.leaving=false;return;}
  const d=Math.hypot(trip.slot.x-DOOR.x,trip.slot.y-DOOR.y);state.mozo={...trip,start:now,leg:Math.max(900,d/WALK_SPEED*1000)};
 }
 const m=state.mozo;if(!m)return null;
 const t=(now-m.start)/m.leg,{slot}=m;
 if(t>=1&&m.type==='bring')slot.placed=true;
 if(t>=1&&m.type==='take'&&!slot.code){state.slots=state.slots.filter(s=>s!==slot);}
 if(t>=2){state.mozo=null;syncSlots(false);return null;}
 const k=t<1?t:2-t,x=DOOR.x+(slot.x-DOOR.x)*k,y=DOOR.y+(slot.y+60-DOOR.y)*k;
 const carrying=(m.type==='bring'&&t<1)||(m.type==='take'&&t>=1&&!slot.code);
 return {x,y,carrying,kind:slot.kind,facing:t<1?Math.atan2(slot.y-DOOR.y,slot.x-DOOR.x):Math.atan2(DOOR.y-slot.y,DOOR.x-slot.x)};
}

// ---------- drawing ----------
const canvas=$('scene'),ctx=canvas.getContext('2d');
let W=0,H=0,DPR=1;
function resize(){DPR=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=W*DPR;canvas.height=H*DPR;}
addEventListener('resize',resize);resize();
let floor=null;
function floorPattern(){
 const c=document.createElement('canvas');c.width=120;c.height=34;const g=c.getContext('2d');
 g.fillStyle='#6b4528';g.fillRect(0,0,120,34);g.fillStyle='#734b2c';g.fillRect(0,0,120,16);
 g.strokeStyle='#4a2e19';g.lineWidth=1.5;g.beginPath();g.moveTo(0,16.5);g.lineTo(120,16.5);g.moveTo(0,33.5);g.lineTo(120,33.5);g.moveTo(70,0);g.lineTo(70,16);g.moveTo(20,17);g.lineTo(20,34);g.moveTo(100,17);g.lineTo(100,34);g.stroke();
 return ctx.createPattern(c,'repeat');
}
const rr=(x,y,w,h,r)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);};
function shadow(on){ctx.shadowColor=on?'rgba(0,0,0,.45)':'transparent';ctx.shadowBlur=on?12:0;ctx.shadowOffsetY=on?6:0;}
function pill(x,y,text,bg='#0f2a1f',fg='#f1e6c8',size=12.5,border='rgba(243,207,115,.45)'){
 ctx.font=`700 ${size}px "DM Sans",sans-serif`;const w=ctx.measureText(text).width+18,h=size+10;
 rr(x-w/2,y-h/2,w,h,h/2);ctx.fillStyle=bg;ctx.fill();if(border){ctx.strokeStyle=border;ctx.lineWidth=1;ctx.stroke();}
 ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+1);return w;
}
function chair(x,y,a,glow){
 ctx.save();ctx.translate(x,y);ctx.rotate(a);
 if(glow){const p=.6+.4*Math.sin(performance.now()/350);ctx.strokeStyle=`rgba(243,207,115,${p})`;ctx.lineWidth=3;rr(-30,-24,60,58,14);ctx.stroke();}
 shadow(true);rr(-23,-17,46,40,9);ctx.fillStyle='#4e3018';ctx.fill();shadow(false);
 rr(-20,-14,40,32,7);ctx.fillStyle='#6a4122';ctx.fill();rr(-24,18,48,10,5);ctx.fillStyle='#3e2512';ctx.fill();
 if(glow){ctx.rotate(-a);ctx.fillStyle='#f3cf73';ctx.font='800 22px "DM Sans",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('+',0,2);}
 ctx.restore();
}
// A person seen from above, facing angle a (0 = up). The head is their avatar.
function person(x,y,a,shirt,img,{cards=false,me=false,mate=false}={}){
 ctx.save();ctx.translate(x,y);ctx.rotate(a);
 shadow(true);ctx.fillStyle=shirt;ctx.beginPath();ctx.ellipse(0,4,25,16,0,0,Math.PI*2);ctx.fill();shadow(false);
 ctx.strokeStyle=shirt;ctx.lineWidth=11;ctx.lineCap='round';
 ctx.beginPath();ctx.moveTo(-21,-2);ctx.quadraticCurveTo(-24,-18,-13,-28);ctx.moveTo(21,-2);ctx.quadraticCurveTo(24,-18,13,-28);ctx.stroke();
 ctx.fillStyle='#e0b48a';ctx.beginPath();ctx.arc(-12,-30,6,0,7);ctx.arc(12,-30,6,0,7);ctx.fill();
 if(cards){ctx.save();ctx.translate(0,-38);for(const r of [-.25,0,.25]){ctx.save();ctx.rotate(r);rr(-6.5,-16,13,19,2);ctx.fillStyle='#8a2b2b';ctx.fill();ctx.strokeStyle='#f1e6c8';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}ctx.restore();}
 if(mate){ctx.save();ctx.translate(26,-14);ctx.fillStyle='#6b3b1d';ctx.beginPath();ctx.arc(0,0,8,0,7);ctx.fill();ctx.fillStyle='#4d7a2a';ctx.beginPath();ctx.arc(0,0,5,0,7);ctx.fill();ctx.fillStyle='#ccc';ctx.fillRect(-1.5,-14,3,14);ctx.restore();}
 ctx.rotate(-a);
 ctx.save();ctx.beginPath();ctx.arc(0,0,15,0,7);ctx.closePath();ctx.fillStyle='#f1e6c8';ctx.fill();ctx.clip();
 if(img?.complete&&img.naturalWidth)ctx.drawImage(img,-15,-15,30,30);ctx.restore();
 ctx.lineWidth=me?3:2;ctx.strokeStyle=me?'#9fd3ff':'rgba(0,0,0,.45)';ctx.beginPath();ctx.arc(0,0,15,0,7);ctx.stroke();
 ctx.restore();
}
function cardBack(x,y,r){ctx.save();ctx.translate(x,y);ctx.rotate(r);rr(-10,-14,20,28,3);ctx.fillStyle='#8a2b2b';ctx.fill();ctx.strokeStyle='#f1e6c8';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}
function tableTop(x,y,kind){
 const w=kind==='2v2'?148:140,h=kind==='2v2'?148:104;
 shadow(true);rr(x-w/2,y-h/2,w,h,kind==='2v2'?20:16);ctx.fillStyle='#8a5c34';ctx.fill();shadow(false);
 rr(x-w/2+10,y-h/2+10,w-20,h-20,11);ctx.fillStyle='#1b5e40';ctx.fill();
}
const SEATS={'1v1':{player1:[0,82,0],player2:[0,-82,Math.PI]},'2v2':{player1:[0,100,0],player2:[100,0,-Math.PI/2],player3:[0,-100,Math.PI],player4:[-100,0,Math.PI/2]}};
const CALLS={truco:'¡TRUCO!',retruco:'¡RETRUCO!',vale4:'¡VALE CUATRO!',envido:'¡ENVIDO!','real-envido':'¡REAL ENVIDO!','falta-envido':'¡FALTA ENVIDO!',flor:'¡FLOR!'};
const callText=c=>CALLS[c]||('¡'+String(c).replace(/[-_]/g,' ').toUpperCase()+'!');
function drawSlot(slot,now){
 if(!slot.placed)return;
 const {x,y,kind}=slot,t=slot.code?currentTables().get(slot.code):null,seats=SEATS[kind];
 const lamp=ctx.createRadialGradient(x,y,0,x,y,kind==='2v2'?210:170);lamp.addColorStop(0,'rgba(255,217,138,.32)');lamp.addColorStop(1,'rgba(255,207,112,0)');ctx.fillStyle=lamp;ctx.fillRect(x-220,y-220,440,440);
 const people=t?(t.live?.players||t.room?.players||{}):{};
 const glow=s=>!t||(t.waiting&&!people[s]?.uid);
 for(const [seat,[dx,dy,a]] of Object.entries(seats))chair(x+dx,y+dy,a+Math.PI,glow(seat));
 tableTop(x,y,kind);
 if(!t){ctx.fillStyle='rgba(13,31,23,.85)';pill(x,y,kind==='2v2'?'LIBRE · 2 vs 2':'LIBRE · 1 vs 1','rgba(13,31,23,.9)','#f3cf73',12);return;}
 if(t.live){cardBack(x-16,y-6,-.2);cardBack(x+14,y+6,.18);if(kind==='2v2')cardBack(x,y+18,.05);}
 else{cardBack(x,y,0);cardBack(x+2,y+2,0);}
 for(const [seat,[dx,dy,a]] of Object.entries(seats)){
  const p=people[seat];if(!p?.uid)continue;
  person(x+dx*.9,y+dy*.9,a,shirtOf(p.uid),avatarOf(p.uid,p.name),{cards:!!t.live,me:p.uid===state.me?.uid});
  const ny=y+dy*1.38+(dy===0?28:0),nx=x+dx*1.25;
  pill(nx,ny,p.name.length>14?p.name.slice(0,13)+'…':p.name,p.uid===state.me?.uid?'#173a52':'#0f2a1f');
 }
 if(t.live){
  const s=t.live.scores,label=(t.live.finished?'Terminó · ':'')+s.player1+' – '+s.player2+(t.live.targetPoints?' · a '+t.live.targetPoints:'');
  pill(x,y-(kind==='2v2'?178:150),label,'#f3cf73','#2a1a0e',13.5,null);
  const call=t.live.call;if(call&&!t.live.finished){
   ctx.save();ctx.translate(x+(kind==='2v2'?110:90),y-(kind==='2v2'?120:70));shadow(true);ctx.font='900 17px "DM Sans",sans-serif';
   const text=callText(call),w=ctx.measureText(text).width+24;rr(0,-18,w,36,10);ctx.fillStyle='#fff6dc';ctx.fill();shadow(false);
   ctx.beginPath();ctx.moveTo(10,16);ctx.lineTo(4,30);ctx.lineTo(24,16);ctx.fill();ctx.fillStyle='#8a2b2b';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(text,12,1);ctx.restore();
  }
 }else{
  const r=t.room,pts=r.targetPoints||20;
  pill(x,y-(kind==='2v2'?178:150),(r.creditMatch?.hasPassword?'🔒 ':'')+'Sentate · '+pts+' pts','#f3cf73','#2a1a0e',13,null);
 }
}
function drawRoom(now){
 ctx.fillStyle=floor||(floor=floorPattern());ctx.fillRect(0,0,WORLD.w,WORLD.h);
 // Back wall with bottles, the sign and the counter.
 ctx.fillStyle='#1d3b2c';ctx.fillRect(0,0,WORLD.w,100);
 const cols=['#2f7a4a','#7a2f2f','#b58a2e','#3a5c8a','#6b4a2a','#9fbf6a'];
 for(let i=0;i<50;i++){const bx=30+i*31,hh=26+(i*7%14);ctx.fillStyle=cols[i%6];rr(bx,82-hh,14,hh,4);ctx.fill();ctx.fillRect(bx+4,74-hh,6,10);}
 ctx.fillStyle='#5c3a1f';ctx.fillRect(0,80,WORLD.w,6);
 ctx.save();ctx.shadowColor='#ffcf70';ctx.shadowBlur=18;rr(WORLD.w/2-120,12,240,50,12);ctx.fillStyle='#0b1712';ctx.fill();ctx.strokeStyle='#f3cf73';ctx.lineWidth=2.5;ctx.stroke();
 ctx.fillStyle='#ffd77a';ctx.font='900 30px "DM Sans",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('B A R',WORLD.w/2,38);ctx.restore();
 shadow(true);rr(30,118,WORLD.w-260,66,14);ctx.fillStyle='#7a4c29';ctx.fill();shadow(false);rr(30,118,WORLD.w-260,12,6);ctx.fillStyle='#a8703f';ctx.fill();
 // The door, on the right wall.
 ctx.fillStyle='#2a1a0e';ctx.fillRect(WORLD.w-24,DOOR.y-80,24,160);ctx.fillStyle='#3e2512';ctx.fillRect(WORLD.w-20,DOOR.y-74,20,148);
 // People online but not playing: on stools along the counter.
 const shown=state.online.filter(p=>!state.walkers.has(p.uid)).slice(0,16);
 shown.forEach((p,i)=>{const sx=90+i*82,sy=222;chair(sx,sy+8,Math.PI,false);person(sx,sy,Math.PI,shirtOf(p.uid),avatarOf(p.uid,p.name),{mate:i%3===0});pill(sx,sy+50,p.name.length>11?p.name.slice(0,10)+'…':p.name,'#0f2a1f','#f1e6c8',11);});
 if(state.online.length>16)pill(90+16*82,222,'+'+(state.online.length-16),'#0f2a1f');
 for(const slot of state.slots)drawSlot(slot,now);
 const mozo=stepMozo(now);
 if(mozo){
  if(mozo.carrying){ctx.save();ctx.translate(mozo.x+Math.cos(mozo.facing)*46,mozo.y+Math.sin(mozo.facing)*46);ctx.rotate(mozo.facing+Math.PI/2);rr(-46,-14,92,28,7);ctx.fillStyle='#8a5c34';ctx.fill();rr(-40,-9,80,18,5);ctx.fillStyle='#1b5e40';ctx.fill();ctx.restore();}
  person(mozo.x,mozo.y,mozo.facing+Math.PI/2,'#f4f1ea',image('/assets/profile/persona.webp'));pill(mozo.x,mozo.y+40,'Mozo','#f4f1ea','#1a1a1a',11);
 }
 // Walkers, then their speech bubbles on top.
 const list=[...state.walkers.values()].sort((a,b)=>a.dy-b.dy);
 for(const w of list){
  const me=w.uid===state.me?.uid;
  if(me){ctx.strokeStyle='rgba(159,211,255,.25)';ctx.setLineDash([8,8]);ctx.lineWidth=2;ctx.beginPath();ctx.arc(w.dx,w.dy,HEAR_RADIUS,0,7);ctx.stroke();ctx.setLineDash([]);}
  person(w.dx,w.dy,w.angle||0,shirtOf(w.uid),avatarOf(w.uid,w.name),{me});
  pill(w.dx,w.dy+42,w.name,me?'#173a52':'#0f2a1f');
 }
 for(const w of list)if(w.bubble&&now<w.bubble.until){
  ctx.font='700 14px "DM Sans",sans-serif';const text=w.bubble.text.length>42?w.bubble.text.slice(0,41)+'…':w.bubble.text,tw=ctx.measureText(text).width+20;
  ctx.save();shadow(true);rr(w.dx-tw/2,w.dy-74,tw,30,10);ctx.fillStyle='#fff6dc';ctx.fill();shadow(false);ctx.beginPath();ctx.moveTo(w.dx-6,w.dy-45);ctx.lineTo(w.dx,w.dy-36);ctx.lineTo(w.dx+6,w.dy-45);ctx.fill();
  ctx.fillStyle='#2a1a0e';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,w.dx,w.dy-58);ctx.restore();
 }
}
function frame(now){
 // Walkers move toward their last known point; mine walks to where I tapped.
 const dt=Math.min(.05,(now-(frame.last||now))/1000);frame.last=now;
 for(const w of state.walkers.values()){
  if(w.uid===state.me?.uid){walkMine(w,dt);continue;}
  const tx=w.tx??w.x,ty=w.ty??w.y,dx=tx-w.dx,dy=ty-w.dy,d=Math.hypot(dx,dy);
  if(d>1){const step=Math.min(d,WALK_SPEED*dt*1.3);w.dx+=dx/d*step;w.dy+=dy/d*step;w.angle=Math.atan2(dy,dx)+Math.PI/2;}
 }
 const me=state.me&&state.walkers.get(state.me.uid);
 if(me&&state.follow){const s=state.cam.s;state.cam.x+=(me.dx-W/2/s-state.cam.x)*.08;state.cam.y+=(me.dy-H/2/s-state.cam.y)*.08;}
 clampCam();
 ctx.setTransform(DPR,0,0,DPR,0,0);ctx.fillStyle='#0b1712';ctx.fillRect(0,0,W,H);
 ctx.setTransform(DPR*state.cam.s,0,0,DPR*state.cam.s,-state.cam.x*state.cam.s*DPR,-state.cam.y*state.cam.s*DPR);
 drawRoom(now);
 if(me)sendMyStep(me,now);
 updateNear(now);
 requestAnimationFrame(frame);
}
function worldBottom(){return Math.max(1100,...state.slots.map(s=>s.y+260));}
function clampCam(){
 const c=state.cam,vw=W/c.s,vh=H/c.s,bottom=worldBottom();
 c.x=vw>=WORLD.w?(WORLD.w-vw)/2:Math.min(Math.max(c.x,-40),WORLD.w-vw+40);
 c.y=vh>=bottom?(bottom-vh)/2:Math.min(Math.max(c.y,-40),bottom-vh+40);
}

// ---------- walking ----------
let lastSent={x:0,y:0,at:0};
function sendMyStep(me,now){
 if(now-lastSent.at<120)return;
 const x=Math.round(me.dx),y=Math.round(me.dy);if(x===lastSent.x&&y===lastSent.y)return;
 lastSent={x,y,at:now};bar?.send({t:'move',x,y});
}
// Nobody walks through the counter, the tables (with their chairs) or other people.
// A tap finds a way around the tables on a grid; other people make me wait or step aside.
const BODY=22,CELL=30;
function obstacles(){
 const list=[{x0:0,y0:0,x1:WORLD.w-225,y1:262}];
 for(const s of state.slots)if(s.placed){const hw=s.kind==='2v2'?128:70,hh=s.kind==='2v2'?128:114;list.push({x0:s.x-hw,y0:s.y-hh,x1:s.x+hw,y1:s.y+hh});}
 return list;
}
function blockedAt(x,y,obs,r=BODY){
 if(x<r||x>WORLD.w-r||y<200||y>worldBottom()-r)return true;
 return obs.some(o=>x>o.x0-r&&x<o.x1+r&&y>o.y0-r&&y<o.y1+r);
}
function clearLine(a,b,obs){const d=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(d/10);for(let i=1;i<=n;i++)if(blockedAt(a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,obs))return false;return true;}
function findPath(from,to,depth=0){
 // Standing inside something (a table the waiter just set down): first step out to the nearest free spot.
 if(!depth&&blockedAt(from.x,from.y,obstacles())){
  const obs=obstacles();let best=null,bd=1e9;
  for(let y=200;y<worldBottom();y+=CELL)for(let x=CELL/2;x<WORLD.w;x+=CELL)if(!blockedAt(x,y,obs)){const d=Math.hypot(x-from.x,y-from.y);if(d<bd){bd=d;best={x,y};}}
  return best?[best,...findPath(best,to,1)]:[];
 }
 const obs=obstacles(),cols=Math.ceil(WORLD.w/CELL),rows=Math.ceil(worldBottom()/CELL),N=cols*rows;
 const center=i=>({x:(i%cols)*CELL+CELL/2,y:Math.floor(i/cols)*CELL+CELL/2});
 const freeCell=new Uint8Array(N);for(let i=0;i<N;i++){const c=center(i);freeCell[i]=blockedAt(c.x,c.y,obs)?0:1;}
 const idx=p=>Math.min(rows-1,Math.max(0,Math.floor(p.y/CELL)))*cols+Math.min(cols-1,Math.max(0,Math.floor(p.x/CELL)));
 // The goal: the tapped point, or the nearest free spot to it.
 let goal=idx(to);
 if(!freeCell[goal]){let best=-1,bd=1e9;for(let i=0;i<N;i++)if(freeCell[i]){const c=center(i),d=Math.hypot(c.x-to.x,c.y-to.y);if(d<bd){bd=d;best=i;}}if(best<0)return [];goal=best;to=center(goal);}
 const start=idx(from);freeCell[start]=1;
 if(clearLine(from,to,obs))return [to];
 const g=new Float32Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),closed=new Uint8Array(N);
 const gc=center(goal),h=i=>{const c=center(i),dx=Math.abs(c.x-gc.x),dy=Math.abs(c.y-gc.y);return Math.max(dx,dy)+.414*Math.min(dx,dy);};
 const heap=[];const push=(i,f)=>{heap.push([f,i]);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m;}}return top;};
 g[start]=0;push(start,h(start));
 while(heap.length){
  const [,i]=pop();if(closed[i])continue;closed[i]=1;if(i===goal)break;
  const cx=i%cols,cy=Math.floor(i/cols);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
   const j=ny*cols+nx;if(!freeCell[j]||closed[j])continue;
   if(dx&&dy&&(!freeCell[cy*cols+nx]||!freeCell[ny*cols+cx]))continue;
   const ng=g[i]+(dx&&dy?1.414:1)*CELL;if(ng<g[j]){g[j]=ng;came[j]=i;push(j,ng+h(j));}
  }
 }
 if(came[goal]<0&&goal!==start)return [];
 const cells=[];for(let i=goal;i!==start&&i>=0;i=came[i])cells.unshift(center(i));
 cells[cells.length-1]=to;
 // Straighten: skip corners that can be seen past.
 const path=[];let from_=from;
 for(let k=0;k<cells.length;k++){if(k===cells.length-1||!clearLine(from_,cells[k+1],obs)){path.push(cells[k]);from_=cells[k];}}
 return path;
}
function walkMine(w,dt){
 const next=w.path?.[0];if(!next)return;
 const dx=next.x-w.dx,dy=next.y-w.dy,d=Math.hypot(dx,dy);
 if(d<3){w.path.shift();return;}
 const step=Math.min(d,WALK_SPEED*dt),nx=w.dx+dx/d*step,ny=w.dy+dy/d*step;
 // Someone in the way: step aside if there is room, else wait for them to move.
 const other=[...state.walkers.values()].find(o=>o!==w&&Math.hypot(o.dx-nx,o.dy-ny)<BODY*2&&Math.hypot(o.dx-nx,o.dy-ny)<Math.hypot(o.dx-w.dx,o.dy-w.dy));
 if(other){
  const side=Math.sign((other.dx-w.dx)*dy-(other.dy-w.dy)*dx)||1,sx=w.dx-dy/d*step*side,sy=w.dy+dx/d*step*side,obs=obstacles();
  if(!blockedAt(sx,sy,obs)&&![...state.walkers.values()].some(o=>o!==w&&Math.hypot(o.dx-sx,o.dy-sy)<BODY*2)){w.dx=sx;w.dy=sy;}
  return;
 }
 w.dx=nx;w.dy=ny;w.tx=nx;w.ty=ny;w.angle=Math.atan2(dy,dx)+Math.PI/2;
}
function walkTo(x,y){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 me.path=findPath({x:me.dx,y:me.dy},{x,y});state.follow=true;$('hint').hidden=true;
}

// ---------- input: tap to walk or pick a table, drag to look around, pinch or wheel to zoom ----------
const pointers=new Map();let drag=null,pinch=null;
const toWorld=(sx,sy)=>({x:state.cam.x+sx/state.cam.s,y:state.cam.y+sy/state.cam.s});
function zoomAt(sx,sy,factor){
 const c=state.cam,before=toWorld(sx,sy);c.s=Math.min(1.6,Math.max(Math.min(.32,W/WORLD.w),c.s*factor));
 c.x=before.x-sx/c.s;c.y=before.y-sy/c.s;state.follow=false;
}
canvas.addEventListener('pointerdown',e=>{
 canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};drag=null;}
 else drag={x:e.clientX,y:e.clientY,cx:state.cam.x,cy:state.cam.y,moved:false};
});
canvas.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);zoomAt((a.x+b.x)/2,(a.y+b.y)/2,d/pinch.d);pinch.d=d;return;}
 if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>8)drag.moved=true;
  if(drag.moved){state.follow=false;state.cam.x=drag.cx-dx/state.cam.s;state.cam.y=drag.cy-dy/state.cam.s;}}
});
const up=e=>{
 pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
 if(drag&&!drag.moved&&pointers.size===0)tap(e.clientX,e.clientY);
 if(pointers.size===0)drag=null;
};
canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;pinch=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.clientX,e.clientY,e.deltaY<0?1.12:1/1.12);},{passive:false});
$('zoom-in').onclick=()=>zoomAt(W/2,H/2,1.25);$('zoom-out').onclick=()=>zoomAt(W/2,H/2,1/1.25);
function tap(sx,sy){
 const p=toWorld(sx,sy);closeSheet();
 const walker=[...state.walkers.values()].find(w=>w.uid!==state.me?.uid&&Math.hypot(w.dx-p.x,w.dy-p.y)<28);
 if(walker){openPerson(walker);return;}
 const slot=state.slots.find(s=>s.placed&&Math.abs(s.x-p.x)<(s.kind==='2v2'?130:90)&&Math.abs(s.y-p.y)<(s.kind==='2v2'?130:120));
 if(slot){const off=slot.kind==='2v2'?170:120;walkTo(slot.x+(p.x<slot.x?-off:off),slot.y);openTable(slot);return;}
 walkTo(p.x,p.y);
}

// ---------- sheets: sit at a table, or someone in the bar ----------
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function closeSheet(){$('sheet').hidden=true;$('sheet').innerHTML='';}
function sheet(html){const s=$('sheet');s.innerHTML=html;s.hidden=false;return s;}
function openTable(slot){
 const t=slot.code?currentTables().get(slot.code):null,mode=slot.kind==='2v2'?'2 vs 2':'1 vs 1';
 if(!t){
  let points=20;
  const s=sheet(`<h3>Mesa libre · ${mode}</h3><p class="sub">Te sentás y esperás rival. Elegí a cuántos puntos:</p>
   <div class="points">${[10,20,30,40].map(n=>`<button type="button" data-p="${n}" aria-pressed="${n===20}">${n}</button>`).join('')}</div>
   <div class="row"><button class="btn ghost" data-close>Cancelar</button><button class="btn" data-sit>Sentarme</button></div>`);
  s.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{points=Number(b.dataset.p);s.querySelectorAll('[data-p]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));});
  s.querySelector('[data-sit]').onclick=()=>{location.href='/?crear='+slot.kind+'&puntos='+points;};
  s.querySelector('[data-close]').onclick=closeSheet;return;
 }
 const players=Object.values((t.live||t.room).players||{}).filter(p=>p?.uid),names=players.map(p=>esc(p.name)).join(', ');
 if(t.live){
  const s=t.live.scores;
  sheet(`<h3>${mode} en juego</h3><p class="sub">${names}<br>Van ${s.player1} a ${s.player2}${t.live.targetPoints?' · a '+t.live.targetPoints+' puntos':''}${t.live.finished?' · terminó':''}</p>
   <p class="sub" style="color:#a9bbb0">Mirar el partido de cerca llega en la próxima etapa.</p><div class="row"><button class="btn ghost" data-close>Cerrar</button></div>`).querySelector('[data-close]').onclick=closeSheet;
  return;
 }
 const mine=players.some(p=>p.uid===state.me?.uid),pts=t.room.targetPoints||20;
 const s=sheet(`<h3>${mine?'Tu mesa':'Mesa de '+esc(players[0]?.name||'alguien')}</h3><p class="sub">${mode} · a ${pts} puntos${t.room.creditMatch?.hasPassword?' · con contraseña':''}${players.length>1?'<br>Sentados: '+names:''}</p>
  <div class="row"><button class="btn ghost" data-close>Cancelar</button><button class="btn" data-sit>${mine?'Volver a la mesa':'Sentarme y jugar'}</button></div>`);
 s.querySelector('[data-sit]').onclick=()=>{location.href='/?mesa='+encodeURIComponent(t.code);};
 s.querySelector('[data-close]').onclick=closeSheet;
}
function openPerson(w){
 const muted=state.muted.has(w.uid);
 const s=sheet(`<h3>${esc(w.name)}</h3><p class="sub">Está en el bar.</p><div class="row">
  <button class="btn ghost" data-mute>${muted?'Volver a escuchar':'Silenciar'}</button><button class="btn ghost" data-report>Reportar</button><button class="btn" data-close>Cerrar</button></div>`);
 s.querySelector('[data-close]').onclick=closeSheet;
 s.querySelector('[data-mute]').onclick=()=>{muted?state.muted.delete(w.uid):state.muted.add(w.uid);closeSheet();toast(muted?'Lo volvés a escuchar.':'No vas a ver lo que escriba.');};
 s.querySelector('[data-report]').onclick=()=>{const last=state.chat.filter(m=>m.uid===w.uid).slice(-3).map(m=>m.text).join(' / ');bar?.send({t:'report',uid:w.uid,name:w.name,text:last});state.muted.add(w.uid);closeSheet();toast('Gracias. Lo revisamos y no vas a ver más lo que escriba.');};
}
let toastTimer=null;
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,3500);}

// ---------- nearby chat ----------
function nearby(){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return [];
 return [...state.walkers.values()].filter(w=>w.uid!==me.uid&&Math.hypot(w.dx-me.dx,w.dy-me.dy)<=HEAR_RADIUS);
}
function updateNear(now){
 if(now-(updateNear.at||0)<250)return;updateNear.at=now;
 const near=nearby(),ids=near.map(w=>w.uid).sort().join(',');
 if(near.length)state.lastNearAt=now;
 const show=near.length>0||now-state.lastNearAt<4000;
 $('chat').hidden=!show;
 if(ids!==state.nearIds){state.nearIds=ids;$('chat-who').textContent=near.length?'Cerca: '+near.map(w=>w.name).join(', '):'No hay nadie cerca';}
 // Alone for a while: the conversation is over.
 if(!show&&state.chat.length){state.chat=[];renderChat();}
}
function renderChat(){
 const log=$('chat-log');log.innerHTML=state.chat.map(m=>m.note?`<li class="note">${esc(m.text)}</li>`:`<li class="${m.uid===state.me?.uid?'me':''}"><b>${esc(m.name)}:</b> ${esc(m.text)}</li>`).join('');
 log.scrollTop=log.scrollHeight;
}
$('chat-form').addEventListener('submit',e=>{
 e.preventDefault();const input=$('chat-input'),text=input.value.trim();if(!text)return;
 if(!nearby().length){toast('No hay nadie cerca para escucharte.');return;}
 bar?.send({t:'say',text});input.value='';
});
$('chat-input').addEventListener('pointerdown',e=>e.stopPropagation());

// ---------- server events ----------
function addWalker(w){
 const old=state.walkers.get(w.uid);
 state.walkers.set(w.uid,{...w,dx:old?.dx??w.x,dy:old?.dy??w.y,tx:w.x,ty:w.y,bubble:old?.bubble});
}
function onBar(m){
 if(m.t==='walkers'){const mine=state.walkers.get(state.me?.uid);state.walkers.clear();for(const w of m.list)addWalker(w);if(mine&&state.walkers.has(mine.uid)){Object.assign(state.walkers.get(mine.uid),{dx:mine.dx,dy:mine.dy,tx:mine.tx,ty:mine.ty});lastSent.at=0;lastSent.x=-1;}renderCount();}
 else if(m.t==='walker'){addWalker(m.walker);renderCount();}
 else if(m.t==='walk'){const w=state.walkers.get(m.uid);if(w){w.tx=m.x;w.ty=m.y;}}
 else if(m.t==='left'){state.walkers.delete(m.uid);renderCount();}
 else if(m.t==='said'){
  if(state.muted.has(m.uid))return;
  const w=state.walkers.get(m.uid);if(w)w.bubble={text:m.text,until:performance.now()+6000};
  state.chat.push({uid:m.uid,name:m.name,text:m.text});state.chat=state.chat.slice(-40);state.lastNearAt=performance.now();renderChat();
 }
 else if(m.t==='say-error')toast(m.error);
 else if(m.t==='replaced')showStatus('Abriste el bar en otra pestaña o dispositivo.',[['Entrar acá de nuevo',()=>location.reload()]]);
}
let firstTables=true;
function onLobby(m){
 if(m.t==='lobby'){state.rooms=m.rooms||{};}
 else if(m.t==='lobby-update'){if(m.room)state.rooms[m.code]=m.room;else delete state.rooms[m.code];}
 else if(m.t==='bar-live'){state.live=m.tables||{};}
 else if(m.t==='bar-table'){if(m.live)state.live[m.code]=m.live;else delete state.live[m.code];}
 else if(m.t==='bar-online'){state.online=m.people||[];renderCount();return;}
 else return;
 if(m.t==='bar-live'){syncSlots(firstTables);firstTables=false;}
 else if(!firstTables)syncSlots(false);
}
function renderCount(){
 const tables=currentTables(),playing=[...tables.values()].filter(t=>t.live&&!t.live.finished).length,waiting=[...tables.values()].filter(t=>t.waiting).length;
 $('count').textContent=`${playing} en juego · ${waiting} esperando · ${state.walkers.size} en el bar · ${state.online.length} en línea`;
}

// ---------- entering ----------
function showStatus(text,actions=[]){
 $('status').hidden=false;$('status-text').textContent=text;const box=$('status-actions');box.innerHTML='';
 for(const [label,act,href] of actions){const el=href?Object.assign(document.createElement('a'),{href}):document.createElement('button');el.className='btn';el.textContent=label;if(act)el.onclick=act;box.append(el);}
}
async function start(){
 let token;
 if(DEV_NAME)token=async()=>'dev:'+DEV_NAME;
 else{
  services=(async()=>{
   const [{initializeApp},{getAuth,onAuthStateChanged},{getDatabase,ref,get}]=await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`)]);
   const app=initializeApp(firebaseConfig),auth=getAuth(app);
   const user=await new Promise(resolve=>{const off=onAuthStateChanged(auth,u=>{off();resolve(u);});});
   return {auth,user,db:getDatabase(app),ref,get};
  })();
  const fb=await services.catch(()=>null);
  if(!fb?.user){showStatus('Para entrar al bar, primero iniciá sesión en el juego con tu cuenta y después volvé a esta página.',[['Ir al juego',null,'/']]);return;}
  token=()=>fb.auth.currentUser.getIdToken();
 }
 const refused=m=>{showStatus(m?.code==='bar-closed'?'El bar todavía no está abierto. Por ahora es solo para algunos jugadores.':(m?.error||'No se pudo entrar al bar.'),[['Volver al juego',null,'/']]);};
 lobby=new Channel('/lobby',token,{bar:true},onLobby,(status,data)=>{if(status==='refused')refused(data);});
 bar=new Channel('/bar',token,{},onBar,(status,data)=>{
  if(status==='ready'){state.me=data;if(!state.walkers.has(data.uid))addWalker(data);$('status').hidden=true;
   const s=state.cam.s=Math.max(.45,Math.min(1,W/1100));state.cam.x=data.x-W/2/s;state.cam.y=data.y-H/2/s;}
  else if(status==='refused')refused(data);
  else if(status==='reconnecting')toast('Reconectando…');
 });
 requestAnimationFrame(frame);
}
start();
