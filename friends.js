// Friends: a full screen with a search box, friend requests, the friend list and the
// people you played with lately; everything follows the database live, so a request
// or a new friendship shows on both sides at once. From a waiting table, invite a
// friend, who gets the invitation live in the game (and as a phone notification)
// with Entrar / Rechazar.
const coinIcon='<svg class="credit-coin-icon" viewBox="-2 -2 52 54" aria-hidden="true"><g transform="rotate(-9 21 35)"><path d="M6 35v7a15 6 0 0 0 30 0v-7"/><ellipse cx="21" cy="35" rx="15" ry="6"/></g><g transform="rotate(9 27 23)"><path d="M12 23v7a15 6 0 0 0 30 0v-7"/><ellipse cx="27" cy="23" rx="15" ry="6"/></g><g transform="rotate(-12 20 12)"><path d="M5 12v7a15 6 0 0 0 30 0v-7"/><ellipse cx="20" cy="12" rx="15" ry="6"/></g></svg>';
export function installFriends({$,api,services,getState,toast,tableToInvite,joinInvite,showView,openLobby,profiles=null,createTable=()=>{},isPlaying=()=>false,balance=()=>undefined,canClaim=()=>false,claimCredits=async()=>{},document}){
 let overview={friends:[],incoming:[],outgoing:[]},recent=null,unsubscribers=[],listening=null,statusTimer=null;
 // Friends' presence (presence/{uid}: lobby, playing or off, and since when), one listener each.
 let presence={},presenceSubs=new Map(),presenceFb=null,pendingInvite=null;
 const open$={requests:false,list:false};
 const shownInvites=new Set(),shownReplies=new Set(),invited=new Map();
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 const call=(action,data={})=>api('playerSocial',{action,...data});
 const byName=(a,b)=>a.name.localeCompare(b.name,'es');
 // Each list follows one database path; an empty or unreadable path is an empty list.
 const asList=value=>Object.entries(value||{}).map(([uid,v])=>({uid,name:v?.name||'',at:v?.at||v?.since||null})).sort(byName);
 const relationOf=uid=>overview.friends.some(f=>f.uid===uid)?'friend':overview.incoming.some(f=>f.uid===uid)?'incoming':overview.outgoing.some(f=>f.uid===uid)?'outgoing':'none';
 // One row: the name, an optional line below it and its buttons.
 function row(name,detail,buttons){
  const item=el('li','friend-row'),who=el('div','friend-who');who.append(el('strong','',name));if(detail)who.append(el('small','',detail));
  const actions=el('div','friend-actions');for(const b of buttons)actions.append(b);item.append(who,actions);return item;
 }
 function button(text,onClick,primary=false){
  const b=el('button','friend-button'+(primary?' primary':''),text);b.type='button';
  b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await onClick();}catch(error){toast(error?.message||'No se pudo completar.',true);}finally{b.disabled=false;}};
  return b;
 }
 const tag=text=>el('span','friend-tag',text);
 // The action that fits someone, given how they relate to me right now.
 function personButtons(person){
  const relation=relationOf(person.uid);
  if(relation==='friend')return [tag('Amigo')];
  if(relation==='outgoing')return [tag('Solicitud enviada')];
  if(relation==='incoming')return [button('Aceptar',async()=>{await call('respond',{uid:person.uid,accept:true});toast('Ahora son amigos.');},true)];
  return [button('Agregar',async()=>{const r=(await call('request',{uid:person.uid}))?.relation;toast(r==='friend'?'Ahora son amigos.':'Solicitud enviada a '+person.name+'.');},true)];
 }
 function list(target,items,empty){target.replaceChildren();if(!items.length){if(empty)target.append(el('p','friend-empty',empty));return;}for(const i of items)target.append(i);}
 function badge(){const n=overview.incoming.length;const b=$('friends-badge');if(b){b.hidden=!n;b.textContent=String(n);}}
 let searchResults=null,searchTimer=null,searchSeq=0;
 const stateOf=uid=>{const p=presence[uid];return p?.state==='lobby'||p?.state==='playing'?p.state:'off';};
 const online=()=>overview.friends.filter(f=>stateOf(f.uid)!=='off');
 const rank={lobby:0,playing:1,off:2};
 const byPresence=(a,b)=>rank[stateOf(a.uid)]-rank[stateOf(b.uid)]||(stateOf(a.uid)==='off'?(presence[b.uid]?.at||0)-(presence[a.uid]?.at||0):0)||byName(a,b);
 function ago(at){
  if(!at)return 'Desconectado';const m=Math.max(1,Math.round((Date.now()-at)/60000));
  if(m<60)return 'Hace '+m+(m===1?' minuto':' minutos');const h=Math.round(m/60);if(h<24)return 'Hace '+h+(h===1?' hora':' horas');
  const d=Math.round(h/24);return d===1?'Ayer':'Hace '+d+' días';
 }
 // A person with their picture, level and what they are doing.
 function personRow(person,detail,buttons,{live=false}={}){
  const item=row(person.name,null,buttons);item.classList.add('with-avatar');
  const state=live?stateOf(person.uid):null;if(state==='off')item.classList.add('is-off');
  const profile=profiles?.profileOf(person.uid,person.name);
  if(profiles){const av=el('span','friend-avatar');av.innerHTML=profiles.avatarHtml(profile||{},'player-avatar');if(state&&state!=='off')av.append(el('i','live-dot'+(state==='playing'?' busy':'')));item.prepend(av);}
  const who=item.querySelector('.friend-who');
  const text=detail??(state==='lobby'?'En línea':state==='playing'?'Jugando una partida':state==='off'?ago(presence[person.uid]?.at):null);
  // The level goes on the second line, so the whole name fits on the first.
  if(text||profile){const small=el('small',state==='lobby'?'is-online':state==='playing'?'is-playing':'',text||'');if(profile)small.prepend(el('span','friend-level','Nv '+profiles.levelOf(profile.points).level));who.append(small);}
  return item;
 }
 // Invite a friend: to the table I am waiting at, or to the one I am about to create.
 async function inviteFriend(f){
  const table=tableToInvite();
  if(table){await call('invite',{uid:f.uid,table});invited.set(f.uid,'sent');toast('Invitación enviada a '+f.name+'.');return;}
  pendingInvite={uid:f.uid,name:f.name,until:Date.now()+10*60000};
  toast('Creá tu mesa y le mandamos la invitación a '+f.name+'.',false,3500);createTable();
 }
 async function sendPendingInvite(){
  if(!pendingInvite)return;if(Date.now()>pendingInvite.until){pendingInvite=null;return;}
  const table=tableToInvite();if(!table)return;const p=pendingInvite;pendingInvite=null;
  try{await call('invite',{uid:p.uid,table});invited.set(p.uid,'sent');toast('Invitación enviada a '+p.name+'.');}
  catch(error){toast(error?.message||'No se pudo enviar la invitación.',true);}
 }
 function friendButtons(f,{remove=false}={}){
  const state=stateOf(f.uid),b=[];
  if(state==='playing')b.push(tag('Jugando'));
  else{const invite=button(invited.get(f.uid)==='sent'?'Invitado':'Invitar',()=>inviteFriend(f),state==='lobby');b.push(invite);}
  if(remove){const x=button('×',async()=>{if(!confirm('¿Quitar a '+f.name+' de tus amigos?'))return;await call('remove',{uid:f.uid});});x.classList.add('icon-only');x.setAttribute('aria-label','Quitar a '+f.name);b.push(x);}
  return b;
 }
 function renderOnline(){
  const people=online().sort(byPresence),n=people.length;
  $('friends-online-text').textContent=n+' en línea';$('friends-online').classList.toggle('has-online',n>0);
  if($('friends-online-dialog').open)list($('friends-online-list'),people.map(f=>personRow(f,null,friendButtons(f),{live:true})),'Ninguno de tus amigos está conectado ahora.');
 }
 function fold(name,toggle,panel){$(toggle).setAttribute('aria-expanded',String(open$[name]));$(toggle).classList.toggle('open',open$[name]);$(panel).hidden=!open$[name];}
 function render(){
  badge();renderOnline();
  if(!$('friends-view').classList.contains('active'))return;
  const incoming=overview.incoming.length,count=$('friends-requests-count');count.hidden=!incoming;count.textContent=String(incoming);
  $('friends-count').textContent=String(overview.friends.length);
  fold('requests','friends-requests-toggle','friends-requests-panel');fold('list','friends-list-toggle','friends-list-panel');
  if(open$.requests){
   list($('friends-incoming'),overview.incoming.map(r=>personRow(r,'Te pidió amistad',[button('Aceptar',async()=>{await call('respond',{uid:r.uid,accept:true});toast('Ahora son amigos.');},true),Object.assign(button('×',()=>call('respond',{uid:r.uid,accept:false})),{className:'friend-button icon-only',ariaLabel:'Rechazar a '+r.name})])),overview.outgoing.length?null:'No tenés solicitudes nuevas.');
   $('friends-sent-title').hidden=!overview.outgoing.length;
   list($('friends-outgoing'),overview.outgoing.map(r=>personRow(r,'Esperando',[button('Cancelar',()=>call('cancel-request',{uid:r.uid}))])),null);
  }
  if(open$.list){
   const query=$('friends-filter').value.trim().toLocaleLowerCase('es');
   const shown=overview.friends.filter(f=>f.name.toLocaleLowerCase('es').includes(query)).sort(byPresence);
   list($('friends-list'),shown.map(f=>personRow(f,null,friendButtons(f,{remove:true}),{live:true})),overview.friends.length?'Ningún amigo con ese nombre.':'Todavía no tenés amigos. Buscalos por nombre o sumá a los que jugaron con vos.');
  }
  // While searching, the results take the place of the folded lists and the recent players.
  const searching=searchResults!==null;
  $('friends-search-section').hidden=!searching;$('friends-recent-section').hidden=searching;document.querySelector('.friends-folds').hidden=searching;
  if(searching)list($('friends-search-results'),searchResults.map(p=>personRow(p,null,personButtons(p))),'No encontramos jugadores con ese nombre.');
  else{
   const strip=$('friends-recent');strip.replaceChildren();
   const people=recent===null?null:recent.filter(p=>relationOf(p.uid)!=='friend');
   if(people===null)strip.append(el('p','friend-empty','Cargando…'));
   else if(!people.length)strip.append(el('p','friend-empty','Cuando juegues con otras personas, aparecen acá.'));
   else for(const p of people){
    const card=el('div','recent-person'),av=el('span','friend-avatar');
    if(profiles)av.innerHTML=profiles.avatarHtml(profiles.profileOf(p.uid,p.name)||{},'player-avatar');
    const [action]=personButtons(p);action.classList.add('recent-action');
    if(action.tagName==='BUTTON'&&action.textContent==='Agregar')action.textContent='+ Sumar';
    card.append(av,el('b','',p.name),action);strip.append(card);
   }
  }
 }
 async function search(){
  const query=$('friends-search').value.trim(),seq=++searchSeq;
  if(query.length<2){searchResults=null;render();return;}
  const results=(await call('search',{query}))?.results||[];if(seq!==searchSeq)return;
  searchResults=results;render();
 }
 async function open(){
  showView('friends-view');$('friends-search').value='';$('friends-filter').value='';searchResults=null;recent=null;open$.requests=overview.incoming.length>0;open$.list=false;render();
  try{recent=(await call('recent'))?.results||[];}catch(e){recent=[];toast(e?.message||'No se pudieron cargar los últimos jugadores.',true);}
  render();
 }
 $('open-friends').onclick=()=>open();
 $('friends-back').onclick=()=>openLobby();
 $('friends-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,300);};
 $('friends-filter').oninput=()=>render();
 for(const [name,toggle] of [['requests','friends-requests-toggle'],['list','friends-list-toggle']])$(toggle).onclick=()=>{open$[name]=!open$[name];render();};
 $('friends-online').onclick=()=>{list($('friends-online-list'),[],null);$('friends-online-dialog').showModal();renderOnline();};
 $('friends-online-close').onclick=()=>$('friends-online-dialog').close();
 $('friends-online-dialog').addEventListener('click',event=>{if(event.target===$('friends-online-dialog'))$('friends-online-dialog').close();});

 // Inviting a friend to the table I am waiting at.
 function renderInviteList(){
  const query=$('invite-friend-search').value.trim().toLocaleLowerCase('es');
  const friends=overview.friends.filter(f=>f.name.toLocaleLowerCase('es').includes(query));
  list($('invite-friend-list'),friends.map(f=>{
   const state=invited.get(f.uid);
   return row(f.name,state==='sent'?'Invitación enviada':state==='declined'?'No puede ahora':state==='busy'?'Está en una partida':null,[button(state==='sent'?'Reenviar':'Invitar',async()=>{
    const table=tableToInvite();if(!table)throw new Error('La mesa ya no está esperando jugadores.');
    // Problems show inside the window (a toast would sit behind it) and fade after 5 seconds.
    try{await call('invite',{uid:f.uid,table});}
    catch(error){if(/ya está en una partida/.test(error?.message||'')){invited.set(f.uid,'busy');renderInviteList();}inviteError(error?.message||'No se pudo enviar la invitación.');return;}
    invited.set(f.uid,'sent');toast('Invitación enviada a '+f.name+'.');renderInviteList();
   },state!=='sent')]);
  }),overview.friends.length?'Ningún amigo con ese nombre.':'Todavía no tenés amigos. Agregalos desde "Amigos" en la pantalla principal.');
 }
 let inviteErrorTimer=null;
 function inviteError(message){const box=$('invite-friend-error');box.textContent=message;box.hidden=false;clearTimeout(inviteErrorTimer);inviteErrorTimer=setTimeout(()=>{box.hidden=true;},5000);}
 $('invite-friend').onclick=()=>{$('invite-friend-error').hidden=true;$('invite-friend-search').value='';$('invite-friend-dialog').showModal();renderInviteList();};
 $('invite-friend-close').onclick=()=>$('invite-friend-dialog').close();
 $('invite-friend-search').oninput=renderInviteList;

 // An invitation for me: shown once, while it is still valid.
 let current=null;
 function showInvite(id,invite){
  if(shownInvites.has(id)||!(invite?.expiresAt>Date.now()))return;
  if(getState().room&&!['waiting','complete'].includes(getState().room.status))return;
  shownInvites.add(id);current={id,invite};
  $('table-invite-text').textContent=invite.fromName+' te invita a jugar en su mesa.';
  renderInviteCredits(invite);
  $('table-invite-dialog').showModal();$('table-invite-accept').focus({preventScroll:true});
  setTimeout(()=>{if(current?.id===id&&$('table-invite-dialog').open){$('table-invite-dialog').close();toast('La invitación de '+invite.fromName+' venció.');}},Math.max(0,invite.expiresAt-Date.now()));
 }
 // The table's facts, and whether my credits let me enter: with none left I can claim
 // the daily 5 right here, or Entrar stays blocked and says why.
 function renderInviteCredits(invite){
  const stake=Number(invite.stake)||0,mine=balance(),known=Number.isFinite(mine);
  const amount=n=>{const dd=el('dd','credit-amount');dd.innerHTML=coinIcon;dd.append(String(n));return dd;};
  const rows=[['Jugadores',el('dd','',invite.mode==='2v2'?'2 vs 2':'1 vs 1')],['Puntos',el('dd','',invite.targetPoints?invite.targetPoints+' puntos':'—')],...(stake?[['Apuesta',amount(stake)]]:[])];
  if(stake)rows.push(['Tus créditos',known?amount(mine):el('dd','','—')]);
  $('table-invite-summary').replaceChildren(...rows.flatMap(([k,v])=>[el('dt','',k),v]));
  const short=!!stake&&known&&mine<stake,claimable=short&&canClaim(),accept=$('table-invite-accept'),claim=$('table-invite-claim');
  claim.hidden=!claimable;
  accept.disabled=short;accept.textContent=short&&!claimable?(mine>0?'No te alcanzan los créditos':'No tenés créditos'):'Entrar';
 }
 async function answer(accept){
  const invite=current;if(!invite)return;current=null;$('table-invite-dialog').close();
  try{const result=await call('answer-invite',{inviteId:invite.id,accept});if(accept&&result?.code)await joinInvite(result.code,result.password||'');}
  catch(error){toast(error?.message||'No se pudo responder la invitación.',true);}
 }
 $('table-invite-accept').onclick=()=>answer(true);
 $('table-invite-claim').onclick=async()=>{
  const b=$('table-invite-claim');if(b.disabled)return;b.disabled=true;b.lastChild.textContent='Reclamando…';
  try{await claimCredits();}catch(error){toast(error?.message||'No se pudieron reclamar los créditos.',true);}
  finally{b.disabled=false;b.lastChild.textContent='Reclamar 5 créditos';if(current)renderInviteCredits(current.invite);}
 };
 $('table-invite-decline').onclick=()=>answer(false);
 // The host hears when a friend cannot come.
 function showReply(id,reply){
  if(shownReplies.has(id))return;shownReplies.add(id);
  if(Date.now()-(reply?.at||0)>5*60000)return;
  if(reply.accepted){invited.delete(reply.to);return;}
  invited.set(reply.to,'declined');
  if(getState().room?.code===reply.code||getState().roomCode===reply.code)toast((reply.name||'Tu amigo')+' no puede jugar ahora.',true,4000);
  if($('invite-friend-dialog').open)renderInviteList();
 }
 // Messages from the administrator, one at a time and never in the middle of a game:
 // when one arrives during a match it waits until the player is back out of it.
 let adminInbox=[],adminShowing=null;
 const adminDate=at=>at?new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at)):'';
 function showAdminMessage(){
  if(adminShowing||!adminInbox.length||isPlaying()||document.querySelector('dialog[open]'))return;
  const m=adminInbox[0];adminShowing=m;
  $('admin-message-text').textContent=m.text;$('admin-message-date').textContent=adminDate(m.at);
  $('admin-message-reply').value='';$('admin-message-error').hidden=true;
  $('admin-message-dialog').showModal();document.activeElement?.blur?.();
 }
 async function answerAdmin(withText){
  const m=adminShowing;if(!m)return;
  const text=withText?$('admin-message-reply').value.trim():'';
  if(withText&&!text){$('admin-message-reply').focus();return;}
  const buttons=[$('admin-message-send'),$('admin-message-close')];buttons.forEach(b=>b.disabled=true);
  try{
   await call('admin-answer',{messageId:m.id,...(text?{text}:{})});
   adminInbox=adminInbox.filter(x=>x.id!==m.id);adminShowing=null;$('admin-message-dialog').close();
   if(text)toast('Respuesta enviada.');
   setTimeout(showAdminMessage,400);
  }catch(error){const box=$('admin-message-error');box.textContent=error?.message||'No se pudo enviar.';box.hidden=false;}
  finally{buttons.forEach(b=>b.disabled=false);}
 }
 $('admin-message-send').onclick=()=>answerAdmin(true);
 $('admin-message-close').onclick=()=>answerAdmin(false);
 $('admin-message-dialog').addEventListener('cancel',event=>{event.preventDefault();answerAdmin(false);});
 // Live listeners for the signed-in player; restarted when the account changes.
 async function start(){
  const uid=getState().uid;if(!uid||listening===uid)return;stop();listening=uid;
  const fb=await services();if(listening!==uid)return;
  const follow=(path,onValue)=>unsubscribers.push(fb.onValue(fb.ref(fb.db,path+'/'+uid),snap=>onValue(snap.val()),()=>onValue(null)));
  // A new request, an acceptance or a removal reaches both players right away.
  let incomingSeen=null;
  follow('friends',value=>{overview.friends=asList(value);followPresence();render();if($('invite-friend-dialog').open)renderInviteList();});
  follow('friendRequests',value=>{
   overview.incoming=asList(value);
   const ids=new Set(overview.incoming.map(r=>r.uid));
   if(incomingSeen)for(const r of overview.incoming)if(!incomingSeen.has(r.uid))toast(r.name+' quiere ser tu amigo.',false,3500);
   incomingSeen=ids;render();
  });
  follow('friendRequestsSent',value=>{overview.outgoing=asList(value);render();});
  follow('tableInvites',value=>{for(const [id,v] of Object.entries(value||{}))showInvite(id,v);});
  follow('tableInviteReplies',value=>{for(const [id,v] of Object.entries(value||{}))showReply(id,v);});
  follow('adminMessages',value=>{adminInbox=Object.entries(value||{}).filter(([,m])=>m&&!m.readAt&&m.text).map(([id,m])=>({id,text:String(m.text),at:Number(m.at)||0})).sort((a,b)=>a.at-b.at);showAdminMessage();});
  // While I am in a game the server turns friends' invitations away; the report is
  // refreshed while playing and removed when the game ends or the connection drops.
  const statusRef=fb.ref(fb.db,'playerStatus/'+uid);let reported=false,reportedAt=0;
  fb.onDisconnect(statusRef).set(null).catch(()=>{});
  const report=()=>{
   if(listening!==uid)return;const playing=!!isPlaying();
   if(playing===reported&&(!playing||Date.now()-reportedAt<5*60000))return;
   reported=playing;reportedAt=Date.now();
   fb.set(statusRef,playing?{playing:true,at:fb.serverTimestamp()}:null).catch(()=>{reported=!playing;});
  };
  // My presence: lobby or playing while connected; the server writes "off" when I drop.
  const presenceRef=fb.ref(fb.db,'presence/'+uid);let shownState=null;
  const announce=force=>{const state=isPlaying()?'playing':'lobby';if(!force&&state===shownState)return;shownState=state;fb.set(presenceRef,{state,at:fb.serverTimestamp()}).catch(()=>{shownState=null;});};
  unsubscribers.push(fb.onValue(fb.ref(fb.db,'.info/connected'),snap=>{if(snap.val()!==true||listening!==uid)return;fb.onDisconnect(presenceRef).set({state:'off',at:fb.serverTimestamp()}).then(()=>announce(true)).catch(()=>{});},()=>{}));
  unsubscribers.push(()=>{fb.set(presenceRef,{state:'off',at:fb.serverTimestamp()}).catch(()=>{});});
  presenceFb=fb;followPresence();
  report();statusTimer=setInterval(()=>{report();announce(false);sendPendingInvite();showAdminMessage();},4000);
  unsubscribers.push(()=>{if(reported)fb.set(statusRef,null).catch(()=>{});});
 }
 // One presence listener per friend, added and dropped as the friend list changes.
 function followPresence(){
  const fb=presenceFb;if(!fb)return;const ids=new Set(overview.friends.map(f=>f.uid));
  for(const [uid,off] of presenceSubs)if(!ids.has(uid)){off?.();presenceSubs.delete(uid);delete presence[uid];}
  for(const uid of ids)if(!presenceSubs.has(uid))presenceSubs.set(uid,fb.onValue(fb.ref(fb.db,'presence/'+uid),snap=>{presence[uid]=snap.val()||null;render();},()=>{presence[uid]=null;}));
 }
 function stop(){for(const off of presenceSubs.values())off?.();presenceSubs=new Map();presence={};presenceFb=null;pendingInvite=null;clearInterval(statusTimer);adminInbox=[];if(adminShowing){adminShowing=null;$('admin-message-dialog').close();}statusTimer=null;for(const off of unsubscribers)off?.();unsubscribers=[];listening=null;overview={friends:[],incoming:[],outgoing:[]};badge();}
 return {start,stop,open,render,friendNames:()=>overview.friends.map(f=>f.name)};
}
