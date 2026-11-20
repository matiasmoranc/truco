// The BAR in 3D (trucouruguayo.uy/bar3d, hidden while it is tried): the same bar as bar/bar.js
// (real tables, the waiter, nearby chat, sitting at real tables) drawn with Three.js. The people are
// built here from simple shapes with a small skeleton, animated by code: they walk with weight
// (speed builds up and dies down, they lean and turn), and sit down on and get up from chairs.
// Move with the joystick (or WASD / arrows), or tap the floor, a chair or a table.
import * as THREE from 'three';
import {CSS2DRenderer,CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';

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

// ---------- 3D: the room and the furniture ----------
// World pixels (the same units as the server) become scene units: x → X, y → Z. A person is ~2 units tall.
const U=1/60,TABLE_H=1.02,SEAT_H=.52,MAX_SPEED=200;
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
scene.add(box(WORLD.w*U,5,.4,mat('#1d3b2c',{roughness:.9}),WORLD.w*U/2,2.5,-.2));
for(const y of [1.6,2.6])scene.add(box(WORLD.w*U-1,.08,.5,darkWood,WORLD.w*U/2,y,.2));
{const colors=['#2f7a4a','#7a2f2f','#b58a2e','#3a5c8a','#6b4a2a','#9fbf6a'],geo=new THREE.CylinderGeometry(.09,.11,.5,8);
 const bottles=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({roughness:.25,metalness:.1}),120),m=new THREE.Matrix4();
 for(let i=0;i<120;i++){m.makeTranslation(.6+Math.floor(i/2)*.42,(i%2?2.6:1.6)+.29,.22);bottles.setMatrixAt(i,m);bottles.setColorAt(i,new THREE.Color(colors[(i*7)%6]));}scene.add(bottles);}
{const sign=canvasTexture(512,128,(g,w,h)=>{g.fillStyle='#0b1712';g.fillRect(0,0,w,h);g.strokeStyle='#f3cf73';g.lineWidth=8;g.strokeRect(8,8,w-16,h-16);g.fillStyle='#ffd77a';g.font='900 84px DM Sans, sans-serif';g.textAlign='center';g.textBaseline='middle';g.shadowColor='#ffcf70';g.shadowBlur=24;g.fillText('B A R',w/2,h/2+4);});
 const s=new THREE.Mesh(new THREE.PlaneGeometry(4,1),new THREE.MeshBasicMaterial({map:sign}));s.position.set(WORLD.w*U/2,3.9,.02);scene.add(s);}
scene.add(box((WORLD.w-260)*U,1.3,66*U,wood,(30+(WORLD.w-260)/2)*U,.65,151*U));
scene.add(box((WORLD.w-260)*U,.08,80*U,mat('#a8703f',{roughness:.4}),(30+(WORLD.w-260)/2)*U,1.33,151*U));
scene.add(box(.2,3.2,160*U,darkWood,WORLD.w*U-.1,1.6,DOOR.y*U));

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

// ---------- people: built from simple shapes, moved by a small skeleton ----------
// Every person looks the same each time (chosen by their account): skin, hair, clothes.
const SKINS=['#f1c7a1','#e0ac7f','#c98e62','#a8704a','#7d4f31','#f5d5b8'],HAIRS=['#1f1a17','#3b2a1e','#6b4423','#a8742f','#d9b26a','#7a7a7a','#9b3b22'];
const SHIRT_COLORS=['#7a2f2f','#2f6a8a','#2f7a4a','#c58a2e','#6a2f7a','#d0d4d8','#b5572f','#3a5c8a','#8a3a5a','#2f8a7a','#e9d9b4'],PANTS=['#2b3445','#3d2f25','#1e1e22','#4a5560','#5a4b3a','#2f4a3a'];
const STYLES=['short','long','bun','cap','curly','bald'];
const hashOf=s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
const isBot=(uid,name)=>String(name||'').startsWith('Bot ')||String(uid).startsWith('house_');
const looks=(uid,name)=>{if(isBot(uid,name))return {robot:true};const h=hashOf(uid),p=(a,k)=>a[Math.floor(h/k)%a.length];
 return {skin:p(SKINS,1),hair:p(HAIRS,7),shirt:p(SHIRT_COLORS,53),pants:p(PANTS,379),style:p(STYLES,2111),beard:(h>>>7)%5===0};};
