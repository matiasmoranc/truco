// The BAR in 3D: served at trucouruguayo.uy/bar (bar/index.html loads this file) and at /bar3d. Same bar as the 2D one before it
// (real tables, the waiter, nearby chat, sitting at real tables) drawn with Three.js. The people are
// built here from simple shapes with a small skeleton, animated by code: they walk with weight
// (speed builds up and dies down, they lean and turn), and sit down on and get up from chairs.
// Move with the joystick (or WASD / arrows), or tap the floor, a chair or a table.
import * as THREE from 'three';
import {CSS2DRenderer,CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {HEIGHTS,U,SEAT_H,MAX_SPEED,lerp,smooth,clamp01,SKINS,HAIRS,SHIRT_COLORS,PANTS,SHOES,customLooks,defaultLook,looks,lookKey,isBot,hashOf,M,G,geo,capsule,dome,ring,part,buildPerson as makePerson,animate,EMOTES} from './people.js?v=20261121-p2';

import {firebaseConfig} from '/firebase-config.js?v=20261016-auth-domain';

const FIREBASE_VERSION='12.4.0';
// Inside the apps the page is also served from "localhost" (Capacitor): that is not a local test.
const LOCAL=['localhost','127.0.0.1'].includes(location.hostname)&&!globalThis.Capacitor?.isNativePlatform?.();
// Local only: a promo video page sets barManual and calls barFrame(t) for each frame (no requestAnimationFrame).
const MANUAL=LOCAL&&!!globalThis.barManual;
const LIVE_URL=(LOCAL?location.origin.replace(/^http/,'ws')+'/live':'wss://truco-live.mati-moran-castro.workers.dev');
const DEV_NAME=LOCAL?new URLSearchParams(location.search).get('dev'):null;
const WORLD={w:1600,h:2400},HEAR_RADIUS=115,WALK_SPEED=280;
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
const state={me:null,walkers:new Map(),rooms:{},live:{},layout:null,online:[],slots:[],trips:[],mozo:null,muted:new Set(),
 cam:{x:0,y:0,s:.6},follow:true,lastCall:{},chat:[],nearIds:'',lastNearAt:0};
let lobby=null,bar=null,services=null;

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
const botUid=uid=>/^(bot:|house_)/.test(String(uid||''));
// The server lays the room out (cloudflare/src/bar-core.js barLayout) so every page, 2D or 3D, shows each
// table in the same place: people sit on chairs by position. state.layout = {"<cell>":{k:'1v1'|'2v2',c:code|null}}.
function tableOf(code){
 if(!code)return null;
 const live=state.live[code];if(live)return {code,kind:tableKind(live),waiting:false,live};
 const room=state.rooms[code];if(room?.status==='waiting')return {code,kind:room.mode==='2v2'?'2v2':'1v1',waiting:true,room};
 return null;
}
let slotSeq=0;
function syncSlots(initial){
 const cells=state.layout;if(!cells)return;
 for(const slot of [...state.slots]){
  const c=cells[slot.cell];
  // Still in the layout: it shows what is there now (a waiting table can change kind).
  if(c){slot.code=c.c||null;slot.kind=c.k;slot.p=c.c?null:c.p??null;slot.by=c.by||null;slot.leaving=false;continue;}
  if(slot.leaving)continue;slot.code=null;
  // Gone: the waiter takes it away (on the first look, or not set down yet, it just goes).
  if(initial||!slot.placed){state.slots=state.slots.filter(o=>o!==slot);state.trips=state.trips.filter(t=>t.slot!==slot);fondo.trips=fondo.trips.filter(t=>t.slot!==slot);}
  else{slot.leaving=true;(slot.p?fondo.trips:state.trips).push({type:'take',slot});}
 }
 for(const [cell,c] of Object.entries(cells)){
  const i=Number(cell);if(!(i>=0&&i<COLS.length*MAX_ROWS)||state.slots.some(o=>o.cell===i))continue;
  const slot={id:++slotSeq,kind:c.k==='2v2'?'2v2':'1v1',cell:i,...cellAt(i),code:c.c||null,p:c.c?null:c.p??null,by:c.by||null,placed:!!initial};
  state.slots.push(slot);if(!initial)(slot.p?fondo.trips:state.trips).push({type:'bring',slot});
 }
 checkMyChair();
 renderCount();
}
// One trip at a time: from the door to the table and back.
// The waiter walks from the door to beside the table (around tables, chairs and people), sets it down
// or picks it up, and walks back out. He never goes through anyone.
let mozoBody=null;
function mozoSpot(slot){
 const hw=slot.kind==='2v2'?74:70,obs=obstacles();
 const spots=slot.kind==='2v2'?[[95,95],[-95,95],[95,-95],[-95,-95]]:[[hw+42,0],[-hw-42,0],[hw+30,60],[-hw-30,60]];
 for(const [dx,dy] of spots){const p={x:slot.x+dx,y:slot.y+dy};if(!blockedAt(p.x,p.y,obs))return p;}
 return {x:slot.x+spots[0][0],y:slot.y+spots[0][1]};
}
function stepMozo(now,dt){
 if(!state.mozo&&state.trips.length){
  const trip=state.trips.shift();
  if(trip.type==='take'&&!trip.slot.leaving)return null;
  state.mozo={...trip,phase:'go'};
 }
 const m=state.mozo;if(!m){mozoBody=null;return null;}
 const b=mozoBody??={uid:'mozo',dx:DOOR.x,dy:DOOR.y,vx:0,vy:0,heading:-Math.PI/2},{slot}=m;
 if(m.type==='board')return boardTrip(m,b,now,dt);
 if(m.phase==='go'){m.spot??=mozoSpot(slot);if(walkBody(b,m.spot,dt,NPC_SPEED)){m.phase='place';m.until=now+600;}}
 else if(m.phase==='place'){physics(b,{x:0,y:0},dt);turnToward(b,Math.atan2(slot.x-b.dx,slot.y-b.dy),dt);
  if(now>=m.until){
   if(m.type==='bring')slot.placed=true;
   else if(slot.leaving){state.slots=state.slots.filter(s2=>s2!==slot);m.took=true;}
   m.phase='back';b.path=null;}}
 else if(m.phase==='back'&&walkBody(b,DOOR,dt,NPC_SPEED)){state.mozo=null;mozoBody=null;syncSlots(false);return null;}
 const carrying=(m.type==='bring'&&m.phase==='go')||(m.type==='take'&&m.phase==='back'&&!!m.took);
 return {b,carrying};
}

// The waiter at the back of the bar: standing by the wall, he takes the order for a new table (which kind
// and how many points), brings it from there and leaves it free with those settings for anyone to sit
// (cloudflare/src/bar-core.js barRequest). One left unused he takes back after 10 minutes.
const FONDO_HOME={x:1330,y:2290};
const fondo={trips:[],job:null,body:{uid:'fondo',dx:FONDO_HOME.x,dy:FONDO_HOME.y,vx:0,vy:0,heading:Math.PI},sayUntil:0,say:''};
function stepFondo(now,dt){
 const b=fondo.body;
 if(!fondo.job&&fondo.trips.length){const trip=fondo.trips.shift();if(!(trip.type==='take'&&!trip.slot.leaving))fondo.job={...trip,phase:'go'};}
 const m=fondo.job;let carrying=false;
 if(m){const {slot}=m;
  if(m.phase==='go'){m.spot??=mozoSpot(slot);carrying=m.type==='bring';if(walkBody(b,m.spot,dt,NPC_SPEED)){m.phase='place';m.until=now+650;}}
  else if(m.phase==='place'){physics(b,{x:0,y:0},dt);turnToward(b,Math.atan2(slot.x-b.dx,slot.y-b.dy),dt);carrying=m.type==='bring';
   if(now>=m.until){if(m.type==='bring')slot.placed=true;else if(slot.leaving){state.slots=state.slots.filter(o=>o!==slot);m.took=true;}m.phase='back';b.path=null;}}
  else if(m.phase==='back'){carrying=m.type==='take'&&!!m.took;if(walkBody(b,FONDO_HOME,dt,NPC_SPEED)){fondo.job=null;syncSlots(false);}}}
 else if(Math.hypot(b.dx-FONDO_HOME.x,b.dy-FONDO_HOME.y)>10)walkBody(b,FONDO_HOME,dt,NPC_SPEED*.6);
 else{physics(b,{x:0,y:0},dt);
  // Idle he looks at whoever comes close, else at the room.
  const me=state.me&&state.walkers.get(state.me.uid),near=me&&Math.hypot(me.dx-b.dx,me.dy-b.dy)<260;
  turnToward(b,near?Math.atan2(me.dx-b.dx,me.dy-b.dy):Math.PI,dt*.6);}
 const v=view('fondo',()=>{const person=buildPerson({skin:'#c98e62',hair:'#3b2a1e',style:'short',face:'bigote'},{waiter:true});
  const carried=new THREE.Group();carried.add(box(1.3,.07,.9,wood,0,0,0),box(1.15,.02,.75,felt,0,.045,0));person.root.add(carried);carried.position.set(0,1.62,.55);
  const say=label('bubble');say.o.position.set(0,2.55,0);person.root.add(say.o);return {person,labels:[say],carried,say};});
 v.person.root.position.copy(P(b.dx,b.dy));v.person.root.rotation.y=b.heading||0;v.carried.visible=carrying;
 v.say.el.hidden=now>fondo.sayUntil;if(!v.say.el.hidden)v.say.set(fondo.say);
 animate(v.person,{speed:Math.hypot(b.vx,b.vy),accel:b.accel||0,turn:b.turnRate||0,carry:carrying,dt,now});
}
function fondoSays(text){fondo.say=text;fondo.sayUntil=performance.now()+3500;}
const nearFondo=me=>!!me&&Math.hypot(me.dx-fondo.body.dx,me.dy-fondo.body.dy)<190&&!fondo.job;
function openTableOrder(){
 let k='1v1',p=20;
 const s=sheet(`<h3>¿Qué mesa te traigo?</h3><p class="sub">La dejo libre en el salón, lista para jugar.</p>
  <div class="points"><button type="button" data-k="1v1" aria-pressed="true">1 vs 1</button><button type="button" data-k="2v2" aria-pressed="false">2 vs 2</button></div>
  <p class="sub">¿A cuántos puntos?</p>
  <div class="points">${[10,20,30,40].map(n=>`<button type="button" data-p="${n}" aria-pressed="${n===20}">${n}</button>`).join('')}</div>
  <div class="row"><button class="btn ghost" data-close>Cancelar</button><button class="btn" data-ask>Pedir la mesa</button></div>`);
 s.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{k=b.dataset.k;s.querySelectorAll('[data-k]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));});
 s.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{p=Number(b.dataset.p);s.querySelectorAll('[data-p]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));});
 s.querySelector('[data-close]').onclick=closeSheet;
 s.querySelector('[data-ask]').onclick=()=>{if(!lobby?.ready){toast('Sin conexión. Probá en un momento.');return;}closeSheet();askTable(k,p,1);};
}
// The order goes to the server; with no answer in 4 seconds it is sent once more, then I am told.
function askTable(k,p,tries){
 const ask=state.tableAsk={k,p,at:performance.now()};lobby?.send({t:'bar-request',k,p});fondoSays('Ya va…');
 setTimeout(()=>{if(state.tableAsk!==ask)return;if(tries<2&&lobby?.ready){askTable(k,p,tries+1);return;}state.tableAsk=null;fondoSays('¿Perdón?');toast('El mozo no te escuchó. Probá de nuevo en un momento.');},4000);
}
function onTableOrder(ok){
 state.tableAsk=null;
 if(ok){fondoSays('¡Ya te la traigo!');toast('El mozo te trae la mesa y la deja libre.');}
 else{fondoSays('Ahora no tengo lugar.');toast('Ahora no hay lugar para otra mesa. Probá en un rato.');}
}

// ---------- 3D: the room and the furniture ----------
// World pixels (the same units as the server) become scene units: x → X, y → Z. A person is ~2 units tall.
const TABLE_H=1.02;
const canvas=$('scene');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const PHONE=Math.min(innerWidth,innerHeight)<600;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,PHONE?1.5:2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const labels=new CSS2DRenderer();labels.domElement.className='labels';document.body.append(labels.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#0b1712');scene.fog=new THREE.Fog('#0b1712',40,85);
const camera=new THREE.PerspectiveCamera(40,1,.1,200);
let W=0,H=0;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);labels.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
const P=(x,y,h=0)=>new THREE.Vector3(x*U,h,y*U);

scene.add(new THREE.HemisphereLight('#ffe7c4','#3a2410',.8));
const sun=new THREE.DirectionalLight('#ffe0b0',1.7);sun.castShadow=true;
sun.shadow.mapSize.set(PHONE?1024:2048,PHONE?1024:2048);Object.assign(sun.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:1,far:60});sun.shadow.bias=-.0004;sun.shadow.normalBias=.02;
scene.add(sun,sun.target);
function canvasTexture(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
const pool=canvasTexture(128,128,(g,w,h)=>{const r=g.createRadialGradient(64,64,0,64,64,64);r.addColorStop(0,'rgba(255,214,140,.5)');r.addColorStop(1,'rgba(255,214,140,0)');g.fillStyle=r;g.fillRect(0,0,w,h);});
const poolMat=new THREE.MeshBasicMaterial({map:pool,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
const planks=canvasTexture(256,256,g=>{for(let r=0;r<8;r++){const shade=88+((r*7)%5)*7;for(let c=-1;c<3;c++){const s2=shade+((r+c*3)%3)*5;g.fillStyle=`rgb(${s2+22},${s2-18},${s2-48})`;g.fillRect(((r%2)*64)+c*128,r*32,128,32);g.fillStyle='rgba(40,22,10,.55)';g.fillRect(((r%2)*64)+c*128,r*32,2,32);}g.fillStyle='rgba(40,22,10,.6)';g.fillRect(0,r*32+30,256,2);}});
planks.wrapS=planks.wrapT=THREE.RepeatWrapping;planks.repeat.set(WORLD.w*U/4,WORLD.h*U/4);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w*U,WORLD.h*U),new THREE.MeshStandardMaterial({map:planks,roughness:.8}));
floor.rotation.x=-Math.PI/2;floor.position.set(WORLD.w*U/2,0,WORLD.h*U/2);floor.receiveShadow=true;scene.add(floor);
const mat=(color,o={})=>new THREE.MeshStandardMaterial({color,roughness:.6,...o});
const wood=mat('#8a5c34'),darkWood=mat('#5a3820',{roughness:.7}),felt=mat('#1b6b46',{roughness:.95});
const box=(w,h,d,m,x,y,z)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;return o;};
// The back wall, its shelves, bottles and sign fade out when the camera turns behind them.
const wallMats=[mat('#1d3b2c',{roughness:.9}),mat('#5a3820',{roughness:.7})];
scene.add(box(WORLD.w*U,5,.4,wallMats[0],WORLD.w*U/2,2.5,-.2));
// The board hangs on the wall behind the counter, between BOARD.x0 and BOARD.x1; shelves and bottles leave it room.
const BOARD={x0:880,x1:1280,y0:1.45,y1:3.95,stand:72};
for(const y of [1.6,2.6]){const a=.5,b=BOARD.x0*U-.15,c=BOARD.x1*U+.15,d=WORLD.w*U-.5;scene.add(box(b-a,.08,.5,wallMats[1],(a+b)/2,y,.2),box(d-c,.08,.5,wallMats[1],(c+d)/2,y,.2));}
{const colors=['#2f7a4a','#7a2f2f','#b58a2e','#3a5c8a','#6b4a2a','#9fbf6a'],geo=new THREE.CylinderGeometry(.09,.11,.5,8);
 const bottleMat=new THREE.MeshStandardMaterial({roughness:.25,metalness:.1});wallMats.push(bottleMat);const spots=[];for(let i=0;i<120;i++){const x=.6+Math.floor(i/2)*.42;if(x<BOARD.x0*U-.3||x>BOARD.x1*U+.3)spots.push([i,x]);}
 const bottles=new THREE.InstancedMesh(geo,bottleMat,spots.length),m=new THREE.Matrix4();
 spots.forEach(([i,x],k)=>{m.makeTranslation(x,(i%2?2.6:1.6)+.29,.22);bottles.setMatrixAt(k,m);bottles.setColorAt(k,new THREE.Color(colors[(i*7)%6]));});scene.add(bottles);}
{const sign=canvasTexture(512,128,(g,w,h)=>{g.fillStyle='#0b1712';g.fillRect(0,0,w,h);g.strokeStyle='#f3cf73';g.lineWidth=8;g.strokeRect(8,8,w-16,h-16);g.fillStyle='#ffd77a';g.font='900 84px DM Sans, sans-serif';g.textAlign='center';g.textBaseline='middle';g.shadowColor='#ffcf70';g.shadowBlur=24;g.fillText('B A R',w/2,h/2+4);});
 const signMat=new THREE.MeshBasicMaterial({map:sign});wallMats.push(signMat);const s=new THREE.Mesh(new THREE.PlaneGeometry(4,1),signMat);s.position.set(420*U,3.9,.02);scene.add(s);}
const counterMats=[mat('#8a5c34'),mat('#a8703f',{roughness:.4})];for(const m of counterMats)m.transparent=true;
scene.add(box((WORLD.w-260)*U,1.3,66*U,counterMats[0],(30+(WORLD.w-260)/2)*U,.65,151*U));
scene.add(box((WORLD.w-260)*U,.08,80*U,counterMats[1],(30+(WORLD.w-260)/2)*U,1.33,151*U));
const doorMat=mat('#5a3820',{roughness:.7});wallMats.push(doorMat);scene.add(box(.2,3.2,160*U,doorMat,WORLD.w*U-.1,1.6,DOOR.y*U));
for(const m of wallMats)m.transparent=true;
let wallFade=1;
function fadeWalls(dt){const behind=camera.position.z<.7||camera.position.x>WORLD.w*U-.3;wallFade+=((behind?.12:1)-wallFade)*Math.min(1,dt*8);for(const m of wallMats){m.opacity=wallFade;m.depthWrite=wallFade>.95;}
 // The counter too, when the camera looks across it from behind.
 const across=camera.position.z<3.4&&camera.position.x<(WORLD.w-230)*U;counterFade+=((across?.2:1)-counterFade)*Math.min(1,dt*8);for(const m of counterMats){m.opacity=counterFade;m.depthWrite=counterFade>.95;}}
let counterFade=1;
// Many copies of one piece: one draw call per material (stools, panels, bottles, flags).
function instanced(parts,spots){for(const [geometry,material] of parts){const m=new THREE.InstancedMesh(geometry,material,spots.length),o=new THREE.Object3D();
 spots.forEach((sp,i)=>{o.position.set(sp.x,sp.y||0,sp.z);o.rotation.set(sp.rx||0,sp.ry||0,sp.rz||0);o.scale.setScalar(sp.s||1);o.updateMatrix();m.setMatrixAt(i,o.matrix);if(sp.color)m.setColorAt(i,new THREE.Color(sp.color));});
 m.castShadow=true;m.receiveShadow=true;scene.add(m);}}
const mergeOf=list=>mergeGeometries(list.map(([g,x=0,y=0,z=0,rx=0,ry=0,rz=0])=>{const c=(g.index?g.toNonIndexed():g.clone());c.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1)));return c;}));
// A bar stool: a round padded seat with a metal rim, one column, a foot ring and a heavy base.
function buildStools(){
 const leather=mat('#7a2f2f',{roughness:.45}),metal=mat('#c9c2b4',{metalness:.85,roughness:.28});
 const seat=mergeOf([[new THREE.CylinderGeometry(.27,.25,.09,28),0,SEAT_H,0],[new THREE.SphereGeometry(.27,28,8,0,Math.PI*2,0,.45),0,SEAT_H-.03,0]]);
 const frame=mergeOf([[new THREE.TorusGeometry(.255,.02,8,32),0,SEAT_H-.05,0,Math.PI/2],[new THREE.CylinderGeometry(.04,.045,SEAT_H-.06,14),0,(SEAT_H-.06)/2,0],
  [new THREE.TorusGeometry(.19,.016,8,32),0,.22,0,Math.PI/2],[new THREE.CylinderGeometry(.24,.27,.035,28),0,.018,0],
  ...[0,1,2].map(i=>[new THREE.BoxGeometry(.19,.015,.015),Math.cos(i*2.09)*.095,.22,Math.sin(i*2.09)*.095,0,-i*2.09,0])]);
 instanced([[seat,leather],[frame,metal]],Array.from({length:STOOLS},(_,i)=>({x:(90+i*90)*U,z:222*U})));
}
// The counter: panels on its front, a kick plate, a rounded edge, a brass foot rail, taps, a register,
// a mate with its thermos, and lamps hanging over it.
{const x0=30*U,x1=(WORLD.w-230)*U,front=184*U,len=x1-x0,panel=mat('#6e4526',{roughness:.6}),brass=mat('#c9a24a',{metalness:.9,roughness:.25}),chrome=mat('#d7d7d2',{metalness:.95,roughness:.18});
 counterMats.push(panel,brass,chrome);for(const m of [panel,brass,chrome])m.transparent=true;
 scene.add(box(len,.16,.06,panel,x0+len/2,.08,front+.01),box(len,.07,.08,panel,x0+len/2,1.22,front+.02));
 const n=Math.floor(len/1.1);instanced([[new THREE.BoxGeometry(.07,.95,.05),panel]],Array.from({length:n+1},(_,i)=>({x:x0+i*len/n,y:.66,z:front+.02})));
 const edge=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,len,12),counterMats[1]);edge.rotation.z=Math.PI/2;edge.position.set(x0+len/2,1.33,front+.12);scene.add(edge);
 const rail=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,len-.2,12),brass);rail.rotation.z=Math.PI/2;rail.position.set(x0+len/2,.3,front+.24);scene.add(rail);
 instanced([[mergeOf([[new THREE.BoxGeometry(.03,.3,.03),0,.15,0],[new THREE.BoxGeometry(.03,.03,.26),0,.3,-.12]]),brass]],Array.from({length:Math.floor(len/2)+1},(_,i)=>({x:x0+.1+i*(len-.2)/Math.floor(len/2),z:front+.24})));
 const top=1.37,back=120*U;
 // Beer taps: a chrome tower with three handles.
 for(const px of [330,760,1190]){const g=new THREE.Group();g.position.set(px*U,top,back);
  g.add(box(.1,.4,.1,chrome,0,.2,0),box(.5,.06,.08,chrome,0,.4,0),box(.36,.02,.18,chrome,0,.01,.06));
  ['#c58a2e','#2f6a8a','#7a2f2f'].forEach((c,i)=>{const h=new THREE.Mesh(new THREE.CylinderGeometry(.018,.012,.2,8),mat(c,{roughness:.4}));h.position.set((i-1)*.17,.53,0);g.add(h);const sp=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.08,8),chrome);sp.position.set((i-1)*.17,.34,.04);g.add(sp);});
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;if(!counterMats.includes(o.material)){o.material.transparent=true;counterMats.push(o.material);}}});scene.add(g);}
 // The register, at the end by the door.
 {const g=new THREE.Group(),dark=mat('#2a2a2e',{roughness:.5}),screen=new THREE.MeshBasicMaterial({color:'#7fe0a0'});g.position.set(1290*U,top,back+.2);
  g.add(box(.55,.18,.45,dark,0,.09,0),box(.5,.1,.25,dark,0,.25,-.05),box(.3,.12,.03,dark,0,.38,-.15));const sc=new THREE.Mesh(new THREE.PlaneGeometry(.24,.08),screen);sc.position.set(0,.39,-.134);g.add(sc);
  g.traverse(o=>{if(o.isMesh&&!counterMats.includes(o.material)){o.material.transparent=true;counterMats.push(o.material);}});scene.add(g);}
 // A mate and its thermos at the other end.
 {const g=new THREE.Group(),gourd=mat('#6b4423',{roughness:.6}),steel=mat('#b9bcc0',{metalness:.85,roughness:.3}),yerba=mat('#7d9a3a',{roughness:1});g.position.set(110*U,top,back+.25);
  const m1=new THREE.Mesh(new THREE.SphereGeometry(.09,18,14),gourd);m1.scale.set(1,1.15,1);m1.position.y=.1;g.add(m1);const y1=new THREE.Mesh(new THREE.CircleGeometry(.065,16),yerba);y1.rotation.x=-Math.PI/2;y1.position.y=.19;g.add(y1);
  const b=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.24,6),steel);b.position.set(.03,.25,0);b.rotation.z=-.3;g.add(b);
  const th=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.42,18),mat('#2f6a8a',{roughness:.4}));th.position.set(.25,.21,0);g.add(th);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.05,.065,.07,16),steel);cap.position.set(.25,.455,0);g.add(cap);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;if(!counterMats.includes(o.material)){o.material.transparent=true;counterMats.push(o.material);}}});scene.add(g);}
 // Lamps over the counter.
 const shade=mat('#1b3a2a',{roughness:.5,side:THREE.DoubleSide}),bulb=new THREE.MeshBasicMaterial({color:'#ffe2a8'});
 for(let i=0;i<6;i++){const x=x0+.8+i*(len-1.6)/5,g=new THREE.Group();g.position.set(x,0,2.2);
  g.add(box(.015,1.1,.015,mat('#1a1a1a'),0,4.45,0));const c=new THREE.Mesh(new THREE.ConeGeometry(.3,.28,20,1,true),shade);c.position.y=3.78;g.add(c);
  const l=new THREE.Mesh(new THREE.SphereGeometry(.09,12,10),bulb);l.position.y=3.68;g.add(l);scene.add(g);}}
