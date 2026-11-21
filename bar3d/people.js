// People in the BAR: built from shapes in code and moved by a small skeleton (hips, spine, neck, head,
// arms and legs). Hair, hats and beards are surfaces that follow the head, so a hat sits over the hair
// and the hair shows under it with no gap; each person's parts are merged per bone so a full room
// stays light on phones. Used by bar3d.js; the choices are checked on the server (cloudflare/src/bar-core.js cleanLook).
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// World pixels → scene units, chair height and top walking speed (the same as bar3d.js).
export const U=1/60,SEAT_H=.52,MAX_SPEED=200;
export const lerp=(a,b,t)=>a+(b-a)*t,smooth=t=>t*t*(3-2*t),clamp01=t=>Math.max(0,Math.min(1,t));
const smoothstep=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const PI=Math.PI;

// ---------- the choices ----------
// Every person looks the same each time: the look chosen in the BAR, or else one taken from their account.
// The first colors of each list are the ones accounts get; new colors only go at the end.
export const SKINS=['#f1c7a1','#e0ac7f','#c98e62','#a8704a','#7d4f31','#f5d5b8','#8d5a3b','#5c3a24','#ffe0c4','#4a2c1a'];
export const HAIRS=['#1f1a17','#3b2a1e','#6b4423','#a8742f','#d9b26a','#7a7a7a','#9b3b22','#e8dcc0','#c4542a','#3d5a8c','#c76b98'];
export const SHIRT_COLORS=['#7a2f2f','#2f6a8a','#2f7a4a','#c58a2e','#6a2f7a','#d0d4d8','#b5572f','#3a5c8a','#8a3a5a','#2f8a7a','#e9d9b4','#6fa8dc','#1f1f24','#f2c94c','#e07a8f','#f4f1ea','#4b5a2e','#c9b48a'];
export const PANTS=['#2b3445','#3d2f25','#1e1e22','#4a5560','#5a4b3a','#2f4a3a','#6b8fb5','#c9b48a','#2c4a6e','#8a8f96'];
export const SHOES=['#2a1d14','#f4f1ea','#1e1e22','#7a2f2f','#2f6a8a','#c58a2e','#3d4f3a','#8a8f96'];
// What each word means is in the page's editor (bar3d.js LOOK_CHOICES).
const LONG_SLEEVES=new Set(['camisa','polera','buzo','campera','saco','mangalarga','raglan','buzocierre','sueter']),NO_SLEEVES=new Set(['musculosa','vestido']);
// Height and face width: five steps each, the middle one the usual.
export const HEIGHTS=[.92,.96,1,1.04,1.08],FACES=[.86,.93,1,1.07,1.14];
const STYLES=['short','long','bun','cap','curly','bald'];
export const hashOf=s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
export const isBot=(uid,name)=>String(name||'').startsWith('Bot ')||/^(bot:|house_)/.test(String(uid));
export const customLooks=new Map();
// The look an account gets before choosing one (the same as always: only the first colors of each list).
export const defaultLook=uid=>{const h=hashOf(uid),i=(n,k)=>Math.floor(h/k)%n,style=STYLES[i(6,2111)],t=i(11,53);
 return {g:'m',s:i(6,1),h:style==='cap'?'short':style,hc:i(7,7),t,o:'remera',p:i(6,379),q:'jean',z:0,y:'champion',a:style==='cap'?'gorra':'',e:'',n:'',ac:t,f:(h>>>7)%5===0?'barba':'',r:false};};
export const looks=(uid,name)=>{if(isBot(uid,name))return {robot:true};const c=customLooks.get(uid)||defaultLook(uid),at=(list,i)=>list[i]||list[0];
 return {skin:at(SKINS,c.s),hair:at(HAIRS,c.hc),shirt:at(SHIRT_COLORS,c.t),pants:at(PANTS,c.p),shoes:at(SHOES,c.z||0),accent:at(SHIRT_COLORS,c.ac??c.t),detail:at(SHIRT_COLORS,c.d??c.ac??c.t),
  female:c.g==='f',height:HEIGHTS[c.k??2]||1,faceW:FACES[c.w??2]||1,style:c.h,outfit:c.o||'remera',legs:c.q||'jean',feet:c.y||'champion',hat:c.a||'',eyes:c.e||(c.a==='lentes'?'lentes':''),neck:c.n||(c.a==='bufanda'?'bufanda':''),face:c.f||(c.b?'barba':''),ears:!!c.r};};
export const lookKey=uid=>{const c=customLooks.get(uid);return c?JSON.stringify(c):'';};

// ---------- materials and shapes (made once, shared) ----------
const mat=(color,o={})=>new THREE.MeshStandardMaterial({color,roughness:.6,...o});
const matCache=new Map();
export const M=(c,o)=>{const k=c+JSON.stringify(o||{});if(!matCache.has(k))matCache.set(k,mat(c,o));return matCache.get(k);};
const texCache=new Map();
function canvasTex(key,w,h,draw,repeat=[1,1]){
 if(!texCache.has(key)){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=4;texCache.set(key,t);}
 return texCache.get(key);
}
// Hair: fine streaks from the crown down (the surfaces run their v from top to tip).
const strands=()=>canvasTex('strands',256,64,(g,w,h)=>{g.fillStyle='#fff';g.fillRect(0,0,w,h);
 let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<260;i++){const x=rnd()*w,l=.62+rnd()*.38;g.fillStyle=`rgba(${Math.round(255*l)},${Math.round(255*l)},${Math.round(255*l)},.55)`;g.fillRect(x,0,1+rnd()*1.6,h);}},[6,1]);
const hairMat=(color,double=false)=>{const k='hair'+color+double;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color,map:strands(),roughness:.55,metalness:.05,side:double?THREE.DoubleSide:THREE.FrontSide}));return matCache.get(k);};
// Knitted wool (a beanie) and the panels of a cap.
const ribs=()=>canvasTex('ribs',128,16,(g,w,h)=>{for(let x=0;x<w;x+=4){g.fillStyle=x%8?'#d8d8d8':'#fff';g.fillRect(x,0,4,h);}},[10,1]);
const panels=()=>canvasTex('panels',512,32,(g,w,h)=>{g.fillStyle='#fff';g.fillRect(0,0,w,h);g.fillStyle='#9a9a9a';for(let i=0;i<6;i++)g.fillRect(i*w/6+w/12,0,3,h);},[1,1]);
const weave=()=>canvasTex('weave',64,64,(g,w,h)=>{g.fillStyle='#fff';g.fillRect(0,0,w,h);for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){g.fillStyle=((x+y)/4)%2?'#d9d9d9':'#f2f2f2';g.fillRect(x,y,4,4);}},[8,3]);
const dots=()=>canvasTex('dots',64,64,(g,w,h)=>{g.fillStyle='#fff';g.fillRect(0,0,w,h);g.fillStyle='#ffffff';g.strokeStyle='rgba(255,255,255,.9)';for(let i=0;i<6;i++){g.beginPath();g.arc((i*23)%w,(i*37)%h,5,0,PI*2);g.fillStyle='rgba(40,40,40,.35)';g.fill();}},[5,3]);
const texMat=(key,color,tex,o={})=>{const k=key+color;if(!matCache.has(k))matCache.set(k,new THREE.MeshStandardMaterial({color,map:tex,roughness:.85,...o}));return matCache.get(k);};
const stripes=color=>{const k='stripes'+color;if(!matCache.has(k)){const t=canvasTex('stripes-'+color,64,8,(g)=>{for(let i=0;i<8;i++){g.fillStyle=i%2?'#f4f1ea':color;g.fillRect(i*8,0,8,8);}},[2,1]);
 matCache.set(k,new THREE.MeshStandardMaterial({map:t,roughness:.7}));}return matCache.get(k);};
// A football shirt's number on the back.
const number=(color)=>{const k='num'+color;if(!matCache.has(k)){const t=canvasTex('num-'+color,128,128,(g,w,h)=>{g.fillStyle=color;g.fillRect(0,0,w,h);
  g.fillStyle='#f4f1ea';g.font='900 92px "DM Sans",Arial,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('10',w/2,h/2+6);});
 matCache.set(k,new THREE.MeshStandardMaterial({map:t,roughness:.75}));}return matCache.get(k);};
const printMat=color=>{const k='print'+color;if(!matCache.has(k)){const t=canvasTex('print-'+color,128,96,(g,w,h)=>{g.clearRect(0,0,w,h);g.translate(w/2,h/2);g.fillStyle=color;
  for(let i=0;i<16;i++){g.save();g.rotate(i*PI/8);g.beginPath();g.moveTo(-5,-22);g.lineTo(0,-40);g.lineTo(5,-22);g.fill();g.restore();}g.beginPath();g.arc(0,0,20,0,PI*2);g.fill();g.fillStyle='rgba(0,0,0,.25)';g.beginPath();g.arc(-7,-4,3,0,PI*2);g.arc(7,-4,3,0,PI*2);g.fill();});
 matCache.set(k,new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.4,roughness:.8}));}return matCache.get(k);};
const shade=(hex,k)=>{const c=new THREE.Color(hex);c.multiplyScalar(k);return '#'+c.getHexString();};
// Toward white (a dark color shaded stays dark: lapels and trims on black need this).
const tint=(hex,k)=>{const c=new THREE.Color(hex);c.lerp(new THREE.Color('#ffffff'),k);return '#'+c.getHexString();};