const matCache=new Map(),M=(c,o)=>{const k=c+JSON.stringify(o||{});if(!matCache.has(k))matCache.set(k,mat(c,o));return matCache.get(k);};
const G={sphere:new THREE.SphereGeometry(1,20,14),cap:(r,l)=>new THREE.CapsuleGeometry(r,l,6,12),box:new THREE.BoxGeometry(1,1,1)};
const capCache=new Map(),capsule=(r,l)=>{const k=r+'|'+l;if(!capCache.has(k))capCache.set(k,G.cap(r,l));return capCache.get(k);};
function part(geo,material,{x=0,y=0,z=0,sx=1,sy=1,sz=1}={}){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;return m;}
// A limb: a joint you rotate, with its piece hanging from it.
function limb(r,len,material){const joint=new THREE.Group(),piece=part(capsule(r,len),material,{y:-len/2-r*.3});joint.add(piece);return joint;}
const HIP_H=.98,THIGH=.42,SHIN=.42;
function buildPerson(look,{waiter=false}={}){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const robot=look.robot,skin=M(robot?'#b9c4cc':look.skin,{roughness:robot?.35:.7,metalness:robot?.5:0}),shirt=M(robot?'#8e9aa4':waiter?'#f4f1ea':look.shirt,{metalness:robot?.4:0}),pants=M(robot?'#5d6873':waiter?'#1e1e22':look.pants,{metalness:robot?.4:0}),shoe=M(robot?'#3b444c':'#2a1d14');
 const hips=new THREE.Group();hips.position.y=HIP_H;body.add(hips);
 hips.add(part(G.sphere,pants,{y:.02,sx:.25,sy:.15,sz:.18}));
 const spine=new THREE.Group();spine.position.y=.08;hips.add(spine);
 const torso=part(capsule(.23,.36),shirt,{y:.3,sz:.78});spine.add(torso);
 if(waiter){spine.add(part(G.box,M('#1e1e22'),{y:.26,z:.15,sx:.4,sy:.5,sz:.05}));spine.add(part(G.box,M('#7a2f2f'),{y:.6,z:.2,sx:.14,sy:.06,sz:.04}));}
 const neck=new THREE.Group();neck.position.y=.66;spine.add(neck);
 const head=new THREE.Group();head.position.y=.22;neck.add(head);
 if(robot){head.add(part(G.box,skin,{sx:.46,sy:.4,sz:.42}));const eye=M('#7ff0ff',{emissive:'#38d8ff',emissiveIntensity:1.6});
  head.add(part(G.box,M('#2e3b44'),{y:.03,z:.21,sx:.36,sy:.14,sz:.02}),part(G.sphere,eye,{x:-.08,y:.03,z:.225,sx:.04,sy:.04,sz:.02}),part(G.sphere,eye,{x:.08,y:.03,z:.225,sx:.04,sy:.04,sz:.02}),
   part(G.box,skin,{y:.28,sx:.03,sy:.16,sz:.03}),part(G.sphere,M('#ff6b6b',{emissive:'#ff3b3b',emissiveIntensity:1}),{y:.38,sx:.05,sy:.05,sz:.05}));}
 else{
  head.add(part(G.sphere,skin,{sx:.25,sy:.27,sz:.25}));
  const dark=M('#1a1412');head.add(part(G.sphere,dark,{x:-.085,y:.03,z:.225,sx:.032,sy:.04,sz:.02}),part(G.sphere,dark,{x:.085,y:.03,z:.225,sx:.032,sy:.04,sz:.02}),part(G.sphere,skin,{y:-.03,z:.25,sx:.045,sy:.05,sz:.04}));
  head.add(part(G.sphere,M('#b0574a'),{y:-.12,z:.225,sx:.06,sy:.018,sz:.02}));
  const hair=M(look.hair,{roughness:.9});
  if(look.style!=='bald')head.add(part(G.sphere,hair,{y:.07,z:-.02,sx:.265,sy:.24,sz:.265}));
  if(look.style==='long')head.add(part(G.box,hair,{y:-.12,z:-.13,sx:.46,sy:.42,sz:.16}));
  if(look.style==='bun')head.add(part(G.sphere,hair,{y:.22,z:-.14,sx:.1,sy:.1,sz:.1}));
  if(look.style==='curly')for(let i=0;i<7;i++){const a=i/7*Math.PI*2;head.add(part(G.sphere,hair,{x:Math.cos(a)*.2,y:.12,z:Math.sin(a)*.2-.03,sx:.09,sy:.09,sz:.09}));}
  if(look.style==='cap'){const c=M(look.shirt);head.add(part(G.sphere,c,{y:.1,sx:.27,sy:.2,sz:.27}),part(G.box,c,{y:.08,z:.25,sx:.3,sy:.03,sz:.18}));}
  if(look.beard)head.add(part(G.sphere,hair,{y:-.14,z:.1,sx:.2,sy:.12,sz:.16}));
 }
 const arms={},legs={};
 for(const side of [-1,1]){
  const shoulder=limb(.075,.27,shirt);shoulder.position.set(side*.31,.56,0);spine.add(shoulder);
  const elbow=limb(.065,.25,robot?shirt:skin);elbow.position.y=-.37;shoulder.add(elbow);
  elbow.add(part(G.sphere,skin,{y:-.36,sx:.085,sy:.09,sz:.085}));
  arms[side]={shoulder,elbow};
  const thigh=limb(.1,THIGH-.12,pants);thigh.position.set(side*.13,0,0);hips.add(thigh);
  const knee=limb(.088,SHIN-.12,pants);knee.position.y=-THIGH;thigh.add(knee);
  const foot=part(G.box,shoe,{y:-SHIN+.02,z:.07,sx:.16,sy:.09,sz:.3});knee.add(foot);
  legs[side]={thigh,knee};
 }
 const shadowBlob=new THREE.Mesh(new THREE.CircleGeometry(.42,24),new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.22,depthWrite:false}));shadowBlob.rotation.x=-Math.PI/2;shadowBlob.position.y=.015;root.add(shadowBlob);
 root.traverse(o=>{if(o.isMesh&&o!==shadowBlob){o.castShadow=true;}});
 scene.add(root);
 return {root,body,hips,spine,neck,head,arms,legs,robot,phase:Math.random()*6,t:Math.random()*10,sit:0,lean:0,side:0,look:0};
}
const lerp=(a,b,t)=>a+(b-a)*t,smooth=t=>t*t*(3-2*t),clamp01=t=>Math.max(0,Math.min(1,t));
// The pose each frame: walking from speed (stride follows the ground), breathing when still, the
// lean from acceleration and turning, and sitting down or getting up (sit 0 → 1).
function animate(p,{speed=0,accel=0,turn=0,sit=0,carry=false,playing=false,dt}){
 p.t+=dt;const s=clamp01(speed/MAX_SPEED);
 p.phase+=speed*U*dt*Math.PI/.62;
 const ph=p.phase,b=smooth(clamp01(sit)),stand=1-b;
 // Lean: forward with acceleration and speed, sideways into turns; eased so it feels like weight.
 p.lean=lerp(p.lean,Math.max(-.25,Math.min(.35,accel*.0011+s*.14)),Math.min(1,dt*6));
 p.side=lerp(p.side,Math.max(-.22,Math.min(.22,-turn*s*.09)),Math.min(1,dt*6));
 // Sitting down: the knees bend and the chest leans forward on the way down, then settles back.
 const mid=Math.sin(Math.PI*clamp01(sit));
 p.hips.position.y=lerp(HIP_H-(1-Math.cos(ph*2))*.03*s,SEAT_H+.1,b)+Math.sin(p.t*2.1)*.004*stand;
 p.hips.position.z=lerp(0,-.04,b);
 p.hips.rotation.y=Math.sin(ph)*.13*s*stand;p.hips.rotation.z=Math.sin(ph)*.04*s*stand;
 p.spine.rotation.x=p.lean*stand+mid*.55+b*.12;p.spine.rotation.z=p.side*stand;p.spine.rotation.y=-Math.sin(ph)*.18*s*stand;
 const breathe=1+Math.sin(p.t*2.1)*.012;p.spine.scale.set(1,breathe,1);
 p.neck.rotation.x=-p.spine.rotation.x*.45+(playing?.25:0);
 p.look=lerp(p.look,Math.sin(p.t*.37)*.35*(1-s),Math.min(1,dt*2));p.neck.rotation.y=p.look+(-p.spine.rotation.y*.6);
 for(const side of [-1,1]){
  const L=p.legs[side],A=p.arms[side],w=Math.sin(ph+(side>0?Math.PI:0));
  const swing=Math.max(0,Math.cos(ph+(side>0?Math.PI:0)));
  const thighWalk=w*.62*s,kneeWalk=(swing*.95+.05)*s;
  const thighSit=-Math.PI/2+.08,kneeSit=Math.PI/2-.05;
  L.thigh.rotation.x=lerp(thighWalk,thighSit,b)-mid*.35;
  L.knee.rotation.x=lerp(kneeWalk,kneeSit,b)+mid*.45;
  L.thigh.rotation.z=side*(.03+b*.06);
  // Arms swing against the legs; carrying holds them forward; at the table they rest on it.
  const armWalk=-w*.5*s,armIdle=Math.sin(p.t*1.3+side)*.03;
  let sx=armWalk+armIdle,ex=-.15-s*.35,sz=side*(.06+s*.04);
  if(carry){sx=-1.25;ex=-.25;sz=side*.08;}
  if(b>0){const rx=playing?-1.05+Math.max(0,Math.sin(p.t*1.7+side*1.3))*-.25:-.95;sx=lerp(sx,rx,b);ex=lerp(ex,-.75,b);sz=lerp(sz,side*.12,b);}
  A.shoulder.rotation.x=sx;A.shoulder.rotation.z=sz;A.elbow.rotation.x=ex;
 }
}