// Bottles of every kind on the shelves (wine, liquor, whisky, beer, a tall spirit), each with a label.
{const glass=new THREE.MeshStandardMaterial({roughness:.15,metalness:.1}),label=mat('#efe6cc',{roughness:.8});wallMats.push(glass,label);
 const lath=pts=>new THREE.LatheGeometry(pts.map(([r,y])=>new THREE.Vector2(r,y)),14);
 const kinds=[
  {g:lath([[0,0],[.075,0],[.08,.02],[.08,.3],[.06,.36],[.028,.4],[.026,.52],[.03,.54],[0,.54]]),colors:['#2f4a2a','#3a1418','#4a2a10'],lab:{w:.12,h:.1,y:.18}},
  {g:lath([[0,0],[.1,0],[.11,.03],[.115,.18],[.08,.26],[.035,.3],[.033,.37],[0,.37]]),colors:['#b5572f','#c58a2e','#8a3a5a'],lab:{w:.14,h:.08,y:.12}},
  {g:mergeOf([[new THREE.BoxGeometry(.17,.26,.12),0,.13,0],[new THREE.CylinderGeometry(.03,.04,.1,10),0,.31,0],[new THREE.CylinderGeometry(.035,.035,.04,10),0,.38,0]]),colors:['#a8742f','#7a4a1c','#c9a24a'],lab:{w:.13,h:.1,y:.14}},
  {g:lath([[0,0],[.055,0],[.06,.02],[.06,.17],[.045,.22],[.02,.27],[.02,.32],[0,.32]]),colors:['#5a3410','#2f6a3a','#4a2a10'],lab:{w:.09,h:.06,y:.09}},
  {g:lath([[0,0],[.06,0],[.065,.02],[.065,.42],[.04,.47],[.022,.5],[.022,.6],[0,.6]]),colors:['#cfe6ef','#9fbf6a','#3a5c8a'],lab:{w:.1,h:.12,y:.22}}];
 const spots=[];for(const y of [1.6,2.6])for(let x=.65;x<WORLD.w*U-.6;x+=.36){if(x>BOARD.x0*U-.35&&x<BOARD.x1*U+.35)continue;spots.push({x,y:y+.04});}
 kinds.forEach((k,ki)=>{const mine=spots.filter((_,i)=>(i*7+3)%kinds.length===ki);
  instanced([[k.g,glass]],mine.map((sp,i)=>({x:sp.x+((i*13)%5-2)*.015,y:sp.y,z:.24,color:k.colors[(i*5)%k.colors.length]})));
  instanced([[new THREE.PlaneGeometry(k.lab.w,k.lab.h),label]],mine.map(sp=>({x:sp.x+0,y:sp.y+k.lab.y,z:.24+(ki===2?.061:ki===1?.116:ki===0?.081:ki===3?.061:.066)})));});}
// The Truco Uruguayo logo in a frame, a clock with the real time, and a string of light-blue and white flags.
{const fr=mat('#3a2412',{roughness:.5}),felt2=mat('#123a2b',{roughness:.9});wallMats.push(fr,felt2);
 const cx=1440*U,cy=3.85;scene.add(box(2.1,1.45,.08,fr,cx,cy,.06),box(1.9,1.25,.02,felt2,cx,cy,.11));
 const logoMat=new THREE.MeshBasicMaterial({transparent:true,toneMapped:false});wallMats.push(logoMat);
 new THREE.TextureLoader().load('/assets/truco-v3-512.webp',t=>{t.colorSpace=THREE.SRGBColorSpace;logoMat.map=t;logoMat.needsUpdate=true;});
 const logo=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.07),logoMat);logo.position.set(cx,cy,.125);scene.add(logo);}
const wallClock={hands:[]};
{const face=canvasTexture(256,256,(g,w,h)=>{g.fillStyle='#f4ecd8';g.beginPath();g.arc(128,128,124,0,Math.PI*2);g.fill();g.strokeStyle='#3a2412';g.lineWidth=10;g.stroke();
  g.fillStyle='#2a1d14';g.font='700 30px "DM Sans",sans-serif';g.textAlign='center';g.textBaseline='middle';for(let i=1;i<=12;i++){const a=i*Math.PI/6;g.fillText(String(i),128+Math.sin(a)*92,128-Math.cos(a)*92);}});
 const fm=new THREE.MeshStandardMaterial({map:face,roughness:.6}),hm=mat('#1a1a1a');wallMats.push(fm,hm);
 const c=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.06,40),fm);c.rotation.x=Math.PI/2;c.position.set(150*U,3.95,.06);c.rotation.y=0;scene.add(c);
 const faceFix=new THREE.Mesh(new THREE.CircleGeometry(.53,40),fm);faceFix.position.set(150*U,3.95,.095);scene.add(faceFix);
 for(const [len,w] of [[.3,.04],[.45,.025]]){const pivot=new THREE.Group();pivot.position.set(150*U,3.95,.11);const hnd=box(w,len,.01,hm,0,len/2-.04,0);pivot.add(hnd);scene.add(pivot);wallClock.hands.push(pivot);}}
function tickClock(){const d=new Date(),m=d.getMinutes()+d.getSeconds()/60,hr=(d.getHours()%12)+m/60;wallClock.hands[0].rotation.z=-hr/12*Math.PI*2;wallClock.hands[1].rotation.z=-m/60*Math.PI*2;}
{const flag=new THREE.BufferGeometry();flag.setAttribute('position',new THREE.Float32BufferAttribute([-.17,0,0,.17,0,0,0,-.32,0],3));flag.computeVertexNormals();
 const fm=new THREE.MeshStandardMaterial({side:THREE.DoubleSide,roughness:.8});wallMats.push(fm);const list=[];
 for(let x=.6;x<WORLD.w*U-.5;x+=.42){const k=x/(WORLD.w*U),y=4.75-Math.sin(k*Math.PI*3)**2*.18;list.push({x,y,z:.08,color:Math.round(x/.42)%2?'#6fb3e0':'#f4f1ea'});}
 instanced([[flag,fm]],list);}

// A chair faces the table: its back is away from it. Seat height SEAT_H.
function chairMesh(){const g=new THREE.Group();g.add(box(.6,.07,.58,darkWood,0,SEAT_H,0),box(.6,.7,.07,darkWood,0,SEAT_H+.36,-.28));for(const [x,z] of [[-.25,-.24],[.25,-.24],[-.25,.24],[.25,.24]])g.add(box(.06,SEAT_H,.06,darkWood,x,SEAT_H/2,z));return g;}
const ringGeo=new THREE.RingGeometry(.5,.66,40),ringMat=()=>new THREE.MeshBasicMaterial({color:'#f3cf73',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false});
const cardGeo=new THREE.BoxGeometry(.3,.012,.44),cardBack=mat('#8a2b2b'),cardFace=mat('#f7f1e3');
function tableMesh(kind){
 const g=new THREE.Group(),w=(kind==='2v2'?148:140)*U,d=(kind==='2v2'?148:104)*U;
 g.add(box(w,.09,d,wood,0,TABLE_H,0),box(w-.25,.02,d-.25,felt,0,TABLE_H+.055,0));
 for(const [x,z] of [[-1,-1],[1,-1],[-1,1],[1,1]])g.add(box(.09,TABLE_H,.09,darkWood,x*(w/2-.15),TABLE_H/2,z*(d/2-.15)));
 const light=new THREE.Mesh(new THREE.PlaneGeometry(7,7),poolMat);light.rotation.x=-Math.PI/2;light.position.y=.01;g.add(light);
 return g;
}
// Seats around a table, in world pixels from its center; a chair sits a bit farther out than the table edge.
const SEATS={'1v1':{player1:[0,84],player2:[0,-84]},'2v2':{player1:[0,104],player2:[104,0],player3:[0,-104],player4:[-104,0]}};

// ---------- people: built in bar3d/people.js ----------
// Added to the room when made; their own merged shapes are freed when they go (sweep, dropActor).
const buildPerson=(look,o)=>{const p=makePerson(look,o);scene.add(p.root);return p;};
const dropPerson=p=>{if(!p)return;scene.remove(p.root);p.dispose?.();};

function label(className){const el=document.createElement('div');el.className=className;const o=new CSS2DObject(el);scene.add(o);return {el,o,set(text){if(el.textContent!==text)el.textContent=text;}};}
function nameLabel(){const l=label('tag');l.img=document.createElement('img');l.span=document.createElement('span');l.el.append(l.img,l.span);
 l.set=(text,avatar,me)=>{if(l.span.textContent!==text)l.span.textContent=text;const src=avatar?.src||'';if(src&&l.img.src!==src)l.img.src=src;l.el.classList.toggle('me',!!me);};return l;}
const views=new Map();
function view(key,make){let v=views.get(key);if(!v){v=make();views.set(key,v);}v.seen=true;return v;}
function sweep(){for(const [key,v] of views){if(!v.seen){if(v.person)dropPerson(v.person);for(const l of v.labels||[])scene.remove(l.o),l.el.remove();if(v.group)scene.remove(v.group);v.dispose?.();views.delete(key);}else v.seen=false;}}

// Where a seat is in the world, which way it faces, and the spot beside it where you stand up.
function seatSpot(slot,seat){const [dx,dy]=SEATS[slot.kind][seat],len=Math.hypot(dx,dy),fx=-dx/len,fy=-dy/len;
 return {x:slot.x+dx,y:slot.y+dy,face:Math.atan2(fx,fy),side:{x:slot.x+dx+fy*52,y:slot.y+dy-fx*52}};}
