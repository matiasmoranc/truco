// Levels and profile pictures in the game: the level and its bar where the credits
// were, the level details with what each level unlocks, the icon or photo of every
// player with its badge on the edge, and the "you went up a level" celebration.
// Levels are written only by the table server; a player writes only its own avatar.
import {levelFor,badgeFor,ICONS,PHOTO_LEVEL,unlocks,BADGES,houseLevel,houseIcon,pointsToReach} from './levels.js?v=20261027-levels1';

// Profile icons, drawn in the game's gold line style.
const ICON_SVG={
 persona:'<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.5-3.8 3-5.5 7-5.5s6.5 1.7 7 5.5"/>',
 mate:'<path d="M7 9h10l-1 9a3 3 0 0 1-3 2.6h-2A3 3 0 0 1 8 18L7 9Z"/><path d="M6.5 9h11M14 9l3-6"/><path d="M9.5 12.5c1 .8 4 .8 5 0"/>',
 espada:'<path d="M12 2.5v13.5"/><path d="M9.5 6 12 2.5 14.5 6"/><path d="M8 16h8M12 16v4.5M10.5 21.5h3"/>',
 bandera:'<path d="M5 3.5v17"/><path d="M5 4.5h14v9H5"/><path d="M9.5 4.5h9.5M9.5 7.5h9.5M9.5 10.5h9.5M5 13.5h14"/><circle cx="7.3" cy="6.8" r="1.6"/>',
 gaucho:'<path d="M3.5 13.5c2.5 1.5 14.5 1.5 17 0"/><path d="M7 13.5c0-4 1.5-7 5-7s5 3 5 7"/><path d="M7.5 11h9"/>',
 termo:'<rect x="8" y="6" width="8" height="15" rx="2.5"/><path d="M9.5 6V4h5v2M12 2.5V4"/><path d="M8 10h8M8 17h8"/>'
};
const BADGE_STAR='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.3 5 5.4.5-4.1 3.6 1.2 5.3L12 15.6l-4.8 2.8 1.2-5.3-4.1-3.6 5.4-.5Z"/></svg>';
const escapeAttr=s=>String(s).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));

export function installProfiles({$,document,services,getState,toast,onChange=()=>{}}){
 const cache=new Map();let mine=null,unsubscribers=[],listening=null;
 const levelOf=points=>levelFor(points||0);
 // An avatar: the chosen icon or the photo, with the badge of the level over its edge.
 function avatarHtml({icon,photo,points}={},cls='player-avatar'){
  const {level}=levelOf(points),badge=badgeFor(level);
  const inner=photo?`<img src="${escapeAttr(photo)}" alt="">`:`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON_SVG[icon]||ICON_SVG.persona}</svg>`;
  return `<span class="${cls}${photo?' has-photo':''}">${inner}${badge?`<span class="level-badge badge-${badge.id}" title="${escapeAttr(badge.name)}">${BADGE_STAR}</span>`:''}</span>`;
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
  if($('level-dialog')?.open)renderDetails();
 }
 const fmt=tenths=>(tenths/10).toLocaleString('es-UY',{maximumFractionDigits:1});
 // Details: level, progress, how points are won and what each level unlocks (unlocked icons can be chosen).
 function renderDetails(){
  const p=mine||{points:0},info=levelOf(p.points);
  $('level-detail-avatar').innerHTML=avatarHtml(p,'player-avatar big-avatar');
  $('level-detail-number').textContent=String(info.level);
  $('level-detail-bar').style.width=Math.round(info.progress*100)+'%';
  $('level-detail-progress').textContent=fmt(info.points)+' de '+fmt(info.need)+' puntos para el nivel '+(info.level+1);
  const list=$('level-unlocks');list.replaceChildren();
  for(const u of unlocks()){
   const got=info.level>=u.level,li=document.createElement('li');li.className='level-unlock'+(got?' unlocked':' locked');
   const chosen=u.kind==='icon'&&!p.photo&&(p.icon||'persona')===u.id;
   const preview=u.kind==='icon'?`<span class="player-avatar unlock-avatar"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_SVG[u.id]}</svg></span>`:u.kind==='badge'?`<span class="unlock-badge level-badge badge-${u.id}">${BADGE_STAR}</span>`:`<span class="player-avatar unlock-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="13" rx="2.5"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8.5 6l1.5-2h4l1.5 2"/></svg></span>`;
   li.innerHTML=`${preview}<span class="unlock-name">${escapeAttr(u.name)}</span><span class="unlock-level">${got?(chosen?'En uso':'Nivel '+u.level+' ✓'):'Nivel '+u.level}</span>`;
   if(got&&u.kind==='icon'&&!chosen){li.classList.add('choosable');li.tabIndex=0;li.setAttribute('role','button');li.title='Usar este ícono';li.onclick=()=>saveAvatar({icon:u.id,photo:null});}
   if(got&&u.kind==='photo'){const b=document.createElement('button');b.type='button';b.className='unlock-photo-button';b.textContent=p.photo?'Cambiar foto':'Elegir foto';b.onclick=()=>$('avatar-photo-input').click();li.querySelector('.unlock-level').replaceWith(b);if(p.photo){const r=document.createElement('button');r.type='button';r.className='unlock-photo-button secondary';r.textContent='Quitar';r.onclick=()=>saveAvatar({photo:null});li.append(r);}}
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
   const side=Math.min(img.naturalWidth,img.naturalHeight),canvas=document.createElement('canvas');canvas.width=canvas.height=160;
   canvas.getContext('2d').drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,160,160);
   let quality=0.82,data=canvas.toDataURL('image/jpeg',quality);while(data.length>58000&&quality>0.4){quality-=0.1;data=canvas.toDataURL('image/jpeg',quality);}
   await saveAvatar({photo:data});
  }catch(error){console.error('[truco:photo]',error);toast('No se pudo usar esa foto.');}
  finally{URL.revokeObjectURL(url);}
 }
 $('avatar-photo-input').onchange=()=>{const file=$('avatar-photo-input').files?.[0];$('avatar-photo-input').value='';void choosePhoto(file);};
 $('level-open').onclick=()=>{renderDetails();$('level-dialog').showModal();};
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