function label(className){const el=document.createElement('div');el.className=className;const o=new CSS2DObject(el);scene.add(o);return {el,o,set(text){if(el.textContent!==text)el.textContent=text;}};}
function nameLabel(){const l=label('tag');l.img=document.createElement('img');l.span=document.createElement('span');l.el.append(l.img,l.span);
 l.set=(text,avatar,me)=>{if(l.span.textContent!==text)l.span.textContent=text;const src=avatar?.src||'';if(src&&l.img.src!==src)l.img.src=src;l.el.classList.toggle('me',!!me);};return l;}
const views=new Map();
function view(key,make){let v=views.get(key);if(!v){v=make();views.set(key,v);}v.seen=true;return v;}
function sweep(){for(const [key,v] of views){if(!v.seen){if(v.person)scene.remove(v.person.root);for(const l of v.labels||[])scene.remove(l.o),l.el.remove();if(v.group)scene.remove(v.group);v.dispose?.();views.delete(key);}else v.seen=false;}}

// Where a seat is in the world, which way it faces, and the spot beside it where you stand up.
function seatSpot(slot,seat){const [dx,dy]=SEATS[slot.kind][seat],len=Math.hypot(dx,dy),fx=-dx/len,fy=-dy/len;
 return {x:slot.x+dx,y:slot.y+dy,face:Math.atan2(fx,fy),side:{x:slot.x+dx+fy*52,y:slot.y+dy-fx*52}};}