// ---------- cards on the tables: in hand, thrown, dealt ----------
const texLoader=new THREE.TextureLoader(),sheets={};
const tex=src=>{const t=texLoader.load(src);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
const backMat=new THREE.MeshStandardMaterial({map:tex('/assets/tatu-dorso.webp'),roughness:.55}),edgeMat=mat('#efe8d6');
const faceMats=new Map();
// Same picture sheets as the game: four cards per file (see cardImage in app.js).
function faceMat(r,suit){const key=r+suit;if(faceMats.has(key))return faceMats.get(key);
 const group={'♦':0,'♥':3,'♠':6,'♣':9}[suit]??6,i=r-1,file=group+Math.floor(i/4)+1,col=i%4;
 const base=sheets[file]??=tex('/assets/cards/'+file+'.jpg'),t=base.clone();t.repeat.set(.25,1);t.offset.set(col*.25,0);t.needsUpdate=true;
 const m=new THREE.MeshStandardMaterial({map:t,roughness:.5});faceMats.set(key,m);return m;}
const CARD_W=.36,CARD_L=.54,cardBox=new THREE.BoxGeometry(CARD_W,.012,CARD_L);
const cardMesh=face=>{const m=new THREE.Mesh(cardBox,[edgeMat,edgeMat,face||backMat,backMat,edgeMat,edgeMat]);m.castShadow=true;return m;};
const seatDir=(kind,seat)=>{const [dx,dy]=SEATS[kind][seat];const l=Math.hypot(dx,dy);return {x:dx/l,z:dy/l,len:l*U};};
// Where a seated player's cards are held, and where each of their cards lands on the cloth (by trick).
const handPos=(kind,seat)=>{const d=seatDir(kind,seat);return new THREE.Vector3(d.x*d.len*.6,TABLE_H+.38,d.z*d.len*.6);};
function tablePos(kind,seat,trick){const d=seatDir(kind,seat),out=kind==='2v2'?.42:.36,side=(trick-1)*.4;return new THREE.Vector3(d.x*out-d.z*side,TABLE_H+.07+trick*.004,d.z*out+d.x*side);}
const DECK=kind=>new THREE.Vector3(kind==='2v2'?-.95:-.8,TABLE_H+.07,kind==='2v2'?.95:0);
// A fan of cards held in front of the chest: the backs show to everyone else.
function fanFor(person){
 const fan=new THREE.Group();fan.position.set(0,1.3,.42);person.root.add(fan);
 for(let i=0;i<3;i++){const c=cardMesh();c.rotation.order='YXZ';c.rotation.x=-1.15;c.rotation.y=(i-1)*.28;c.position.set((i-1)*.1,0,(1-Math.abs(i-1))*.02);fan.add(c);}
 return fan;
}
// A card flying: an arc from where it is to where it goes, turning on the way.
function fly(c,now){const k=Math.min(1,(now-c.start)/c.dur),e=1-Math.pow(1-k,3);
 c.mesh.position.lerpVectors(c.from,c.to,e);c.mesh.position.y+=Math.sin(Math.PI*k)*c.arc;c.mesh.rotation.y=lerp(c.rot0,c.rot1,e);return k>=1;}
function liveCards(v,slot,L,now){
 const kind=slot.kind,a=v.play??={hand:null,cards:new Map(),leaving:[],dealt:null,deal:null,deck:null,muestra:null};
 const seats=Object.keys(L.players).filter(seat=>SEATS[kind][seat]),played=L.played||[];
 if(!a.deck){a.deck=new THREE.Group();for(let i=0;i<4;i++){const c=cardMesh();c.position.y=i*.014;c.rotation.y=Math.PI/2+i*.03;a.deck.add(c);}v.group.add(a.deck);}
 a.deck.position.copy(DECK(kind));
 // A new hand: the cards on the table go back to the deck and the dealer deals three to each.
 if(a.hand!==L.hand){
  const first=a.hand===null;a.hand=L.hand;a.gone=new Set();
  for(const c of a.cards.values()){c.from=c.mesh.position.clone();c.to=DECK(kind);c.start=now;c.dur=350;c.arc=.2;c.rot0=c.mesh.rotation.y;c.rot1=Math.PI/2;a.leaving.push(c);}
  a.cards=new Map();
  if(!first&&!played.length&&L.dealer&&seats.includes(L.dealer)){
   const order=[],start=seats.indexOf(L.dealer);for(let r=0;r<3;r++)for(let i=1;i<=seats.length;i++)order.push(seats[(start+i)%seats.length]);
   a.deal={start:now+400,order,launched:0,flying:[]};a.dealt=Object.fromEntries(seats.map(s2=>[s2,0]));
   const dealer=sitterAt(slot,L.dealer);if(dealer)dealer.person.gesture={kind:'deal',start:now+400,dur:order.length*170+200,flicks:order.length};
  }else{a.deal=null;a.dealt=null;}
 }
 a.leaving=a.leaving.filter(c=>{if(!fly(c,now))return true;v.group.remove(c.mesh);return false;});
 // Dealing: one card every 170 ms, each lands in that player's hand.
 if(a.deal){
  const d=a.deal;
  while(d.launched<d.order.length&&now>=d.start+d.launched*170){const to=d.order[d.launched++],mesh=cardMesh();v.group.add(mesh);
   d.flying.push({mesh,seat:to,from:handPos(kind,L.dealer),to:handPos(kind,to),start:now,dur:380,arc:.35,rot0:0,rot1:Math.PI*2});}
  d.flying=d.flying.filter(c=>{if(!fly(c,now))return true;v.group.remove(c.mesh);a.dealt[c.seat]++;return false;});
  if(d.launched>=d.order.length&&!d.flying.length){a.deal=null;a.dealt=null;}
 }
 // The muestra: face up, across, half under the deck, once the dealing is over.
 if(!a.muestra){a.muestra=cardMesh();v.group.add(a.muestra);}
 const mkey=L.muestra?L.muestra.r+L.muestra.s:'';
 if(L.muestra&&a.muestraKey!==mkey){a.muestra.material=[edgeMat,edgeMat,faceMat(L.muestra.r,L.muestra.s),backMat,edgeMat,edgeMat];a.muestraKey=mkey;}
 a.muestra.visible=!!L.muestra&&!a.deal;a.muestra.position.copy(DECK(kind)).add(new THREE.Vector3(0,-.01,.22));a.muestra.rotation.y=Math.PI/2;
 // Cards played: each flies from the hand to its place, and the arm throws it.
 // Only the trick in play stays on the cloth: a finished one goes to the deck (see below).
 const lastTrick=played.reduce((m,c)=>Math.max(m,c.t),-1),trickDone=t=>t<lastTrick||played.filter(c=>c.t===t).length>=seats.length;
 a.gone??=new Set();
 for(const item of played){
  const key=item.p+'|'+item.r+item.s;if(a.cards.has(key)||a.gone.has(key)||!SEATS[kind][item.p])continue;
  if(!a.seenOnce&&item.t<lastTrick){a.gone.add(key);continue;}
  const mesh=cardMesh(faceMat(item.r,item.s));v.group.add(mesh);
  const d=seatDir(kind,item.p),rot=Math.atan2(d.x,d.z)+((hashOf(key)%7)-3)*.05,animated=!!a.seenOnce;
  const c={mesh,trick:item.t,from:handPos(kind,item.p),to:tablePos(kind,item.p,item.t),start:now,dur:animated?420:0,arc:.45,rot0:rot+1.2,rot1:rot};
  a.cards.set(key,c);if(animated){const thrower=sitterAt(slot,item.p);if(thrower)thrower.person.gesture={kind:'throw',start:now-80,dur:520};}
 }
 a.seenOnce=true;
 for(const c of a.cards.values())if(!c.done&&(c.dur===0||fly(c,now))){c.mesh.position.copy(c.to);c.mesh.rotation.y=c.rot1;c.done=true;}
 // A trick over (all its cards down, or a later one started): a moment to see it, then to the deck.
 for(const [key,c] of [...a.cards]){
  if(!c.done||!trickDone(c.trick)){c.doneAt=null;continue;}
  c.doneAt??=now;if(now-c.doneAt<1400)continue;
  Object.assign(c,{from:c.mesh.position.clone(),to:DECK(kind),start:now,dur:350,arc:.2,rot0:c.mesh.rotation.y,rot1:Math.PI/2});
  a.leaving.push(c);a.cards.delete(key);a.gone.add(key);
 }
 // Cards in each hand: three, less the ones played; while dealing, the ones already received.
 for(const seat of seats){const s2=sitterAt(slot,seat);if(!s2)continue;if(!s2.fan){s2.fan=fanFor(s2.person);s2.fanSlot=slot.id;}
  const held=a.dealt?a.dealt[seat]:Math.max(0,3-played.filter(c=>c.p===seat).length);
  s2.fan.children.forEach((c,i)=>{c.visible=i<held;});s2.fan.visible=!L.finished;}
}
function clearLiveCards(v){const a=v.play;if(!a)return;for(const c of [...a.cards.values(),...a.leaving])v.group.remove(c.mesh);if(a.deck)v.group.remove(a.deck);if(a.muestra)v.group.remove(a.muestra);
 for(const a2 of actors.values())if(a2.fan&&a2.fanSlot===v.slotId){a2.person.root.remove(a2.fan);a2.fan=null;}v.play=null;}

function drawSlot(slot,now,dt){
 if(!slot.placed)return;
 const t=slot.code?tableOf(slot.code):null,seats=SEATS[slot.kind],people=t?(t.live?.players||t.room?.players||{}):{};
 const v=view('slot'+slot.id+slot.kind,()=>{const group=new THREE.Group();group.position.copy(P(slot.x,slot.y));group.add(tableMesh(slot.kind));
  const rings={};for(const [seat,[dx,dy]] of Object.entries(seats)){const ch=chairMesh();ch.position.set(dx*U,0,dy*U);ch.rotation.y=Math.atan2(-dx,-dy);group.add(ch);
   const ring=new THREE.Mesh(ringGeo,ringMat());ring.rotation.x=-Math.PI/2;ring.position.set(dx*U,.02,dy*U);group.add(ring);rings[seat]=ring;}
  const cards=new THREE.Group();for(const [x,z,r,face] of [[-.28,-.08,-.3,1],[.22,.12,.25,1],[0,.32,.1,0],[.45,-.25,0,0]]){const c=new THREE.Mesh(cardGeo,face?cardFace:cardBack);c.position.set(x,TABLE_H+.075,z);c.rotation.y=r;c.castShadow=true;cards.add(c);}group.add(cards);
  scene.add(group);const sign=label('sign');sign.o.position.set(0,TABLE_H+2.1,0);group.add(sign.o);
  return {group,rings,cards,sign,labels:[sign],slotId:slot.id};});
 const pulse=.45+.4*Math.sin(now/350),meSeat=myChair(),armer=!t?armerOf(slot):null;
 for(const [seat,ring] of Object.entries(v.rings)){ring.visible=(!t||(t.waiting&&!people[seat]?.uid))&&!armer&&!(meSeat&&meSeat.slot===slot&&meSeat.seat===seat);ring.material.opacity=pulse;}
 v.cards.visible=!!t&&!t.live;
 if(t?.live)liveCards(v,slot,t.live,now);else clearLiveCards(v);
 // The game just ended (I saw it playing): the winning side celebrates. A rematch starts a new game here too.
 if(t?.live){const fin=!!t.live.finished;if(v.fin===false&&fin){const sc=t.live.scores||{},first=(Number(sc.player1)||0)>=(Number(sc.player2)||0);
   for(const seat of first?['player1','player3']:['player2','player4']){const a=sitterAt(slot,seat);if(a)a.person.gesture={kind:'win',start:now,dur:4200};}}v.fin=fin;}
 else v.fin=undefined;
 const mode=slot.kind==='2v2'?'2 vs 2':'1 vs 1',near=nearTable(slot);v.sign.el.hidden=false;
 if(!t&&armer){v.sign.el.hidden=!near||armer.uid===state.me?.uid;v.sign.set(armer.name+' arma una mesa · '+armer.points+' pts');v.sign.el.className='sign wait';}
 else if(!t){v.sign.set('LIBRE · '+mode+(slot.p?' · '+slot.p+' pts':''));v.sign.el.className='sign free';}
 // A table in play shows no sign over it: the score is on the scorer lying on the table.
 else if(t.live){v.sign.el.hidden=true;tableTalk(v,slot,t.live,now,near);}
 else{v.sign.set((t.room.creditMatch?.hasPassword?'🔒 ':'')+'Sentate · '+(t.room.targetPoints||20)+' pts');v.sign.el.className='sign wait';}
 scorer(v,slot,t?.live||null);if(!t?.live)hideTalk(v);
}
// ---------- the scorer on the table: the game's own anotador, lying there ----------
// The same look as the anotador in the game (dark green, the names, the sticks in groups of five with
// the malas above and the buenas below), without its buttons or the totals: only the sticks count. It lies at the end of
// the table and turns by quarters so it reads upright from where I look.
const SCORER_W=.46,SCORER_L=.6,SCORER_PX=[300,392];
function scorer(v,slot,L){
 if(!L){if(v.scorer)v.scorer.group.visible=false;return;}
 const sc=v.scorer??=makeScorer(v,slot);sc.group.visible=true;
 sc.group.rotation.y=Math.round(cam.yaw/(Math.PI/2))*(Math.PI/2);
 const two=slot.kind==='2v2',name=seat=>L.players?.[seat]?.name||'';
 const teams=[two?[name('player1'),name('player3')]:[name('player1')],two?[name('player2'),name('player4')]:[name('player2')]];
 const key=JSON.stringify([teams,L.scores,L.targetPoints,L.finished]);if(sc.key===key)return;sc.key=key;
 drawScorer(sc.ctx,teams,[Number(L.scores?.player1)||0,Number(L.scores?.player2)||0],Number(L.targetPoints)||30,!!L.finished);sc.tex.needsUpdate=true;
}
function makeScorer(v,slot){
 const c=document.createElement('canvas');[c.width,c.height]=SCORER_PX;
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
 const g=new THREE.Group(),screen=new THREE.Mesh(new THREE.PlaneGeometry(SCORER_W,SCORER_L),new THREE.MeshBasicMaterial({map:tex}));
 screen.rotation.x=-Math.PI/2;screen.position.y=.013;
 g.add(box(SCORER_W+.03,.012,SCORER_L+.03,M('#151a17',{roughness:.4}),0,.006,0),screen);
 const two=slot.kind==='2v2';
 // 1 vs 1: at the end of the table, clear of the cards; 2 vs 2: in the corner across from the deck.
 g.position.set(two?.78:.84,TABLE_H+.07,two?-.78:0);
 v.group.add(g);return {group:g,ctx:c.getContext('2d'),tex,key:''};
}
function drawScorer(g,teams,scores,target,finished){
 const [W,H]=SCORER_PX,limit=[10,20,30,40,50,60].includes(target)?target:30,slots=limit/10;
 g.fillStyle='#0d2119';g.fillRect(0,0,W,H);
 g.textAlign='center';g.textBaseline='middle';
 g.fillStyle='#d8b875';g.font='700 19px "DM Sans",sans-serif';g.fillText(finished?'Terminó':'A '+limit,W/2,20);
 g.strokeStyle='rgba(239,235,215,.15)';g.lineWidth=1.5;g.beginPath();g.moveTo(W/2,38);g.lineTo(W/2,H-8);g.stroke();
 // The groups sit in two blocks, malas and buenas, with the line exactly between them: the same small
 // gap above it and below it, whatever the points.
 const avail=H-82-12,step=Math.min(36,avail/(2*slots)),size=step*.72,gap=step-size,top=88,line=top+slots*step;
 teams.forEach((names,i)=>{
  const cx=W/4+i*W/2,points=Math.min(Math.max(0,scores[i]),limit);
  g.fillStyle='#f7f3e9';g.font='600 '+(names.length>1?14:18)+'px "DM Sans",sans-serif';
  g.fillText(names.map(n=>n.length>9?n.slice(0,8)+'…':n).join(' y '),cx,54,W/2-14);
  // Malas above the line, buenas below it, as in the game.
  g.strokeStyle='rgba(239,235,215,.4)';g.lineWidth=1.5;g.beginPath();g.moveTo(cx-W/4+10,line);g.lineTo(cx+W/4-10,line);g.stroke();
  g.strokeStyle='#f0eee2';g.lineWidth=3;g.lineCap='round';
  for(let k=0;k*5<points;k++){const n=Math.min(5,points-k*5),x=cx-size/2,y=k<slots?top+k*step:line+gap+(k-slots)*step;
   const sides=[[x,y,x,y+size],[x,y+size,x+size,y+size],[x+size,y+size,x+size,y],[x+size,y,x,y],[x,y+size,x+size,y]];
   for(const [x1,y1,x2,y2] of sides.slice(0,n)){g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}}
 });
}
// ---------- what the players say: a bubble over each one ----------
// Calls (truco, envido, flor), answers and points sung come from the table's own feed, with who said
// it (bar-core.js liveTableEntry). A 2 vs 2 signal shows only that one was made. On the first look
// nothing old is repeated.
// Near a table: as close as one talks to someone (HEAR_RADIUS from its chairs). Only then its texts show
// (the players' names, what they say); a table with free places shows its sign from anywhere.
const TABLE_REACH=110;
function nearTable(slot){if(state.watching===slot)return true;const me=state.me&&state.walkers.get(state.me.uid);return !!me&&Math.hypot(me.dx-slot.x,me.dy-slot.y)<=HEAR_RADIUS+TABLE_REACH;}
function tableTalk(v,slot,L,now,near=true){
 const talk=v.talk??={seen:null,bubbles:{},signId:null};
 if(talk.seen===null){talk.seen=new Set((L.says||[]).map(x=>x.id));talk.signId=L.sign?.id||null;}
 for(const item of L.says||[]){if(talk.seen.has(item.id))continue;talk.seen.add(item.id);
  if(!SEATS[slot.kind][item.p])continue;bubbleAt(v,slot,item.p,String(item.w),now,false);
  const a=sitterAt(slot,item.p);if(a&&String(item.w).startsWith('¡'))a.person.gesture={kind:'shout',start:now,dur:1100};}
 if(talk.seen.size>60)talk.seen=new Set([...talk.seen].slice(-30));
 if(L.sign?.id&&L.sign.id!==talk.signId){talk.signId=L.sign.id;
  if(SEATS[slot.kind][L.sign.p]){bubbleAt(v,slot,L.sign.p,'🤫',now,true);const a=sitterAt(slot,L.sign.p);if(a)a.person.gesture={kind:'sign',start:now,dur:1000};}}
 for(const b of Object.values(talk.bubbles))b.l.el.hidden=now>=b.until||!near;
}
function bubbleAt(v,slot,seat,text,now,emote){
 const b=v.talk.bubbles[seat]??={l:(()=>{const l=label('bubble talk');v.group.add(l.o);v.labels.push(l);return l;})(),until:0};
 const [dx,dy]=SEATS[slot.kind][seat];b.l.o.position.set(dx*U,2.6,dy*U);b.l.set(text);
 b.l.el.classList.toggle('emote',emote);b.l.el.classList.toggle('shout',text.startsWith('¡'));b.until=now+(emote?1800:3200);b.l.el.hidden=false;
}
function hideTalk(v){if(!v.talk)return;for(const b of Object.values(v.talk.bubbles))b.l.el.hidden=true;v.talk.seen=null;}
const CALLS={truco:'¡TRUCO!',retruco:'¡RETRUCO!',vale4:'¡VALE CUATRO!',envido:'¡ENVIDO!','real-envido':'¡REAL ENVIDO!','falta-envido':'¡FALTA ENVIDO!',flor:'¡FLOR!'};
const callText=c=>CALLS[c]||('¡'+String(c).replace(/[-_]/g,' ').toUpperCase()+'!');
// ---------- everyone in the game, as people in the bar ----------
// The bar mirrors the game: each person (at a table or in the lobby) is one character that goes where
// they are. Sitting at a table: they walk to the chair and sit. A game over and the table left: they
// get up and walk to the counter if they stay in the lobby, or out the door if they left the game.
// New people come in through the door. On the first look everyone is already in place.
const STOOLS=14,DOOR_IN={x:1515,y:330},NPC_SPEED=MAX_SPEED*.85,GONE_GRACE_MS=2500;
const actors=new Map(),stoolOf=new Map(),lastWalkerPos=new Map();
let mirrorFrom=null;
buildStools();
// A stool at the counter (facing it), or a standing spot near it when all stools are taken.
function stoolSpot(i,face=Math.PI){if(i<STOOLS){const x=90+i*90;return {x,y:222,face,side:{x,y:300}};}const j=i-STOOLS,x=110+(j%16)*80,y=330+Math.floor(j/16)*60;return {x,y,face:Math.PI,side:{x,y},stand:true};}
// A stool someone in the bar sits on (me included) is not given to anyone else.
function stoolByWalker(i){if(sitting?.stool===i)return true;const x=90+i*90;for(const w of state.walkers.values())if(w.uid!==state.me?.uid&&w.ts&&Math.abs((w.tx??w.x)-x)<25&&Math.abs((w.ty??w.y)-222)<25)return true;return false;}
function stoolFor(uid){if(stoolOf.has(uid)&&!stoolByWalker(stoolOf.get(uid)))return stoolOf.get(uid);stoolOf.delete(uid);const used=new Set(stoolOf.values());for(let i=0;i<STOOLS;i++)if(stoolByWalker(i))used.add(i);let i=0;while(used.has(i))i++;stoolOf.set(uid,i);return i;}
// Where each person should be now.
function places(){
 const out=new Map();
 for(const slot of state.slots){if(!slot.placed||!slot.code)continue;const t=tableOf(slot.code);if(!t)continue;
  for(const [seat,p] of Object.entries(t.live?.players||t.room?.players||{}))if(p?.uid&&SEATS[slot.kind][seat]&&!(t.live?.finished&&t.live.here?.[seat]===false))out.set(String(p.uid).startsWith('bot:')?p.uid+'@'+slot.code:p.uid,{key:'seat:'+slot.id+':'+seat,spot:seatSpot(slot,seat),name:p.name,slot,seat,playing:!!t.live&&!t.live.finished});}
 for(const p of state.online)if(!out.has(p.uid)){const i=stoolFor(p.uid);out.set(p.uid,{key:'stool:'+i,spot:stoolSpot(i,hashOf(p.uid)%3===0?0:Math.PI),name:p.name});}
 for(const uid of [...stoolOf.keys()])if(!out.has(uid)||!out.get(uid).key.startsWith('stool:'))stoolOf.delete(uid);
 return out;
}
function sitterAt(slot,seat){for(const a of actors.values())if(a.goal?.key==='seat:'+slot.id+':'+seat&&a.phase==='seated')return a;return null;}
function makeActor(uid,name,at){
 const person=buildPerson(looks(uid,name)),tag=nameLabel();
 return {uid,name,person,tag,lookKey:lookKey(uid),dx:at.x,dy:at.y,vx:0,vy:0,heading:Math.atan2(-1,0),sit:0,phase:'walk',path:null,goal:null,goneSince:null};
}
function dropActor(a){dropPerson(a.person);scene.remove(a.tag.o);a.tag.el.remove();actors.delete(a.uid);}
// Ask the server how people at the tables and the counter look (new ones, every 2 s at most).
const lookAsked=new Set();let lookAskAt=0;
function askLooks(uids,now){
 if(now-lookAskAt<2000)return;const fresh=uids.filter(u=>!lookAsked.has(u)&&!isBot(u,'')).slice(0,60);if(!fresh.length)return;
 lookAskAt=now;for(const u of fresh)lookAsked.add(u);bar?.send({t:'looks',uids:fresh});
}
function updateActors(now,dt){
 const want=places();askLooks([...want.keys()],now);
 // People inside the bar page walk by themselves (as walkers); keep where they were last seen.
 for(const w of state.walkers.values()){lastWalkerPos.set(w.uid,{x:w.dx,y:w.dy});const a=actors.get(w.uid);if(a)dropActor(a);}
 if(mirrorFrom===null&&(state.slots.length||state.online.length))mirrorFrom=now;
 const settling=mirrorFrom!==null&&now-mirrorFrom<2500;
 for(const [uid,goal] of want){
  if(state.walkers.has(uid)||actors.has(uid))continue;
  // Already there when the bar opens; later, in through the door (or from where they walked in the bar).
  const a=makeActor(uid,goal.name,settling?goal.spot.side:lastWalkerPos.get(uid)||DOOR_IN);actors.set(uid,a);
  if(settling){a.goal=goal;a.dx=goal.spot.side.x;a.dy=goal.spot.side.y;a.heading=goal.spot.face;a.sit=goal.spot.stand?0:1;a.phase=goal.spot.stand?'idle':'seated';}
 }
 for(const a of [...actors.values()]){
  const goal=want.get(a.uid)||null;
  if(!goal){a.goneSince??=now;}else a.goneSince=null;
  const target=goal||(now-a.goneSince>GONE_GRACE_MS?{key:'gone'}:a.goal);
  if(target&&target.key!==a.goal?.key){a.goal=target;a.path=null;a.ghost=false;a.best=null;a.stuckT=0;a.repath=false;if(a.phase==='seated'||a.phase==='down')a.phase='up';else if(a.phase==='idle')a.phase='walk';}
  if(goal)a.name=goal.name;
  if(a.lookKey!==lookKey(a.uid)){dropPerson(a.person);a.person=buildPerson(looks(a.uid,a.name));a.lookKey=lookKey(a.uid);a.fan=null;}
  stepActor(a,now,dt);
 }
}
// Walk toward a point along a path; true on arrival. Never stuck: with no way through, or 3 s without
// getting closer (someone in the way), they walk straight there through whatever is in the way.
function walkBody(a,dest,dt,speed){
 const far=Math.hypot(dest.x-a.dx,dest.y-a.dy);
 if(far<(a.best??Infinity)-8){a.best=far;a.stuckT=0;}else a.stuckT=(a.stuckT||0)+dt;
 if(a.stuckT>3)a.ghost=true;
 // Someone in the way for a moment: look for a way around them.
 if(!a.ghost&&a.stuckT>1&&!a.repath){a.path=null;a.repath=true;}
 let next;
 if(a.ghost)next=far<6?null:dest;
 else{a.path??=findPath({x:a.dx,y:a.dy},dest,0,a);if(!a.path.length&&far>=14){a.ghost=true;next=dest;}else next=a.path[0];}
 if(!next){physics(a,{x:0,y:0},dt);if(far<14){a.ghost=false;a.best=null;a.stuckT=0;a.repath=false;a.path=null;return true;}a.path=null;return false;}
 const dx=next.x-a.dx,dy=next.y-a.dy,d=Math.hypot(dx,dy),last=a.ghost||a.path.length===1;
 if(d<(last?6:22)||(!last&&d<speed*dt*1.5)){if(!a.ghost)a.path.shift();}else{const sp=last?Math.min(speed,d*3.2):speed;physics(a,{x:dx/d*sp,y:dy/d*sp},dt);}
 return false;
}
function stepActor(a,now,dt){
 const goal=a.goal,spot=goal?.spot;
 if(a.phase!=='seated'&&a.fan){a.person.root.remove(a.fan);a.fan=null;}
 if(a.phase==='up'){a.sit=Math.max(0,a.sit-dt/.75);a.vx=a.vy=0;if(a.sit<=0){a.phase='walk';a.path=null;a.seatSpot=null;}}
 else if(a.phase==='walk'&&goal){
  const dest=goal.key==='gone'?DOOR_IN:spot.side;
  if(walkBody(a,dest,dt,NPC_SPEED)){if(goal.key==='gone'){dropActor(a);return;}a.dx=dest.x;a.dy=dest.y;a.phase=spot.stand?'idle':'down';a.seatSpot=spot.stand?null:spot;}
 }
 else if(a.phase==='down'){a.vx=a.vy=0;a.seatSpot=spot;if(turnToward(a,spot.face,dt)<.5)a.sit=Math.min(1,a.sit+dt/.9);if(a.sit>=1)a.phase='seated';}
 else if(a.phase==='idle'){physics(a,{x:0,y:0},dt);turnToward(a,spot?.face??a.heading,dt);}
 else if(a.phase==='seated'){a.seatSpot=spot;a.vx=a.vy=0;a.heading=spot.face;}
 // Draw: on a chair the body moves from beside it onto the seat while sitting down.
 const sitAt=a.seatSpot&&a.sit>0?a.seatSpot:null,k=clamp01(a.sit*1.6);
 const x=sitAt?lerp(sitAt.side.x,sitAt.x,k):a.dx,y=sitAt?lerp(sitAt.side.y,sitAt.y,k):a.dy;
 a.person.root.position.copy(P(x,y));a.person.root.rotation.y=a.heading;
 animate(a.person,{speed:Math.hypot(a.vx,a.vy),accel:a.accel||0,turn:a.turnRate||0,sit:a.sit,playing:a.phase==='seated'&&!!goal?.playing,handsDown:!!(sitAt&&sitAt.y<260&&Math.cos(sitAt.face||0)>.5),dt,now});
 const len=a.name.length>14?a.name.slice(0,13)+'…':a.name;
 a.tag.o.position.set(x*U,2.45-smooth(clamp01(a.sit))*.4,y*U);a.tag.set(len,avatarOf(a.uid,a.name),a.uid===state.me?.uid);
 a.tag.el.style.visibility=a.goal?.slot&&!nearTable(a.goal.slot)?'hidden':'';
}

function drawWalkers(now,dt){
 for(const w of state.walkers.values()){
  const me=w.uid===state.me?.uid;
  if(me&&LOCAL&&globalThis.barHideMe)continue;
  const v=view('walker'+w.uid+lookKey(w.uid),()=>{const person=buildPerson(looks(w.uid,w.name)),tag=nameLabel(),bubble=label('bubble');
   const ring=new THREE.Mesh(new THREE.RingGeometry(HEAR_RADIUS*U-.05,HEAR_RADIUS*U,64),new THREE.MeshBasicMaterial({color:'#9fd3ff',transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.visible=me;scene.add(ring);
   return {person,labels:[tag,bubble],tag,bubble,ring,dispose(){scene.remove(ring);}};});
  // The sitting spot moves the body onto the chair; standing, it is where the walker is.
  const sitAt=w.seatSpot&&w.sit>0?w.seatSpot:null,b=smooth(clamp01(w.sit||0));
  const x=sitAt?lerp(sitAt.side.x,sitAt.x,clamp01((w.sit||0)*1.6)):w.dx,y=sitAt?lerp(sitAt.side.y,sitAt.y,clamp01((w.sit||0)*1.6)):w.dy;
  // Stopped against the counter: lean on it, facing it or with the back to it.
  const still=Math.hypot(w.vx||0,w.vy||0)<20&&!(w.sit>0),atBar=still&&w.dy<COUNTER_FRONT+BODY+16&&w.dx<WORLD.w-235;
  w.rest=lerp(w.rest||0,atBar?1:0,Math.min(1,dt*(atBar?3:8)));const back=Math.cos((w.heading||0)-Math.PI)<0;
  holdItem(v.person,held.get(w.uid)||null);
  animate(v.person,{speed:Math.hypot(w.vx||0,w.vy||0),accel:w.accel||0,turn:w.turnRate||0,sit:w.sit||0,rest:w.rest,restBack:back,handsDown:!!(sitAt&&sitAt.y<260&&Math.cos(sitAt.face||0)>.5),holding:!!held.get(w.uid),dt});
  v.person.root.position.copy(P(x,y-(w.rest||0)*10));v.person.root.rotation.y=w.heading||0;
  // Choosing my look: whoever stands right next to me steps out of the picture.
  const meW=state.editingLook&&state.walkers.get(state.me?.uid),aside=!!meW&&!me&&Math.hypot(w.dx-meW.dx,w.dy-meW.dy)<160;
  v.person.root.visible=!aside;v.tag.el.style.visibility=aside?'hidden':'';
  v.ring.position.set(w.dx*U,.02,w.dy*U);v.ring.scale.setScalar(reachOf(w)/HEAR_RADIUS);
  v.tag.o.position.set(x*U,2.45-b*.45,y*U);v.tag.set(w.name,avatarOf(w.uid,w.name),me);
  if(w.gesture&&w.gesture!==v.person.gesture)v.person.gesture=w.gesture;
  const talking=w.bubble&&now<w.bubble.until,emote=!talking&&w.emote&&now<w.emote.until;v.bubble.el.hidden=!talking&&!emote;v.bubble.el.classList.toggle('emote',!!emote);
  if(talking||emote){v.bubble.set(emote?w.emote.text:w.bubble.text.length>60?w.bubble.text.slice(0,59)+'…':w.bubble.text);v.bubble.o.position.set(x*U,3.15-b*.45,y*U);}
 }
}
function drawMozo(now,dt){
 const m=stepMozo(now,dt);if(!m)return;const b=m.b;
 const v=view('mozo',()=>{const person=buildPerson({skin:'#e0ac7f',hair:'#1f1a17',style:'short',beard:true},{waiter:true});
  const carried=new THREE.Group();carried.add(box(1.3,.07,.9,wood,0,0,0),box(1.15,.02,.75,felt,0,.045,0));person.root.add(carried);carried.position.set(0,1.62,.55);
  const cup=new THREE.Group();cup.add(box(.5,.03,.36,M('#c9c9c9',{metalness:.5,roughness:.3}),0,0,0),itemMesh('cafe'));cup.children[1].position.y=.02;person.root.add(cup);cup.position.set(.3,1.32,.42);
  return {person,labels:[],carried,cup};});
 v.person.root.position.copy(P(b.dx,b.dy));v.person.root.rotation.y=b.heading||0;
 v.carried.visible=m.carrying;v.cup.visible=!!m.cup;animate(v.person,{speed:m.shuffle??Math.hypot(b.vx,b.vy),accel:b.accel||0,turn:b.turnRate||0,carry:m.carrying,reach:m.reach||null,dt});
}

const CELL=30;
function blockedAt(x,y,obs,r=BODY){
 if(x<r||x>WORLD.w-r||y<(obs.top??200)||y>worldBottom()-r)return true;
 return obs.some(o=>x>o.x0-r&&x<o.x1+r&&y>o.y0-r&&y<o.y1+r);
}
function clearLine(a,b,obs){const d=Math.hypot(b.x-a.x,b.y-a.y),n=Math.ceil(d/10);for(let i=1;i<=n;i++)if(blockedAt(a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n,obs))return false;return true;}
function findPath(from,to,depth=0,self=null,staff=false){
 // Standing inside something (a table the waiter just set down): first step out to the nearest free spot.
 if(!depth&&blockedAt(from.x,from.y,obstacles(staff))){
  const obs=obstacles(staff);let best=null,bd=1e9;
  for(let y=staff?40:200;y<worldBottom();y+=CELL)for(let x=CELL/2;x<WORLD.w;x+=CELL)if(!blockedAt(x,y,obs)){const d=Math.hypot(x-from.x,y-from.y);if(d<bd){bd=d;best={x,y};}}
  return best?[best,...findPath(best,to,1,null,staff)]:[];
 }
 const obs=obstacles(staff),cols=Math.ceil(WORLD.w/CELL),rows=Math.ceil(worldBottom()/CELL),N=cols*rows;
 // Someone standing in the way counts as a small obstacle (only for the path, not where they go).
 if(self)for(const o of movingBodies())if(o!==self&&!((o.sit||0)>.5)&&!o.ghost&&Math.hypot(o.dx-to.x,o.dy-to.y)>40)obs.push({x0:o.dx-14,y0:o.dy-14,x1:o.dx+14,y1:o.dy+14});
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

// ---------- moving: a body with weight ----------
// Speed builds up and dies down (no instant starts or stops), turning takes a moment, and the body
// slides along tables, chairs, the counter and other people instead of going through them.
const COUNTER_FRONT=196,STOOL_HALF=14,BODY=22,ACCEL=950,BRAKE=1300,TURN_RATE=9,CHAIR_HALF=20;
// staff: someone who may go behind the counter (BAR_STAFF on the server): for them only the counter itself is in the way.
function obstacles(staff=false){
 const list=[staff?{x0:20,y0:112,x1:WORLD.w-225,y1:COUNTER_FRONT}:{x0:0,y0:0,x1:WORLD.w-225,y1:COUNTER_FRONT}];
 for(let i=0;i<STOOLS;i++)list.push({x0:90+i*90-STOOL_HALF,y0:222-STOOL_HALF,x1:90+i*90+STOOL_HALF,y1:222+STOOL_HALF});
 list.push({x0:SIGN.x-60,y0:SIGN.y-40,x1:SIGN.x+60,y1:SIGN.y+40});
 list.top=staff?40:200;
 for(const s of state.slots)if(s.placed){
  const hw=s.kind==='2v2'?74:70,hh=s.kind==='2v2'?74:52;list.push({x0:s.x-hw,y0:s.y-hh,x1:s.x+hw,y1:s.y+hh});
  for(const [dx,dy] of Object.values(SEATS[s.kind]))list.push({x0:s.x+dx-CHAIR_HALF,y0:s.y+dy-CHAIR_HALF,x1:s.x+dx+CHAIR_HALF,y1:s.y+dy+CHAIR_HALF});
 }
 return list;
}
function movingBodies(){const list=[...state.walkers.values(),...actors.values(),fondo.body];if(mozoBody)list.push(mozoBody);return list;}
// Push a circle out of every box and every other person; returns the push direction (to cancel speed into walls).
function collide(w){
 const obs=obstacles(!!w.staff);let nx=0,ny=0;
 for(const o of obs){
  const cx=Math.max(o.x0,Math.min(w.dx,o.x1)),cy=Math.max(o.y0,Math.min(w.dy,o.y1)),dx=w.dx-cx,dy=w.dy-cy,d=Math.hypot(dx,dy);
  if(d<BODY){if(d>.001){w.dx+=dx/d*(BODY-d);w.dy+=dy/d*(BODY-d);nx+=dx/d;ny+=dy/d;}else{w.dy=o.y1+BODY;ny+=1;}}
 }
 if(!w.passPeople)for(const o of movingBodies()){if(o===w||(o.sit||0)>.5||o.ghost)continue;const dx=w.dx-o.dx,dy=w.dy-o.dy,d=Math.hypot(dx,dy);if(d<BODY*2&&d>.001){w.dx+=dx/d*(BODY*2-d);w.dy+=dy/d*(BODY*2-d);nx+=dx/d;ny+=dy/d;}}
 w.dx=Math.min(WORLD.w-BODY,Math.max(BODY,w.dx));w.dy=Math.min(worldBottom()-BODY,Math.max(w.staff?40:200,w.dy));
 const n=Math.hypot(nx,ny);if(n>0){nx/=n;ny/=n;const into=(w.vx||0)*nx+(w.vy||0)*ny;if(into<0){w.vx-=into*nx;w.vy-=into*ny;}}
}
// Move toward a wanted velocity with limited acceleration; face where you go, turning smoothly.
function physics(w,want,dt){
 w.vx??=0;w.vy??=0;w.heading??=w.a||0;
 const dvx=want.x-w.vx,dvy=want.y-w.vy,dv=Math.hypot(dvx,dvy),speeding=Math.hypot(want.x,want.y)>Math.hypot(w.vx,w.vy);
 const max=(speeding?ACCEL:BRAKE)*dt,k=dv>max?max/dv:1;
 const before=Math.hypot(w.vx,w.vy);w.vx+=dvx*k;w.vy+=dvy*k;
 w.dx+=w.vx*dt;w.dy+=w.vy*dt;if(!w.ghost)collide(w);
 const sp=Math.hypot(w.vx,w.vy);w.accel=(sp-before)/Math.max(dt,.001);
 if(sp>12){const target=Math.atan2(w.vx,w.vy);let da=Math.atan2(Math.sin(target-w.heading),Math.cos(target-w.heading));const step=Math.max(-TURN_RATE*dt,Math.min(TURN_RATE*dt,da*Math.min(1,dt*10)));w.heading+=step;w.turnRate=step/Math.max(dt,.001);}
 else w.turnRate=0;
}
function turnToward(w,angle,dt){const da=Math.atan2(Math.sin(angle-(w.heading||0)),Math.cos(angle-(w.heading||0)));w.heading=(w.heading||0)+da*Math.min(1,dt*7);return Math.abs(da);}

// ---------- the joystick (and the keyboard on a computer) ----------
const stick={x:0,y:0,active:false};
{const base=$('stick'),knob=$('stick-knob');let id=null;
 const set=e=>{const r=base.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,R=r.width/2-18;let dx=e.clientX-cx,dy=e.clientY-cy;const d=Math.hypot(dx,dy);if(d>R){dx*=R/d;dy*=R/d;}
  knob.style.transform=`translate(${dx}px,${dy}px)`;stick.x=dx/R;stick.y=dy/R;stick.active=true;};
 base.addEventListener('pointerdown',e=>{id=e.pointerId;base.setPointerCapture(id);set(e);e.stopPropagation();});
 base.addEventListener('pointermove',e=>{if(e.pointerId===id)set(e);});
 const end=e=>{if(e.pointerId!==id)return;id=null;knob.style.transform='';stick.x=stick.y=0;stick.active=false;};
 base.addEventListener('pointerup',end);base.addEventListener('pointercancel',end);}
const keys=new Set();
// Typing in a box (chat, report) never walks.
addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault();}});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
addEventListener('blur',()=>keys.clear());
function control(){
 let x=stick.x,y=stick.y;
 if(keys.size){x=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);y=(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);const n=Math.hypot(x,y);if(n>1){x/=n;y/=n;}}
 const m=Math.hypot(x,y);if(m<.12)return null;
 if(state.watching)stopWatching();
 // Up on the stick is "forward": away from the camera, wherever you turned it by dragging.
 const c=Math.cos(cam.yaw),s=Math.sin(cam.yaw);return {x:x*c+y*s,y:-x*s+y*c,m:Math.min(1,m)};
}

// ---------- my body: joystick, a tapped destination, or sitting on a chair ----------
// sitting: {slot, seat, spot, phase:'going'|'down'|'seated'|'up'}; w.sit goes 0 → 1 while sitting down.
let sitting=null;
const myChair=()=>sitting&&sitting.phase!=='going'?sitting:null;
function walkTo(x,y){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 if(sitting&&sitting.phase!=='going'){standUp(()=>walkTo(x,y));return;}
 sitting=null;me.path=findPath({x:me.dx,y:me.dy},{x,y},0,null,!!me.staff);unstick(me,null,0);me.ghost=false;state.follow=true;$('hint').hidden=true;
}
function sitOnStool(i){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 if(sitting&&sitting.phase!=='going'){if(sitting.stool===i){sitting.spot={...sitting.spot,face:sitting.spot.face===Math.PI?0:Math.PI};toast(sitting.spot.face===0?'Mirando a las mesas.':'Mirando a la barra.');return;}standUp(()=>sitOnStool(i));return;}
 const spot=stoolSpot(i);me.path=findPath({x:me.dx,y:me.dy},spot.side,0,null,!!me.staff);unstick(me,null,0);me.ghost=false;sitting={stool:i,spot,phase:'going'};state.follow=true;$('hint').hidden=true;
}
function sitOn(slot,seat){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 const spot=seatSpot(slot,seat);
 if(sitting&&sitting.phase!=='going'){if(sitting.slot===slot&&sitting.seat===seat){openTable(slot);return;}standUp(()=>sitOn(slot,seat));return;}
 me.path=findPath({x:me.dx,y:me.dy},spot.side,0,null,!!me.staff);unstick(me,null,0);me.ghost=false;sitting={slot,seat,spot,phase:'going'};state.follow=true;$('hint').hidden=true;
}
let afterStand=null;
function checkMyChair(){
 const s=sitting;if(!s?.slot)return;
 const slot=s.slot,t=tableOf(slot.code),who=(t?.live||t?.room)?.players?.[s.seat]?.uid;
 if(state.slots.includes(slot)&&!slot.leaving&&SEATS[slot.kind][s.seat]&&!t?.live&&(!who||who===state.me?.uid))return;
 if(s.phase==='going'){sitting=null;const me=state.me&&state.walkers.get(state.me.uid);if(me)me.path=null;}else standUp();
}
function standUp(then){if(!sitting||sitting.phase==='going'){then?.();return;}sitting.phase='up';afterStand=then||null;}
function moveMe(w,dt){
 const c=control();
 if(c&&sitting&&sitting.phase!=='going'&&sitting.phase!=='up'){standUp();}
 if(c&&sitting?.phase==='going'){sitting=null;w.path=null;}
 if(sitting&&sitting.phase!=='going'){
  const sp=sitting.spot;w.seatSpot=sp;w.vx=w.vy=0;w.accel=0;w.turnRate=0;
  if(sitting.phase==='down'){const off=turnToward(w,sp.face,dt);if(off<.5)w.sit=Math.min(1,(w.sit||0)+dt/.9);if(w.sit>=1){sitting.phase='seated';if(sitting.slot)openTable(sitting.slot);else toast('Tocá el banco otra vez para darte vuelta.');}}
  else if(sitting.phase==='seated'&&sitting.stool!=null)turnToward(w,sp.face,dt);
  else if(sitting.phase==='up'){w.sit=Math.max(0,(w.sit||0)-dt/.75);if(w.sit<=0){w.dx=sp.side.x;w.dy=sp.side.y;w.seatSpot=null;sitting=null;const then=afterStand;afterStand=null;then?.();}}
  return;
 }
 w.sit=0;w.seatSpot=null;
 if(c){w.path=null;w.ghost=false;unstick(w,null,dt);
  // Pushing with the joystick against someone who does not move: after a moment I slip past them (never through walls or tables).
  const want=MAX_SPEED*c.m,x0=w.dx,y0=w.dy;physics(w,{x:c.x*want,y:c.y*want},dt);
  // Measured by how far I really went: held back, the time adds up; moving freely, it runs down.
  const went=Math.hypot(w.dx-x0,w.dy-y0);w.pushT=went<want*dt*.25?(w.pushT||0)+dt:Math.max(0,(w.pushT||0)-dt*2);if(w.pushT>1.5)w.passPeople=true;else if(w.pushT<=0)w.passPeople=false;state.follow=true;$('hint').hidden=true;return;}
 w.pushT=0;w.passPeople=false;
 const next=w.path?.[0];
 if(!next){w.ghost=false;unstick(w,null,dt);physics(w,{x:0,y:0},dt);return;}
 const dx=next.x-w.dx,dy=next.y-w.dy,d=Math.hypot(dx,dy),last=w.path.length===1;
 if(d<(last?6:22)||(!last&&d<MAX_SPEED*dt*1.5)){w.path.shift();unstick(w,null,dt);if(!w.path.length){w.ghost=false;if(sitting?.phase==='going'){sitting.phase='down';w.dx=sitting.spot.side.x;w.dy=sitting.spot.side.y;}}return;}
 unstick(w,d,dt);
 const speed=last?Math.min(MAX_SPEED,d*3.2):MAX_SPEED;
 physics(w,{x:dx/d*speed,y:dy/d*speed},dt);
}
// Stuck on the way (someone standing there, a table set down in front): with no progress for 1.2 s
// another way is looked for; for 3 s, the body goes through whatever is in the way until it gets there.
function unstick(w,d,dt){
 if(d==null){w.bestD=null;w.stuckT=0;w.repathed=false;return;}
 if(d<(w.bestD??Infinity)-6){w.bestD=d;w.stuckT=0;return;}
 w.stuckT=(w.stuckT||0)+dt;
 if(w.stuckT>1.2&&!w.repathed&&w.path?.length){w.repathed=true;const goal=w.path[w.path.length-1];w.path=findPath({x:w.dx,y:w.dy},goal,0,w,!!w.staff);w.bestD=null;if(!w.path.length)w.path=[goal];}
 if(w.stuckT>3)w.ghost=true;
}
// Other people: their body chases where the server says they are, with the same weight and turning.
function moveOther(w,dt){
 const tx=w.tx??w.x,ty=w.ty??w.y;
 if(w.ts){w.seatSpot={x:tx,y:ty,side:{x:tx,y:ty},face:w.ta||0};w.dx=tx;w.dy=ty;w.vx=w.vy=0;turnToward(w,w.ta||0,dt);w.sit=Math.min(1,(w.sit||0)+dt/.9);return;}
 if(w.sit>0){w.sit=Math.max(0,w.sit-dt/.75);return;}
 w.seatSpot=null;
 const dx=tx-w.dx,dy=ty-w.dy,d=Math.hypot(dx,dy);
 if(d>400){w.dx=tx;w.dy=ty;w.vx=w.vy=0;return;}
 const speed=Math.min(MAX_SPEED*1.15,d*4);
 w.lagT=d>40?(w.lagT||0)+dt:0;if(w.lagT>2.5)w.ghost=true;else if(d<10)w.ghost=false;
 if(d<3){physics(w,{x:0,y:0},dt);if(Math.hypot(w.vx,w.vy)<15)turnToward(w,w.ta??w.heading??0,dt);return;}
 physics(w,{x:dx/d*speed,y:dy/d*speed},dt);
}
let lastSent={x:0,y:0,a:0,s:false,at:0};
function sendMyStep(me,now){
 if(now-lastSent.at<110)return;
 const seated=!!(sitting&&sitting.phase!=='going'&&(me.sit||0)>.5),x=Math.round(seated?sitting.spot.x:me.dx),y=Math.round(seated?sitting.spot.y:me.dy),a=Math.round((me.heading||0)*100)/100;
 if(x===lastSent.x&&y===lastSent.y&&Math.abs(a-lastSent.a)<.05&&seated===lastSent.s)return;
 lastSent={x,y,a,s:seated,at:now};bar?.send({t:'move',x,y,a,s:seated});
}

// ---------- camera: follows me, drag to look around, pinch or wheel to zoom ----------
// The camera orbits around me: drag sideways to turn it (yaw), up and down to tilt it (pitch).
const cam={target:new THREE.Vector3(),dist:PHONE?13:15,pitch:.75,yaw:0};
function placeCamera(){
 // The angle never changes near a wall: the camera may go past it (it fades), only never under the floor.
 const h=Math.cos(cam.pitch)*cam.dist;
 camera.position.set(cam.target.x+Math.sin(cam.yaw)*h,cam.target.y+Math.sin(cam.pitch)*cam.dist,cam.target.z+Math.cos(cam.yaw)*h);camera.lookAt(cam.target);
}
function clampTarget(){const b=worldBottom();cam.target.x=Math.min(WORLD.w*U,Math.max(0,cam.target.x));cam.target.z=Math.min(b*U,Math.max(3,cam.target.z));}
// The whole floor can be walked, to the back of the room, with tables or without.
function worldBottom(){return WORLD.h;}
// While choosing my look: me from the front, whole, centered in the space between the top bar and the
// sheet (the picture is shifted up so the sheet never covers me), the same on a phone or a computer.
// What the editor shows: the whole doll, the head (hair, face, hats, glasses), the clothes on top,
// the pants or the shoes; height and size in metres for a doll of normal height.
const LOOK_FOCUS={full:{y:1.12,h:2.6},head:{y:1.93,h:.72},neck:{y:1.66,h:.95},top:{y:1.42,h:1.15},legs:{y:.62,h:1.35},feet:{y:.18,h:.6}};
const FOCUS_OF={g:'full',s:'full',k:'full',w:'head',f:'head',h:'head',hc:'head',a:'head',e:'head',r:'head',ac:'head',n:'neck',o:'top',t:'top',q:'legs',p:'legs',y:'feet',z:'feet'};
const TAB_FOCUS={cuerpo:'full',pelo:'head',ropa:'top',accesorios:'head'};
function lookCamera(dt=.016){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 const sheetTop=$('sheet').hidden?H:$('sheet').getBoundingClientRect().top,top=document.querySelector('.top').getBoundingClientRect().bottom+8;
 const free=Math.max(140,sheetTop-top),center=(top+sheetTop)/2,tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
 camera.setViewOffset(W,H,0,H/2-center,W,H);
 const want=LOOK_FOCUS[state.lookFocus]||LOOK_FOCUS.full,k=Math.min(1,dt*6),scale=HEIGHTS[customLooks.get(state.me.uid)?.k??2]||1;
 const f=state.lookCam??={y:want.y,h:want.h};f.y+=(want.y*scale-f.y)*k;f.h+=(want.h*scale-f.h)*k;
 cam.target.copy(P(me.dx,me.dy,f.y));cam.pitch=state.lookFocus==='feet'?.3:.12;
 cam.dist=Math.min(16,Math.max(1.1,f.h*H/(2*tan*free*.9)/(state.lookZoom||1)));
}
const clock=new THREE.Clock();
if(LOCAL)Object.assign(globalThis,{barFrame:t=>frame(t),barDemo:()=>({lastWalkerPos,customLooks,actors,held,renderer,openPerson}),barState:state,barLobby:m=>onLobby(m),barEvent:m=>onBar(m),barPerf:()=>perf,barWalk:(x,y)=>walkTo(x,y),bar3d:{cam,views,scene,camera,THREE,stick,sitOn,sitOnStool:i=>sitOnStool(i),actors,get sitting(){return sitting;}}});
function frame(now){
 const raw=clock.getDelta(),dt=Math.min(LOCAL&&globalThis.barDtCap||.05,raw);adaptQuality(raw,now);
 for(const w of state.walkers.values())w.uid===state.me?.uid?moveMe(w,dt):moveOther(w,dt);
 const me=state.me&&state.walkers.get(state.me.uid);
 if(state.watching)watchCamera(dt,now);
 else if(me&&state.follow)cam.target.lerp(P(me.dx,me.dy,1.1),Math.min(1,dt*5));
 else if(state.watchCam)cam.target.lerp(P(state.watchCam.x,state.watchCam.y,1.1),Math.min(1,dt*3));
 if(state.editingLook)lookCamera(dt);
 if(now-(tickClock.at||0)>1000){tickClock.at=now;tickClock();}
 clampTarget();placeCamera();fadeWalls(dt);
 sun.position.set(cam.target.x+6,22,cam.target.z+14);sun.target.position.copy(cam.target);
 for(const slot of state.slots)drawSlot(slot,now,dt);
 updateActors(now,dt);drawWalkers(now,dt);drawMozo(now,dt);stepBarman(now,dt);stepFondo(now,dt);sweep();
 renderer.render(scene,camera);labels.render(scene,camera);
 if(me)sendMyStep(me,now);
 updateNear(now);tendCounter(now);tendArming();renderNet(now);if(state.joining)checkJoin();
 if(!MANUAL)requestAnimationFrame(frame);
}

// ---------- input: tap to walk or pick a table, drag to look around, pinch or wheel to zoom ----------
const ray=new THREE.Raycaster(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
function toWorld(sx,sy,height=0){
 ray.setFromCamera(new THREE.Vector2(sx/W*2-1,-(sy/H)*2+1),camera);
 const hit=new THREE.Vector3();if(!ray.ray.intersectPlane(height?new THREE.Plane(new THREE.Vector3(0,1,0),-height):groundPlane,hit))return null;return {x:hit.x/U,y:hit.z/U,v:hit};
}
// ---------- watching a game from above ----------
// Near a table in play, "Mirar la partida" (or tapping the table) turns the camera to look down on it:
// the cards, the scorer and what the players shout, bigger. Walking, tapping elsewhere or the button ends it.
function startWatching(slot){
 if(state.watching===slot)return;state.watchBefore??={pitch:cam.pitch,dist:cam.dist};
 state.watching=slot;state.watchEase=1.4;state.follow=false;document.body.classList.add('watching');$('watch-score').hidden=false;tendCounter.at=0;
}
function stopWatching(){
 if(!state.watching)return;state.watching=null;document.body.classList.remove('watching');$('watch-score').hidden=true;
 const b=state.watchBefore;state.watchBefore=null;if(b){cam.pitch=b.pitch;cam.dist=b.dist;}state.follow=true;tendCounter.at=0;
}
function watchCamera(dt,now){
 const slot=state.watching,t=slot&&tableOf(slot.code);
 if(!t?.live||!state.slots.includes(slot)){stopWatching();return;}
 cam.target.lerp(P(slot.x,slot.y,TABLE_H),Math.min(1,dt*4));
 // The score, big at the top: each side's names and points, and to how many.
 const L=t.live,two=slot.kind==='2v2',nm=seat=>esc(L.players?.[seat]?.name||'');
 const html=`<span>${two?nm('player1')+' y '+nm('player3'):nm('player1')}</span><b>${Number(L.scores?.player1)||0}</b><i>–</i><b>${Number(L.scores?.player2)||0}</b><span>${two?nm('player2')+' y '+nm('player4'):nm('player2')}</span><small>${L.finished?'Terminó':'a '+(Number(L.targetPoints)||30)}</small>`;
 if($('watch-score').dataset.html!==html){$('watch-score').innerHTML=html;$('watch-score').dataset.html=html;}
 // Easing in at first; after that the drag and the zoom are mine.
 if(state.watchEase>0){state.watchEase-=dt;const k=Math.min(1,dt*4);cam.pitch+=(1.0-cam.pitch)*k;cam.dist+=((slot.kind==='2v2'?7.2:6.2)-cam.dist)*k;}
}
function zoomBy(factor){if(state.editingLook){state.lookZoom=Math.min(3.5,Math.max(.6,(state.lookZoom||1)*factor));return;}cam.dist=Math.min(34,Math.max(3,cam.dist/factor));}
const pointers=new Map();let drag=null,pinch=null;
canvas.addEventListener('pointerdown',e=>{
 try{canvas.setPointerCapture(e.pointerId);}catch{}
 pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};drag=null;}
 else drag={x:e.clientX,y:e.clientY,lx:e.clientX,ly:e.clientY,moved:false};
});
canvas.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);zoomBy(d/pinch.d);pinch.d=d;return;}
 if(drag){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8)drag.moved=true;
  // Dragging turns the view around me; the joystick then walks toward where I look.
  if(drag.moved){state.watchEase=0;cam.yaw-=(e.clientX-drag.lx)*.0065;cam.pitch=Math.min(1.3,Math.max(.06,cam.pitch+(e.clientY-drag.ly)*.0045));if(!state.watchCam)state.follow=true;$('hint').hidden=true;}
  drag.lx=e.clientX;drag.ly=e.clientY;}
});
const up=e=>{
 pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
 if(drag&&!drag.moved&&pointers.size===0)tap(e.clientX,e.clientY);
 if(pointers.size===0)drag=null;
};
canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);drag=null;pinch=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY<0?1.12:1/1.12);},{passive:false});
$('zoom-in').onclick=()=>zoomBy(1.25);$('zoom-out').onclick=()=>zoomBy(1/1.25);
function tap(sx,sy){
 const p=toWorld(sx,sy);closeSheet();if(!p)return;
 if(state.watching){const sl=state.watching;if(Math.abs(sl.x-p.x)<(sl.kind==='2v2'?140:100)&&Math.abs(sl.y-p.y)<(sl.kind==='2v2'?140:125))return;stopWatching();}
 ray.setFromCamera(new THREE.Vector2(sx/W*2-1,-(sy/H)*2+1),camera);if(ray.intersectObject(boardMesh).length){openBoard();return;}
 const walker=[...state.walkers.values()].find(w=>w.uid!==state.me?.uid&&Math.hypot(w.dx-p.x,w.dy-p.y)<34);
 if(walker){openPerson(walker);return;}
 const slot=state.slots.find(s=>s.placed&&Math.abs(s.x-p.x)<(s.kind==='2v2'?140:100)&&Math.abs(s.y-p.y)<(s.kind==='2v2'?140:125));
 if(slot){
  const t=slot.code?tableOf(slot.code):null,people=t?(t.live?.players||t.room?.players||{}):{};
  // A table with room: walk to the free chair nearest to where you tapped and sit down.
  const armer=!t?armerOf(slot):null;
  if(armer&&armer.uid!==state.me?.uid){toast(armer.name+' está armando esta mesa. Esperá un momento.');return;}
  if(!t?.live){const free=Object.entries(SEATS[slot.kind]).filter(([seat])=>!people[seat]?.uid).sort((a,b)=>Math.hypot(slot.x+a[1][0]-p.x,slot.y+a[1][1]-p.y)-Math.hypot(slot.x+b[1][0]-p.x,slot.y+b[1][1]-p.y));
   if(free.length){sitOn(slot,free[0][0]);return;}}
  const off=slot.kind==='2v2'?170:130;walkTo(slot.x+(p.x<slot.x?-off:off),slot.y);openTable(slot);return;
 }
 // A stool at the counter (tapped on it): the nearest free one. Tapping the floor by the counter walks there (to lean on it).
{const top=toWorld(sx,sy,SEAT_H);if(top&&top.y>180&&top.y<262){const i=Math.round((top.x-90)/90);if(i>=0&&i<STOOLS&&Math.abs(90+i*90-top.x)<32&&(sitting?.stool===i||!stoolByWalker(i))&&![...actors.values()].some(a=>a.goal?.key==='stool:'+i)){sitOnStool(i);return;}}}
 if(p.y<255){const free=[...Array(STOOLS).keys()].filter(i=>!stoolByWalker(i)||sitting?.stool===i).filter(i=>![...actors.values()].some(a=>a.goal?.key==='stool:'+i)).sort((a,b)=>Math.abs(90+a*90-p.x)-Math.abs(90+b*90-p.x));
  if(free.length&&Math.abs(90+free[0]*90-p.x)<40){sitOnStool(free[0]);return;}}
 walkTo(p.x,p.y);
}