export const G={sphere:new THREE.SphereGeometry(1,32,20),lowSphere:new THREE.SphereGeometry(1,14,10),box:new THREE.BoxGeometry(1,1,1)};
const geoCache=new Map();
export const geo=(key,make)=>{if(!geoCache.has(key))geoCache.set(key,make());return geoCache.get(key);};
export const capsule=(r,l)=>geo('cap'+r+'|'+l,()=>new THREE.CapsuleGeometry(r,l,8,16));
export const dome=k=>geo('dome'+k,()=>new THREE.SphereGeometry(1,24,12,0,PI*2,0,PI*k));
export const ring=(r,t,arc=PI*2)=>geo('ring'+r+t+arc,()=>new THREE.TorusGeometry(r,t,10,32,arc));
const rbox=(w,h,d,r)=>geo('rbox'+[w,h,d,r],()=>new RoundedBoxGeometry(w,h,d,3,r));
const tube=(r,h,open=true)=>geo('tube'+r+h+open,()=>new THREE.CylinderGeometry(r,r,h,24,1,open));
const cone=(top,bottom,h)=>geo('cone'+top+bottom+h,()=>new THREE.CylinderGeometry(top,bottom,h,24,1,true));
const lathe=(key,pts,seg=40)=>geo('lathe'+key,()=>new THREE.LatheGeometry(pts.map(([x,y])=>new THREE.Vector2(x,y)),seg));
// Hats turned from a profile are seen from both sides (a crown drawn top to bottom faces inward).
const hatMat=(c,o={})=>M(c,{side:THREE.DoubleSide,roughness:.85,...o});
export function part(g,material,{x=0,y=0,z=0,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0}={}){const m=new THREE.Mesh(g,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.set(rx,ry,rz);m.castShadow=true;return m;}
export const GOLD={metalness:.85,roughness:.25};

// ---------- surfaces on the head ----------
// The head is the unit sphere scaled (.25,.27,.25): hair, hats and beards are built on that sphere
// (the "skull" group) as patches between two lines around it. phi is the angle around (0 = the
// face, + = the right side) and theta the angle down from the top. A patch stands out by `thick`
// (in head radii) and thins to the skin at a soft edge, or ends in a lip like a hat's rim.
// hairline(front, side, back): where a patch ends, in fractions of PI, smooth all around, with a
// notch over the ears and sideburns in front of them.
function hairline(front,side,back,{ear=.08,burn=.06,jag=0,jagFront=0}={}){
 return phi=>{const c=Math.cos(phi),a=Math.abs(Math.atan2(Math.sin(phi),c));
  let t=c>=0?side+(front-side)*Math.pow(c,1.3):side+(back-side)*Math.pow(-c,1.1);
  t-=ear*Math.exp(-(((a-1.62)/.2)**2));t+=burn*Math.exp(-(((a-1.27)/.09)**2));
  if(jag)t+=jag*Math.sin(phi*11)*.5+jag*Math.sin(phi*23+1)*.5;
  if(jagFront)t+=jagFront*Math.max(0,c)**2*Math.abs(Math.sin(phi*26));
  return t*PI;};
}
// arc=[a,b]: only between those angles around (sideburns, a goatee), thinning at both ends.
function patch({to,from=null,thick=.06,extra=null,taper=.16,lip=false,segU=64,segV=20,arc=null}){
 const pos=[],uv=[],idx=[],rows=segV+1+(lip?1:0);
 for(let j=0;j<rows;j++){const edgeRow=lip&&j===rows-1,v=edgeRow?1:j/segV;
  for(let i=0;i<=segU;i++){const u=i/segU,phi=arc?lerp(arc[0],arc[1],u):PI+u*PI*2,t0=from?from(phi):0,t1=to(phi),th=t0+(t1-t0)*v;
   // Soft: full thickness inside, down to the skin at the edge(s). With a lip: full to the edge, then a rim.
   const prof=(lip?1:(1-smoothstep(1-taper,1,v))*(from?smoothstep(0,taper,v):1))*(arc?smoothstep(0,.25,u)*(1-smoothstep(.75,1,u)):1);
   const r=edgeRow?1.006:1.012+(thick+(extra?extra(phi,th,v):0))*prof;
   const s=Math.sin(th);pos.push(s*Math.sin(phi)*r,Math.cos(th)*r,s*Math.cos(phi)*r);uv.push(u,v);}}
 for(let j=0;j<rows-1;j++)for(let i=0;i<segU;i++){const a=j*(segU+1)+i,b=a+segU+1;idx.push(a,b,a+1,b,b+1,a+1);}
 return finish(pos,uv,idx);
}
function finish(pos,uv,idx){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}
// Hair falling from the hairline: around the back from phi0 to -phi0, down to len(phi) (in head radii
// below the center), hanging straight below the widest part of the head; wave and flare at the tips.
function curtain({edge,phi0,len,thick=.12,wave=0,flare=0,cap=.08,segU=48,segV=26}){
 const pos=[],uv=[],idx=[];
 for(let j=0;j<=segV;j++){const v=j/segV;
  for(let i=0;i<=segU;i++){const u=i/segU,phi=phi0+u*(PI*2-phi0*2),th0=edge(phi)*.72,y0=Math.cos(th0),y=lerp(y0,-len(phi),v);
   const head=y>0?Math.sqrt(Math.max(0,1-y*y)):1,start=Math.sin(th0)*(1.012+cap*.9);
   let r=Math.max(lerp(start,head+thick,smoothstep(0,.4,v)),head+.03)+flare*smoothstep(.55,1,v)+wave*Math.sin(phi*8+v*7)*smoothstep(.1,.4,v);
   // The sides near the face are a little thinner, so the hair frames it.
   pos.push(Math.sin(phi)*r,y,Math.cos(phi)*r);uv.push(u*3,v);}}
 for(let j=0;j<segV;j++)for(let i=0;i<segU;i++){const a=j*(segU+1)+i,b=a+segU+1;idx.push(a,a+1,b,b,a+1,b+1);}
 return finish(pos,uv,idx);
}
// A tube along a curve, thinning from r0 to r1 (a ponytail, a braid's core, glasses' arms, a mustache).
function taper(points,r0,r1,{seg=24,rad=12,bulge=0}={}){
 const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),frames=curve.computeFrenetFrames(seg,false),pos=[],uv=[],idx=[];
 for(let i=0;i<=seg;i++){const t=i/seg,p=curve.getPointAt(t),N=frames.normals[i],B=frames.binormals[i],r=lerp(r0,r1,t)+bulge*Math.sin(PI*t);
  for(let j=0;j<=rad;j++){const a=j/rad*PI*2,cx=Math.cos(a),cy=Math.sin(a);pos.push(p.x+r*(cx*N.x+cy*B.x),p.y+r*(cx*N.y+cy*B.y),p.z+r*(cx*N.z+cy*B.z));uv.push(j/rad,t);}}
 for(let i=0;i<seg;i++)for(let j=0;j<rad;j++){const a=i*(rad+1)+j,b=a+rad+1;idx.push(a,b,a+1,b,b+1,a+1);}
 const g=finish(pos,uv,idx);
 // Faces outward whatever way the frames turned.
 const n=g.attributes.normal,p0=new THREE.Vector3(pos[0],pos[1],pos[2]).sub(curve.getPointAt(0));
 if(p0.dot(new THREE.Vector3(n.getX(0),n.getY(0),n.getZ(0)))<0){const ix=g.index.array;for(let k=0;k<ix.length;k+=3){const t=ix[k+1];ix[k+1]=ix[k+2];ix[k+2]=t;}g.computeVertexNormals();}
 return g;
}
// Many small balls merged in one shape (curls, braids, pearls).
function balls(list,base=G.lowSphere){const parts=list.map(([x,y,z,sx,sy=sx,sz=sx,rx=0,rz=0])=>{const g=base.clone();g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,0,rz)),new THREE.Vector3(sx,sy,sz)));return g;});return mergeGeometries(parts);}
const onSphere=(th,phi,r)=>[Math.sin(th)*Math.sin(phi)*r,Math.cos(th)*r,Math.sin(th)*Math.cos(phi)*r];

// ---------- hair ----------
// Each style: the cap (with its own hairline and volume) and what hangs or sits on it. Under a hat the
// cap stays close to the head (the hat covers its top) and only what shows below the hat is kept.
const SHORT=hairline(.3,.5,.69);
const HAIR={
 short:{line:SHORT,thick:.075,extra:(p,th)=>.05*(1-smoothstep(.08*PI,.3*PI,th))},
 fade:{line:hairline(.31,.47,.58,{ear:.1}),thick:.03,extra:(p,th)=>.1*(1-smoothstep(.12*PI,.34*PI,th))},
 quiff:{line:hairline(.29,.48,.62),thick:.04,extra:(p,th)=>.06*(1-smoothstep(.1*PI,.4*PI,th))+.32*Math.max(0,Math.cos(p))**2*Math.exp(-(((th-.2*PI)/(.13*PI))**2))},
 messy:{line:hairline(.33,.5,.66,{jag:.02}),thick:.09,extra:(p,th)=>.05*Math.sin(p*7+th*5)*Math.sin(th*6)+.04},
 fringe:{line:hairline(.43,.5,.66,{jagFront:.025}),thick:.085,extra:(p,th)=>.04*(1-smoothstep(.1*PI,.35*PI,th))},
 curly:{line:SHORT,thick:.1,curls:true},
 afro:{line:hairline(.3,.53,.7,{ear:.04}),thick:.52,taper:.4,extra:(p,th)=>.2*(1-smoothstep(0,.4*PI,th))+.03*Math.sin(p*13)*Math.sin(th*11)},
 long:{line:hairline(.3,.55,.66,{ear:0}),thick:.08,curtain:{phi0:1.05,len:p=>lerp(.95,2.35,smoothstep(.2,-1,Math.cos(p))),thick:.13}},
 wavy:{line:hairline(.31,.55,.66,{ear:0}),thick:.1,curtain:{phi0:1.0,len:p=>lerp(.9,1.65,smoothstep(.2,-1,Math.cos(p))),thick:.14,wave:.035,flare:.04}},
 bob:{line:hairline(.38,.55,.66,{ear:0,jagFront:.015}),thick:.1,curtain:{phi0:.95,len:()=>.78,thick:.15,flare:.1}},
 ponytail:{line:hairline(.3,.5,.6),thick:.05,tail:true},
 bun:{line:hairline(.3,.5,.6),thick:.05,bun:true},
 braids:{line:hairline(.3,.52,.64,{ear:0}),thick:.055,braids:true},
 mohawk:{line:hairline(.3,.47,.6,{ear:.1}),thick:.012,crest:true},
 // Short, for men mostly.
 buzz:{line:hairline(.31,.49,.64,{ear:.1}),thick:.02},
 sidepart:{line:SHORT,thick:.07,extra:(p,th)=>{const a=Math.atan2(Math.sin(p),Math.cos(p));return .06*(1-smoothstep(.1*PI,.33*PI,th))*(1+.6*Math.sin(p))-.07*Math.exp(-(((a+.55)/.07)**2))*smoothstep(.04*PI,.1*PI,th)*(1-smoothstep(.28*PI,.34*PI,th));}},
 spiky:{line:SHORT,thick:.05,spikes:true},
 undercut:{line:hairline(.31,.47,.6,{ear:.1}),thick:.015,extra:(p,th)=>.17*(1-smoothstep(.19*PI,.3*PI,th))*(1+.35*Math.max(0,Math.cos(p)))},
 manbun:{line:hairline(.3,.5,.62),thick:.045,bun:'small'},
 mullet:{line:SHORT,thick:.07,extra:(p,th)=>.04*(1-smoothstep(.1*PI,.3*PI,th)),curtain:{phi0:2.05,len:p=>lerp(.95,1.5,smoothstep(-.45,-1,Math.cos(p))),thick:.11,flare:.05}},
 // Messy or with waves.
 shortwavy:{line:hairline(.31,.5,.67,{jag:.012}),thick:.1,extra:(p,th)=>.05*Math.sin(p*6+th*9)*smoothstep(.05*PI,.2*PI,th)+.03},
 shaggy:{line:hairline(.4,.55,.68,{ear:0,jag:.02,jagFront:.02}),thick:.11,extra:(p,th)=>.04*Math.sin(p*8+th*6),curtain:{phi0:.95,len:p=>1.05+.12*Math.sin(p*7),thick:.15,wave:.03,flare:.07}},
 longcurly:{line:hairline(.31,.55,.66,{ear:0}),thick:.12,curls:true,curtain:{phi0:.95,len:p=>lerp(1.0,1.9,smoothstep(.2,-1,Math.cos(p))),thick:.2,wave:.09,flare:.14}},
 dreads:{line:hairline(.3,.52,.66,{ear:0}),thick:.08,dreads:true},
 // Long or tied up, for women mostly.
 pixie:{line:hairline(.4,.47,.62,{jagFront:.02,ear:.06}),thick:.08,extra:(p,th)=>.06*(1-smoothstep(.1*PI,.35*PI,th))*(1+.5*Math.sin(p))},
 bangs:{line:hairline(.43,.55,.66,{ear:0,jagFront:.015}),thick:.085,curtain:{phi0:1.05,len:p=>lerp(.95,2.3,smoothstep(.2,-1,Math.cos(p))),thick:.13}},
 halfup:{line:hairline(.3,.55,.66,{ear:0}),thick:.08,tie:true,curtain:{phi0:1.05,len:p=>lerp(.95,2.0,smoothstep(.2,-1,Math.cos(p))),thick:.13}},
 pigtails:{line:hairline(.3,.52,.62,{ear:0}),thick:.05,pigtails:true},
 braid:{line:hairline(.3,.52,.62,{ear:0}),thick:.05,braid:true},
 lowbun:{line:hairline(.3,.52,.62,{ear:0}),thick:.05,bun:'low'},
 bald:null};
