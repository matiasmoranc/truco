// The people at a table: each player's picture stays on the table for the whole match
// (the rival's beside their cards, mine above my hand, and in 2 vs 2 beside each name),
// tapping a picture shows it big with the level and a way to add that player as a
// friend, and the result screen offers the same and a chat with the rival.
const SEATS1=['player1','player2'];
export function installTablePeople({$,document,getState,profiles,friends,signedIn,escapeHtml,chat,toast}){
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 const room=()=>getState().room;
 const seatsOf=r=>r?.mode==='2v2'?['player1','player3','player2','player4']:SEATS1;
 // A real person, as opposed to a bot or a house player.
 const isPerson=p=>!!p?.uid&&!p.bot&&!String(p.uid).startsWith('house_');
 function profileFor(seat){
  const s=getState(),p=s.room?.players?.[seat];if(!p)return {};
  if(seat===s.playerId&&s.uid)return profiles.profileOf(s.uid,p.name)||profiles.mine?.()||{};
  return (p.uid&&profiles.profileOf(p.uid,p.name))||{};
 }
 const levelText=profile=>profile&&profile.points!=null?'Nv '+profiles.levelOf(profile.points).level:'';
 const nameOf=seat=>{const s=getState(),p=s.room?.players?.[seat];if(!p)return 'Jugador';if(seat===s.playerId)return 'Vos';return p.name||(p.bot?'Bot':'Jugador');};
 // Whose move it is right now, to light that picture.
 function activeSeat(r){const b=r?.pendingBet;if(r?.status!=='started')return null;return b?(b.revealMode?b.revealTurn:b.responder):r.turn;}
 // 1 vs 1: a picture for the rival beside their cards and one for me above my hand.
 function chip(id){
  let node=$(id);if(node)return node;
  node=el('button','seat-chip '+id);node.id=id;node.type='button';
  node.addEventListener('click',()=>showCard(node.dataset.seat));
  $('felt-area').append(node);return node;
 }
 function renderSeats(){
  const s=getState(),r=s.room;
  const shown=!!r&&r.mode!=='2v2'&&!s.learning&&s.playerId&&!['waiting','drawing'].includes(r.status);
  const rival=s.playerId==='player1'?'player2':'player1';
  $('game-view').classList.toggle('has-my-seat',!!shown);
  for(const [id,seat] of [['rival-seat',rival],['my-seat',s.playerId]]){
   const node=chip(id);node.hidden=!shown||!r?.players?.[seat];if(node.hidden)continue;
   const profile=profileFor(seat),name=nameOf(seat);
   const key=JSON.stringify([seat,name,profile.photo,profile.use,profile.icon,profile.badge,profile.points]);
   if(node.dataset.key!==key){
    node.dataset.key=key;node.dataset.seat=seat;
    node.innerHTML=profiles.avatarHtml(profile,'player-avatar seat-avatar');
    node.append(el('span','seat-chip-name',id==='my-seat'?'Vos':name));
    if(id==='rival-seat'){const level=levelText(profile);if(level)node.append(el('small','seat-chip-level',level));}
    node.setAttribute('aria-label','Ver el perfil de '+(seat===s.playerId?'vos':name));
   }
   node.classList.toggle('is-turn',activeSeat(r)===seat);
  }
 }
 // 2 vs 2: the picture goes inside each name tag, so it never covers cards.
 function decorateTeamSeats(){
  const s=getState(),r=s.room;if(r?.mode!=='2v2')return;
  for(const seat of seatsOf(r)){
   const box=$('team-seat-'+seat),label=box?.querySelector('.team-player-name');if(!label)continue;
   const html=profiles.avatarHtml(profileFor(seat),'player-avatar'),old=label.querySelector('.team-seat-avatar');
   if(old?.dataset.html===html)continue;old?.remove();
   const b=el('button','team-seat-avatar');b.type='button';b.innerHTML=html;b.dataset.html=html;
   b.setAttribute('aria-label','Ver el perfil de '+nameOf(seat));b.addEventListener('click',()=>showCard(seat));
   label.prepend(b);label.classList.add('with-avatar');
  }
 }
 // What I can do with someone: add, wait, accept or nothing (already friends).
 function friendAction(seat,{compact=false}={}){
  const s=getState(),p=s.room?.players?.[seat];
  if(!signedIn()||!isPerson(p)||p.uid===s.uid||!friends)return null;
  const relation=friends.relationOf(p.uid),name=p.name||'Jugador';
  if(relation==='friend')return el('span','friend-tag is-friend','✓ Amigos');
  if(relation==='outgoing')return el('span','friend-tag','Solicitud enviada');
  const accept=relation==='incoming';
  const b=el('button','friend-button primary add-friend-button',accept?'Aceptar amistad':compact?'+ Agregar':'+ Agregar amigo');b.type='button';
  b.addEventListener('click',async()=>{
   if(b.disabled)return;b.disabled=true;
   try{if(accept)await friends.acceptFriend(p.uid);else await friends.requestFriend(p.uid,name);}
   catch(error){toast(error?.message||'No se pudo completar.');}
   finally{b.disabled=false;refresh();}
  });
  return b;
 }
 // A player's card: the picture big, the name, the level and the friend button.
 let card=null;
 function showCard(seat){
  const s=getState(),p=s.room?.players?.[seat];if(!p)return;
  card?.close();
  const dialog=el('dialog','player-card-dialog');dialog.setAttribute('aria-label','Perfil de '+nameOf(seat));
  const profile=profileFor(seat),big=el('div','player-card-avatar');big.innerHTML=profiles.avatarHtml(profile,'player-avatar');
  const name=el('strong','player-card-name',seat===s.playerId?(p.name||'Vos'):nameOf(seat)),level=levelText(profile);
  const close=el('button','button secondary player-card-close','Cerrar');close.type='button';close.onclick=()=>dialog.close();
  dialog.append(big,name);if(level)dialog.append(el('span','player-card-level',level));
  if(seat!==s.playerId&&p.bot)dialog.append(el('small','player-card-note','Es un bot.'));
  const action=friendAction(seat);if(action)dialog.append(action);
  dialog.append(close);
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{dialog.remove();if(card===dialog)card=null;});
  document.body.append(dialog);card=dialog;dialog.showModal();close.focus({preventScroll:true});
 }

 // The result screen: the people I played with (to add them) and a chat that stays open.
 const endVisible=()=>!$('match-end').classList.contains('hidden');
 function renderEndPeople(){
  const s=getState(),r=s.room,box=$('match-end-people');if(!box)return;
  const others=r?seatsOf(r).filter(q=>q!==s.playerId&&isPerson(r.players?.[q])):[];
  const rows=others.map(q=>{
   const p=r.players[q],relation=signedIn()&&friends?friends.relationOf(p.uid):'none';
   const row=el('div','end-person'+(relation==='incoming'?' is-asking':''));
   const pic=el('button','end-person-avatar');pic.type='button';pic.innerHTML=profiles.avatarHtml(profileFor(q),'player-avatar');pic.setAttribute('aria-label','Ver el perfil de '+(p.name||'Jugador'));pic.onclick=()=>showCard(q);
   const who=el('div','end-person-who');who.append(el('strong','',p.name||'Jugador'));
   const level=levelText(profileFor(q));
   who.append(el('small','',relation==='incoming'?(p.name||'Te')+' te invitó a ser amigos':level));
   row.append(pic,who);const action=friendAction(q,{compact:true});if(action)row.append(action);
   return row;
  });
  box.replaceChildren(...rows);box.hidden=!rows.length;
 }
 // The end chat shows the same messages as the table chat and sends through it.
 function renderEndChat(){
  const s=getState(),r=s.room,box=$('match-end-chat');if(!box||!r)return;
  const info=chat.state(),peers=seatsOf(r).filter(q=>q!==s.playerId&&r.players?.[q]&&!r.players[q].bot);
  box.hidden=s.localGame||!peers.length||info.gone;if(box.hidden)return;
  $('end-chat-title').textContent=r.mode==='2v2'?'Chat de la mesa':'Chat con '+(r.players[peers[0]]?.name||'tu rival');
  const history=$('end-chat-history'),near=history.scrollHeight-history.scrollTop-history.clientHeight<24;
  const items=[...info.messages,...info.pending.map(m=>({...m,pending:true}))];
  history.replaceChildren(...(items.length?items.map(m=>{
   const mine=m.sender===s.playerId,item=el('div','end-chat-message'+(mine?' mine':''));
   if(!mine&&r.mode==='2v2')item.append(el('strong','',r.players?.[m.sender]?.name||'Jugador'));
   item.append(el('span','',m.text));return item;
  }):[el('p','end-chat-empty','¿Buena partida? Escribile algo.')]));
  if(near||items.length)history.scrollTop=history.scrollHeight;
  const note=info.unavailable;
  $('end-chat-note').textContent=note||'';$('end-chat-note').hidden=!note;
  for(const node of [$('end-chat-input'),$('end-chat-send'),...box.querySelectorAll('[data-end-quick]')])node.disabled=!!note||info.sending;
 }
 async function sendEnd(text){
  text=String(text||'').trim();if(!text)return;
  const error=await chat.send(text);
  if(error){$('end-chat-note').textContent=error;$('end-chat-note').hidden=false;}
  renderEndChat();
 }
 $('end-chat-form')?.addEventListener('submit',event=>{event.preventDefault();const input=$('end-chat-input'),text=input.value;input.value='';void sendEnd(text);});
 for(const b of document.querySelectorAll('[data-end-quick]'))b.addEventListener('click',()=>sendEnd(b.dataset.endQuick));
 function renderEnd(){if(!endVisible())return;renderEndPeople();renderEndChat();}
 function refresh(){renderSeats();decorateTeamSeats();renderEnd();if(card&&card.open){/* the friend state of the open card may have changed */}}
 return {renderSeats,decorateTeamSeats,renderEnd,refresh,showCard,endVisible};
}