// ---------- sheets: sit at a table, or someone in the bar ----------
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let onSheetClose=null;
// While a sheet is open, the buttons at the bottom ("Pedir", "Dejar", "Reportar problema") step aside.
function closeSheet(){$('sheet').hidden=true;$('sheet').innerHTML='';document.body.classList.remove('sheet-open');const undo=onSheetClose;onSheetClose=null;undo?.();}
function sheet(html){onSheetClose=null;const s=$('sheet');s.innerHTML=html;s.hidden=false;document.body.classList.add('sheet-open');return s;}
function openTable(slot){
 const t=slot.code?tableOf(slot.code):null,mode=slot.kind==='2v2'?'2 vs 2':'1 vs 1';
 if(!t&&sitting?.slot===slot&&sitting.phase==='seated'){closeSheet();startArming(slot);return;}
 if(!t){
  let points=slot.p||20;
  const s=sheet(`<h3>Mesa libre · ${mode}</h3><p class="sub">${slot.p?'Te sentás y esperás rival. Se juega a '+slot.p+' puntos.':'Te sentás y esperás rival. Elegí a cuántos puntos:'}</p>
   ${slot.p?'':`<div class="points">${[10,20,30,40].map(n=>`<button type="button" data-p="${n}" aria-pressed="${n===20}">${n}</button>`).join('')}</div>`}
   <div class="row"><button class="btn ghost" data-close>Cancelar</button><button class="btn" data-sit>Sentarme</button></div>`);
  s.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{points=Number(b.dataset.p);s.querySelectorAll('[data-p]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));});
  s.querySelector('[data-sit]').onclick=()=>{if(!state.slots.includes(slot)||slot.leaving){closeSheet();toast('Esa mesa ya no está. Elegí otra.');return;}if(slot.code){openTable(slot);return;}location.href='/?crear='+slot.kind+'&puntos='+points;};
  s.querySelector('[data-close]').onclick=closeSheet;return;
 }
 const players=Object.values((t.live||t.room).players||{}).filter(p=>p?.uid),names=players.map(p=>esc(p.name)).join(', ');
 if(t.live){closeSheet();startWatching(slot);return;}
 const mine=players.some(p=>p.uid===state.me?.uid),pts=t.room.targetPoints||20;
 const s=sheet(`<h3>${mine?'Tu mesa':'Mesa de '+esc(players[0]?.name||'alguien')}</h3><p class="sub">${mode} · a ${pts} puntos${t.room.creditMatch?.hasPassword?' · con contraseña':''}${players.length>1?'<br>Sentados: '+names:''}</p>
  <div class="row"><button class="btn ghost" data-close>Cancelar</button><button class="btn" data-sit>${mine?'Volver a la mesa':'Sentarme y jugar'}</button></div>`);
 s.querySelector('[data-sit]').onclick=()=>{location.href='/?mesa='+encodeURIComponent(t.code);};
 s.querySelector('[data-close]').onclick=closeSheet;
}
function openPerson(w){
 const muted=state.muted.has(w.uid);let points=20;
 const s=sheet(`<h3>${esc(w.name)}</h3><p class="sub">Está en el bar. ¿Le proponés un 1 vs 1? Elegí a cuántos puntos:</p>
  <div class="points">${[10,20,30,40].map(n=>`<button type="button" data-p="${n}" aria-pressed="${n===20}">${n}</button>`).join('')}</div>
  <div class="row"><button class="btn ghost" data-mute>${muted?'Volver a escuchar':'Silenciar'}</button><button class="btn ghost" data-report>Reportar</button><button class="btn ghost" data-close>Cerrar</button><button class="btn" data-invite>Jugamos un 1 vs 1</button></div>`);
 s.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{points=Number(b.dataset.p);s.querySelectorAll('[data-p]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));});
 s.querySelector('[data-invite]').onclick=()=>invite(w,points);
 s.querySelector('[data-close]').onclick=closeSheet;
 s.querySelector('[data-mute]').onclick=()=>{muted?state.muted.delete(w.uid):state.muted.add(w.uid);closeSheet();toast(muted?'Lo volvés a escuchar.':'No vas a ver lo que escriba.');};
 s.querySelector('[data-report]').onclick=()=>{const last=state.chat.filter(m=>m.uid===w.uid).slice(-3).map(m=>m.text).join(' / ');bar?.send({t:'report',uid:w.uid,name:w.name,text:last});state.muted.add(w.uid);closeSheet();toast('Gracias. Lo revisamos y no vas a ver más lo que escriba.');};
}
let toastTimer=null;
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,3500);}

// ---------- nearby chat ----------
// Behind the counter (the staff only) the reach is twice as far, as on the server (bar-core.js reachOf).
const reachOf=w=>w?.staff&&w.dy<COUNTER_FRONT-6?HEAR_RADIUS*2:HEAR_RADIUS;
function nearby(){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return [];
 return [...state.walkers.values()].filter(w=>w.uid!==me.uid&&Math.hypot(w.dx-me.dx,w.dy-me.dy)<=Math.max(reachOf(me),reachOf(w)));
}
function updateNear(now){
 if(now-(updateNear.at||0)<250)return;updateNear.at=now;
 const near=nearby(),ids=near.map(w=>w.uid).sort().join(',');
 if(near.length)state.lastNearAt=now;
 const show=near.length>0||now-state.lastNearAt<4000||!!state.chatOpen;
 $('chat').hidden=!show;if(show)state.unread=0;document.body.classList.toggle('with-chat',show);
 const btn=$('chat-open');btn.hidden=show||!state.chat.length;btn.textContent='💬'+(state.unread?' '+state.unread:'');
 if(ids!==state.nearIds){state.nearIds=ids;$('chat-who').textContent=near.length?'Cerca: '+near.map(w=>w.name).join(', '):'No hay nadie cerca';}
}
function renderChat(){
 const log=$('chat-log');log.innerHTML=state.chat.map(m=>m.note?`<li class="note">${esc(m.text)}</li>`:`<li class="${m.uid===state.me?.uid?'me':''}${m.mention?' mention':''}"><b>${esc(m.name)}:</b> ${esc(m.text)}</li>`).join('');
 log.scrollTop=log.scrollHeight;
}
$('chat-form').addEventListener('submit',e=>{
 e.preventDefault();const input=$('chat-input'),text=input.value.trim();if(!text)return;
 if(!nearby().length){toast('No hay nadie cerca para escucharte.');return;}
 bar?.send({t:'say',text});input.value='';
});
$('chat-input').addEventListener('pointerdown',e=>e.stopPropagation());

// ---------- the board: the best players, written in chalk ----------
// Three lists of 10: most wins ever, most wins this week (Monday to Monday) and highest level.
// When the lists change, the waiter goes behind the counter, wipes the board and writes it again.
const BOARD_W=2048,BOARD_H=Math.round(2048*(BOARD.y1-BOARD.y0)/((BOARD.x1-BOARD.x0)*U));
const boardCanvas=document.createElement('canvas');boardCanvas.width=BOARD_W;boardCanvas.height=BOARD_H;
const boardTex=new THREE.CanvasTexture(boardCanvas);boardTex.colorSpace=THREE.SRGBColorSpace;boardTex.anisotropy=8;
const boardMat=new THREE.MeshBasicMaterial({map:boardTex});wallMats.push(boardMat);
const boardMesh=new THREE.Mesh(new THREE.PlaneGeometry((BOARD.x1-BOARD.x0)*U,BOARD.y1-BOARD.y0),boardMat);
boardMesh.position.set((BOARD.x0+BOARD.x1)/2*U,(BOARD.y0+BOARD.y1)/2,.03);scene.add(boardMesh);
{const w=(BOARD.x1-BOARD.x0)*U,h=BOARD.y1-BOARD.y0,cx=(BOARD.x0+BOARD.x1)/2*U,cy=(BOARD.y0+BOARD.y1)/2,f=.09;
 scene.add(box(w+f*2,f,.08,wallMats[1],cx,BOARD.y1+f/2,.04),box(w+f*2,f,.08,wallMats[1],cx,BOARD.y0-f/2,.04),box(f,h,.08,wallMats[1],cx-w/2-f/2,cy,.04),box(f,h,.08,wallMats[1],cx+w/2+f/2,cy,.04));
 scene.add(box(w*.9,.04,.12,wallMats[1],cx,BOARD.y0-.1,.08));}
const BOARD_COLS=[{key:'week',title:'VICTORIAS ESTA SEMANA',name:'Victorias esta semana',unit:''},{key:'level',title:'NIVEL MÁS ALTO',name:'Nivel más alto',unit:'Nv '}];
state.board={shown:null,pending:null,wipeX:null,writeX:null};
const boardU=x=>(x-BOARD.x0)/(BOARD.x1-BOARD.x0)*BOARD_W;
// Old chalk wiped with a cloth leaves a light haze.
function chalkHaze(g,from,to){
 g.fillStyle='#21402f';g.fillRect(from,0,to-from,BOARD_H);
 g.save();g.beginPath();g.rect(from,0,to-from,BOARD_H);g.clip();g.strokeStyle='rgba(225,235,225,.07)';g.lineWidth=46;
 for(let i=0;i<14;i++){const y=BOARD_H*(i+.5)/14;g.beginPath();for(let x=from-40;x<=to+40;x+=60)g.lineTo(x,y+Math.sin(x/90+i)*26);g.stroke();}
 g.restore();
}
function chalkLists(g,data){
 g.fillStyle='#21402f';g.fillRect(0,0,BOARD_W,BOARD_H);
 const colW=BOARD_W/BOARD_COLS.length,rowH=(BOARD_H-150)/10;
 g.textBaseline='middle';
 g.font='900 52px "DM Sans",sans-serif';g.fillStyle='rgba(255,226,140,.95)';g.textAlign='center';g.fillText('LOS MEJORES DEL BAR',BOARD_W/2,42);
 BOARD_COLS.forEach((c,ci)=>{
  // Each list is a narrow block in the middle of its half: the number stays next to the name.
  const blockW=Math.min(colW-80,600),x0=ci*colW+(colW-blockW)/2,x1=x0+blockW;
  g.font='800 38px "DM Sans",sans-serif';g.fillStyle='rgba(255,226,140,.9)';g.textAlign='center';g.fillText(c.title,(x0+x1)/2,108);
  if(ci){g.fillStyle='rgba(235,240,230,.25)';g.fillRect(ci*colW-2,80,4,BOARD_H-100);}
  const rows=data?.[c.key]||[];
  if(!rows.length){g.font='500 34px "DM Sans",sans-serif';g.fillStyle='rgba(235,240,230,.55)';g.textAlign='center';g.fillText(data?'Todavía nadie':'…',(x0+x1)/2,150+rowH*1.5);}
  rows.slice(0,10).forEach((r,i)=>{const y=150+rowH*(i+.5);
   g.font='700 36px "DM Sans",sans-serif';g.fillStyle='rgba(240,244,236,.92)';g.textAlign='left';g.fillText((i+1)+'.',x0,y);
   const name=r.name.length>22?r.name.slice(0,21)+'…':r.name;g.font='600 36px "DM Sans",sans-serif';g.fillText(name,x0+62,y,blockW-62-120);
   g.textAlign='right';g.font='800 36px "DM Sans",sans-serif';g.fillStyle='rgba(255,236,170,.95)';g.fillText(c.unit+r.n,x1,y);});
 });
 // A little chalk dust over everything.
 g.fillStyle='rgba(235,240,230,.035)';for(let i=0;i<220;i++)g.fillRect((i*733)%BOARD_W,(i*397)%BOARD_H,3+(i%5),2);
}
let boardDrawn='';
const boardTmp=document.createElement('canvas');boardTmp.width=BOARD_W;boardTmp.height=BOARD_H;
function drawBoard(){
 const b=state.board,key=JSON.stringify([b.shown,b.wipeX!=null?Math.round(b.wipeX/4):null,b.writeX!=null?Math.round(b.writeX/4):null]);
 if(key===boardDrawn)return;boardDrawn=key;
 const g=boardCanvas.getContext('2d');
 if(b.writeX!=null){chalkHaze(g,0,BOARD_W);const at=Math.max(0,Math.min(BOARD_W,boardU(b.writeX)));
  if(at>0){chalkLists(boardTmp.getContext('2d'),b.shown);g.drawImage(boardTmp,0,0,at,BOARD_H,0,0,at,BOARD_H);}}
 else{chalkLists(g,b.shown);if(b.wipeX!=null){const at=Math.max(0,Math.min(BOARD_W,boardU(b.wipeX)));chalkHaze(g,at,BOARD_W);}}
 boardTex.needsUpdate=true;
}
drawBoard();
document.fonts?.ready.then(()=>{boardDrawn='';drawBoard();});
function onBoard(board){
 const b=state.board;
 if(JSON.stringify(board)===JSON.stringify(b.pending??b.shown))return;
 // The first time it is already written; later the waiter comes to rewrite it.
 if(!b.shown&&!b.pending&&state.mozo?.type!=='board'){b.shown=board;drawBoard();return;}
 b.pending=board;
 if(state.mozo?.type!=='board'&&!state.trips.some(t=>t.type==='board'))state.trips.push({type:'board'});
}
// The waiter: from the door around the end of the counter, behind it to the board's right end;
// wipes it walking to the left, writes it walking back to the right, and leaves.
const BOARD_PASS=1430;
function boardTrip(m,b,now,dt){
 const L=BOARD.x0+28,R=BOARD.x1-28,Y=BOARD.stand,bd=state.board;b.ghost=true;
 const go=p=>{const dx=p.x-b.dx,dy=p.y-b.dy,d=Math.hypot(dx,dy);if(d<8)return true;const v=Math.min(NPC_SPEED,d*3+20);physics(b,{x:dx/d*v,y:dy/d*v},dt);return false;};
 m.reach=null;m.shuffle=undefined;
 if(m.phase==='go'){m.legs??=[{x:BOARD_PASS,y:300},{x:BOARD_PASS,y:Y},{x:R,y:Y}];if(go(m.legs[0])){m.legs.shift();if(!m.legs.length)m.phase='turn';}}
 else if(m.phase==='turn'){physics(b,{x:0,y:0},dt);if(turnToward(b,Math.PI,dt)<.1){m.phase='wipe';bd.wipeX=b.dx;}}
 else if(m.phase==='wipe'||m.phase==='write'){
  const wiping=m.phase==='wipe',speed=wiping?150:105;b.vx=b.vy=0;b.heading=Math.PI;
  b.dx+=(wiping?-1:1)*speed*dt;m.reach=wiping?'erase':'write';m.shuffle=40;
  if(wiping){bd.wipeX=b.dx-10;if(b.dx<=L){b.dx=L;m.phase='write';bd.wipeX=null;if(bd.pending){bd.shown=bd.pending;bd.pending=null;}bd.writeX=L-30;}}
  else{bd.writeX=b.dx+30;if(b.dx>=R){b.dx=R;bd.writeX=null;m.phase='back';m.legs=[{x:BOARD_PASS,y:Y},{x:BOARD_PASS,y:300},{x:DOOR.x,y:DOOR.y}];}}
  drawBoard();
 }
 else if(m.phase==='back'){if(go(m.legs[0])){m.legs.shift();if(!m.legs.length){state.mozo=null;mozoBody=null;
  // Changed again meanwhile: another trip.
  if(bd.pending&&!state.trips.some(t=>t.type==='board'))state.trips.push({type:'board'});syncSlots(false);return null;}}}
 return {b,carrying:false,reach:m.reach,shuffle:m.shuffle};
}
function openBoard(){
 const d=state.board.shown;
 const list=(rows,unit)=>rows?.length?`<ol class="board-list">${rows.map(r=>`<li><span>${esc(r.name)}</span><b>${unit}${r.n}</b></li>`).join('')}</ol>`:'<p class="sub">Todavía nadie.</p>';
 const s=sheet(`<h3>Los mejores del bar</h3>
  <div class="board-cols">${BOARD_COLS.map(c=>`<div><h4>${c.name}</h4>${d?list(d[c.key],c.unit):'<p class="sub">Cargando…</p>'}</div>`).join('')}</div>
  <p class="sub" style="color:#a9bbb0">La semana va de lunes a lunes.</p><div class="row"><button class="btn" data-close>Cerrar</button></div>`);
 s.querySelector('[data-close]').onclick=closeSheet;
}

// ---------- the barman: always behind the counter, serves what people order ----------
// Sitting on a stool or leaning on the counter, "Pedir" opens the menu. The order goes to everyone
// (server: bar-core.js acceptOrder): the barman walks to that spot behind the counter and leaves it.
// A drink goes to the hand and is carried around; food stays on the counter while its owner is there.
const COUNTER_TOP=1.37,BARMAN_HOME={x:640,y:84};
const BAR_MENU=[['refresco','Refresco','🥤'],['cafe','Café','☕'],['agua','Agua','💧'],['cerveza','Cerveza','🍺'],['vino','Vino','🍷'],['hamburguesa','Hamburguesa','🍔'],['papas','Papas fritas','🍟'],['ensalada','Ensalada','🥗']];
const DRINK_SET=new Set(['refresco','cafe','agua','cerveza','vino']);
const held=new Map(),foods=new Map();
const barman={body:{uid:'barman',dx:BARMAN_HOME.x,dy:BARMAN_HOME.y,vx:0,vy:0,heading:0,ghost:true},queue:[],job:null,idleAt:0};
function itemMesh(kind){
 const g=new THREE.Group(),plate=()=>g.add(part(geo('plate',()=>new THREE.CylinderGeometry(.17,.15,.02,24)),M('#f4f1ea',{roughness:.4}),{y:.01}));
 const glass=(r,h,mat,y=0)=>part(geo('glass'+r+h,()=>new THREE.CylinderGeometry(r,r*.85,h,18)),mat,{y:y+h/2});
 if(kind==='refresco'){g.add(glass(.05,.16,M('#b3202a',{roughness:.3})),part(capsule(.006,.12),M('#f4f1ea'),{x:.02,y:.2,rz:.2}));}
 else if(kind==='cafe'){g.add(glass(.05,.1,M('#f4f1ea',{roughness:.35})),part(geo('coffee',()=>new THREE.CircleGeometry(.045,16)),M('#3b2412'),{y:.101,rx:-Math.PI/2}),part(ring(.03,.008),M('#f4f1ea'),{x:.055,y:.05,ry:Math.PI/2}));}
 else if(kind==='agua'){g.add(glass(.05,.15,M('#bfe3ff',{transparent:true,opacity:.55,roughness:.1})),part(geo('water',()=>new THREE.CylinderGeometry(.044,.04,.1,16)),M('#7fc4ff',{transparent:true,opacity:.6}),{y:.055}));}
 else if(kind==='cerveza'){g.add(glass(.055,.17,M('#d99a1e',{transparent:true,opacity:.9,roughness:.2})),part(geo('foam',()=>new THREE.CylinderGeometry(.056,.056,.035,18)),M('#fbf6e8',{roughness:.9}),{y:.185}));}
 else if(kind==='vino'){const wine=M('#5e0f1f',{roughness:.2}),stem=M('#e6eef2',{transparent:true,opacity:.7,roughness:.1});
  g.add(part(geo('wbase',()=>new THREE.CylinderGeometry(.04,.045,.008,18)),stem,{y:.004}),part(capsule(.007,.09),stem,{y:.06}),part(G.sphere,wine,{y:.15,sx:.055,sy:.05,sz:.055}),part(dome(.5),stem,{y:.15,sx:.058,sy:.06,sz:.058}));}
 else if(kind==='hamburguesa'){plate();const bun=M('#c98a3e',{roughness:.7});
  g.add(part(geo('bunb',()=>new THREE.CylinderGeometry(.08,.075,.03,20)),bun,{y:.035}),part(geo('patty',()=>new THREE.CylinderGeometry(.085,.085,.025,20)),M('#5a3320'),{y:.06}),
   part(geo('lettuce',()=>new THREE.CylinderGeometry(.09,.09,.008,20)),M('#5aa33c'),{y:.077}),part(geo('cheese',()=>new THREE.BoxGeometry(.13,.006,.13)),M('#f2c94c'),{y:.083,ry:.4}),part(dome(.5),bun,{y:.085,sx:.08,sy:.06,sz:.08}));}
 else if(kind==='papas'){plate();g.add(part(G.box,M('#c0302b'),{y:.06,sx:.11,sy:.1,sz:.07}));
  for(let i=0;i<7;i++)g.add(part(G.box,M('#f2c94c',{roughness:.8}),{x:-.04+i*.013,y:.13+(i%3)*.01,z:(i%2)*.012-.006,sx:.012,sy:.08,sz:.012,rz:(i-3)*.06}));}
 else if(kind==='ensalada'){plate();g.add(part(dome(.5),M('#f4f1ea',{side:THREE.DoubleSide}),{y:.08,sx:.11,sy:-.07,sz:.11}));
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;g.add(part(G.sphere,M(i%3?'#5aa33c':'#c0302b'),{x:Math.cos(a)*.05,y:.085,z:Math.sin(a)*.05,sx:.03,sy:.02,sz:.03}));}}
 g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
 return g;
}
// At the counter: on a stool, or standing against its front (where one leans on it).
function atCounter(w,isMe){
 if(!w)return false;
 if(isMe?sitting?.stool!=null&&sitting.phase==='seated':w.ts&&Math.abs((w.ty??w.y)-222)<25)return true;
 return !(w.sit>0)&&w.dy<COUNTER_FRONT+BODY+45&&w.dx<WORLD.w-235;
}
function onOrder(m){
 barman.queue.push({uid:m.uid,item:m.item,x:Number(m.x)||BARMAN_HOME.x});
 if(m.uid===state.me?.uid)toast((BAR_MENU.find(([k])=>k===m.item)?.[1]||'Tu pedido')+' en camino.');
}
function deliver(j){
 if(!state.walkers.has(j.uid))return;
 if(DRINK_SET.has(j.item)){held.set(j.uid,j.item);return;}
 setFood(j.uid,j.item,j.x);
}
// On the counter: someone's food (key uid) and a drink they left there (key uid|left), a little to the side.
function setFood(key,item,x){
 const old=foods.get(key);if(old)scene.remove(old.mesh);
 const at=Math.max(60,Math.min(WORLD.w-260,x+(key.endsWith('|left')?42:0)));
 const mesh=itemMesh(item);mesh.position.set(at*U,COUNTER_TOP,178*U);scene.add(mesh);foods.set(key,{item,x,mesh});
}
function dropFood(uid){const f=foods.get(uid);if(!f)return;scene.remove(f.mesh);foods.delete(uid);}
function stepBarman(now,dt){
 const b=barman.body;
 const go=p=>{const dx=p.x-b.dx,dy=p.y-b.dy,d=Math.hypot(dx,dy);if(d<8)return true;const v=Math.min(NPC_SPEED,d*3+20);physics(b,{x:dx/d*v,y:dy/d*v},dt);return false;};
 const stay=()=>{physics(b,{x:0,y:0},dt);turnToward(b,0,dt);};
 if(!barman.job&&barman.queue.length)barman.job={...barman.queue.shift(),phase:'go'};
 const j=barman.job;let gesture=null;
 if(j){const X=Math.max(60,Math.min(WORLD.w-260,j.x));
  if(j.phase==='go'){if(go({x:X,y:BARMAN_HOME.y})){j.phase='place';j.until=now+650;gesture={kind:'throw',start:now,dur:620};}}
  else{stay();if(now>=j.until){deliver(j);barman.job=null;barman.idleAt=now;}}}
 else if(now-barman.idleAt>9000){if(go(BARMAN_HOME))stay();}
 else stay();
 const v=view('barman',()=>{const person=buildPerson({skin:'#a8704a',hair:'#1f1a17',style:'curly',face:''},{waiter:true});return {person,labels:[]};});
 if(gesture)v.person.gesture=gesture;
 v.person.root.position.copy(P(b.dx,b.dy));v.person.root.rotation.y=b.heading||0;
 animate(v.person,{speed:Math.hypot(b.vx,b.vy),accel:b.accel||0,turn:b.turnRate||0,dt,now});
}
// Food stays only while its owner is at the counter; I put it down for everyone when I leave.
function tendCounter(now){
 if(now-(tendCounter.at||0)<500)return;tendCounter.at=now;
 const me=state.me&&state.walkers.get(state.me.uid),here=atCounter(me,true);
 // At the counter: "Pedir", and "Dejar" when something is in my hand.
 $('counter').hidden=!here||!!state.editingLook;
 // Right by the sign: "Reportar problema" at the bottom of the screen, like "Pedir" at the counter.
 $('report-near').hidden=!(me&&Math.hypot(me.dx-SIGN.x,me.dy-SIGN.y)<200&&!state.editingLook);
 $('ask-table').hidden=!(nearFondo(me)&&!state.editingLook&&!sitting);
 const live=!sitting&&me&&!state.editingLook?state.slots.find(sl=>sl.placed&&tableOf(sl.code)?.live&&Math.hypot(me.dx-sl.x,me.dy-sl.y)<HEAR_RADIUS+TABLE_REACH+40):null;
 $('watch').hidden=!(state.watching||live);$('watch').textContent=state.watching?'✕ Dejar de mirar':'👀 Mirar la partida';$('watch').dataset.cell=live?.cell??'';$('leave').hidden=!held.has(state.me?.uid);
 for(const [key,f] of [...foods]){const uid=key.split('|')[0],w=state.walkers.get(uid),mine=uid===state.me?.uid;
  if(!w||!atCounter(w,mine)||Math.abs(w.dx-f.x)>160){dropFood(key);if(mine)bar?.send({t:'drop',what:key.endsWith('|left')?'left':'food'});}}
}
function openMenu(){
 const s=sheet(`<h3>¿Qué te sirvo?</h3>
  <div class="menu">${BAR_MENU.map(([k,l,e])=>`<button type="button" data-item="${k}"><span>${e}</span>${l}</button>`).join('')}</div>
  <div class="row"><button class="btn ghost" data-close>Cerrar</button></div>`);
 s.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{bar?.send({t:'order',item:b.dataset.item});closeSheet();});
 s.querySelector('[data-close]').onclick=closeSheet;
}
$('order').onclick=e=>{e.stopPropagation();openMenu();};
$('report-near').onclick=e=>{e.stopPropagation();openProblem();};
$('ask-table').onclick=e=>{e.stopPropagation();openTableOrder();};
$('watch').onclick=e=>{e.stopPropagation();if(state.watching){stopWatching();return;}const sl=state.slots.find(o=>String(o.cell)===$('watch').dataset.cell);if(sl)startWatching(sl);};
$('leave').onclick=e=>{e.stopPropagation();if(held.has(state.me?.uid))bar?.send({t:'leave'});};
// What someone holds: in the right hand, kept upright whatever the arm does.
function holdItem(person,item){
 if(person.heldKind===item)return;
 if(person.heldMesh){person.heldMesh.parent?.remove(person.heldMesh);person.heldMesh=null;}
 person.heldKind=item||null;if(!item)return;
 const m=itemMesh(item);m.position.set(0,-.43,.03);person.arms[1].elbow.add(m);person.heldMesh=m;
}