function hairCap(style,hat){
 const h=HAIR[style]||HAIR.short,key='hair:'+style+(hat?':hat':'');
 return geo(key,()=>patch({to:h.line,thick:hat?Math.min(h.thick,.05):h.thick,extra:hat?null:h.extra,taper:h.taper||.16}));
}
function buildHair(skull,look,hat){
 const st=look.style;if(st==='bald'||!HAIR[st]&&st!=='short'&&!HAIR[st])return null;
 const h=HAIR[st]||HAIR.short,hm=hairMat(look.hair),tail=null;
 skull.add(part(hairCap(st,hat),st==='buzz'?M(look.hair,{map:strands(),roughness:.8,transparent:true,opacity:.78}):hm));
 if(h.curtain){const c=h.curtain;skull.add(part(geo('curtain:'+st,()=>curtain({edge:h.line,cap:h.thick,...c})),hairMat(look.hair,true)));}
 if(h.curls){// Curls over the cap; under a hat only those below it.
  const list=[];for(let i=0;i<150;i++){const y=1-(i+.5)/150*1.55,th=Math.acos(Math.max(-1,Math.min(1,y))),phi=i*2.39996;
   if(th>h.line(phi)*.97||(hat&&th<hatLine(hat)(phi)+.12))continue;const [x,yy,z]=onSphere(th,phi,1.11);list.push([x,yy,z,.15+(i%3)*.02]);}
  if(list.length)skull.add(part(geo('curls'+(hat||''),()=>balls(list)),M(look.hair,{roughness:.7})));}
 if(h.bun){const low=h.bun==='low'||hat,small=h.bun==='small';
  const at=low?{y:-.38,z:-1.08,r:small?.24:.33,rx:-.15}:small?{y:.83,z:-.55,r:.25,rx:-.75}:{y:.72,z:-.72,r:.37,rx:-.6};
  skull.add(part(geo('bun'+h.bun+(hat?1:0),()=>balls([[0,at.y,at.z,at.r,at.r*.9,at.r*.95,at.rx]])),hairMat(look.hair)),
   part(ring(at.r*.62,.05),M(shade(look.hair,.6)),{y:at.y-Math.cos(at.rx)*at.r*.55,z:at.z+Math.sin(-at.rx)*at.r*.55,rx:PI/2+at.rx}));}
 if(h.spikes&&!hat){const list=[];for(let i=0;i<40;i++){const y=1-(i+.5)/40*.7,th=Math.acos(y),phi=i*2.39996;if(th>.34*PI||(th>.2*PI&&Math.cos(phi)>.5))continue;
   const g=new THREE.ConeGeometry(.12,.22,7);g.translate(0,.11,0);const dir=new THREE.Vector3(...onSphere(th+.25,phi+.15,1)).normalize();
   g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...onSphere(th,phi,1.03)),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir),new THREE.Vector3(1,1,1)));list.push(g);}
  skull.add(part(geo('spikes',()=>mergeGeometries(list)),hairMat(look.hair)));}
 if(h.dreads){const list=[];for(let k=0;k<28;k++){const phi=1.15+k/27*(PI*2-2.3),th=h.line(phi)*.9,s0=onSphere(th,phi,1.06),out=1.14;
   const len=lerp(1.3,2.1,smoothstep(.2,-1,Math.cos(phi)))+(k%3)*.08;
   const wob=.06*Math.sin(k*2.3);list.push(taper([s0,[Math.sin(phi)*out,s0[1]-.4,Math.cos(phi)*out],[Math.sin(phi+wob)*out*1.04,-len*.6,Math.cos(phi+wob)*out*1.04],[Math.sin(phi)*out*1.02,-len,Math.cos(phi)*out*1.02]],.12,.08,{rad:7,seg:12}));}
  skull.add(part(geo('dreads',()=>mergeGeometries(list)),M(look.hair,{roughness:.85})));}
 if(h.pigtails){const tails=[];for(const side of [-1,1]){const t=new THREE.Group();t.position.set(...onSphere(.52*PI,side*2.0,1.04));skull.add(t);
   t.add(part(ring(.13,.05),M(look.accent||'#c76b98'),{ry:side*2.0,rx:PI/2}));
   t.add(part(geo('pigtail'+side,()=>taper([[0,0,0],[side*.25,-.3,-.05],[side*.32,-.95,-.02],[side*.22,-1.55,.02]],.22,.06,{bulge:.06})),hairMat(look.hair)));tails.push(t);}
  return tails;}
 if(h.braid){const pts=[];for(let i=0;i<11;i++){const t=i/10;pts.push([0,lerp(-.25,-2.4,t),lerp(-1.02,-.98,t)-Math.sin(t*PI)*.08,.2-t*.07,.22-t*.07,.2-t*.07,0,(i%2?.5:-.5)]);}
  skull.add(part(geo('braid1',()=>balls(pts)),hairMat(look.hair)),part(G.lowSphere,M(look.accent||'#c76b98'),{y:-2.5,z:-.98,sx:.1,sy:.08,sz:.1}));}
 if(h.tie&&!hat)skull.add(part(G.lowSphere,hairMat(look.hair),{y:.3,z:-1.1,sx:.2,sy:.17,sz:.16}),part(ring(.11,.04),M(look.accent||'#3b2a1e'),{y:.22,z:-1.07,rx:.3}));
 if(h.crest&&!hat){const spikes=[];for(let i=0;i<8;i++){const th=.3*PI-i*.12*PI,g=new THREE.ConeGeometry(.14-i*.006,.52-Math.abs(i-2.5)*.035,10);
   g.translate(0,.25,0);g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0,Math.cos(th)*.98,Math.sin(th)*.98),new THREE.Quaternion().setFromEuler(new THREE.Euler(th,0,0)),new THREE.Vector3(.55,1,1.1)));spikes.push(g);}
  skull.add(part(geo('crest',()=>mergeGeometries(spikes)),hairMat(look.hair)));}
 if(h.braids)for(const side of [-1,1]){const pts=[];for(let i=0;i<9;i++){const t=i/8;pts.push([side*lerp(.82,.55,t),lerp(-.15,-2.1,t),lerp(-.62,-.95,t),.17-t*.05,.2-t*.05,.17-t*.05,.0,side*(i%2?.45:-.45)]);}
  skull.add(part(geo('braid'+side,()=>balls(pts)),hairMat(look.hair)),part(G.lowSphere,M(look.accent||'#c76b98'),{x:side*.55,y:-2.2,z:-.95,sx:.09,sy:.07,sz:.09}));}
 if(h.tail){// The ponytail swings on its own joint (animate moves p.tail).
  const t=new THREE.Group();t.position.set(0,hat?-.05:.12,-1.06);skull.add(t);
  t.add(part(ring(.16,.06),M(look.accent||'#3b2a1e'),{rx:.3}));
  t.add(part(geo('tail',()=>taper([[0,0,-.02],[0,-.3,-.28],[0,-1.0,-.32],[0,-1.8,-.12]],.26,.07,{bulge:.08})),hairMat(look.hair)));
  return [t];}
 return tail;
}

// ---------- hats ----------
// Where a hat ends on the head (it covers what is above).
const HAT_LINES={gorra:hairline(.42,.5,.56,{ear:0,burn:0}),gorro:hairline(.41,.53,.62,{ear:0,burn:0}),sombrero:hairline(.36,.42,.46,{ear:0,burn:0}),
 boina:hairline(.33,.38,.42,{ear:0,burn:0}),piluso:hairline(.4,.47,.52,{ear:0,burn:0}),plana:hairline(.39,.47,.53,{ear:0,burn:0}),
 bombin:hairline(.37,.43,.47,{ear:0,burn:0}),panama:hairline(.36,.42,.46,{ear:0,burn:0}),gaucho:hairline(.36,.42,.46,{ear:0,burn:0}),bandana:hairline(.38,.5,.6,{ear:0,burn:0})};