function drawSlot(slot,now,dt){
 if(!slot.placed)return;
 const t=slot.code?currentTables().get(slot.code):null,seats=SEATS[slot.kind],people=t?(t.live?.players||t.room?.players||{}):{};
 const v=view('slot'+slot.id,()=>{const group=new THREE.Group();group.position.copy(P(slot.x,slot.y));group.add(tableMesh(slot.kind));
  const rings={};for(const [seat,[dx,dy]] of Object.entries(seats)){const ch=chairMesh();ch.position.set(dx*U,0,dy*U);ch.rotation.y=Math.atan2(-dx,-dy);group.add(ch);
   const ring=new THREE.Mesh(ringGeo,ringMat());ring.rotation.x=-Math.PI/2;ring.position.set(dx*U,.02,dy*U);group.add(ring);rings[seat]=ring;}
  const cards=new THREE.Group();for(const [x,z,r,face] of [[-.28,-.08,-.3,1],[.22,.12,.25,1],[0,.32,.1,0],[.45,-.25,0,0]]){const c=new THREE.Mesh(cardGeo,face?cardFace:cardBack);c.position.set(x,TABLE_H+.075,z);c.rotation.y=r;c.castShadow=true;cards.add(c);}group.add(cards);
  scene.add(group);const sign=label('sign');sign.o.position.set(0,TABLE_H+2.1,0);group.add(sign.o);
  return {group,rings,cards,sign,labels:[sign],sitters:{}};});
 const pulse=.45+.4*Math.sin(now/350),meSeat=myChair();
 for(const [seat,ring] of Object.entries(v.rings)){ring.visible=(!t||(t.waiting&&!people[seat]?.uid))&&!(meSeat&&meSeat.slot===slot&&meSeat.seat===seat);ring.material.opacity=pulse;}
 v.cards.visible=!!t;
 for(const [seat,[dx,dy]] of Object.entries(seats)){
  const p=people[seat],key=p?.uid?p.uid:null,old=v.sitters[seat];
  if(old&&old.key!==key){scene.remove(old.person.root);v.group.remove(old.tag.o);old.tag.el.remove();delete v.sitters[seat];}
  if(!key)continue;
  const s=v.sitters[seat]??=(()=>{const person=buildPerson(looks(p.uid,p.name));v.group.add(person.root);person.root.position.set(dx*U,0,dy*U);person.root.rotation.y=Math.atan2(-dx,-dy);
   const tag=nameLabel();tag.o.position.set(dx*U*1.45,2.3,dy*U*1.45);v.group.add(tag.o);return {key,person,tag};})();
  animate(s.person,{sit:1,playing:!!t?.live&&!t.live.finished,dt});
  s.tag.set(p.name.length>14?p.name.slice(0,13)+'…':p.name,avatarOf(p.uid,p.name),p.uid===state.me?.uid);
 }
 const mode=slot.kind==='2v2'?'2 vs 2':'1 vs 1';
 if(!t){v.sign.set('LIBRE · '+mode);v.sign.el.className='sign free';}
 else if(t.live){const s=t.live.scores;v.sign.set((t.live.finished?'Terminó · ':'')+s.player1+' – '+s.player2+(t.live.targetPoints?' · a '+t.live.targetPoints:''));v.sign.el.className='sign score';
  const call=t.live.call&&!t.live.finished?callText(t.live.call):'';v.call??=(()=>{const l=label('call');l.o.position.set(1.2,TABLE_H+2.7,0);v.group.add(l.o);v.labels.push(l);return l;})();v.call.set(call);v.call.el.hidden=!call;}
 else{v.sign.set((t.room.creditMatch?.hasPassword?'🔒 ':'')+'Sentate · '+(t.room.targetPoints||20)+' pts');v.sign.el.className='sign wait';}
 if(!t?.live&&v.call)v.call.el.hidden=true;
}
const CALLS={truco:'¡TRUCO!',retruco:'¡RETRUCO!',vale4:'¡VALE CUATRO!',envido:'¡ENVIDO!','real-envido':'¡REAL ENVIDO!','falta-envido':'¡FALTA ENVIDO!',flor:'¡FLOR!'};
const callText=c=>CALLS[c]||('¡'+String(c).replace(/[-_]/g,' ').toUpperCase()+'!');
function drawCounter(dt){
 const shown=state.online.filter(p=>!state.walkers.has(p.uid)).slice(0,14);
 shown.forEach((p,i)=>{
  const v=view('stool'+i+'|'+p.uid,()=>{const group=new THREE.Group();group.position.copy(P(90+i*90,222));group.add(box(.5,SEAT_H,.5,darkWood,0,SEAT_H/2,0));
   const person=buildPerson(looks(p.uid,p.name));group.add(person.root);person.root.rotation.y=Math.PI;scene.add(group);
   const tag=nameLabel();tag.o.position.set(0,2.3,.4);group.add(tag.o);return {group,labels:[tag],tag,person};});
  animate(v.person,{sit:1,dt});v.tag.set(p.name.length>11?p.name.slice(0,10)+'…':p.name,avatarOf(p.uid,p.name));
 });
}
function drawWalkers(now,dt){
 for(const w of state.walkers.values()){
  const me=w.uid===state.me?.uid;
  const v=view('walker'+w.uid,()=>{const person=buildPerson(looks(w.uid,w.name)),tag=nameLabel(),bubble=label('bubble');
   const ring=new THREE.Mesh(new THREE.RingGeometry(HEAR_RADIUS*U-.05,HEAR_RADIUS*U,64),new THREE.MeshBasicMaterial({color:'#9fd3ff',transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.visible=me;scene.add(ring);
   return {person,labels:[tag,bubble],tag,bubble,ring,dispose(){scene.remove(ring);}};});
  // The sitting spot moves the body onto the chair; standing, it is where the walker is.
  const sitAt=w.seatSpot&&w.sit>0?w.seatSpot:null,b=smooth(clamp01(w.sit||0));
  const x=sitAt?lerp(sitAt.side.x,sitAt.x,clamp01((w.sit||0)*1.6)):w.dx,y=sitAt?lerp(sitAt.side.y,sitAt.y,clamp01((w.sit||0)*1.6)):w.dy;
  v.person.root.position.copy(P(x,y));v.person.root.rotation.y=w.heading||0;
  animate(v.person,{speed:Math.hypot(w.vx||0,w.vy||0),accel:w.accel||0,turn:w.turnRate||0,sit:w.sit||0,dt});
  v.ring.position.set(w.dx*U,.02,w.dy*U);
  v.tag.o.position.set(x*U,2.45-b*.45,y*U);v.tag.set(w.name,avatarOf(w.uid,w.name),me);
  const talking=w.bubble&&now<w.bubble.until;v.bubble.el.hidden=!talking;
  if(talking){v.bubble.set(w.bubble.text.length>60?w.bubble.text.slice(0,59)+'…':w.bubble.text);v.bubble.o.position.set(x*U,3.15-b*.45,y*U);}
 }
}
function drawMozo(now,dt){
 const m=stepMozo(now);if(!m)return;
 const v=view('mozo',()=>{const person=buildPerson({skin:'#e0ac7f',hair:'#1f1a17',style:'short',beard:true},{waiter:true}),tag=label('tag mozo');tag.set('Mozo');
  const carried=new THREE.Group();carried.add(box(1.3,.07,.9,wood,0,0,0),box(1.15,.02,.75,felt,0,.045,0));person.root.add(carried);carried.position.set(0,1.62,.55);
  return {person,labels:[tag],tag,carried,last:null};});
 const pos=P(m.x,m.y),moved=v.last?pos.distanceTo(v.last)/U/Math.max(dt,.001):0;v.last=pos.clone();
 v.person.root.position.copy(pos);v.person.root.rotation.y=Math.atan2(Math.cos(m.facing),Math.sin(m.facing));
 v.carried.visible=m.carrying;animate(v.person,{speed:Math.min(MAX_SPEED,moved),carry:m.carrying,dt});
 v.tag.o.position.set(m.x*U,2.45,m.y*U);
}

const CELL=30;
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

// ---------- moving: a body with weight ----------
// Speed builds up and dies down (no instant starts or stops), turning takes a moment, and the body
// slides along tables, chairs, the counter and other people instead of going through them.
const BODY=22,ACCEL=950,BRAKE=1300,TURN_RATE=9,CHAIR_HALF=20;
function obstacles(){
 const list=[{x0:0,y0:0,x1:WORLD.w-225,y1:262}];
 for(const s of state.slots)if(s.placed){
  const hw=s.kind==='2v2'?74:70,hh=s.kind==='2v2'?74:52;list.push({x0:s.x-hw,y0:s.y-hh,x1:s.x+hw,y1:s.y+hh});
  for(const [dx,dy] of Object.values(SEATS[s.kind]))list.push({x0:s.x+dx-CHAIR_HALF,y0:s.y+dy-CHAIR_HALF,x1:s.x+dx+CHAIR_HALF,y1:s.y+dy+CHAIR_HALF});
 }
 return list;
}
// Push a circle out of every box and every other person; returns the push direction (to cancel speed into walls).
function collide(w){
 const obs=obstacles();let nx=0,ny=0;
 for(const o of obs){
  const cx=Math.max(o.x0,Math.min(w.dx,o.x1)),cy=Math.max(o.y0,Math.min(w.dy,o.y1)),dx=w.dx-cx,dy=w.dy-cy,d=Math.hypot(dx,dy);
  if(d<BODY){if(d>.001){w.dx+=dx/d*(BODY-d);w.dy+=dy/d*(BODY-d);nx+=dx/d;ny+=dy/d;}else{w.dy=o.y1+BODY;ny+=1;}}
 }
 for(const o of state.walkers.values()){if(o===w||o.sit>.5)continue;const dx=w.dx-o.dx,dy=w.dy-o.dy,d=Math.hypot(dx,dy);if(d<BODY*2&&d>.001){w.dx+=dx/d*(BODY*2-d);w.dy+=dy/d*(BODY*2-d);nx+=dx/d;ny+=dy/d;}}
 w.dx=Math.min(WORLD.w-BODY,Math.max(BODY,w.dx));w.dy=Math.min(worldBottom()-BODY,Math.max(200,w.dy));
 const n=Math.hypot(nx,ny);if(n>0){nx/=n;ny/=n;const into=(w.vx||0)*nx+(w.vy||0)*ny;if(into<0){w.vx-=into*nx;w.vy-=into*ny;}}
}
// Move toward a wanted velocity with limited acceleration; face where you go, turning smoothly.
function physics(w,want,dt){
 w.vx??=0;w.vy??=0;w.heading??=w.a||0;
 const dvx=want.x-w.vx,dvy=want.y-w.vy,dv=Math.hypot(dvx,dvy),speeding=Math.hypot(want.x,want.y)>Math.hypot(w.vx,w.vy);
 const max=(speeding?ACCEL:BRAKE)*dt,k=dv>max?max/dv:1;
 const before=Math.hypot(w.vx,w.vy);w.vx+=dvx*k;w.vy+=dvy*k;
 w.dx+=w.vx*dt;w.dy+=w.vy*dt;collide(w);
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
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.add(k);e.preventDefault();}});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
addEventListener('blur',()=>keys.clear());
function control(){
 let x=stick.x,y=stick.y;
 if(keys.size){x=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);y=(keys.has('s')||keys.has('arrowdown')?1:0)-(keys.has('w')||keys.has('arrowup')?1:0);const n=Math.hypot(x,y);if(n>1){x/=n;y/=n;}}
 const m=Math.hypot(x,y);if(m<.12)return null;
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
 sitting=null;me.path=findPath({x:me.dx,y:me.dy},{x,y});state.follow=true;$('hint').hidden=true;
}
function sitOn(slot,seat){
 const me=state.me&&state.walkers.get(state.me.uid);if(!me)return;
 const spot=seatSpot(slot,seat);
 if(sitting&&sitting.phase!=='going'){if(sitting.slot===slot&&sitting.seat===seat){openTable(slot);return;}standUp(()=>sitOn(slot,seat));return;}
 me.path=findPath({x:me.dx,y:me.dy},spot.side);sitting={slot,seat,spot,phase:'going'};state.follow=true;$('hint').hidden=true;
}
let afterStand=null;
function standUp(then){if(!sitting||sitting.phase==='going'){then?.();return;}sitting.phase='up';afterStand=then||null;}
function moveMe(w,dt){
 const c=control();
 if(c&&sitting&&sitting.phase!=='going'&&sitting.phase!=='up'){standUp();}
 if(c&&sitting?.phase==='going'){sitting=null;w.path=null;}
 if(sitting&&sitting.phase!=='going'){
  const sp=sitting.spot;w.seatSpot=sp;w.vx=w.vy=0;w.accel=0;w.turnRate=0;
  if(sitting.phase==='down'){const off=turnToward(w,sp.face,dt);if(off<.5)w.sit=Math.min(1,(w.sit||0)+dt/.9);if(w.sit>=1){sitting.phase='seated';openTable(sitting.slot);}}
  else if(sitting.phase==='up'){w.sit=Math.max(0,(w.sit||0)-dt/.75);if(w.sit<=0){w.dx=sp.side.x;w.dy=sp.side.y;w.seatSpot=null;sitting=null;const then=afterStand;afterStand=null;then?.();}}
  return;
 }
 w.sit=0;w.seatSpot=null;
 if(c){w.path=null;physics(w,{x:c.x*MAX_SPEED*c.m,y:c.y*MAX_SPEED*c.m},dt);state.follow=true;$('hint').hidden=true;return;}
 const next=w.path?.[0];
 if(!next){physics(w,{x:0,y:0},dt);return;}
 const dx=next.x-w.dx,dy=next.y-w.dy,d=Math.hypot(dx,dy),last=w.path.length===1;
 if(d<(last?6:22)){w.path.shift();if(!w.path.length&&sitting?.phase==='going'){sitting.phase='down';w.dx=sitting.spot.side.x;w.dy=sitting.spot.side.y;}return;}
 const speed=last?Math.min(MAX_SPEED,d*3.2):MAX_SPEED;
 physics(w,{x:dx/d*speed,y:dy/d*speed},dt);
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
 // Turned toward a wall, the camera comes closer instead of going through it.
 let h=Math.cos(cam.pitch)*cam.dist;const dx=Math.sin(cam.yaw),dz=Math.cos(cam.yaw),minX=.4,maxX=WORLD.w*U-.4,minZ=.6,maxZ=worldBottom()*U+6;
 if(dx>0)h=Math.min(h,(maxX-cam.target.x)/dx);if(dx<0)h=Math.min(h,(minX-cam.target.x)/dx);if(dz<0)h=Math.min(h,(minZ-cam.target.z)/dz);if(dz>0)h=Math.min(h,(maxZ-cam.target.z)/dz);
 h=Math.max(.8,h);camera.position.set(cam.target.x+dx*h,cam.target.y+Math.sin(cam.pitch)*cam.dist,cam.target.z+dz*h);camera.lookAt(cam.target);
}
function clampTarget(){const b=worldBottom();cam.target.x=Math.min(WORLD.w*U,Math.max(0,cam.target.x));cam.target.z=Math.min(b*U,Math.max(3,cam.target.z));}
function worldBottom(){return Math.max(1100,...state.slots.map(s=>s.y+260));}
const clock=new THREE.Clock();
if(LOCAL)Object.assign(globalThis,{barState:state,barWalk:(x,y)=>walkTo(x,y),bar3d:{cam,views,scene,camera,THREE,stick,sitOn,get sitting(){return sitting;}}});
function frame(now){
 const dt=Math.min(.05,clock.getDelta());
 for(const w of state.walkers.values())w.uid===state.me?.uid?moveMe(w,dt):moveOther(w,dt);
 const me=state.me&&state.walkers.get(state.me.uid);
 if(me&&state.follow)cam.target.lerp(P(me.dx,me.dy,1.1),Math.min(1,dt*5));
 clampTarget();placeCamera();
 sun.position.set(cam.target.x+6,22,cam.target.z+14);sun.target.position.copy(cam.target);
 for(const slot of state.slots)drawSlot(slot,now,dt);
 drawCounter(dt);drawWalkers(now,dt);drawMozo(now,dt);sweep();
 renderer.render(scene,camera);labels.render(scene,camera);
 if(me)sendMyStep(me,now);
 updateNear(now);
 requestAnimationFrame(frame);
}