// ---------- a free table being set up ----------
// Seated at a free table, the points are chosen over it; the others see that it is being set up
// (and cannot sit there meanwhile). Standing up, or the table taken by someone else, ends it.
function armerOf(slot){
 if(state.arming?.slot===slot)return {uid:state.me?.uid,name:'Vos',points:state.arming.points};
 for(const w of state.walkers.values())if(w.uid!==state.me?.uid&&w.arm?.cell===slot.cell)return {uid:w.uid,name:w.name,points:w.arm.points};
 return null;
}
let armLabel=null;
function startArming(slot){
 const other=[...state.walkers.values()].find(w=>w.uid!==state.me?.uid&&w.arm?.cell===slot.cell);
 if(other){toast(other.name+' está armando esta mesa. Esperá un momento.');standUp();return;}
 state.arming={slot,points:slot.p||(state.arming?.slot===slot?state.arming.points:20)};bar?.send({t:'arming',cell:slot.cell,points:state.arming.points});
 armLabel??=label('arm-pick');renderArming();
}
function renderArming(){
 const a=state.arming;if(!a||!armLabel)return;const mode=a.slot.kind==='2v2'?'2 vs 2':'1 vs 1';
 armLabel.el.innerHTML=(a.slot.p?`<b>Mesa ${mode} · a ${a.slot.p} puntos</b>`:`<b>Mesa ${mode} · ¿a cuántos puntos?</b><div class="pts">${[10,20,30,40].map(n=>`<button type="button" data-p="${n}" aria-pressed="${n===a.points}">${n}</button>`).join('')}</div>`)+`<div class="go"><button type="button" data-x>Levantarme</button><button type="button" class="main" data-sit>Abrir la mesa</button></div>`;
 armLabel.el.querySelectorAll('[data-p]').forEach(b=>b.onclick=e=>{e.stopPropagation();a.points=Number(b.dataset.p);bar?.send({t:'arming',cell:a.slot.cell,points:a.points});renderArming();});
 armLabel.el.querySelector('[data-x]').onclick=e=>{e.stopPropagation();stopArming();standUp();};
 armLabel.el.querySelector('[data-sit]').onclick=e=>{e.stopPropagation();const slot=a.slot;
  if(!state.slots.includes(slot)||slot.leaving){stopArming();toast('Esa mesa ya no está. Elegí otra.');return;}
  if(slot.code){stopArming();openTable(slot);return;}
  location.href='/?crear='+slot.kind+'&puntos='+a.points;};
}
function stopArming(){if(!state.arming)return;state.arming=null;bar?.send({t:'arming',cell:null});if(armLabel){scene.remove(armLabel.o);armLabel.el.remove();armLabel=null;}}
function tendArming(){
 const a=state.arming;if(!a)return;
 if(!sitting||sitting.slot!==a.slot||sitting.phase==='up'||a.slot.code||!state.slots.includes(a.slot)){stopArming();return;}
 armLabel.o.position.copy(P(a.slot.x,a.slot.y,TABLE_H+1.5));
}