HAT_LINES.atras=HAT_LINES.gorra;
const hatLine=hat=>HAT_LINES[hat]||(()=>0);
function buildHat(head,skull,look){
 const hat=look.hat,ac=look.accent||'#7a2f2f';
 if(hat==='gorra'||hat==='atras'){const back=hat==='atras';
  skull.add(part(geo('gorra',()=>patch({to:HAT_LINES.gorra,thick:.1,lip:true})),texMat('panel',ac,panels())));
  skull.add(part(G.lowSphere,M(ac),{y:1.115,sx:.08,sy:.05,sz:.08}));
  const visor=geo('visor',()=>{const s=new THREE.Shape();s.moveTo(-.2,0);s.absellipse(0,0,.2,.2,PI,0,true);s.lineTo(-.2,0);
   const g=new THREE.ExtrudeGeometry(s,{depth:.014,bevelEnabled:true,bevelThickness:.004,bevelSize:.004,bevelSegments:2,curveSegments:24});g.translate(0,0,-.007);return g;});
  head.add(part(visor,hatMat(shade(ac,.85),{roughness:.75}),back?{y:.07,z:-.19,ry:PI,rx:-(PI/2+.2)}:{y:.075,z:.19,rx:PI/2+.16}));
  if(back)head.add(part(geo('snap',()=>new THREE.TorusGeometry(.05,.012,8,16,PI)),M(shade(ac,.7)),{y:.12,z:.262,rz:PI}));}
 if(hat==='gorro'){const wool=texMat('wool',ac,ribs(),{roughness:.95});
  skull.add(part(geo('gorro',()=>patch({to:HAT_LINES.gorro,thick:.16,lip:true,extra:(p,th)=>.04*(1-smoothstep(0,.3*PI,th))})),wool));
  const L=HAT_LINES.gorro;skull.add(part(geo('gorro-cuff',()=>patch({from:p=>L(p)-.12*PI,to:L,thick:.2,lip:true,taper:.3,extra:(p,th,v)=>.03*smoothstep(0,.3,v)})),wool));
  skull.add(part(geo('pompom',()=>{const g=new THREE.IcosahedronGeometry(1,3),p=g.attributes.position;for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i);v.multiplyScalar(1+.12*Math.sin(v.x*9)*Math.sin(v.y*8)*Math.sin(v.z*10));p.setXYZ(i,v.x,v.y,v.z);}g.computeVertexNormals();return g;}),M('#f4f1ea',{roughness:1}),{y:1.36,sx:.27,sy:.25,sz:.27}));}
 if(hat==='sombrero'){const felt=hatMat(ac,{roughness:.9}),band=hatMat(shade(ac,.45),{roughness:.6});
  head.add(part(lathe('crown',[[0,.36],[.1,.355],[.17,.345],[.215,.315],[.235,.26],[.25,.18],[.262,.1],[.262,.09]]),felt,{sz:.94}));
  head.add(part(G.sphere,felt,{y:.352,sx:.17,sy:.02,sz:.15}));
  head.add(part(lathe('brim',[[.25,.1],[.38,.094],[.44,.104],[.465,.124],[.47,.132],[.455,.126],[.43,.11],[.38,.104],[.25,.112]]),felt));
  head.add(part(tube(.2635,.05),band,{y:.125,sz:.94}));}
 if(hat==='bombin'){const felt=hatMat(ac,{roughness:.6});
  head.add(part(lathe('bowler',[[0,.39],[.12,.385],[.2,.36],[.243,.3],[.257,.2],[.262,.11]]),felt));
  head.add(part(lathe('bowler-brim',[[.25,.11],[.32,.105],[.355,.12],[.36,.135],[.345,.128],[.32,.114],[.25,.12]]),felt));
  head.add(part(tube(.2632,.035),hatMat(shade(ac,.5),{roughness:.4}),{y:.128}));}
 if(hat==='panama'){const straw=texMat('straw','#e6d3a3',weave(),{side:THREE.DoubleSide,roughness:.9});
  head.add(part(lathe('panama',[[0,.33],[.15,.322],[.215,.3],[.243,.24],[.258,.16],[.262,.1]]),straw));
  head.add(part(lathe('panama-brim',[[.25,.1],[.42,.092],[.45,.1],[.452,.108],[.42,.102],[.25,.112]]),straw));
  head.add(part(tube(.2632,.045),hatMat(ac,{roughness:.6}),{y:.125}));}
 if(hat==='gaucho'){const felt=hatMat(ac,{roughness:.9});
  head.add(part(lathe('gaucho',[[0,.31],[.2,.31],[.235,.302],[.25,.2],[.262,.1]]),felt));
  head.add(part(lathe('gaucho-brim',[[.25,.1],[.5,.098],[.505,.106],[.5,.114],[.25,.118]]),felt));
  head.add(part(tube(.2632,.03),hatMat(shade(ac,.5)),{y:.12}));
  head.add(part(geo('barbijo',()=>taper([[-.262,.1,.02],[-.24,-.12,.07],[0,-.3,.12],[.24,-.12,.07],[.262,.1,.02]],.005,.005,{rad:6,seg:24})),M('#2a1d14')));}
 if(hat==='plana'){const c=hatMat(ac,{roughness:.95});
  skull.add(part(geo('plana',()=>patch({to:HAT_LINES.plana,thick:.08,lip:true})),texMat('tweed',ac,weave(),{roughness:.95})));
  head.add(part(lathe('flatcap',[[0,.3],[.2,.295],[.28,.26],[.295,.235],[.28,.215],[.24,.205]]),c,{y:-.012,z:.025,rx:.2,sz:1.08}));
  head.add(part(geo('cap-brim',()=>{const s=new THREE.Shape();s.moveTo(-.15,0);s.absellipse(0,0,.15,.1,PI,0,true);s.lineTo(-.15,0);return new THREE.ExtrudeGeometry(s,{depth:.012,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:1,curveSegments:18});}),c,{y:.1,z:.23,rx:PI/2+.42}));}
 if(hat==='bandana'){const cloth=texMat('paisley',ac,dots(),{roughness:.85});
  skull.add(part(geo('bandana',()=>patch({to:HAT_LINES.bandana,thick:.06,lip:true})),cloth));
  head.add(part(G.lowSphere,cloth,{y:.02,z:-.27,sx:.04,sy:.035,sz:.03}));
  for(const side of [-1,1])head.add(part(rbox(.03,.1,.008,.004),cloth,{x:side*.025,y:-.04,z:-.27,rz:side*.35}));}
 if(hat==='boina'){const b=hatMat(ac,{roughness:.95});
  skull.add(part(geo('boina-band',()=>patch({to:HAT_LINES.boina,thick:.06,lip:true})),b));
  head.add(part(lathe('beret',[[0,.315],[.12,.31],[.21,.29],[.27,.255],[.285,.225],[.275,.2],[.245,.185],[.2,.19]]),b,{x:-.02,y:-.005,rz:.14,sz:.97}));
  head.add(part(capsule(.012,.03),b,{x:-.06,y:.315,rz:.2}));}
 if(hat==='piluso'){const c=hatMat(ac,{roughness:.9});
  skull.add(part(geo('piluso',()=>patch({to:HAT_LINES.piluso,thick:.13,lip:true})),c));
  head.add(part(lathe('bucket',[[.255,.12],[.33,.07],[.385,.04],[.392,.03],[.38,.028],[.325,.058],[.255,.107]]),c));}
 if(hat==='vincha'){const L1=hairline(.24,.3,.36,{ear:0,burn:0}),L2=hairline(.31,.37,.43,{ear:0,burn:0});
  skull.add(part(geo('vincha',()=>patch({from:L1,to:L2,thick:.1,taper:.25})),M(ac,{roughness:.8})));}
}

// ---------- the face ----------
function buildFace(head,skull,look,skin){
 const hidden=!!HAIR[look.style]?.curtain;
 head.add(part(G.sphere,skin,{sx:.25,sy:.27,sz:.25}));
 // Ears, nose, eyes (white, pupil, a glint), brows and mouth.
 // Ears (long hair covers them).
 if(!hidden)for(const side of [-1,1])head.add(part(G.lowSphere,skin,{x:side*.243,y:-.005,z:.005,sx:.035,sy:.062,sz:.048,rz:side*-.1}));
 head.add(part(G.lowSphere,skin,{y:-.03,z:.25,sx:.042,sy:.05,sz:.04}));
 const white=M('#fbfaf6',{roughness:.3}),pupil=M('#221a16',{roughness:.25}),glint=M('#ffffff',{emissive:'#ffffff',emissiveIntensity:.6});
 for(const side of [-1,1]){const x=side*.083;
  head.add(part(G.lowSphere,white,{x,y:.032,z:.218,sx:.036,sy:.04,sz:.016}),part(G.lowSphere,pupil,{x:x+side*.002,y:.028,z:.229,sx:.022,sy:.027,sz:.01}),
   part(G.lowSphere,glint,{x:x+.008,y:.04,z:.238,sx:.006,sy:.006,sz:.003}));
  head.add(part(capsule(.011,.045),M(look.hair||'#3b2a1e',{roughness:.8}),{x,y:.098,z:.214,rz:PI/2+side*.12,rx:-.32}));
  if(look.female)head.add(part(G.box,pupil,{x:x+side*.03,y:.055,z:.218,sx:.022,sy:.006,sz:.006,rz:side*-.5}));}
 head.add(part(capsule(.012,.05),M(look.female?'#b8484a':'#a4544a',{roughness:.45}),{y:-.125,z:.222,rz:PI/2}));
 // Facial hair: a beard is a patch on the lower face; a mustache a curved tube above the lip.
 const f=look.face,hm=hairMat(look.hair||'#3b2a1e');
 if(f==='patillas')for(const side of [-1,1])skull.add(part(geo('chops'+side,()=>patch({arc:side>0?[.98,1.6]:[-1.6,-.98],from:()=>.44*PI,to:p=>{const k=(Math.abs(p)-.98)/.62;return (.6+.12*Math.sin(k*PI))*PI;},thick:.065,taper:.3,segU:24})),hm));
 if(f==='barba'||f==='tres'||f==='larga'){const short=f==='tres',sides=false;
  const top=p=>{const a=Math.abs(Math.atan2(Math.sin(p),Math.cos(p)));return (a<1.95?lerp(.655,.47,smoothstep(0,1.6,a)):.47)*PI;};
  const g=geo('beard'+f,()=>patch({from:top,to:p=>{const a=Math.abs(Math.atan2(Math.sin(p),Math.cos(p)));return lerp(.96,.7,smoothstep(.6,1.9,a))*PI;},
   thick:short?.012:.07,taper:.22,extra:short?null:(p,th)=>.12*Math.max(0,Math.cos(p))**3*smoothstep(.7*PI,.88*PI,th)}));
  // Only the front half of the head: the beard stops at the sideburns.
  skull.add(part(sides?keepAngles(g,'chops',.62,1.95):beardOnly(g,'beard'+f),short?M(shade(look.hair||'#3b2a1e',.9),{roughness:.95,transparent:true,opacity:.55}):hm));}
 // A long beard hangs below the chin (in front of the chest).
 if(f==='larga')head.add(part(geo('longbeard',()=>taper([[0,-.2,.16],[0,-.3,.2],[0,-.4,.215],[0,-.46,.2]],.09,.02,{bulge:.02})),hm,{sx:1.25,sz:.75}));
 if(f==='manubrio')head.add(part(geo('handlebar',()=>taper([[-.12,-.05,.18],[-.1,-.085,.205],[-.05,-.09,.238],[0,-.08,.25],[.05,-.09,.238],[.1,-.085,.205],[.12,-.05,.18]],.017,.017,{bulge:.006,seg:28})),hm));
 if(f==='barba'||f==='larga'||f==='bigote'||f==='candado')head.add(part(geo('stache',()=>taper([[-.075,-.1,.205],[-.04,-.085,.236],[0,-.08,.25],[.04,-.085,.236],[.075,-.1,.205]],.016,.016,{bulge:.008,seg:20})),hm));
 if(f==='candado')skull.add(part(geo('goatee',()=>patch({arc:[-.8,.8],from:p=>(.655+.05*(p/.8)**2)*PI,to:p=>(.9-.17*(p/.8)**2)*PI,thick:.07,taper:.35,segU:24})),hm));
 if(f==='chivita')skull.add(part(geo('soulpatch',()=>patch({arc:[-.3,.3],from:()=>.665*PI,to:p=>(.77-.07*(p/.3)**2)*PI,thick:.045,taper:.4,segU:12})),hm));
}
// Keeps the part of a patch between two angles from the front (sideburns that leave the chin bare).
function keepAngles(g,key,lo,hi){return geo('ang:'+key,()=>{const src=g.index?g.toNonIndexed():g,p=src.attributes.position,uv=src.attributes.uv,P2=[],U2=[];
 for(let i=0;i<p.count;i+=3){let ok=true;for(let k=0;k<3;k++){const a=Math.abs(Math.atan2(p.getX(i+k),p.getZ(i+k)));if(a<lo||a>hi)ok=false;}
  if(ok)for(let k=0;k<3;k++){P2.push(p.getX(i+k),p.getY(i+k),p.getZ(i+k));U2.push(uv.getX(i+k),uv.getY(i+k));}}
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(P2,3));out.setAttribute('uv',new THREE.Float32BufferAttribute(U2,2));out.computeVertexNormals();return out;});}
// Keeps the part of a patch facing front (|phi| < limit radians): beards.
function beardOnly(g,key,limit=1.95){return geo('front:'+key+limit,()=>{
 const src=g.index?g.toNonIndexed():g,p=src.attributes.position,uv=src.attributes.uv,keepP=[],keepU=[];
 for(let i=0;i<p.count;i+=3){let ok=true;for(let k=0;k<3;k++){const x=p.getX(i+k),z=p.getZ(i+k);if(Math.abs(Math.atan2(x,z))>limit)ok=false;}
  if(ok)for(let k=0;k<3;k++){keepP.push(p.getX(i+k),p.getY(i+k),p.getZ(i+k));keepU.push(uv.getX(i+k),uv.getY(i+k));}}
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(keepP,3));out.setAttribute('uv',new THREE.Float32BufferAttribute(keepU,2));out.computeVertexNormals();return out;});}

