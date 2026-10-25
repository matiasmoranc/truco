// Friends: search players, the last opponents, friend requests and the friend list;
// from a waiting table, invite a friend, who gets the invitation live in the game
// (and as a phone notification) with Entrar / Rechazar.
export function installFriends({$,api,services,getState,toast,tableToInvite,joinInvite,document}){
 let tab='friends',overview={friends:[],incoming:[],outgoing:[]},inviteUnsub=null,replyUnsub=null,listening=null;
 const shownInvites=new Set(),shownReplies=new Set(),invited=new Map();
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 const call=(action,data={})=>api('playerSocial',{action,...data});
 const LABELS={friend:'Amigo',outgoing:'Solicitud enviada',incoming:'Te mandó solicitud'};
 // One row: the name and its buttons.
 function row(name,detail,buttons){
  const item=el('li','friend-row'),who=el('div','friend-who');who.append(el('strong','',name));if(detail)who.append(el('small','',detail));
  const actions=el('div','friend-actions');for(const b of buttons)actions.append(b);item.append(who,actions);return item;
 }
 function button(text,onClick,primary=false){
  const b=el('button','button '+(primary?'primary':'secondary')+' friend-button',text);b.type='button';
  b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{await onClick();}catch(error){toast(error?.message||'No se pudo completar.',true);}finally{b.disabled=false;}};
  return b;
 }
 // The right action for someone, given how they relate to me.
 function personButtons(person,refresh){
  if(person.relation==='friend')return [el('span','friend-tag',LABELS.friend)];
  if(person.relation==='incoming')return [button('Aceptar',async()=>{await call('respond',{uid:person.uid,accept:true});toast('Ahora son amigos.');await refresh();},true)];
  if(person.relation==='outgoing')return [el('span','friend-tag',LABELS.outgoing)];
  return [button('Agregar',async()=>{const r=(await call('request',{uid:person.uid})).relation;toast(r==='friend'?'Ahora son amigos.':'Solicitud enviada.');person.relation=r;await refresh();},true)];
 }
 function list(target,items,empty){target.replaceChildren();if(!items.length){target.append(el('p','friend-empty',empty));return;}for(const i of items)target.append(i);}
 async function loadOverview(){overview=(await call('overview'))||overview;badge();}
 function badge(){const n=overview.incoming.length;for(const b of [$('friends-badge'),$('friends-requests-badge')]){if(!b)continue;b.hidden=!n;b.textContent=String(n);}}
 async function render(){
  for(const t of document.querySelectorAll('[data-friends-tab]'))t.classList.toggle('active',t.dataset.friendsTab===tab);
  for(const p of document.querySelectorAll('[data-friends-panel]'))p.hidden=p.dataset.friendsPanel!==tab;
  if(tab==='friends')list($('friends-list'),overview.friends.map(f=>row(f.name,null,[button('Quitar',async()=>{if(!confirm('¿Quitar a '+f.name+' de tus amigos?'))return;await call('remove',{uid:f.uid});await loadOverview();render();})])),'Todavía no tenés amigos. Buscalos por nombre o agregá a los últimos con los que jugaste.');
  if(tab==='requests'){
   list($('friends-incoming'),overview.incoming.map(r=>row(r.name,'Quiere ser tu amigo',[button('Aceptar',async()=>{await call('respond',{uid:r.uid,accept:true});toast('Ahora son amigos.');await loadOverview();render();},true),button('Rechazar',async()=>{await call('respond',{uid:r.uid,accept:false});await loadOverview();render();})])),'No tenés solicitudes pendientes.');
   list($('friends-outgoing'),overview.outgoing.map(r=>row(r.name,'Esperando respuesta',[button('Cancelar',async()=>{await call('cancel-request',{uid:r.uid});await loadOverview();render();})])),'No enviaste solicitudes.');
  }
  if(tab==='recent'){
   $('friends-recent').replaceChildren(el('p','friend-empty','Cargando…'));
   const results=(await call('recent'))?.results||[];
   const refresh=async()=>{await loadOverview();render();};
   list($('friends-recent'),results.map(p=>row(p.name,'Jugaron juntos',personButtons(p,refresh))),'Cuando juegues con otras personas, aparecen acá las últimas 10.');
  }
 }
 let searchTimer=null,searchSeq=0;
 async function search(){
  const query=$('friends-search').value.trim(),seq=++searchSeq;
  if(query.length<2){list($('friends-search-results'),[],'Escribí al menos 2 letras del nombre.');return;}
  const results=(await call('search',{query}))?.results||[];if(seq!==searchSeq)return;
  const refresh=async()=>{await loadOverview();search();};
  list($('friends-search-results'),results.map(p=>row(p.name,p.relation==='incoming'?LABELS.incoming:null,personButtons(p,refresh))),'No encontramos jugadores con ese nombre.');
 }
 async function open(start='friends'){tab=start;$('friends-dialog').showModal();$('friends-list').replaceChildren(el('p','friend-empty','Cargando…'));try{await loadOverview();}catch(e){toast(e?.message||'No se pudieron cargar tus amigos.',true);}render();}
 $('open-friends').onclick=()=>open(overview.incoming.length?'requests':'friends');
 $('friends-close').onclick=()=>$('friends-dialog').close();
 for(const t of document.querySelectorAll('[data-friends-tab]'))t.onclick=()=>{tab=t.dataset.friendsTab;render();};
 $('friends-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,300);};

 // Inviting a friend to the table I am waiting at.
 function renderInviteList(){
  const query=$('invite-friend-search').value.trim().toLocaleLowerCase('es');
  const friends=overview.friends.filter(f=>f.name.toLocaleLowerCase('es').includes(query));
  list($('invite-friend-list'),friends.map(f=>{
   const state=invited.get(f.uid);
   return row(f.name,state==='sent'?'Invitación enviada':state==='declined'?'No puede ahora':null,[button(state==='sent'?'Reenviar':'Invitar',async()=>{
    const table=tableToInvite();if(!table)throw new Error('La mesa ya no está esperando jugadores.');
    await call('invite',{uid:f.uid,table});invited.set(f.uid,'sent');toast('Invitación enviada a '+f.name+'.');renderInviteList();
   },state!=='sent')]);
  }),overview.friends.length?'Ningún amigo con ese nombre.':'Todavía no tenés amigos. Agregalos desde "Amigos" en la pantalla principal.');
 }
 $('invite-friend').onclick=async()=>{$('invite-friend-search').value='';$('invite-friend-dialog').showModal();$('invite-friend-list').replaceChildren(el('p','friend-empty','Cargando…'));try{await loadOverview();}catch{}renderInviteList();};
 $('invite-friend-close').onclick=()=>$('invite-friend-dialog').close();
 $('invite-friend-search').oninput=renderInviteList;

 // An invitation for me: shown once, while it is still valid.
 let current=null;
 function showInvite(id,invite){
  if(shownInvites.has(id)||!(invite?.expiresAt>Date.now()))return;
  if(getState().room&&!['waiting','complete'].includes(getState().room.status))return;
  shownInvites.add(id);current={id,invite};
  $('table-invite-text').textContent=invite.fromName+' te invita a jugar'+(invite.mode==='2v2'?' una mesa de 2 vs 2':' una mesa de 1 vs 1')+(invite.targetPoints?' a '+invite.targetPoints+' puntos':'')+(invite.stake?' ('+invite.stake+' crédito'+(invite.stake===1?'':'s')+')':'')+'.';
  $('table-invite-dialog').showModal();
  setTimeout(()=>{if(current?.id===id&&$('table-invite-dialog').open){$('table-invite-dialog').close();toast('La invitación de '+invite.fromName+' venció.');}},Math.max(0,invite.expiresAt-Date.now()));
 }
 async function answer(accept){
  const invite=current;if(!invite)return;current=null;$('table-invite-dialog').close();
  try{const result=await call('answer-invite',{inviteId:invite.id,accept});if(accept&&result?.code)await joinInvite(result.code,result.password||'');}
  catch(error){toast(error?.message||'No se pudo responder la invitación.',true);}
 }
 $('table-invite-accept').onclick=()=>answer(true);
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
 // Live listeners for the signed-in player; restarted when the account changes.
 async function start(){
  const uid=getState().uid;if(!uid||listening===uid)return;stop();listening=uid;
  const fb=await services();if(listening!==uid)return;
  inviteUnsub=fb.onValue(fb.ref(fb.db,'tableInvites/'+uid),snap=>{for(const [id,v] of Object.entries(snap.val()||{}))showInvite(id,v);},()=>{});
  replyUnsub=fb.onValue(fb.ref(fb.db,'tableInviteReplies/'+uid),snap=>{for(const [id,v] of Object.entries(snap.val()||{}))showReply(id,v);},()=>{});
  loadOverview().catch(()=>{});
 }
 function stop(){inviteUnsub?.();replyUnsub?.();inviteUnsub=replyUnsub=null;listening=null;}
 return {start,stop,open,refresh:()=>loadOverview().catch(()=>{})};
}