// ---------- invitations: "Jugamos un 1 vs 1" ----------
// The one invited accepts: the one who invited opens a table, and the other sits at it as soon as it appears.
function invite(w,points){
 if(state.inviting&&performance.now()-state.inviting.at<15000){toast('Esperá la respuesta de '+state.inviting.name+'.');return;}
 state.inviting={uid:w.uid,name:w.name,points,at:performance.now()};bar?.send({t:'invite',uid:w.uid,points});closeSheet();
 toast('Invitaste a '+w.name+'. Esperando que conteste…');
 setTimeout(()=>{if(state.inviting?.uid===w.uid&&!state.inviting.answered){state.inviting=null;toast(w.name+' no contestó.');}},45000);
}
function onInvited(m){
 if(state.muted.has(m.uid)){bar?.send({t:'invite-answer',uid:m.uid,yes:false});return;}
 const s=sheet(`<h3>${esc(m.name)} te invita</h3><p class="sub">Un 1 vs 1 a ${Number(m.points)||20} puntos. Si aceptás, abre la mesa y te sentás enseguida.</p>
  <div class="row"><button class="btn ghost" data-no>No, gracias</button><button class="btn" data-yes>Jugar</button></div>`);
 s.querySelector('[data-no]').onclick=()=>{bar?.send({t:'invite-answer',uid:m.uid,yes:false});closeSheet();};
 s.querySelector('[data-yes]').onclick=()=>{bar?.send({t:'invite-answer',uid:m.uid,yes:true});closeSheet();
  state.joining={uid:m.uid,name:m.name,until:performance.now()+90000};showWait('Esperando que '+m.name+' abra la mesa…');checkJoin();};
}
function onInviteAnswer(m){
 if(state.inviting?.uid!==m.uid)return;state.inviting.answered=true;
 if(!m.yes){state.inviting=null;toast(m.name+' no puede ahora.');return;}
 const points=state.inviting.points;toast('¡'+m.name+' aceptó! Abriendo la mesa…');
 setTimeout(()=>{location.href='/?crear=1v1&puntos='+points;},800);
}
function checkJoin(){
 const j=state.joining;if(!j)return;
 if(performance.now()>j.until){state.joining=null;showWait(null);toast(j.name+' no abrió la mesa.');return;}
 for(const [code,room] of Object.entries(state.rooms))if(room?.status==='waiting'&&room.mode!=='2v2'&&room.players?.player1?.uid===j.uid&&!room.players?.player2?.uid){state.joining=null;location.href='/?mesa='+encodeURIComponent(code);return;}
}
function showWait(text){$('wait').hidden=!text;if(text)$('wait-text').textContent=text;}
$('wait-cancel').onclick=()=>{state.joining=null;showWait(null);};