// ---------- glasses ----------
function roundRect(s,w,h,r){const x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
 s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function drop(s,w,h){// An aviator's teardrop, wider at the top.
 s.moveTo(-w/2,h*.25);s.bezierCurveTo(-w/2,h*.62,w/2,h*.62,w/2,h*.25);s.bezierCurveTo(w/2,-h*.25,w*.22,-h*.55,-w*.05,-h*.5);s.bezierCurveTo(-w*.38,-h*.45,-w/2,-h*.05,-w/2,h*.25);return s;}
const GLASSES={
 lentes:{shape:(s,k)=>roundRect(s,.105*k,.07*k,.022*k),rim:.009,frame:'#1b1b1d',lens:'clear'},
 redondos:{shape:(s,k)=>{s.absarc(0,0,.05*k,0,PI*2,false);return s;},rim:.006,frame:'#c9a24a',metal:true,lens:'clear'},
 sol:{shape:(s,k)=>{const w=.118*k,h=.078*k;s.moveTo(-w/2,h/2);s.lineTo(w/2,h/2);s.quadraticCurveTo(w/2+.004,-h*.1,w*.28,-h/2);s.lineTo(-w*.3,-h/2);s.quadraticCurveTo(-w/2-.004,-h*.15,-w/2,h/2);return s;},rim:.015,frame:'#121214',lens:'dark'},
 aviador:{shape:(s,k)=>drop(s,.11*k,.09*k),rim:.005,frame:'#d4b36a',metal:true,lens:'brown',double:true},
 gatito:{shape:(s,k)=>{const w=.11*k,h=.07*k;s.moveTo(-w/2,h*.15);s.bezierCurveTo(-w/2,h*.55,w*.15,h*.5,w/2+.012*k,h*.72);s.bezierCurveTo(w/2,h*.1,w*.35,-h/2,0,-h/2);s.bezierCurveTo(-w*.42,-h/2,-w/2,-h*.25,-w/2,h*.15);return s;},rim:.012,frame:'#2a1416',lens:'clear',mirror:true},
 gruesos:{shape:(s,k)=>{s.absarc(0,0,.056*k,0,PI*2,false);return s;},rim:.017,frame:'#3a2416',lens:'clear'},
 clubmaster:{shape:(s,k)=>roundRect(s,.1*k,.068*k,.026*k),rim:.005,frame:'#c9a24a',metal:true,lens:'clear',brow:'#1b1b1d'},
 solredondos:{shape:(s,k)=>{s.absarc(0,0,.048*k,0,PI*2,false);return s;},rim:.006,frame:'#c9a24a',metal:true,lens:'dark'},
 deportivos:{wrap:true,frame:'#1b1b1d'}};
function buildGlasses(head,kind){
 const G2=GLASSES[kind];if(!G2)return;
 const frame=M(G2.frame,G2.metal?{metalness:.85,roughness:.25,side:THREE.DoubleSide}:{roughness:.35,side:THREE.DoubleSide});
 const temples=()=>{for(const side of [-1,1])head.add(part(geo('temple'+side,()=>taper([[side*.142,.045,.25],[side*.205,.05,.21],[side*.256,.045,.11],[side*.258,.035,.02],[side*.25,.0,-.03]],.0055,.0055,{rad:8,seg:16})),frame));};
 // Sports glasses: one wide mirrored lens around the face.
 if(G2.wrap){head.add(part(geo('wrap-lens',()=>new THREE.CylinderGeometry(.272,.27,.07,32,1,true,-1.0,2.0)),M('#24508a',{metalness:.75,roughness:.12,side:THREE.DoubleSide}),{y:.04,sz:1.0}));
  head.add(part(geo('wrap-top',()=>{const pts=[];for(let i=0;i<=16;i++){const a=-1.0+i/16*2.0;pts.push([Math.sin(a)*.275,.077,Math.cos(a)*.275]);}return taper(pts,.007,.007,{rad:6,seg:30});}),frame));temples();return;}
 const lens=G2.lens==='clear'?M('#d8ecff',{transparent:true,opacity:.18,roughness:.05,side:THREE.DoubleSide}):G2.lens==='brown'?M('#3a2614',{transparent:true,opacity:.86,roughness:.08,metalness:.4}):M('#0c0d10',{roughness:.06,metalness:.5});
 const fr=geo('frame:'+kind,()=>{const outer=G2.shape(new THREE.Shape(),1),inner=G2.shape(new THREE.Path(),1-G2.rim*2/.1);outer.holes.push(inner);
  return new THREE.ExtrudeGeometry(outer,{depth:.008,bevelEnabled:true,bevelThickness:.002,bevelSize:.0015,bevelSegments:2,curveSegments:20});});
 const ln=geo('lens:'+kind,()=>new THREE.ShapeGeometry(G2.shape(new THREE.Shape(),1-G2.rim*2/.1),20));
 for(const side of [-1,1]){const x=side*.088;
  const sx=G2.mirror&&side<0?-1:1;head.add(part(fr,frame,{x,y:.035,z:.252,ry:side*.1,sx}),part(ln,lens,{x,y:.035,z:.256,ry:side*.1,sx}));
  if(G2.brow)head.add(part(rbox(.104,.026,.014,.006),M(G2.brow,{roughness:.3}),{x,y:.062,z:.256,ry:side*.1}));
  head.add(part(geo('temple'+side,()=>taper([[side*.142,.045,.25],[side*.205,.05,.21],[side*.256,.045,.11],[side*.258,.035,.02],[side*.25,.0,-.03]],.0055,.0055,{rad:8,seg:16})),frame));}
 head.add(part(geo('bridge'+kind,()=>taper([[-.04,.045,.262],[0,.06,.272],[.04,.045,.262]],.006,.006,{rad:8,seg:10})),frame));
 if(G2.double)head.add(part(geo('bridge2',()=>taper([[-.05,.085,.262],[0,.088,.27],[.05,.085,.262]],.004,.004,{rad:6,seg:10})),frame));
}

// ---------- clothes ----------
// The torso is a capsule (radius .23, a bit flat front to back); the arms hang from the shoulders.
function buildTop(spine,arms,look,m){
 const o=look.outfit,{shirt,skin}=m,trim=M(shade(look.shirt,.78),{roughness:.85}),white=M('#f4f1ea',{roughness:.7}),ac=M(look.detail||look.accent,{roughness:.8});
 const sleeves=LONG_SLEEVES.has(o)?'long':NO_SLEEVES.has(o)?'none':'short';
 // Shoulders: round, so the arm joins the chest smoothly.
 if(sleeves!=='none')for(const side of [-1,1])spine.add(part(G.sphere,o==='raglan'?ac:shirt,{x:side*.295,y:.55,sx:.094,sy:.09,sz:.092}));
 // The hem at the waist and the neckline.
 if(o!=='vestido'&&o!=='saco')spine.add(part(tube(.208,.05),trim,{y:-.02,sz:.8}));
 if(['remera','rayas','pollera','musculosa','estampada','mangalarga','raglan'].includes(o))spine.add(part(ring(.115,.016),trim,{y:.655,z:.02,sz:.85,rx:PI/2-.25}));
 for(const side of [-1,1]){const {shoulder,elbow}=arms[side];
  if(sleeves==='short'){shoulder.add(part(cone(.094,.088,.19),shirt,{y:-.085}),part(ring(.088,.011),trim,{y:-.172,rx:PI/2}));}
  if(sleeves==='long'){const sl=o==='raglan'?ac:shirt;elbow.children[0].material=sl;elbow.userData.joint.material=sl;shoulder.children[0].material=sl;elbow.add(part(ring(.066,.014),o==='saco'?white:trim,{y:-.29,rx:PI/2}));}
  if(sleeves!=='long')shoulder.children[0].material=skin;}
 if(o==='camiseta'){spine.add(part(geo('vneck',()=>taper([[-.11,.64,.08],[0,.52,.2],[.11,.64,.08]],.016,.016,{rad:8,seg:12})),white));
  spine.add(part(geo('jersey-back',()=>new THREE.CylinderGeometry(.236,.236,.24,20,1,true,PI-.5,1.0)),number(look.shirt),{y:.36,sz:.79}));
  for(const side of [-1,1])arms[side].shoulder.add(part(ring(.089,.012),white,{y:-.17,rx:PI/2}));}
 if(o==='chomba'){spine.add(part(ring(.12,.026),shirt,{y:.66,z:.02,sz:.88,rx:PI/2-.3}));
  for(const side of [-1,1])spine.add(part(G.box,shirt,{x:side*.055,y:.625,z:.165,sx:.1,sy:.04,sz:.08,rz:side*-.45,rx:-.3}));
  spine.add(part(G.box,trim,{y:.56,z:.178,sx:.045,sy:.12,sz:.012}));for(let i=0;i<2;i++)spine.add(part(G.lowSphere,white,{y:.6-i*.05,z:.186,sx:.009,sy:.009,sz:.005}));
  spine.add(part(G.lowSphere,ac,{x:.1,y:.5,z:.172,sx:.018,sy:.018,sz:.006}));}
 if(o==='camisa'){const collar=geo('collar',()=>{const s=new THREE.Shape();s.moveTo(0,0);s.lineTo(.075,-.015);s.lineTo(.04,-.085);s.lineTo(-.005,-.03);s.lineTo(0,0);
   return new THREE.ExtrudeGeometry(s,{depth:.012,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:1});});
  for(const side of [-1,1])spine.add(part(collar,shirt,{x:side*.012,y:.665,z:.14,sx:side,rx:-.35}));
  spine.add(part(ring(.115,.02,PI*1.4),shirt,{y:.655,z:.0,sz:.85,rx:PI/2-.15,rz:PI*1.3}));
  spine.add(part(G.box,trim,{y:.38,z:.177,sx:.035,sy:.5,sz:.008}));
  for(let i=0;i<5;i++)spine.add(part(G.lowSphere,white,{y:.57-i*.1,z:.184,sx:.009,sy:.009,sz:.005}));
  spine.add(part(rbox(.075,.07,.01,.004),trim,{x:-.1,y:.47,z:.174}));}
 if(o==='polera')spine.add(part(geo('turtle',()=>new THREE.CylinderGeometry(.115,.13,.13,24,1,true)),texMat('wool',look.shirt,ribs(),{roughness:.9}),{y:.7,sz:.9}),
  part(ring(.118,.02),shirt,{y:.765,sz:.9,rx:PI/2}));
 if(o==='buzo'){spine.add(part(geo('hood',()=>new THREE.TorusGeometry(.15,.075,12,28,PI*1.25)),shirt,{y:.62,z:-.06,sz:1.1,rx:-PI/2+.5,rz:PI*.875}));
  spine.add(part(rbox(.26,.13,.04,.02),trim,{y:.24,z:.17}));
  for(const side of [-1,1])spine.add(part(capsule(.006,.12),white,{x:side*.045,y:.5,z:.188}),part(G.lowSphere,white,{x:side*.045,y:.43,z:.19,sx:.011,sy:.016,sz:.011}));
  for(const side of [-1,1])arms[side].elbow.add(part(ring(.066,.016),trim,{y:-.28,rx:PI/2}));
  spine.add(part(tube(.212,.07),texMat('wool',shade(look.shirt,.85),ribs()),{y:-.02,sz:.8}));}
 if(o==='campera'){spine.add(part(G.box,M('#e9e3d2'),{y:.4,z:.173,sx:.075,sy:.5,sz:.02}));
  spine.add(part(G.box,M('#bdbdbd',GOLD),{x:.045,y:.38,z:.186,sx:.007,sy:.48,sz:.008}),part(G.box,M('#bdbdbd',GOLD),{x:.045,y:.6,z:.19,sx:.018,sy:.03,sz:.01}));
  spine.add(part(geo('jacket-collar',()=>new THREE.CylinderGeometry(.13,.145,.09,24,1,true,PI*.12,PI*1.76)),shirt,{y:.68,sz:.9}));
  for(const side of [-1,1])spine.add(part(rbox(.09,.012,.04,.004),trim,{x:side*.11,y:.2,z:.17,rz:side*.15}));
  for(const side of [-1,1])arms[side].elbow.add(part(ring(.067,.017),trim,{y:-.28,rx:PI/2}));
  spine.add(part(tube(.212,.06),texMat('wool',shade(look.shirt,.8),ribs()),{y:-.02,sz:.8}));}
 if(o==='saco'){// A jacket over a white shirt: lapels, the shirt's V and a tie in the accent color.
  spine.add(part(geo('shirt-v',()=>new THREE.CylinderGeometry(.205,.21,.3,24,1,true,-.35,.7)),white,{y:.5,z:.004,sz:.82}));
  spine.add(part(geo('tie',()=>{const s=new THREE.Shape();s.moveTo(-.014,0);s.lineTo(.014,0);s.lineTo(.028,-.2);s.lineTo(0,-.24);s.lineTo(-.028,-.2);s.lineTo(-.014,0);return new THREE.ExtrudeGeometry(s,{depth:.008,bevelEnabled:false});}),ac,{y:.63,z:.172,rx:-.14}));
  const lapel=geo('lapel',()=>{const s=new THREE.Shape();s.moveTo(0,0);s.lineTo(.05,.02);s.lineTo(.085,-.06);s.lineTo(.07,-.09);s.lineTo(.02,-.3);s.lineTo(0,-.3);s.lineTo(0,0);return new THREE.ExtrudeGeometry(s,{depth:.012,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:1});});
  const lap=M(tint(shade(look.shirt,.9),.12),{roughness:.5});for(const side of [-1,1])spine.add(part(lapel,lap,{x:side*.05,y:.66,z:.15,sx:side,rx:-.2}));
  for(let i=0;i<2;i++)spine.add(part(G.lowSphere,M('#1e1e22'),{x:.012,y:.28-i*.09,z:.185,sx:.012,sy:.012,sz:.006}));
  for(const side of [-1,1])spine.add(part(rbox(.09,.012,.04,.004),trim,{x:side*.11,y:.16,z:.172,rz:side*.1}));
  spine.add(part(rbox(.06,.01,.03,.003),trim,{x:-.11,y:.47,z:.172}),part(G.lowSphere,ac,{x:-.11,y:.485,z:.176,sx:.02,sy:.015,sz:.006}));}
 if(o==='estampada')spine.add(part(geo('print',()=>new THREE.CylinderGeometry(.236,.236,.2,20,1,true,-.5,1.0)),printMat(look.detail||look.accent),{y:.43,sz:.79}));
 if(o==='cuellov'){spine.add(part(geo('vskin',()=>{const s=new THREE.Shape();s.moveTo(-.07,0);s.lineTo(.07,0);s.lineTo(0,-.12);s.lineTo(-.07,0);return new THREE.ExtrudeGeometry(s,{depth:.01,bevelEnabled:false});}),skin,{y:.665,z:.155,rx:-.25}));
  spine.add(part(geo('vtrim',()=>taper([[-.075,.665,.16],[0,.54,.19],[.075,.665,.16]],.012,.012,{rad:8,seg:12})),trim));}
 if(o==='buzocierre'){spine.add(part(geo('hood',()=>new THREE.TorusGeometry(.15,.075,12,28,PI*1.25)),shirt,{y:.62,z:-.06,sz:1.1,rx:-PI/2+.5,rz:PI*.875}));
  spine.add(part(G.box,M(look.accent==='#f4f1ea'?'#1f1f24':'#f4f1ea'),{y:.4,z:.172,sx:.06,sy:.5,sz:.02}));
  for(const side of [-1,1])spine.add(part(G.box,M('#9a9a9a',GOLD),{x:side*.036,y:.38,z:.184,sx:.006,sy:.48,sz:.008}),part(capsule(.006,.12),white,{x:side*.06,y:.52,z:.188}));
  for(const side of [-1,1])spine.add(part(rbox(.09,.1,.02,.02),trim,{x:side*.12,y:.22,z:.17}));
  for(const side of [-1,1])arms[side].elbow.add(part(ring(.066,.016),trim,{y:-.28,rx:PI/2}));
  spine.add(part(tube(.212,.07),texMat('wool',shade(look.shirt,.85),ribs()),{y:-.02,sz:.8}));}
 if(o==='sueter'){spine.add(part(ring(.12,.028),texMat('wool',shade(look.shirt,.82),ribs()),{y:.66,z:.01,sz:.86,rx:PI/2-.22}));
  for(const side of [-1,1])arms[side].elbow.add(part(ring(.067,.018),texMat('wool',shade(look.shirt,.82),ribs()),{y:-.28,rx:PI/2}));
  spine.add(part(tube(.212,.08),texMat('wool',shade(look.shirt,.82),ribs()),{y:-.02,sz:.8}));}
 if(o==='mangalarga'||o==='raglan')for(const side of [-1,1])arms[side].elbow.add(part(ring(.066,.014),o==='raglan'?ac:trim,{y:-.29,rx:PI/2}));
 if(o==='musculosa'){for(const side of [-1,1])spine.add(part(G.box,shirt,{x:side*.13,y:.6,z:.0,sx:.07,sy:.08,sz:.34}));}
 if(o==='vestido'||o==='pollera')spine.add(part(tube(.212,.035),M('#1e1e22',{roughness:.5}),{y:.02,sz:.8}));
 // Around the neck.
 const n=look.neck,acc=M(look.accent,{roughness:.85});
 if(n==='bufanda'){const knit=texMat('wool',look.accent,ribs(),{roughness:.95});
  spine.add(part(ring(.165,.065),knit,{y:.64,sz:.85,rx:PI/2-.12}));
  spine.add(part(rbox(.1,.3,.04,.018),knit,{x:.075,y:.45,z:.18,rz:.06}),part(rbox(.1,.22,.04,.018),knit,{x:.0,y:.5,z:.19,rz:-.1}));
  for(let i=0;i<4;i++)spine.add(part(G.box,acc,{x:.045+i*.02,y:.285,z:.18,sx:.008,sy:.04,sz:.012}));}
 const chain=M('#e8c25a',GOLD);
 if(n==='cadena'||n==='medalla')spine.add(part(ring(.118,.006,PI),chain,{y:.63,z:.11,rx:-.55,rz:PI}));
 if(n==='medalla')spine.add(part(geo('medal',()=>new THREE.CylinderGeometry(.034,.034,.01,24)),chain,{y:.51,z:.198,rx:PI/2-.2}));
 if(n==='perlas'){const list=[];for(let i=0;i<15;i++){const a=PI*(i+.5)/15;list.push([Math.cos(a)*.125,.63-Math.sin(a)*.115,.12+Math.sin(a)*.065,.016]);}
  spine.add(part(geo('pearls',()=>balls(list,G.sphere)),M('#f6f2ea',{roughness:.2,metalness:.1})));}
}
// Legs: jeans with seams and turned-up hems, chinos, joggers with a stripe, or shorts.
function buildLegs(legs,look,m,skirt){
 const q=look.legs,pants=m.pants;
 for(const side of [-1,1]){const {thigh,knee}=legs[side];
  if(skirt)continue;
  if(q==='bermuda'){knee.children[0].material=m.skin;knee.userData.joint.material=m.skin;thigh.add(part(cone(.112,.115,.16),pants,{y:-.36}),part(ring(.113,.012),M(shade(look.pants,.8)),{y:-.44,rx:PI/2}));continue;}
  if(q==='jean'){const seam=M(shade(look.pants,1.35),{roughness:.9});
   thigh.add(part(G.box,seam,{x:side*.099,y:-.18,sx:.004,sy:.34,sz:.012}));knee.add(part(G.box,seam,{x:side*.087,y:-.17,sx:.004,sy:.3,sz:.012}));
   knee.add(part(tube(.094,.045),M(shade(look.pants,1.15)),{y:-.36}));}
  if(q==='jogging'){knee.add(part(tube(.084,.05),M(shade(look.pants,.8),{roughness:.95}),{y:-.38}));
   const stripe=M('#f4f1ea');thigh.add(part(G.box,stripe,{x:side*.1,y:-.18,sx:.006,sy:.36,sz:.022}));knee.add(part(G.box,stripe,{x:side*.088,y:-.15,sx:.006,sy:.28,sz:.02}));}
  if(q==='chino')knee.add(part(tube(.092,.03),M(shade(look.pants,.9)),{y:-.375}));
  if(q==='cargo'){const pk=M(shade(look.pants,.85),{roughness:.9});thigh.add(part(rbox(.05,.12,.11,.012),pk,{x:side*.098,y:-.24}),part(rbox(.054,.025,.115,.006),pk,{x:side*.1,y:-.175}));
   knee.add(part(tube(.093,.035),pk,{y:-.375}));}
  if(q==='vestir'){const crease=M(shade(look.pants,.75));thigh.add(part(G.box,crease,{z:.098,y:-.18,sx:.006,sy:.34,sz:.004}));knee.add(part(G.box,crease,{z:.086,y:-.17,sx:.006,sy:.32,sz:.004}));}
  if(q==='roto'){const seam=M(shade(look.pants,1.35),{roughness:.9}),bare=m.skin,thread=M('#efe9dc',{roughness:1});
   thigh.add(part(G.box,seam,{x:side*.099,y:-.18,sx:.004,sy:.34,sz:.012}),part(G.lowSphere,bare,{z:.095,y:-.3,sx:.04,sy:.022,sz:.012}));
   knee.add(part(G.lowSphere,bare,{z:.088,y:-.03,sx:.048,sy:.03,sz:.014}),part(tube(.094,.045),M(shade(look.pants,1.15)),{y:-.36}));
   for(let i=0;i<3;i++)knee.add(part(G.box,thread,{z:.094,y:-.012-i*.016,sx:.07,sy:.003,sz:.003}));}
  if(q==='short'){thigh.children[0].material=m.skin;thigh.add(part(cone(.115,.112,.22),pants,{y:-.11}),part(ring(.113,.011),M(shade(look.pants,.8)),{y:-.22,rx:PI/2}),part(G.box,M('#f4f1ea'),{x:side*.112,y:-.11,sx:.006,sy:.2,sz:.02}));
   knee.children[0].material=m.skin;knee.userData.joint.material=m.skin;}
 }
}
// Shoes, standing on the floor (knee space: the ankle at -.41, the floor at -.56).
const FLOOR=-.56;
function buildShoe(knee,look,m){
 const y=look.feet,c=m.shoe,col=look.shoes||'#2a1d14',whiteSole=M(col==='#f4f1ea'?'#e2dccf':'#f4f1ea',{roughness:.7}),dark=M('#1c1714',{roughness:.8});
 if(y==='bota'){knee.add(part(rbox(.15,.04,.3,.016),dark,{y:FLOOR+.02,z:.05}),part(rbox(.14,.1,.26,.045),c,{y:FLOOR+.085,z:.045}),part(geo('boot-shaft',()=>new THREE.CylinderGeometry(.1,.09,.17,20)),c,{y:FLOOR+.195}),part(ring(.099,.012),M(shade(col,.75)),{y:FLOOR+.28,rx:PI/2}));
  for(let i=0;i<3;i++)knee.add(part(G.box,dark,{y:FLOOR+.12+i*.04,z:.1-i*.02,sx:.06,sy:.008,sz:.01,rx:-.4}));return;}
 if(y==='mocasin'){knee.add(part(rbox(.13,.025,.29,.012),dark,{y:FLOOR+.0125,z:.05}),part(rbox(.125,.065,.27,.03),c,{y:FLOOR+.05,z:.05}),
  part(ring(.03,.004,PI),M('#e8c25a',GOLD),{y:FLOOR+.083,z:.12,rx:-PI/2}));return;}
 if(y==='zapato'){const shine=M(col,{roughness:.22,metalness:.1});knee.add(part(rbox(.13,.022,.3,.01),dark,{y:FLOOR+.011,z:.055}),part(rbox(.12,.07,.26,.033),shine,{y:FLOOR+.055,z:.045}),
  part(G.sphere,shine,{y:FLOOR+.05,z:.17,sx:.06,sy:.035,sz:.05}));for(let i=0;i<3;i++)knee.add(part(G.box,dark,{y:FLOOR+.093+i*.007,z:.1-i*.025,sx:.035,sy:.005,sz:.008,rx:-.3}));return;}
 if(y==='alpargata'){const rope=texMat('rope','#d9c08a',weave(),{roughness:1});knee.add(part(rbox(.13,.035,.29,.015),rope,{y:FLOOR+.0175,z:.05}),
  part(rbox(.12,.06,.26,.03),M(col,{roughness:.95}),{y:FLOOR+.06,z:.045}),part(G.sphere,M(col,{roughness:.95}),{y:FLOOR+.055,z:.16,sx:.058,sy:.035,sz:.05}));return;}
 if(y==='botin'){knee.add(part(rbox(.14,.035,.29,.014),dark,{y:FLOOR+.0175,z:.05}),part(rbox(.13,.09,.26,.042),M(col,{roughness:.5}),{y:FLOOR+.075,z:.045}),
  part(geo('chelsea',()=>new THREE.CylinderGeometry(.095,.088,.13,20)),M(col,{roughness:.5}),{y:FLOOR+.17}));
  for(const side of [-1,1])knee.add(part(rbox(.01,.09,.06,.004),M('#1c1714',{roughness:.9}),{x:side*.093,y:FLOOR+.17}));return;}
 if(y==='running'){const acc=M(look.detail||look.accent||'#e07a8f',{roughness:.6});knee.add(part(rbox(.155,.06,.32,.025),whiteSole,{y:FLOOR+.03,z:.055}),part(rbox(.158,.014,.322,.006),acc,{y:FLOOR+.045,z:.055}),
  part(rbox(.135,.085,.26,.04),c,{y:FLOOR+.1,z:.045}),part(rbox(.12,.05,.08,.025),c,{y:FLOOR+.085,z:.17}),part(rbox(.06,.05,.03,.012),acc,{y:FLOOR+.12,z:-.07}));
  for(let i=0;i<3;i++)knee.add(part(G.box,M('#f4f1ea'),{y:FLOOR+.137+i*.012,z:.12-i*.035,sx:.055,sy:.008,sz:.012,rx:-.35}));return;}
 // Sneakers: a thick white sole, the upper, laces and the heel tab; a high one has a collar.
 knee.add(part(rbox(.148,.045,.315,.02),whiteSole,{y:FLOOR+.0225,z:.055}),part(rbox(.135,.085,.27,.04),c,{y:FLOOR+.075,z:.045}));
 knee.add(part(rbox(.12,.05,.08,.025),c,{y:FLOOR+.06,z:.17}));
 for(let i=0;i<3;i++)knee.add(part(G.box,M('#f4f1ea'),{y:FLOOR+.112+i*.012,z:.12-i*.035,sx:.055,sy:.008,sz:.012,rx:-.35}));
 knee.add(part(rbox(.012,.03,.16,.005),M(look.detail||'#f4f1ea'),{x:.069,y:FLOOR+.07,z:.05}),part(rbox(.012,.03,.16,.005),M(look.detail||'#f4f1ea'),{x:-.069,y:FLOOR+.07,z:.05}));
 if(y==='alta')knee.add(part(geo('hightop',()=>new THREE.CylinderGeometry(.086,.08,.11,20)),c,{y:FLOOR+.15,z:.0}),part(ring(.086,.012),whiteSole,{y:FLOOR+.205,rx:PI/2}));
}

// ---------- the person ----------
export const HIP_H=.98,THIGH=.42,SHIN=.42;
function limb(r,len,material){const joint=new THREE.Group(),piece=part(capsule(r,len),material,{y:-len/2-r*.3});joint.add(piece);return joint;}
// Every group's meshes with the same material become one (fewer draw calls); its own shapes are freed on dispose.
function bake(root){
 const groups=[];root.traverse(o=>{if(o.isGroup||o===root)groups.push(o);});
 for(const g of groups){const by=new Map();
  for(const c of g.children)if(c.isMesh&&!c.userData.keep){if(!by.has(c.material))by.set(c.material,[]);by.get(c.material).push(c);}
  for(const [material,list] of by){if(list.length<2)continue;
   const geos=list.map(c=>{c.updateMatrix();let x=c.geometry.index?c.geometry.toNonIndexed():c.geometry.clone();
    for(const k of Object.keys(x.attributes))if(!['position','normal','uv'].includes(k))x.deleteAttribute(k);
    if(!x.attributes.uv)x.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count*2),2));
    x.applyMatrix4(c.matrix);return x;});
   const merged=mergeGeometries(geos);for(const x of geos)x.dispose();if(!merged)continue;
   for(const c of list)g.remove(c);
   const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.userData.own=true;g.add(mesh);}}
}
export function buildPerson(look,{waiter=false}={}){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const robot=look.robot,person=!robot&&!waiter;
 if(waiter)look={...look,outfit:'camisa',legs:'chino',feet:'mocasin',shirt:'#f4f1ea',pants:'#1e1e22',shoes:'#2a1d14',accent:'#7a2f2f'};
 const skin=M(robot?'#b9c4cc':look.skin,{roughness:robot?.35:.62,metalness:robot?.5:0});
 const shirt=robot?M('#8e9aa4',{metalness:.4}):look.outfit==='rayas'?stripes(look.shirt):look.outfit==='sueter'?texMat('wool',look.shirt,ribs(),{roughness:.95}):M(look.shirt,{roughness:.8});
 const pants=M(robot?'#5d6873':look.pants,{metalness:robot?.4:0,roughness:.85}),shoe=M(robot?'#3b444c':look.shoes||'#2a1d14',{roughness:.6});
 const female=person&&look.female,dress=person&&look.outfit==='vestido',skirt=person&&look.outfit==='pollera';
 const hips=new THREE.Group();hips.position.y=HIP_H;body.add(hips);
 hips.add(part(G.sphere,dress?shirt:pants,{y:.02,sx:female?.265:.25,sy:.15,sz:.18}));
 const spine=new THREE.Group();spine.position.y=.08;hips.add(spine);
 spine.add(part(capsule(female?.21:.23,.36),shirt,{y:.3,sx:female?.95:1,sz:.78}));
 if(dress||skirt)hips.add(part(geo('skirt'+(dress?1:0),()=>{const pts=[];for(let i=0;i<=10;i++){const t=i/10;pts.push(new THREE.Vector2(lerp(.235,dress?.42:.38,t)+Math.sin(t*PI)*.02,-t*(dress?.62:.5)));}
  const g=new THREE.LatheGeometry(pts,36);g.translate(0,.08,0);return g;}),M(dress?look.shirt:look.pants,{side:THREE.DoubleSide,roughness:.8})));
 if(waiter){spine.add(part(rbox(.4,.5,.05,.02),M('#1e1e22'),{y:.26,z:.15}));spine.add(part(G.box,M('#7a2f2f'),{y:.6,z:.2,sx:.12,sy:.05,sz:.03}));}
 const neck=new THREE.Group();neck.position.y=.66;spine.add(neck);
 const head=new THREE.Group();head.position.y=.22;neck.add(head);
 const skull=new THREE.Group();skull.scale.set(.25,.27,.25);head.add(skull);
 let tail=null;head.scale.set(look.faceW||1,1,lerp(1,look.faceW||1,.5));
 if(robot){head.add(part(rbox(.46,.4,.42,.06),skin));const eye=M('#7ff0ff',{emissive:'#38d8ff',emissiveIntensity:1.6});
  head.add(part(rbox(.36,.14,.02,.01),M('#2e3b44'),{y:.03,z:.21}),part(G.lowSphere,eye,{x:-.08,y:.03,z:.225,sx:.04,sy:.04,sz:.02}),part(G.lowSphere,eye,{x:.08,y:.03,z:.225,sx:.04,sy:.04,sz:.02}),
   part(G.box,skin,{y:.28,sx:.03,sy:.16,sz:.03}),part(G.lowSphere,M('#ff6b6b',{emissive:'#ff3b3b',emissiveIntensity:1}),{y:.38,sx:.05,sy:.05,sz:.05}));}
 else{const L={hair:look.hair||'#1f1a17',style:look.style||'short',face:look.face??'',hat:waiter?'':look.hat||'',accent:look.accent,female};
  buildFace(head,skull,{...L,hair:L.hair},skin);
  tail=buildHair(skull,L,L.hat);
  if(L.hat)buildHat(head,skull,L);
  if(person&&look.eyes)buildGlasses(head,look.eyes);
  if(person&&look.ears)for(const side of [-1,1])head.add(part(G.lowSphere,M('#e8c25a',GOLD),{x:side*.262,y:-.06,z:.01,sx:.016,sy:.016,sz:.016}),part(ring(.02,.005),M('#e8c25a',GOLD),{x:side*.264,y:-.088,z:.01,ry:PI/2}));}
 const arms={},legs={};
 for(const side of [-1,1]){
  const shoulder=limb(female?.068:.075,.27,shirt);shoulder.position.set(side*(female?.28:.31),.56,0);spine.add(shoulder);
  const elbow=limb(.064,.25,robot?shirt:skin);elbow.position.y=-.37;shoulder.add(elbow);
  // The hand: a palm and a thumb.
  elbow.add(part(G.lowSphere,skin,{y:-.355,sx:.068,sy:.085,sz:.048}),part(capsule(.016,.03),skin,{x:-side*.03,y:-.335,z:.035,rx:.35,rz:-side*.35}));
  // Round joints at the elbow and the knee, so the limb bends without a gap.
  elbow.userData.joint=part(G.sphere,robot?shirt:skin,{sx:.066,sy:.066,sz:.066});elbow.add(elbow.userData.joint);
  arms[side]={shoulder,elbow};
  const legMat=dress||skirt?skin:pants,thigh=limb(.1,THIGH-.12,legMat);thigh.position.set(side*.13,0,0);hips.add(thigh);
  const knee=limb(.088,SHIN-.12,legMat);knee.position.y=-THIGH;thigh.add(knee);
  knee.userData.joint=part(G.sphere,legMat,{sx:.093,sy:.093,sz:.093});knee.add(knee.userData.joint);
  legs[side]={thigh,knee};
 }
 if(person||waiter){buildTop(spine,arms,look,{shirt,skin});buildLegs(legs,look,{pants,skin},dress||skirt);}
 for(const side of [-1,1]){const knee=legs[side].knee;
  if(robot)knee.add(part(rbox(.16,.09,.3,.03),shoe,{y:FLOOR+.045,z:.06}));else buildShoe(knee,look,{shoe});}
 const h=person?look.height||1:1;body.scale.setScalar(h);
 bake(root);
 const shadowBlob=new THREE.Mesh(geo('blob',()=>new THREE.CircleGeometry(.42,24)),blobMat);shadowBlob.rotation.x=-PI/2;shadowBlob.position.y=.015;root.add(shadowBlob);
 root.traverse(o=>{if(o.isMesh&&o!==shadowBlob)o.castShadow=true;});
 const dispose=()=>root.traverse(o=>{if(o.isMesh&&o.userData.own)o.geometry.dispose();});
 return {root,body,hips,spine,neck,head,arms,legs,tails:tail||[],robot,dispose,height:h,phase:Math.random()*6,t:Math.random()*10,sit:0,lean:0,side:0,look:0,sway:0};
}
const blobMat=new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.22,depthWrite:false});

