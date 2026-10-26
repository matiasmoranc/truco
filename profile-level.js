// Levels and profile pictures in the game: the level and its bar where the credits
// were, the level details with what each level unlocks, the icon or photo of every
// player with its badge on the edge, and the "you went up a level" celebration.
// Levels are written only by the table server; a player writes only its own avatar.
import {levelFor,badgeFor,ICONS,PHOTO_LEVEL,unlocks,BADGES,houseLevel,houseIcon,pointsToReach} from './levels.js?v=20261027-icons1';

// Profile icons and badges: pictures in assets/profile. The "gaucho" id is kept for
// players who already chose it; it now shows the coat of arms of Uruguay.
const ICON_FILE={persona:'persona',mate:'mate',espada:'espada',bandera:'bandera',gaucho:'escudo',termo:'termo'};
const iconImg=id=>`<img class="avatar-icon" src="assets/profile/${ICON_FILE[id]||'persona'}.webp" alt="">`;
const badgeImg=id=>`<img src="assets/profile/insignia-${id}.webp" alt="">`;
const escapeAttr=s=>String(s).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));

export function installProfiles({$,document,services,getState,toast,onChange=()=>{}}){
 const cache=new Map();let mine=null,unsubscribers=[],listening=null;
 const levelOf=points=>levelFor(points||0);
 // An avatar: the chosen icon or the photo, with the badge of the level over its edge.
 const showsPhoto=p=>!!p?.photo&&p.use!=='icon';
 // The badge shown: the one the player picked if its level has it, none if hidden, else the highest.
 const shownBadge=p=>{const level=levelOf(p?.points).level;if(p?.badge==='none')return null;const picked=BADGES.find(b=>b.id===p?.badge&&level>=b.level);return picked||badgeFor(level);};
 function avatarHtml(profile={},cls='player-avatar'){
  const {icon}=profile,photo=showsPhoto(profile)?profile.photo:null,badge=shownBadge(profile);
  const inner=photo?`<img src="${escapeAttr(photo)}" alt="">`:iconImg(icon);
  return `<span class="${cls}${photo?' has-photo':' has-icon'}">${inner}${badge?`<span class="level-badge badge-${badge.id}" title="${escapeAttr(badge.name)}">${badgeImg(badge.id)}</span>`:''}</span>`;
 }
 // Other players: level and avatar read once a minute at most, then the lobby re-renders.
 function profileOf(uid,name){
  if(!uid||typeof uid!=='string')return null;
  // House players: their fixed level and an icon it unlocked.
  if(uid.startsWith('house_')){const who=name||uid.slice(6);return {points:pointsToReach(houseLevel(who)),icon:houseIcon(who)};}
  if(uid===getState().uid&&mine)return mine;
  const entry=cache.get(uid);
  if(entry&&Date.now()-entry.at<60000)return entry.value;
  if(!entry?.loading){
   cache.set(uid,{...(entry||{}),loading:true,at:entry?.at||0,value:entry?.value||null});
   services().then(async fb=>{
    const [points,avatar]=await Promise.all([fb.get(fb.ref(fb.db,'levels/'+uid+'/points')),fb.get(fb.ref(fb.db,'avatars/'+uid))]);
    cache.set(uid,{at:Date.now(),value:{points:Number(points.val())||0,...(avatar.val()||{})}});onChange();
   }).catch(()=>cache.set(uid,{at:Date.now(),value:entry?.value||{points:0}}));
  }
  return entry?.value||null;
 }
 const levelNumber=uid=>{const p=profileOf(uid);return p?levelOf(p.points).level:null;};

 // Header: the level number and its bar; the account button shows the avatar.
 function renderHeader(){
  const p=mine||{points:0},info=levelOf(p.points);
  if($('level-number'))$('level-number').textContent=String(info.level);
  if($('level-bar'))$('level-bar').style.width=Math.round(info.progress*100)+'%';
  if($('level-open'))$('level-open').setAttribute('aria-label','Nivel '+info.level+': '+fmt(info.points)+' de '+fmt(info.need)+' puntos. Ver detalles');
  const slot=$('account-avatar-slot');if(slot)slot.innerHTML=avatarHtml(p,'player-avatar header-avatar');
  const own=$('player-account-avatar');if(own)own.innerHTML=avatarHtml(p,'player-avatar account-profile-avatar');
  if($('level-dialog')?.open)renderDetails();
 }
 const fmt=tenths=>(tenths/10).toLocaleString('es-UY',{maximumFractionDigits:1});
 // Details: level, progress, how points are won and what each level unlocks (unlocked icons can be chosen).
 function renderDetails(){
  const p=mine||{points:0},info=levelOf(p.points);
  $('level-detail-avatar').innerHTML=avatarHtml(p,'player-avatar big-avatar');
  $('level-detail-number').textContent=String(info.level);
  $('level-detail-bar').style.width=Math.round(info.progress*100)+'%';
  $('level-detail-progress').textContent=fmt(info.points)+' puntos / '+fmt(info.need)+' puntos';
  $('level-detail-progress').setAttribute('aria-label',fmt(info.points)+' de '+fmt(info.need)+' puntos para el nivel '+(info.level+1));
  // Without a photo yet: when it unlocks, or a shortcut to upload it once it has.
  const hint=$('level-photo-hint');
  if(hint){hint.hidden=!!p.photo;hint.replaceChildren();
   if(!p.photo){if(info.level>=PHOTO_LEVEL){hint.append('Ya podés subir tu foto de perfil.');const b=document.createElement('button');b.type='button';b.className='unlock-photo-button';b.textContent='Subir foto';b.onclick=()=>$('avatar-photo-input').click();hint.append(b);}else hint.append('Subí tu foto de perfil a partir del nivel '+PHOTO_LEVEL+'.');}}
  const list=$('level-unlocks');list.replaceChildren();
  for(const u of unlocks()){
   const got=info.level>=u.level,li=document.createElement('li');li.className='level-unlock'+(got?' unlocked':' locked');
   const chosen=u.kind==='icon'?!showsPhoto(p)&&(p.icon||'persona')===u.id:u.kind==='photo'?showsPhoto(p):shownBadge(p)?.id===u.id;
   const preview=u.kind==='icon'?`<span class="player-avatar unlock-avatar has-icon">${iconImg(u.id)}</span>`:u.kind==='badge'?`<span class="unlock-badge level-badge badge-${u.id}">${badgeImg(u.id)}</span>`:`<span class="player-avatar unlock-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8.5 6l1.5-2h4l1.5 2"/></svg></span>`;
   li.innerHTML=`${preview}<span class="unlock-name">${escapeAttr(u.name)}</span><span class="unlock-level${chosen?' in-use':''}">${got?(chosen?'En uso':'Usar'):'Nivel '+u.level}</span>`;
   if(got&&u.kind==='icon'&&!chosen){li.classList.add('choosable');li.tabIndex=0;li.setAttribute('role','button');li.title='Usar este ícono';li.onclick=()=>saveAvatar({icon:u.id,use:'icon'});}
   // Badges: tap one to wear it; the one in use can be taken off.
   if(got&&u.kind==='badge'&&!chosen){li.classList.add('choosable');li.tabIndex=0;li.setAttribute('role','button');li.title='Usar esta insignia';li.onclick=()=>saveAvatar({badge:u.id});}
   if(got&&u.kind==='badge'&&chosen){const b=document.createElement('button');b.type='button';b.className='unlock-photo-button secondary';b.textContent='Sacar';b.onclick=event=>{event.stopPropagation();saveAvatar({badge:'none'});};li.querySelector('.unlock-level').after(b);}
   if(got&&u.kind==='photo'){
    // The photo stays saved while an icon is in use, so it can come back with one tap.
    const actions=document.createElement('span');actions.className='unlock-photo-actions';
    const add=(text,cls,fn)=>{const b=document.createElement('button');b.type='button';b.className='unlock-photo-button'+(cls?' '+cls:'');b.textContent=text;b.onclick=event=>{event.stopPropagation();fn();};actions.append(b);};
    if(p.photo&&!chosen)add('Usar','',()=>saveAvatar({use:'photo'}));
    add(p.photo?'Cambiar':'Elegir foto',p.photo?'secondary':'',()=>$('avatar-photo-input').click());
    if(p.photo)add('Quitar','secondary',()=>saveAvatar({photo:null,use:null}));
    const tag=li.querySelector('.unlock-level');if(chosen)tag.after(actions);else tag.replaceWith(actions);
    if(p.photo)li.querySelector('.unlock-avatar').outerHTML=avatarHtml({photo:p.photo,use:'photo',points:0,badge:'none'},'player-avatar unlock-avatar');
   }
   list.append(li);
  }
 }
 async function saveAvatar(changes){
  const uid=getState().uid;if(!uid)return;
  try{const fb=await services();await fb.update(fb.ref(fb.db,'avatars/'+uid),changes);}
  catch(error){console.error('[truco:avatar]',error);toast('No se pudo guardar. Revisá que tengas ese nivel.');}
 }
 // A photo, cut to a square and made small, so it travels with the profile.
 async function choosePhoto(file){
  if(!file)return;
  const url=URL.createObjectURL(file);
  try{
   const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
   const frame=await framePhoto(img);if(!frame)return;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=200;
   canvas.getContext('2d').drawImage(img,frame.x,frame.y,frame.side,frame.side,0,0,200,200);
   let quality=0.85,data=canvas.toDataURL('image/jpeg',quality);while(data.length>58000&&quality>0.4){quality-=0.1;data=canvas.toDataURL('image/jpeg',quality);}
   await saveAvatar({photo:data,use:'photo'});
  }catch(error){console.error('[truco:photo]',error);toast('No se pudo usar esa foto.');}
  finally{URL.revokeObjectURL(url);}
 }
 // Framing: drag the photo and zoom it inside the circle; resolves with the square to keep.
 function framePhoto(img){
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='credit-join-dialog photo-frame-dialog';
   dialog.innerHTML='<h2>Acomodá tu foto</h2><p class="level-dialog-note">Arrastrá la foto para centrarla y usá el control para acercarla.</p><div class="photo-frame"><canvas width="560" height="560"></canvas></div><label class="photo-zoom">Acercar<input type="range" min="1" max="4" step="0.01" value="1"></label><div class="photo-frame-actions"><button type="button" class="button secondary" data-cancel>Cancelar</button><button type="button" class="button primary" data-ok>Usar foto</button></div>';
   document.body.append(dialog);
   const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d'),zoom=dialog.querySelector('input'),size=canvas.width;
   const W=img.naturalWidth,H=img.naturalHeight,min=Math.min(W,H);
   let side=min,cx=W/2,cy=H/2;
   const clamp=()=>{side=min/Number(zoom.value);cx=Math.min(W-side/2,Math.max(side/2,cx));cy=Math.min(H-side/2,Math.max(side/2,cy));};
   const draw=()=>{clamp();ctx.clearRect(0,0,size,size);ctx.drawImage(img,cx-side/2,cy-side/2,side,side,0,0,size,size);
    ctx.save();ctx.fillStyle='rgba(4,20,14,.6)';ctx.beginPath();ctx.rect(0,0,size,size);ctx.arc(size/2,size/2,size/2-4,0,Math.PI*2,true);ctx.fill();
    ctx.strokeStyle='#e8c983';ctx.lineWidth=4;ctx.beginPath();ctx.arc(size/2,size/2,size/2-4,0,Math.PI*2);ctx.stroke();ctx.restore();};
   // One finger drags, two fingers pinch to zoom.
   const points=new Map();let start=null;
   const begin=()=>{const list=[...points.values()];start={cx,cy,zoom:Number(zoom.value),x:list.reduce((a,p)=>a+p.x,0)/list.length,y:list.reduce((a,p)=>a+p.y,0)/list.length,gap:list.length>1?Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y):0};};
   canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});begin();};
   canvas.onpointermove=e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const list=[...points.values()],x=list.reduce((a,p)=>a+p.x,0)/list.length,y=list.reduce((a,p)=>a+p.y,0)/list.length;
    if(list.length>1&&start.gap){zoom.value=String(Math.min(4,Math.max(1,start.zoom*Math.hypot(list[0].x-list[1].x,list[0].y-list[1].y)/start.gap)));side=min/Number(zoom.value);}
    const k=side/canvas.getBoundingClientRect().width;cx=start.cx-(x-start.x)*k;cy=start.cy-(y-start.y)*k;draw();};
   canvas.onpointerup=canvas.onpointercancel=e=>{points.delete(e.pointerId);if(points.size)begin();};
   canvas.onwheel=e=>{e.preventDefault();zoom.value=String(Math.min(4,Math.max(1,Number(zoom.value)*(e.deltaY<0?1.08:1/1.08))));draw();};
   zoom.oninput=draw;
   const finish=value=>{dialog.close();dialog.remove();resolve(value);};
   dialog.querySelector('[data-cancel]').onclick=()=>finish(null);
   dialog.querySelector('[data-ok]').onclick=()=>{clamp();finish({x:cx-side/2,y:cy-side/2,side});};
   dialog.oncancel=e=>{e.preventDefault();finish(null);};
   draw();dialog.showModal();
  });
 }
 // A player's photo, big, when its avatar is tapped on a lobby table.
 function showPhoto(src,name){
  const dialog=document.createElement('dialog');dialog.className='credit-join-dialog photo-view-dialog';
  dialog.innerHTML='<img alt=""><strong></strong><button type="button" class="button secondary">Cerrar</button>';
  dialog.querySelector('img').src=src;dialog.querySelector('strong').textContent=name||'';
  dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close();};dialog.onclose=()=>dialog.remove();
  document.body.append(dialog);dialog.showModal();
 }
 document.addEventListener('click',event=>{
  const avatar=event.target.closest?.('.room-avatar.has-photo');if(!avatar)return;
  event.preventDefault();event.stopPropagation();
  showPhoto(avatar.querySelector('img').src,avatar.closest('.compact-room-owner')?.querySelector('h3')?.textContent);
 },true);
 // Own profile: the summary (name, level and picture) opens the level details.
 const openDetails=()=>{renderDetails();$('level-dialog').showModal();};
 const summary=document.querySelector('.player-account-summary');
 if(summary){summary.setAttribute('role','button');summary.tabIndex=0;summary.setAttribute('aria-label','Ver tu nivel');
  const go=()=>{summary.closest('dialog')?.close();openDetails();};
  summary.onclick=go;summary.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};}
 $('avatar-photo-input').onchange=()=>{const file=$('avatar-photo-input').files?.[0];$('avatar-photo-input').value='';void choosePhoto(file);};
 $('level-open').onclick=openDetails;
 $('level-close').onclick=()=>$('level-dialog').close();
 $('level-up-close').onclick=()=>$('level-up-dialog').close();

 // Going up a level: a celebration with what it unlocked (once per level and device).
 function celebrate(previous,level){
  const got=unlocks().filter(u=>u.level>previous&&u.level<=level);
  $('level-up-number').textContent=String(level);
  $('level-up-unlocks').replaceChildren(...got.map(u=>{const li=document.createElement('li');li.textContent=u.name;return li;}));
  $('level-up-unlocks').hidden=!got.length;
  if(!document.querySelector('dialog[open]'))$('level-up-dialog').showModal();
 }
 function seenLevel(uid,level){
  const key='truco-level-seen-'+uid;let previous=null;
  try{previous=Number(localStorage.getItem(key))||null;localStorage.setItem(key,String(level));}catch{}
  return previous;
 }
 async function start(){
  const uid=getState().uid;if(!uid||listening===uid)return;stop();listening=uid;
  const fb=await services();if(listening!==uid)return;
  let points=0,avatar={},loaded=0;
  const update=()=>{mine={points,...avatar};cache.set(uid,{at:Date.now(),value:mine});renderHeader();onChange();
   if(loaded!==3)return;const level=levelOf(points).level,previous=seenLevel(uid,level);if(previous&&level>previous)celebrate(previous,level);};
  unsubscribers.push(fb.onValue(fb.ref(fb.db,'levels/'+uid+'/points'),snap=>{points=Number(snap.val())||0;loaded|=1;update();},()=>{}));
  unsubscribers.push(fb.onValue(fb.ref(fb.db,'avatars/'+uid),snap=>{avatar=snap.val()||{};loaded|=2;update();},()=>{}));
 }
 function stop(){for(const off of unsubscribers)off?.();unsubscribers=[];listening=null;mine=null;renderHeader();}
 renderHeader();
 return {start,stop,avatarHtml,profileOf,levelNumber,mine:()=>mine,levelOf};
}
export {ICONS,BADGES,PHOTO_LEVEL};