// ---------- gestures ----------
let gestureAt=0;
function doGesture(uid,g){
 const w=state.walkers.get(uid);if(!w||!EMOTES[g])return;const now=performance.now();
 w.gesture={kind:g,start:now,dur:g==='clap'||g==='party'?1700:1500};w.emote={text:EMOTES[g],until:now+1800};
}
// One button opens the four gestures; choosing one folds them back.
const foldEmotes=open=>{$('emote-list').hidden=!open;$('emote-toggle').setAttribute('aria-expanded',String(open));$('emote-toggle').textContent=open?'✕':'👋';};
$('emote-toggle').onclick=e=>{e.stopPropagation();foldEmotes($('emote-list').hidden);};
document.querySelectorAll('[data-g]').forEach(b=>b.onclick=e=>{e.stopPropagation();foldEmotes(false);const now=performance.now();if(now-gestureAt<1250||!state.me)return;gestureAt=now;bar?.send({t:'gesture',g:b.dataset.g});doGesture(state.me.uid,b.dataset.g);});

// ---------- my look ----------
// Four tabs (body, hair, clothes, accessories); every choice shows on me at once, the camera in front.
// Turn buttons go around me; "Al azar" picks everything. Nothing is kept until Guardar.
const HAIR_GROUPS=[['Cortos',[['short','Corto'],['buzz','Rapado'],['fade','Degradé'],['undercut','Undercut'],['sidepart','Raya al costado'],['quiff','Jopo'],['spiky','Paraditos'],['fringe','Flequillo'],['mohawk','Cresta'],['bald','Pelado']]],
 ['Despeinados y con ondas',[['messy','Despeinado'],['shortwavy','Ondas cortas'],['curly','Rulos'],['afro','Afro'],['shaggy','Desmechado'],['wavy','Ondulado'],['longcurly','Rulos largos'],['dreads','Rastas'],['mullet','Mullet']]],
 ['Largos y recogidos',[['long','Largo'],['bangs','Largo con flequillo'],['halfup','Semirecogido'],['bob','Melena'],['pixie','Pixie'],['ponytail','Colita'],['pigtails','Dos colitas'],['bun','Rodete'],['lowbun','Rodete bajo'],['manbun','Rodete chico'],['braid','Trenza'],['braids','Dos trenzas']]]];
const LOOK_CHOICES={
 g:[['m','Hombre'],['f','Mujer']],f:[['','Nada'],['tres','Barba corta'],['barba','Barba'],['larga','Barba larga'],['candado','Candado'],['chivita','Chivita'],['patillas','Patillas'],['bigote','Bigote'],['manubrio','Bigote manubrio']],
 h:HAIR_GROUPS.flatMap(([,list])=>list),
 o:[['remera','Remera'],['estampada','Remera estampada'],['cuellov','Cuello en V'],['mangalarga','Manga larga'],['raglan','Mangas en color'],['rayas','Rayada'],['camiseta','Camiseta'],['chomba','Chomba'],['camisa','Camisa'],['polera','Polera'],
  ['buzo','Buzo con capucha'],['buzocierre','Buzo con cierre'],['sueter','Suéter'],['campera','Campera'],['saco','Saco'],['musculosa','Musculosa'],['vestido','Vestido'],['pollera','Pollera']],
 q:[['jean','Jean'],['roto','Jean roto'],['chino','Pantalón'],['vestir','De vestir'],['cargo','Cargo'],['jogging','Jogging'],['bermuda','Bermuda'],['short','Short']],
 y:[['champion','Championes'],['running','Deportivos'],['alta','Botitas'],['alpargata','Alpargatas'],['zapato','Zapatos'],['mocasin','Mocasines'],['botin','Botines'],['bota','Botas']],
 a:[['','Nada'],['gorra','Gorra'],['atras','Gorra al revés'],['plana','Gorra inglesa'],['gorro','Gorro de lana'],['piluso','Piluso'],['bandana','Pañuelo'],['vincha','Vincha'],['boina','Boina'],['sombrero','Sombrero'],['panama','Panamá'],['bombin','Bombín'],['gaucho','Sombrero gaucho']],
 e:[['','Nada'],['lentes','Lentes'],['redondos','Redondos'],['gruesos','Gruesos'],['clubmaster','Clásicos'],['gatito','Ojo de gato'],['sol','De sol'],['solredondos','De sol redondos'],['aviador','Aviador'],['deportivos','Deportivos']],
 n:[['','Nada'],['bufanda','Bufanda'],['cadena','Cadena'],['perlas','Collar de perlas'],['medalla','Medalla']]};