// ---------- moving ----------
// The pose each frame: walking from speed (stride follows the ground), breathing when still, the
// lean from acceleration and turning, and sitting down or getting up (sit 0 → 1).
// Gestures: [shoulder forward/up, elbow, shoulder out] for each arm (side -1 left, 1 right), t in seconds.
export const EMOTE_POSE={
 wave:(side,t)=>side===1?[-2.75,-.25,.35+Math.sin(t*13)*.35]:null,
 clap:(side,t)=>[-1.35,-.55,-side*(.12+Math.abs(Math.sin(t*12))*.28)],
 cheers:(side,t)=>side===1?[-2.45+Math.sin(t*5)*.1,-.55,.12]:null,
 party:(side,t)=>[-2.8,-.15+Math.sin(t*10+side)*.2,side*(.45+Math.sin(t*10)*.12)],
 shout:(side,t)=>side===1?[-2.45,-.5+Math.sin(t*14)*.15,.28]:null,
 sign:(side)=>side===1?[-1.35,-1.95,-.35]:null,
 win:(side,t)=>[-2.95+Math.sin(t*9+side)*.12,-.15-Math.abs(Math.sin(t*9))*.55,side*.32]};
export const EMOTES={wave:'👋',clap:'👏',cheers:'🍻',party:'🎉'};
export function animate(p,{speed=0,accel=0,turn=0,sit=0,carry=false,playing=false,rest=0,restBack=false,handsDown=false,reach=null,holding=false,dt,now=performance.now()}){
 p.t+=dt;const s=clamp01(speed/MAX_SPEED);
 p.phase+=speed*U*dt*PI/.62;
 const ph=p.phase,b=smooth(clamp01(sit)),stand=1-b;
 // Lean: forward with acceleration and speed, sideways into turns; eased so it feels like weight.
 p.lean=lerp(p.lean,Math.max(-.25,Math.min(.35,accel*.0011+s*.14)),Math.min(1,dt*6));
 p.side=lerp(p.side,Math.max(-.22,Math.min(.22,-turn*s*.09)),Math.min(1,dt*6));
 // Sitting down: the knees bend and the chest leans forward on the way down, then settles back.
 const mid=Math.sin(PI*clamp01(sit));
 p.hips.position.y=lerp(HIP_H-(1-Math.cos(ph*2))*.03*s,(SEAT_H+.1)/(p.height||1),b)+Math.sin(p.t*2.1)*.004*stand;
 p.hips.position.z=lerp(0,-.04,b);
 p.hips.rotation.y=Math.sin(ph)*.13*s*stand;p.hips.rotation.z=Math.sin(ph)*.04*s*stand;
 const rr=smooth(clamp01(rest))*stand;
 p.spine.rotation.x=p.lean*stand+mid*.55+b*.12+rr*(restBack?-.2:.32);
 p.hips.rotation.y+=rr*(restBack?-.12:.1);p.spine.rotation.z=p.side*stand;p.spine.rotation.y=-Math.sin(ph)*.18*s*stand;
 const breathe=1+Math.sin(p.t*2.1)*.012;p.spine.scale.set(1,breathe,1);
 p.neck.rotation.x=-p.spine.rotation.x*.45+(playing?.25:0);
 p.look=lerp(p.look,Math.sin(p.t*.37)*.35*(1-s),Math.min(1,dt*2));p.neck.rotation.y=p.look+(-p.spine.rotation.y*.6);
 // A ponytail lags behind: it swings with the steps and lifts a little with speed.
 if(p.tails.length){p.sway=lerp(p.sway,Math.sin(ph)*.32*s+Math.sin(p.t*1.6)*.04,Math.min(1,dt*8));for(const t of p.tails){t.rotation.z=p.sway;t.rotation.x=lerp(t.rotation.x,-s*.35-p.lean*.6,Math.min(1,dt*5));}}
 for(const side of [-1,1]){
  const L=p.legs[side],A=p.arms[side],w=Math.sin(ph+(side>0?PI:0));
  const swing=Math.max(0,Math.cos(ph+(side>0?PI:0)));
  const thighWalk=w*.62*s,kneeWalk=(swing*.95+.05)*s;
  const thighSit=-PI/2+.08,kneeSit=PI/2-.05;
  L.thigh.rotation.x=lerp(thighWalk,thighSit,b)-mid*.35;
  L.knee.rotation.x=lerp(kneeWalk,kneeSit,b)+mid*.45;
  L.thigh.rotation.z=side*(.03+b*.06);
  // Leaning: one leg relaxed, the knee a little bent.
  if(rr>0&&side===-1){L.thigh.rotation.x+=rr*(restBack?.32:.18);L.knee.rotation.x+=rr*(restBack?.1:.45);}
  // Arms swing against the legs; carrying holds them forward; at the table they rest on it.
  const armWalk=-w*.5*s,armIdle=Math.sin(p.t*1.3+side)*.03;
  let sx=armWalk+armIdle,ex=-.15-s*.35,sz=side*(.06+s*.04);
  if(carry){sx=-1.25;ex=-.25;sz=side*.08;}
  // Elbows on the counter (forearms on the top), or behind on its edge with the back against it.
  if(rr>0){sx=lerp(sx,restBack?.55:-1.2,rr);ex=lerp(ex,restBack?-.12:-1.05,rr);sz=lerp(sz,side*(restBack?.2:.22),rr);}
  if(b>0){if(handsDown){sx=lerp(sx,-.42,b);ex=lerp(ex,-.62,b);sz=lerp(sz,side*.1,b);}
   else{const rx=playing?-1.05+Math.max(0,Math.sin(p.t*1.7+side*1.3))*-.25:-.95;sx=lerp(sx,rx,b);ex=lerp(ex,-.75,b);sz=lerp(sz,side*.12,b);}}
  // The right arm throws a card (reach forward and flick) or deals (quick flicks toward each player).
  const g=p.gesture,gk=g?(now-g.start)/g.dur:2;
  const pose=g&&gk>=0&&gk<1&&EMOTE_POSE[g.kind]?EMOTE_POSE[g.kind](side,now/1000):null;
  if((g?.kind==='party'||g?.kind==='win')&&gk>=0&&gk<1&&side===1)p.hips.position.y+=Math.abs(Math.sin(gk*PI*5))*.1*(1-b);
  if(pose){const up=Math.min(1,Math.sin(PI*gk)*3);sx=lerp(sx,pose[0],up);ex=lerp(ex,pose[1],up);sz=lerp(sz,pose[2],up);}
  else if(side===1&&gk>=0&&gk<1){const up=Math.sin(PI*gk);
   if(g.kind==='throw'){sx=lerp(sx,-1.55,up);ex=lerp(ex,-.15,up);sz=lerp(sz,-.05,up);}
   else{const flick=Math.abs(Math.sin(gk*PI*g.flicks));sx=-1.15-flick*.35;ex=-.55+flick*.3;sz=.18-flick*.25;}}
  if(reach&&side===1){const k=now/1000;if(reach==='erase'){sx=-2.35+Math.sin(k*9)*.3;ex=-.35;sz=-.15+Math.cos(k*9)*.35;}else{sx=-2.05+Math.sin(k*23)*.06;ex=-.75+Math.sin(k*17)*.08;sz=-.1+Math.sin(k*11)*.08;}}
  // Carrying a drink: the forearm forward, the glass upright.
  if(holding&&side===1&&!pose&&!(gk>=0&&gk<1)){sx=lerp(-.15+Math.sin(p.t*1.3)*.03,sx,b*.5);ex=-1.35;sz=.08;}
  A.shoulder.rotation.x=sx;A.shoulder.rotation.z=sz;A.elbow.rotation.x=ex;
  if(side===1&&p.heldMesh)p.heldMesh.rotation.x=-(sx+ex);
 }
}
