// Head to head with friends: how many games each one won against the other.
// - versus: the numbers per friend and per bot of the house (house: true), from the server, kept a minute.
// - notebookElement: the notebook page with the numbers, used on the table and in the friend's card.
// - match notebook: when two friends (or someone and a bot of the house) start a 1 vs 1 game the server gives the room introUntil: until then the
//   notebook lies on the table (6 seconds, the countdown shows 5: the first second does not count),
//   nobody can play and the first turn clock has not started.
//   It slides in from the left side and leaves the same way.
// - friend card: a friend's numbers, last games and an invite button.
const OUT_MS=650;

export function createVersus({api,now=()=>Date.now()}){
 let cache=null,at=0,pending=null;
 async function load(force=false){
  if(!force&&cache&&now()-at<60000)return cache;
  pending??=api('playerSocial',{action:'versus',houses:true}).then(r=>{cache=Object.fromEntries((r?.results||[]).map(x=>[x.uid,x]));at=now();return cache;}).finally(()=>{pending=null;});
  return pending;
 }
 return {load,cached:()=>cache,forget(){cache=null;at=0;}};
}

const el=(document,tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const empty={won:0,lost:0,last:[],one:{won:0,lost:0},teamVs:{won:0,lost:0},together:{won:0,lost:0},streak:null};
const plural=(n,one,many)=>n+' '+(n===1?one:many);
// A bot of the house keeps its whole name ("Bot Pepe"), a person their first part ("Caro" from "Caro.Suarez").
export const firstName=name=>/^Bot /.test(String(name||''))?String(name):String(name||'').split(/[._\s-]/)[0]||String(name||'');

// The short line under the numbers: who is ahead, or how the last game went.
export function versusLine(stats,other){
 const s=stats||empty,games=s.won+s.lost,diff=s.won-s.lost;
 if(!games)return {last:'',mood:'Primera partida entre ustedes. ¡Suerte!'};
 const lastRival=(s.last||[]).find(g=>!g.together&&g.result!=='tied');
 const last=lastRival?(lastRival.result==='won'?'La última la ganaste vos':'La última la ganó '+other)+(lastRival.mine||lastRival.theirs?', '+Math.max(lastRival.mine,lastRival.theirs)+' a '+Math.min(lastRival.mine,lastRival.theirs)+'.':'.'):'';
 const mood=diff>0?{lead:'Vas ganando por '+diff,tail:' ¡dale!'}:diff<0?{lead:other+' va ganando por '+(-diff),tail:' ¡a remontar!'}:{lead:'Están parejos',tail:' ¡a desempatar!'};
 return {last,mood};
}

// The notebook page: "Vos vs Caro", the wins of each one (truco has no ties) and one line below.
export function notebookElement(document,stats,otherName){
 const s=stats||empty,other=firstName(otherName),games=s.won+s.lost;
 const page=el(document,'div','versus-notebook');
 const rings=el(document,'div','versus-rings');for(let i=0;i<10;i++)rings.append(el(document,'i'));
 const inner=el(document,'div','versus-page');
 const h=el(document,'h3','','Vos vs '+other+' ');h.append(el(document,'small','','· '+plural(games,'partida','partidas')));
 inner.append(h);
 for(const [name,value,lead] of [['Vos',s.won,s.won>s.lost],[other,s.lost,s.lost>s.won]]){
  const row=el(document,'div','versus-row'+(lead?' lead':''));const n=el(document,'b','',String(value));
  row.append(el(document,'span','',name),n);inner.append(row);
 }
 const {last,mood}=versusLine(s,other),foot=el(document,'p','versus-foot');
 if(last)foot.append(last,el(document,'br'));
 if(typeof mood==='string')foot.append(mood);else foot.append(el(document,'em','',mood.lead),mood.tail);
 inner.append(foot);page.append(rings,inner);return page;
}

export function installMatchNotebook({document,getState,relationOf,versus,now}){
 const shown=new Set();let layer=null,timers=[];
 function clear(){for(const t of timers)clearTimeout(t);timers=[];layer?.remove();layer=null;}
 // Called on every render: shows the notebook once, right when a 1 vs 1 game between friends starts.
 function check(){
  const state=getState(),room=state.room;
  if(!room||state.learning||state.localGame||!room.managedCredits||room.mode==='2v2')return;
  const key=String(room.creditMatch?.id||room.table||'')+':'+String(room.matchNumber||1);
  if(shown.has(key))return;
  const end=Number(room.introUntil)||0;
  if(room.status!=='started'||end<=now())return;
  const me=state.playerId,other=me==='player1'?'player2':me==='player2'?'player1':null,person=other&&room.players?.[other];
  if(!person?.uid)return;
  shown.add(key);show(person,end);
 }
 function show(person,end){
  clear();
  layer=el(document,'div','versus-layer');layer.setAttribute('role','dialog');layer.setAttribute('aria-label','Partidas entre ustedes');
  const slot=el(document,'div','versus-slot'),pill=el(document,'div','versus-countdown');
  layer.append(slot,pill);document.body.append(layer);
  // Reading the layout fixes the starting position (off the left side) before sliding in.
  void slot.getBoundingClientRect().width;layer.classList.add('in');
  const put=stats=>{if(!layer)return;slot.replaceChildren(notebookElement(document,stats,person.name));};
  const known=versus.cached()?.[person.uid];put(known||null);
  versus.load(true).then(all=>put(all?.[person.uid]||null)).catch(()=>{});
  // The first second the notebook settles; then 5 … 1, and it leaves right when the turn clock starts.
  const left=end-now(),at=ms=>Math.max(0,left-ms);
  const count=n=>{if(!layer)return;pill.classList.add('show');pill.replaceChildren(el(document,'span','versus-ring',String(n)),'Empieza en '+plural(n,'segundo','segundos'));};
  for(let n=5;n>=1;n--)if(left>n*1000-1000)timers.push(setTimeout(()=>count(n),at(n*1000)));
  timers.push(setTimeout(()=>{layer?.classList.remove('in');layer?.classList.add('leaving');},at(OUT_MS)),setTimeout(clear,left));
 }
 return {check,clear};
}

// A friend's card: the notebook, a few numbers, the last games and an invite button.
export function installFriendCard({document,versus,profiles=null,onInvite=null,toast=()=>{}}){
 const dialog=el(document,'dialog','versus-card');document.body.append(dialog);
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 const when=at=>{if(!at)return '';const d=Math.floor((Date.now()-at)/86400000);if(d<1)return 'hoy';if(d<2)return 'ayer';if(d<7)return 'hace '+d+' días';const t=new Date(at);return t.getDate()+'/'+(t.getMonth()+1);};
 async function open(friend){
  dialog.replaceChildren();
  const box=el(document,'div','versus-card-inner'),head=el(document,'div','versus-card-head');
  const av=el(document,'span','friend-avatar');if(profiles)av.innerHTML=profiles.avatarHtml(profiles.profileOf(friend.uid,friend.name)||{},'player-avatar');
  const who=el(document,'div','versus-card-who');who.append(el(document,'strong','',friend.name));
  const profile=profiles?.profileOf(friend.uid,friend.name);if(profile)who.append(el(document,'small','','Nivel '+profiles.levelOf(profile.points).level));
  const close=el(document,'button','account-close','×');close.type='button';close.setAttribute('aria-label','Cerrar');close.onclick=()=>dialog.close();
  head.append(av,who,close);const content=el(document,'div','versus-card-body');content.append(el(document,'p','friend-empty','Cargando…'));
  box.append(head,content);dialog.append(box);if(!dialog.open)dialog.showModal();
  let stats=versus.cached()?.[friend.uid];
  try{stats=(await versus.load())?.[friend.uid]||null;}catch(e){if(!stats){content.replaceChildren(el(document,'p','friend-empty',e?.message||'No pudimos cargar las partidas.'));return;}}
  const s=stats||empty;content.replaceChildren(notebookElement(document,s,friend.name));
  const grid=el(document,'div','versus-grid'),other=firstName(friend.name);
  const streak=s.streak&&s.streak.result!=='tied'?[plural(s.streak.count,'seguida','seguidas'),s.streak.result==='won'?'ganadas por vos':'ganadas por '+other]:['—','sin racha'];
  // A bot of the house only plays 1 vs 1: no 2 vs 2 boxes.
  const boxes=[['Racha',...streak],['1 vs 1',s.one.won+' – '+s.one.lost,'ganadas – perdidas'],['2 vs 2 en contra',s.teamVs.won+' – '+s.teamVs.lost,'ganadas – perdidas'],['2 vs 2 juntos',s.together.won+' – '+s.together.lost,'como compañeros']];
  for(const [label,value,note] of friend.house?boxes.slice(0,2):boxes){
   const b=el(document,'div','versus-box');b.append(el(document,'small','',label),el(document,'b','',value),el(document,'em','',note));grid.append(b);
  }
  content.append(grid);
  if(s.last?.length){
   content.append(el(document,'h4','versus-section','Últimas partidas'));const list=el(document,'ul','versus-last');
   for(const g of s.last.filter(g=>g.result!=='tied')){
    const li=el(document,'li'),mark=el(document,'i',g.result==='won'?'w':'l',g.result==='won'?'G':'P');
    const text=(g.result==='won'?'Ganaste':'Perdiste')+(g.mine||g.theirs?' '+g.mine+' a '+g.theirs:'')+(g.together?' juntos':'');
    li.append(mark,el(document,'span','',text),el(document,'small','',(g.mode==='2v2'?'2 vs 2':'1 vs 1')+(g.at?' · '+when(g.at):'')));list.append(li);
   }
   content.append(list);
  }
  if(onInvite&&!friend.house){
   const invite=el(document,'button','button primary versus-invite','Invitar a jugar');invite.type='button';
   invite.onclick=async()=>{invite.disabled=true;try{await onInvite(friend);dialog.close();}catch(e){toast(e?.message||'No se pudo enviar la invitación.',true);}finally{invite.disabled=false;}};
   content.append(invite);
  }
 }
 return {open};
}
