export function installPlayerPanel({document,api,getState,versus=null,openCard=null,profiles=null}){
 const $=id=>document.getElementById(id);
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const dialog=document.createElement('dialog');dialog.className='player-overlay';
 const card=node('div','','player-panel-card');const close=node('button','×','account-close');close.type='button';close.setAttribute('aria-label','Cerrar');close.onclick=()=>dialog.close();
 const title=node('h2','');title.id='player-panel-title';dialog.setAttribute('aria-labelledby',title.id);const body=node('div','','player-panel-body');card.append(close,title,body);dialog.append(card);document.body.append(dialog);
 let generation=0;const localIds=new WeakMap();
 dialog.addEventListener('close',()=>generation++);
 function open(text){generation++;title.textContent=text;body.replaceChildren();if(!dialog.open)dialog.showModal();return generation;}
 async function history(){
  const token=open('Mis estadísticas');body.append(node('p','Cargando estadísticas…'));
  try{
   const data=await api('playerConsole',{action:'history'});if(token!==generation)return;
   body.replaceChildren();const stats=node('div','','player-stats player-summary-stats');
   const finished=(data.matches||[]).filter(m=>m.status==='settled');
   const won=finished.filter(m=>m.winner===true).length,lost=finished.length-won;
   const percentage=finished.length?Math.round(won/finished.length*100):0;
   for(const [label,value] of [['Partidas ganadas',won],['Partidas perdidas',lost],['Porcentaje de victorias',percentage+'%']]){
    const box=node('div','','player-stat');box.append(node('strong',String(value)),node('small',label));stats.append(box);
   }
   const general=node('div','','player-tab-panel');general.append(stats);
   if(!versus){body.append(general);return;}
   // Two tabs: everything, or against each friend.
   const tabs=node('div','','player-tabs'),friendsPanel=node('div','','player-tab-panel');friendsPanel.hidden=true;
   const panels=[general,friendsPanel];
   const tab=(text,panel)=>{const b=node('button',text,'player-tab');b.type='button';b.onclick=()=>{for(const t of tabs.children)t.classList.toggle('on',t===b);for(const p of panels)p.hidden=p!==panel;if(panel===friendsPanel)againstFriends(friendsPanel,token);};return b;};
   const first=tab('General',general);first.classList.add('on');tabs.append(first,tab('Contra amigos',friendsPanel));
   body.append(tabs,...panels);
  }catch(e){if(token===generation)body.replaceChildren(node('p',e.message||'No pudimos cargar tus estadísticas.'));}
 }
 // houses: the bots of the house instead of friends.
 async function againstFriends(panel,token,houses=false){
  panel.replaceChildren(node('p','Cargando…','player-friends-empty'));
  let all;try{all=Object.values(await versus.load()||{});}catch(e){if(token===generation)panel.replaceChildren(node('p',e.message||'No pudimos cargar las partidas con amigos.','player-friends-empty'));return;}
  if(token!==generation)return;
  const games=s=>s.won+s.lost,played=all.filter(s=>games(s)>0&&!!s.house===houses).sort((a,b)=>games(b)-games(a)||(b.lastAt||0)-(a.lastAt||0));
  panel.replaceChildren();
  if(!played.length){panel.append(node('p',houses?'Todavía no jugaste contra los bots de la casa. Buscá sus mesas en el lobby.':'Todavía no jugaste contra tus amigos. Invitalos desde Amigos.','player-friends-empty'));return;}
  const total=played.reduce((n,s)=>n+games(s),0),won=played.reduce((n,s)=>n+s.won,0),lost=played.reduce((n,s)=>n+s.lost,0);
  const sum=node('div','','player-stats player-friends-sum');
  for(const [value,label,cls] of [[String(total),houses?'partidas contra bots':'partidas con amigos',''],[won+' – '+lost,'ganadas – perdidas',won>lost?'up':won<lost?'down':'']]){const box=node('div','','player-stat');box.append(node('strong',value,cls),node('small',label));sum.append(box);}
  panel.append(sum,node('h4',houses?'Contra qué bot jugás más':'Con quién jugás más','player-friends-title'));
  const list=node('ul','','player-friends-list');
  const ago=at=>{if(!at)return '';const d=Math.floor((Date.now()-at)/86400000);return d<1?'última hoy':d<2?'última ayer':d<7?'hace '+d+' días':d<14?'hace 1 semana':'hace '+Math.floor(d/7)+' semanas';};
  for(const f of played){
   const li=node('li','','player-friend'),n=games(f),cls=f.won>f.lost?'up':f.won<f.lost?'down':'even';
   const av=node('span','','friend-avatar');if(profiles)av.innerHTML=profiles.avatarHtml(profiles.profileOf(f.uid,f.name)||{},'player-avatar');
   const who=node('div','','player-friend-who'),bar=node('div','','player-friend-bar'),fill=node('span','');fill.style.width=Math.round(f.won/Math.max(1,f.won+f.lost)*100)+'%';bar.append(fill);
   who.append(node('strong',f.name),node('small',n+(n===1?' partida':' partidas')+(f.lastAt?' · '+ago(f.lastAt):'')),bar);
   const score=node('div','','player-friend-score '+cls);score.append(node('b',f.won+' – '+f.lost),node('small',cls==='up'?'vas ganando':cls==='down'?'vas perdiendo':'parejos'));
   li.append(av,who,score);
   if(openCard){li.classList.add('is-tappable');li.onclick=()=>openCard(f);}
   list.append(li);
  }
  panel.append(list,node('p',houses?'Cada bot lleva la cuenta con vos: tocalo para ver su ficha.':'Las partidas 2 vs 2 cuentan contra un amigo cuando jugó en el equipo rival.','player-friends-note'));
 }
 async function blockedUsers(){
  const token=open('Jugadores bloqueados'),state=getState(),uid=state.uid,fb=state.firebase;
  body.append(node('p','Cargando jugadores bloqueados…'));
  try{
   if(!uid||!fb)throw new Error('Iniciá sesión para administrar tus bloqueos.');
   const snapshot=await fb.get(fb.ref(fb.db,`userBlocks/${uid}`));if(token!==generation)return;
   const entries=Object.entries(snapshot.val()||{}).filter(([,value])=>value===true||value?.blocked===true);
   body.replaceChildren();
   if(!entries.length){body.append(node('p','No tenés jugadores bloqueados.'));return;}
   for(const [targetUid,value] of entries){
    const row=node('div','','player-blocked-item'),name=node('strong',value===true?`Jugador · ${targetUid.slice(0,8)}`:value.name||`Jugador · ${targetUid.slice(0,8)}`);
    const unblock=node('button','Desbloquear','button secondary');unblock.type='button';
    unblock.onclick=async()=>{
     unblock.disabled=true;unblock.textContent='Desbloqueando…';
     try{
      await fb.set(fb.ref(fb.db,`userBlocks/${uid}/${targetUid}`),null);if(token!==generation)return;
      row.remove();if(!body.querySelector('.player-blocked-item'))body.append(node('p','No tenés jugadores bloqueados.'));
     }catch(error){unblock.disabled=false;unblock.textContent='Desbloquear';const message=node('small',error.message||'No se pudo quitar el bloqueo. Volvé a intentar.');row.append(message);}
    };
    row.append(name,unblock);body.append(row);
   }
  }catch(error){if(token===generation)body.replaceChildren(node('p',error.message||'No pudimos cargar los jugadores bloqueados.'));}
 }
 function report(fromMatch=false){
  const token=open('Reportar un problema');const state=getState(),matchId=fromMatch&&state.room?.managedCredits?state.room.creditMatch?.id:null;
  let localId=null;if(fromMatch&&state.localGame&&state.room){if(!localIds.has(state.room))localIds.set(state.room,'local_'+crypto.randomUUID());localId=localIds.get(state.room);}
  if(!matchId&&!localId)body.append(node('p','Contanos qué pasó para que podamos revisarlo.'));
  const form=document.createElement('form'),input=document.createElement('textarea');input.maxLength=1000;input.minLength=5;input.required=true;input.rows=5;input.placeholder='¿Qué pasó?';input.setAttribute('aria-label','Descripción del problema');
  const submit=node('button','Enviar reporte','button primary');submit.type='submit';const status=node('p','');status.setAttribute('role','status');form.append(input,submit,status);body.append(form);
  const requestId=crypto.randomUUID();let busy=false;
  form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;submit.textContent='Enviando…';try{await api('playerConsole',{action:'report',message:input.value,requestId,matchId,localId,mode:state.localGame?'bot':'general'});if(token!==generation)return;status.textContent='Reporte enviado. Gracias por avisarnos.';input.disabled=true;submit.textContent='Reporte enviado';submit.style.display='none';setTimeout(()=>{if(token===generation&&dialog.open)dialog.close();},2000);}catch(e){status.textContent=e.message||'No pudimos enviar el reporte. Volvé a intentar.';submit.disabled=false;submit.textContent='Enviar reporte';}finally{busy=false;}};
 }
 $('player-history').onclick=history;
 $('player-blocked-users').onclick=blockedUsers;
 for(const id of ['lobby-report','account-report'])$(id).onclick=()=>report();
 $('match-report').onclick=()=>report(true);
 $('account-open').addEventListener('click',()=>{$('player-account-name').textContent=$('account-username').textContent;$('player-account-balance').textContent='Nivel '+($('level-number')?.textContent||'1');});
}