// ---------- input: tap to walk or pick a table, drag to look around, pinch or wheel to zoom ----------
const ray=new THREE.Raycaster(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
function toWorld(sx,sy){
 ray.setFromCamera(new THREE.Vector2(sx/W*2-1,-(sy/H)*2+1),camera);
 const hit=new THREE.Vector3();if(!ray.ray.intersectPlane(groundPlane,hit))return null;return {x:hit.x/U,y:hit.z/U,v:hit};
}
function zoomBy(factor){cam.dist=Math.min(34,Math.max(6,cam.dist/factor));}
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
  if(drag.moved){cam.yaw-=(e.clientX-drag.lx)*.0065;cam.pitch=Math.min(1.3,Math.max(.28,cam.pitch+(e.clientY-drag.ly)*.0045));state.follow=true;$('hint').hidden=true;}
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
 const walker=[...state.walkers.values()].find(w=>w.uid!==state.me?.uid&&Math.hypot(w.dx-p.x,w.dy-p.y)<34);
 if(walker){openPerson(walker);return;}
 const slot=state.slots.find(s=>s.placed&&Math.abs(s.x-p.x)<(s.kind==='2v2'?140:100)&&Math.abs(s.y-p.y)<(s.kind==='2v2'?140:125));
 if(slot){
  const t=slot.code?currentTables().get(slot.code):null,people=t?(t.live?.players||t.room?.players||{}):{};
  // A table with room: walk to the free chair nearest to where you tapped and sit down.
  if(!t?.live){const free=Object.entries(SEATS[slot.kind]).filter(([seat])=>!people[seat]?.uid).sort((a,b)=>Math.hypot(slot.x+a[1][0]-p.x,slot.y+a[1][1]-p.y)-Math.hypot(slot.x+b[1][0]-p.x,slot.y+b[1][1]-p.y));
   if(free.length){sitOn(slot,free[0][0]);return;}}
  const off=slot.kind==='2v2'?170:130;walkTo(slot.x+(p.x<slot.x?-off:off),slot.y);openTable(slot);return;
 }
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
 state.walkers.set(w.uid,{...old,...w,dx:old?.dx??w.x,dy:old?.dy??w.y,tx:w.x,ty:w.y,ta:w.a,ts:!!w.s,heading:old?.heading??w.a??0,bubble:old?.bubble});
}
function onBar(m){
 if(m.t==='walkers'){const mine=state.walkers.get(state.me?.uid);state.walkers.clear();for(const w of m.list)addWalker(w);if(mine&&state.walkers.has(mine.uid)){Object.assign(state.walkers.get(mine.uid),{dx:mine.dx,dy:mine.dy,tx:mine.tx,ty:mine.ty});lastSent.at=0;lastSent.x=-1;}renderCount();}
 else if(m.t==='walker'){addWalker(m.walker);renderCount();}
 else if(m.t==='walk'){const w=state.walkers.get(m.uid);if(w){w.tx=m.x;w.ty=m.y;w.ta=m.a;w.ts=!!m.s;}}
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
   cam.target.copy(P(data.x,data.y));}
  else if(status==='refused')refused(data);
  else if(status==='reconnecting')toast('Reconectando…');
 });
 requestAnimationFrame(frame);
}
start();