const STEPS={k:['Más bajo','Bajo','Normal','Alto','Más alto'],w:['Muy delgada','Delgada','Normal','Redonda','Muy redonda']};
const HATS_WITH_COLOR=new Set(['gorra','atras','plana','gorro','piluso','bandana','vincha','boina','sombrero','panama','bombin','gaucho']);
let lookTab='cuerpo';
function openLookEditor(){
 const uid=state.me?.uid;if(!uid)return;
 const before=customLooks.get(uid)||null,look={...defaultLook(uid),...(before||{})};
 const camBefore={dist:cam.dist,pitch:cam.pitch,yaw:cam.yaw},me=state.walkers.get(uid);
 state.editingLook=true;state.lookFocus=TAB_FOCUS[lookTab]||'full';state.lookZoom=1;state.lookCam=null;document.body.classList.add('editing');
 if(me){state.follow=false;state.watchCam=null;cam.yaw=me.heading||0;}
 const back=()=>{Object.assign(cam,camBefore);state.follow=true;state.editingLook=false;document.body.classList.remove('editing');camera.clearViewOffset();};
 const undo=()=>{if(before)customLooks.set(uid,before);else customLooks.delete(uid);back();};
 const chips=(key,list)=>`<div class="chips">${list.map(([v,l])=>`<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${look[key]===v}">${l}</button>`).join('')}</div>`;
 const steps=key=>`<div class="chips">${STEPS[key].map((l,i)=>`<button type="button" data-k="${key}" data-n="${i}" aria-pressed="${(look[key]??2)===i}">${l}</button>`).join('')}</div>`;
 const colors=(key,list)=>`<div class="chips">${list.map((c,i)=>`<button type="button" class="sw" style="background:${c}" data-k="${key}" data-n="${i}" aria-pressed="${look[key]===i}" aria-label="Color ${i+1}"></button>`).join('')}</div>`;
 const group=(title,html)=>`<div class="grp"><span>${title}</span>${html}</div>`;
 const tabs={
  cuerpo:()=>group('Soy',chips('g',LOOK_CHOICES.g))+group('Altura',steps('k'))+group('Cara',steps('w'))+group('Piel',colors('s',SKINS))+(look.g==='m'?group('Barba y bigote',chips('f',LOOK_CHOICES.f)):''),
  pelo:()=>HAIR_GROUPS.map(([title,list])=>group(title,chips('h',list))).join('')+group('Color',colors('hc',HAIRS)),
  ropa:()=>group('Arriba',chips('o',LOOK_CHOICES.o))+group(look.o==='vestido'?'Color del vestido':'Color',colors('t',SHIRT_COLORS))
   +(look.o==='vestido'||look.o==='pollera'?'':group('Pantalón',chips('q',LOOK_CHOICES.q)))+(look.o==='vestido'?'':group(look.o==='pollera'?'Color de la pollera':'Color del pantalón',colors('p',PANTS)))
   +group('Calzado',chips('y',LOOK_CHOICES.y))+group('Color del calzado',colors('z',SHOES))
   +(['saco','raglan','estampada','chomba'].includes(look.o)||['running','champion','alta'].includes(look.y)?group(look.o==='saco'?'Color de la corbata':look.o==='raglan'?'Color de las mangas':look.o==='estampada'?'Color del estampado':look.o==='chomba'?'Color del logo':'Color de los detalles del calzado',colors('d',SHIRT_COLORS)):''),
  accesorios:()=>group('En la cabeza',chips('a',LOOK_CHOICES.a))+group('Ojos',chips('e',LOOK_CHOICES.e))+group('En el cuello',chips('n',LOOK_CHOICES.n))
   +group('Aros',`<div class="chips"><button type="button" data-ears aria-pressed="${look.r}">${look.r?'Con aros':'Sin aros'}</button></div>`)
   +(HATS_WITH_COLOR.has(look.a)||look.n==='bufanda'?group(look.n==='bufanda'&&!look.a?'Color de la bufanda':look.a?'Color del sombrero o gorro':'Color de la bufanda',colors('ac',SHIRT_COLORS)):'')};
 const TAB_NAMES={cuerpo:'Cuerpo',pelo:'Pelo',ropa:'Ropa',accesorios:'Accesorios'};
 const apply=()=>{if(look.g==='f')look.f='';customLooks.set(uid,{...look});};
 const draw=()=>{
  const scroll=document.querySelector('#sheet .look-ed')?.scrollTop||0;
  const s=sheet(`<div class="look-head"><h3>Tu muñeco</h3><div class="look-tools"><button type="button" data-turn="1" aria-label="Girar a la izquierda">⟲</button><button type="button" data-turn="-1" aria-label="Girar a la derecha">⟳</button><button type="button" data-random>🎲 Al azar</button></div></div>
   <div class="look-tabs" role="tablist">${Object.entries(TAB_NAMES).map(([k,l])=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${lookTab===k}">${l}</button>`).join('')}</div>
   <div class="look-ed">${tabs[lookTab]()}</div>
   <div class="row"><button class="btn ghost" data-cancel>Cancelar</button><button class="btn" data-save>Guardar</button></div>`);
  s.querySelector('.look-ed').scrollTop=scroll;
  s.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{lookTab=b.dataset.tab;state.lookFocus=TAB_FOCUS[lookTab];state.lookZoom=1;draw();s.querySelector('.look-ed').scrollTop=0;});
  s.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{const k=b.dataset.k;look[k]=b.dataset.n!=null?Number(b.dataset.n):b.dataset.v;state.lookFocus=k==='ac'&&!look.a?'neck':k==='d'?(['saco','raglan','estampada','chomba'].includes(look.o)?'top':'feet'):FOCUS_OF[k]||state.lookFocus;state.lookZoom=1;
   if(k==='g'&&look.g==='f'&&['short','bald','mohawk','buzz','fade','undercut','spiky','sidepart'].includes(look.h))look.h='long';apply();draw();});
  s.querySelector('[data-ears]')?.addEventListener('click',()=>{look.r=!look.r;apply();draw();});
  s.querySelectorAll('[data-turn]').forEach(b=>b.onclick=()=>{cam.yaw+=Number(b.dataset.turn)*Math.PI/2;});
  s.querySelector('[data-random]').onclick=()=>{const r=n=>Math.floor(Math.random()*n),one=list=>list[r(list.length)][0];
   look.g=one(LOOK_CHOICES.g);look.s=r(SKINS.length);look.h=one(LOOK_CHOICES.h);look.hc=r(HAIRS.length);look.t=r(SHIRT_COLORS.length);
   look.o=one(LOOK_CHOICES.o.filter(([v])=>look.g==='f'||(v!=='vestido'&&v!=='pollera')));look.p=r(PANTS.length);look.z=r(SHOES.length);look.q=one(LOOK_CHOICES.q);look.y=one(LOOK_CHOICES.y);look.k=r(5);look.w=r(5);
   look.a=Math.random()<.5?'':one(LOOK_CHOICES.a);look.e=Math.random()<.7?'':one(LOOK_CHOICES.e);look.n=Math.random()<.6?'':one(LOOK_CHOICES.n);
   look.ac=r(SHIRT_COLORS.length);look.d=r(SHIRT_COLORS.length);look.f=look.g==='m'&&Math.random()<.5?one(LOOK_CHOICES.f):'';look.r=Math.random()<(look.g==='f'?.6:.15);apply();draw();};
  s.querySelector('[data-cancel]').onclick=closeSheet;
  s.querySelector('[data-save]').onclick=()=>{onSheetClose=null;apply();bar?.send({t:'look',look:{...look}});closeSheet();back();toast('¡Listo! Así te ven todos en el bar.');};
  onSheetClose=undo;
 };
 apply();draw();
}
$('me-look').onclick=e=>{e.stopPropagation();openLookEditor();};

// ---------- nearby chat: mentions ----------
const plain=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function mentionsMe(text){
 const name=plain(state.me?.name).trim();if(name.length<3)return false;const t=plain(text);
 const parts=name.split(/[\s_.-]+/),words=[...new Set([name,...parts,...parts.map(p=>p.replace(/\d+$/,''))])].filter(w=>w.length>=3);
 return words.some(w=>new RegExp('(^|[^a-z0-9])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9])').test(t));
}
$('chat-open').onclick=e=>{e.stopPropagation();state.chatOpen=true;state.unread=0;updateNear.at=0;};
$('chat-close').onclick=e=>{e.stopPropagation();state.chatOpen=false;state.lastNearAt=0;updateNear.at=0;};

// ---------- the connection ----------
// A slow or lost connection says so, instead of showing an empty room.
const net={lobby:false,bar:false,badSince:0};
function renderNet(now){
 if(now-(renderNet.at||0)<400)return;renderNet.at=now;
 const el=$('net');if(!$('status').hidden){el.hidden=true;return;}
 const text=!net.bar||!net.lobby?'Reconectando… la conexión anda lenta.':!state.layout?'Cargando las mesas…':'';
 if(!text){net.badSince=0;el.hidden=true;return;}
 net.badSince||=now;if(now-net.badSince<1200)return;
 $('net-text').textContent=text;el.hidden=false;
}

// ---------- quality: lighter on slow phones ----------
// Slow for a few seconds: first fewer pixels, then no shadows. Fast again for a while: one step back.
const perf={avg:16,level:0,since:0};
function adaptQuality(raw,now){
 if(MANUAL||document.hidden||raw>=.2||raw<=0)return;perf.avg+=(raw*1000-perf.avg)*.05;
 if(now-perf.since<4000)return;
 if(perf.avg>26&&perf.level<2){perf.level++;perf.since=now;applyQuality();}
 else if(perf.avg<13&&perf.level>0&&now-perf.since>20000){perf.level--;perf.since=now;applyQuality();}
}
function applyQuality(){
 renderer.setPixelRatio(perf.level>=1?1:Math.min(devicePixelRatio||1,PHONE?1.5:2));resize();
 const shadows=perf.level<2;
 if(renderer.shadowMap.enabled!==shadows){renderer.shadowMap.enabled=shadows;sun.castShadow=shadows;
  scene.traverse(o=>{if(o.material)for(const m of [].concat(o.material))m.needsUpdate=true;});}
}

// ---------- the welcome sign at the back of the room, with "Reportar problema" ----------
// A chalk board on an easel: what the BAR is while it is tried. Near it, "Reportar problema" opens the same report
// box as the game; the report goes with the game's own (server: bar.js "problem", mode "bar").
// At the back of the room, past the last row tables can take (y 2110 plus chairs), facing the counter.
const SIGN={x:800,y:2330,turn:Math.PI},SIGN_LINES=[['Estamos probando este lobby virtual.',54,700],
 ['Puede tener fallas que iremos solucionando.',50,600],['El juego sigue funcionando como siempre.',50,600],['Acá también podés dejarnos reportes y sugerencias.',50,600]];
const signCanvas=document.createElement('canvas');signCanvas.width=900;signCanvas.height=1300;
const signTex=new THREE.CanvasTexture(signCanvas);signTex.colorSpace=THREE.SRGBColorSpace;signTex.anisotropy=8;
function drawSign(){
 const g=signCanvas.getContext('2d'),W=900,H=1300;
 g.fillStyle='#21402f';g.fillRect(0,0,W,H);
 g.fillStyle='rgba(235,240,230,.04)';for(let i=0;i<300;i++)g.fillRect((i*733)%W,(i*397)%H,3+(i%5),2);
 g.textAlign='center';g.textBaseline='alphabetic';
 g.fillStyle='rgba(255,226,140,.97)';g.font='900 82px "DM Sans",sans-serif';g.fillText('¡Hola jugadores!',W/2,140);
 g.strokeStyle='rgba(255,226,140,.6)';g.lineWidth=4;g.beginPath();g.moveTo(160,178);g.lineTo(740,178);g.stroke();
 // Lines as wide as fit; the last line never ends with one or two words alone (they move down).
 let y=272;
 for(const [text,size,weight] of SIGN_LINES){
  g.font=weight+' '+size+'px "DM Sans",sans-serif';g.fillStyle='rgba(240,244,236,.94)';
  const out=[];let line=[];for(const w of text.split(' ')){if(line.length&&g.measureText([...line,w].join(' ')).width>800){out.push(line);line=[w];}else line.push(w);}
  out.push(line);while(out.length>1&&out.at(-1).length<3&&out.at(-2).length>3)out.at(-1).unshift(out.at(-2).pop());
  for(const l of out){g.fillText(l.join(' '),W/2,y);y+=size*1.3;}y+=20;
 }
 g.fillStyle='rgba(255,226,140,.97)';g.font='900 70px "DM Sans",sans-serif';g.fillText('¡Gracias!',W/2,y+40);
 signTex.needsUpdate=true;
}
drawSign();document.fonts?.ready.then(drawSign);
(()=>{
 const w=1.8,h=w*1300/900,cy=.6+h/2,grp=new THREE.Group(),frame=M('#5a3820',{roughness:.7});
 const board=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:signTex}));board.position.set(0,cy,.035);grp.add(board);
 const bx=(a,b,d,x,y,z)=>grp.add(box(a,b,d,frame,x,y,z));
 bx(w+.16,.08,.06,0,cy+h/2+.04,0);bx(w+.16,.08,.06,0,cy-h/2-.04,0);bx(.08,h,.06,-w/2-.04,cy,0);bx(.08,h,.06,w/2+.04,cy,0);bx(w,h,.03,0,cy,0);
 bx(.07,.9,.07,-w/2+.15,.45,-.02);bx(.07,.9,.07,w/2-.15,.45,-.02);bx(.07,2.2,.07,0,1.1,-.5);
 grp.position.copy(P(SIGN.x,SIGN.y));grp.rotation.y=SIGN.turn;scene.add(grp);

})();
function openProblem(){
 const requestId=crypto.randomUUID().replace(/-/g,'');
 const s=sheet(`<button type="button" class="sheet-x" data-close aria-label="Cerrar">✕</button><h3>Reportar un problema</h3><p class="sub">Contanos qué pasó para que podamos revisarlo.</p>
  <form class="problem-form"><textarea maxlength="1000" minlength="5" rows="5" required placeholder="¿Qué pasó?" aria-label="Descripción del problema"></textarea>
  <button class="btn full" type="submit">Enviar reporte</button><p class="problem-status" role="status"></p></form>`);
 const form=s.querySelector('form'),input=form.querySelector('textarea'),submit=form.querySelector('[type=submit]'),status=form.querySelector('.problem-status');
 s.querySelector('[data-close]').onclick=closeSheet;
 input.addEventListener('pointerdown',e=>e.stopPropagation());
 form.onsubmit=e=>{e.preventDefault();if(state.problemBusy)return;
  if(input.value.trim().length<5){status.textContent='Escribí un mensaje de al menos 5 letras.';return;}
  state.problemBusy={status,input,submit};submit.disabled=true;submit.textContent='Enviando…';
  bar?.send({t:'problem',text:input.value,requestId});};
 input.focus();
}
function onProblemResult(m){
 const p=state.problemBusy;state.problemBusy=null;if(!p)return;
 if(m.ok){closeSheet();toast('Reporte enviado. Gracias por avisarnos.');return;}
 p.status.textContent=m.error||'No se pudo enviar. Probá de nuevo.';p.submit.disabled=false;p.submit.textContent='Enviar reporte';
}

// ---------- server events ----------
function addWalker(w){
 if(w.look)customLooks.set(w.uid,w.look);
 if(w.hold)held.set(w.uid,w.hold);else held.delete(w.uid);
 if(w.food&&!foods.has(w.uid))setFood(w.uid,w.food.item,w.food.x);
 if(w.left&&!foods.has(w.uid+'|left'))setFood(w.uid+'|left',w.left.item,w.left.x);
 const old=state.walkers.get(w.uid);
 state.walkers.set(w.uid,{...old,...w,dx:old?.dx??w.x,dy:old?.dy??w.y,tx:w.x,ty:w.y,ta:w.a,ts:!!w.s,heading:old?.heading??w.a??0,bubble:old?.bubble});
}
function onBar(m){
 if(m.t==='walkers'){const mine=state.walkers.get(state.me?.uid);state.walkers.clear();for(const w of m.list)addWalker(w);if(mine&&state.walkers.has(mine.uid)){Object.assign(state.walkers.get(mine.uid),{dx:mine.dx,dy:mine.dy,tx:mine.tx,ty:mine.ty});lastSent.at=0;lastSent.x=-1;}renderCount();}
 else if(m.t==='walker'){addWalker(m.walker);renderCount();}
 else if(m.t==='walk'){const w=state.walkers.get(m.uid);if(w){w.tx=m.x;w.ty=m.y;w.ta=m.a;w.ts=!!m.s;}}
 else if(m.t==='left'){state.walkers.delete(m.uid);held.delete(m.uid);dropFood(m.uid);dropFood(m.uid+'|left');renderCount();}
 else if(m.t==='order')onOrder(m);
 else if(m.t==='leave'){held.delete(m.uid);setFood(m.uid+'|left',m.item,Number(m.x)||0);}
 else if(m.t==='drop'){if(m.what==='food')dropFood(m.uid);else if(m.what==='left')dropFood(m.uid+'|left');else held.delete(m.uid);}
 else if(m.t==='said'){
  if(state.muted.has(m.uid))return;
  const w=state.walkers.get(m.uid);if(w)w.bubble={text:m.text,until:performance.now()+6000};
  const mention=m.uid!==state.me?.uid&&mentionsMe(m.text);
  state.chat.push({uid:m.uid,name:m.name,text:m.text,mention});state.chat=state.chat.slice(-40);state.lastNearAt=performance.now();
  if($('chat').hidden&&m.uid!==state.me?.uid)state.unread=(state.unread||0)+1;
  if(mention){toast(m.name+' te nombró: '+m.text);try{navigator.vibrate?.(80);}catch{}}
  renderChat();
 }
 else if(m.t==='look'){if(m.look)customLooks.set(m.uid,m.look);}
 else if(m.t==='looks'){for(const [u,l] of Object.entries(m.looks||{}))if(l)customLooks.set(u,l);}
 else if(m.t==='gesture'){if(!state.muted.has(m.uid))doGesture(m.uid,m.g);}
 else if(m.t==='arming'){const w=state.walkers.get(m.uid);if(w)w.arm=m.arm||null;}
 else if(m.t==='invited')onInvited(m);
 else if(m.t==='invite-answer')onInviteAnswer(m);
 else if(m.t==='invite-failed'){if(state.inviting?.uid===m.uid)state.inviting=null;toast('No se pudo invitar: ya no está en el bar.');}
 else if(m.t==='problem-result')onProblemResult(m);
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
 else if(m.t==='bar-layout'){state.layout=m.cells||{};syncSlots(firstTables);firstTables=false;return;}
 else if(m.t==='bar-board'){onBoard(m.board);return;}
 else if(m.t==='bar-request'){onTableOrder(!!m.ok);return;}
 else return;
 checkMyChair();checkJoin();
 renderCount();
}
function renderCount(){
 const tables=state.slots.filter(o=>!o.leaving).map(o=>tableOf(o.code)).filter(Boolean),playing=tables.filter(t=>t.live&&!t.live.finished).length,waiting=tables.filter(t=>t.waiting).length;
  if($('count'))$('count').textContent=`${playing} en juego · ${waiting} esperando · ${state.walkers.size} en el bar · ${state.online.length} en línea`;
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
 let blocked=false,gotTables=false;
 const refused=m=>{blocked=true;showStatus(m?.code==='bar-closed'?'El bar todavía no está abierto. Por ahora es solo para algunos jugadores.':(m?.error||'No se pudo entrar al bar.'),[['Volver al juego',null,'/']]);};
 const openLobby=()=>new Channel('/lobby',token,{bar:true},m=>{if(m.t==='bar-layout')gotTables=true;onLobby(m);},(status,data)=>{
  if(status==='ready')net.lobby=true;else if(status==='reconnecting'||status==='closed')net.lobby=false;
  if(status!=='refused')return;
  if(data?.code==='bar-closed'){refused(data);return;}
  setTimeout(()=>{lobby=openLobby();},2000);
 });
 lobby=openLobby();
 setInterval(()=>{if(!gotTables&&!blocked&&lobby?.ws?.readyState!==0){lobby.closed=true;try{lobby.ws.close();}catch{}lobby=openLobby();}},10000);
 bar=new Channel('/bar',token,{},onBar,(status,data)=>{
  if(status==='ready'){net.bar=true;state.me=data;if(!state.walkers.has(data.uid))addWalker(data);if(!blocked)$('status').hidden=true;
   cam.target.copy(P(data.x,data.y));}
  else if(status==='refused')refused(data);
  else if(status==='reconnecting'||status==='closed')net.bar=false;
 });
 if(!MANUAL)requestAnimationFrame(frame);
}
start();
