import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
const $=id=>document.getElementById(id);
let auth,call,users=[],pageToken=null,selection=null,busy=false,epoch=0,metrics=null,metricsBusy=false,metricsTimer=null,pagesLoaded=1,userScope='all',tableData={tables:[],archivedTables:[]};
function say(message){$('status').textContent=message;}
function errorText(e){return e.code==='functions/not-found'?'Falta publicar las funciones de administración en Firebase.':e.message||'No se pudo completar el cambio.';}
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function button(text,handler){const el=node('button',text);if(text==='Eliminar usuario')el.classList.add('danger');el.type='button';el.addEventListener('click',handler);return el;}
function openEdit(action,item){
 selection={action,item,requestId:crypto.randomUUID()};$('edit-error').textContent='';$('reason').value='';
 const credits=action==='credits',rename=action==='rename';
 $('delete-label').hidden=action!=='delete';$('delete-confirm').required=action==='delete';$('delete-confirm').value='';
 $('edit-title').textContent=action==='delete'?'Eliminar usuario':credits?'Editar créditos':rename?'Cambiar nombre':action==='block'?(item.disabled?'Desbloquear usuario':'Bloquear usuario'):'Cerrar mesa';
 $('edit-description').textContent=action==='delete'?'Se eliminará la cuenta de '+(item.name||item.uid)+'. Si vuelve a registrarse, se creará una cuenta nueva. Sus partidas y registros contables se conservan.':action==='close-table'?'Mesa '+item.code+'. Se cerrará para ambos jugadores y se devolverán las apuestas pendientes.':(item.name||item.email||item.uid);
 $('value-label').hidden=!credits&&!rename;$('value').required=credits||rename;$('value').type=credits?'number':'text';$('value').min='0';$('value').max='1000000000';$('value').step='1';$('value').maxLength=18;$('value').value=credits?item.balance:rename?item.name:'';
 $('edit').showModal();
}
function renderUsers(){
 const expanded=new Set([...$('user-list').querySelectorAll('details[open]')].map(el=>el.dataset.uid));
 const query=$('search').value.toLocaleLowerCase();$('user-list').replaceChildren();
 for(const u of users.filter(u=>[u.name,u.email,u.uid].some(v=>v.toLocaleLowerCase().includes(query)))){
  const card=node('details','', 'card user-card');card.dataset.uid=u.uid;card.open=expanded.has(u.uid);
  const summary=node('summary');summary.append(node('span',u.name||'Sin nombre'),node('strong',u.balance+' créditos'));card.append(summary);
  const detail=node('div','','user-detail');detail.append(node('p',u.email||'Sin correo'),node('small','UID: '+u.uid),node('small',u.locked+' reservados · '+(u.disabled?'Bloqueado':'Habilitado')+' · '+(metrics?.online.includes(u.uid)?'En línea':'Fuera de línea')),node('small','Registro: '+new Date(u.createdAt).toLocaleDateString('es-UY')));card.append(detail);
  const movements=node('details');movements.append(node('summary','Movimientos de créditos'));
  for(const e of Object.values(tableData.movements?.[u.uid]||{}).sort((a,b)=>b.at-a.at))movements.append(node('p',formatTableTime(e.at)+': saldo '+e.before+' → '+e.after+' · reservados '+e.reservedBefore+' → '+e.reservedAfter));detail.append(movements);
  const actions=node('div','','actions');actions.append(button('Editar créditos',()=>openEdit('credits',u)),button('Cambiar nombre',()=>openEdit('rename',u)),button(u.disabled?'Desbloquear':'Bloquear',()=>openEdit('block',u)),button('Eliminar usuario',()=>openEdit('delete',u)));detail.append(actions);$('user-list').append(card);
 }
 if(!$('user-list').children.length)$('user-list').append(node('p','No hay usuarios para mostrar.'));
 $('more').hidden=!pageToken;
}
async function refresh(more=false,preservePages=false){
 if(busy)return;busy=true;const generation=epoch;$('more').disabled=true;$('user-scope').disabled=true;for(const b of document.querySelectorAll('[data-scope]'))b.disabled=true;say('Cargando…');
 try{
  const result=(await call({action:'users',scope:userScope,...(more&&pageToken?{pageToken}:{})})).data;
  if(preservePages&&!more){
   let loaded=1;
   while(result.pageToken&&loaded<pagesLoaded){
    const page=(await call({action:'users',scope:userScope,pageToken:result.pageToken})).data;
    result.users.push(...page.users);result.pageToken=page.pageToken;loaded++;
   }
  }
  if(generation!==epoch)return;
  if(more)pagesLoaded++;else if(!preservePages)pagesLoaded=1;
  users=more?[...users,...result.users]:result.users;pageToken=result.pageToken;renderUsers();
  const data=(await call({action:'tables'})).data;if(generation!==epoch)return;
  tableData=data;renderUsers();renderTables();
  $('reservation-alerts').replaceChildren();
  for(const a of data.alerts||[]){const card=node('article','','card');card.append(node('h3','Créditos reservados: '+(users.find(u=>u.uid===a.uid)?.name||a.uid)),node('p',a.locked+' créditos · '+a.reason));if(a.repairable)card.append(button('Resolver reserva',async()=>{try{await call({action:'repair-reservation',uid:a.uid});await refresh();}catch(e){say(errorText(e));}}));$('reservation-alerts').append(card);}
  $('reports-list').replaceChildren();
  for(const r of data.reports||[]){const card=node('article','','card');card.append(node('h3',r.name),node('small',formatTableTime(r.at)),node('p',r.message),node('small',r.matchId?'Mesa '+r.code+' · ID '+r.matchId:r.localId?'Partida contra el bot · ID '+r.localId:'Reporte general del juego'));card.append(node('small','Usuario: '+r.uid));if(r.matchId)card.append(button('Ver partida',()=>{showTab('tables');$('table-search').value=r.matchId;$('table-state').value='all';renderTables();}));$('reports-list').append(card);}
  if(!data.reports?.length)$('reports-list').append(node('p','No hay problemas reportados.'));
  $('audit-list').replaceChildren();for(const a of data.audit){
   const card=node('article','','card');card.append(node('h3',a.action),node('p',a.reason),node('p',a.uid||a.code||''),node('small',new Date(a.at).toLocaleString('es-UY')),node('small','Administrador: '+a.actor));
   if(a.before!==undefined)card.append(node('p',String(a.before)+' → '+String(a.after)));$('audit-list').append(card);
  }await refreshMetrics();say('');
 }catch(e){if(generation===epoch)say(errorText(e));}finally{busy=false;$('more').disabled=false;$('user-scope').disabled=false;for(const b of document.querySelectorAll('[data-scope]'))b.disabled=false;}
}
function tableTime(table){return Number(table.finishedAt||table.createdAt)||0;}
function formatTableTime(value){
 if(!value)return 'Sin fecha registrada';
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return 'Sin fecha registrada';
 return new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
function sortedTables(list){
 const order=$('table-order').value;
 return [...list].sort((a,b)=>{
  const dateDifference=tableTime(b)-tableTime(a);
  // Undated old records stay last in either chronological direction.
  if(order==='oldest')return !tableTime(a)?(!tableTime(b)?0:1):!tableTime(b)?-1:-dateDifference;
  if(order==='stake')return (Number(b.stake)||0)-(Number(a.stake)||0)||dateDifference;
  if(order==='points')return (Number(b.targetPoints)||0)-(Number(a.targetPoints)||0)||dateDifference;
  return dateDifference;
 });
}
function renderTables(){
 const scope=$('table-state').value;
 const list=$('table-list');const expanded=new Set([...list.querySelectorAll('details.table-card[open]')].map(el=>el.dataset.match));list.replaceChildren();
 const tableCard=t=>{
  const card=node('details','','card table-card');card.dataset.match=t.id||t.code;card.open=expanded.has(card.dataset.match);
  const summary=node('summary','','table-summary');
  const players=node('span',t.players[0]||'Sin creador','table-summary-players');players.append(node('small',t.players[1]?'vs. '+t.players[1]:'Esperando rival'));
  summary.append(players,node('span',t.status,'table-status'),node('span',formatTableTime(t.createdAt),'table-summary-date'),node('span',t.stake+' créditos','table-summary-stake'));card.append(summary);
  const contents=node('div','','table-expanded');card.append(contents);
  contents.append(node('h3','Mesa '+t.code+' · Partida '+(t.matchNumber||1)),node('small','Partida a '+t.targetPoints+' puntos'),node('small','Creada: '+formatTableTime(t.createdAt)));
  if(t.finishedAt)contents.append(node('small','Finalizada: '+formatTableTime(t.finishedAt)));
  if(t.scores){const score=node('p',t.players.map((name,i)=>name+': '+(t.scores['player'+(i+1)]||0)).join(' · '),'table-result');contents.append(score);}
  if(t.winnerName)contents.append(node('p','Ganó '+t.winnerName,'table-winner'));
  if(t.rawStatus==='settled')contents.append(node('p','El ganador recibe '+(2*t.stake)+' créditos; cada jugador apostó '+t.stake+'.'));
  if(t.rawStatus==='refunded')contents.append(node('p','La apuesta fue devuelta a los participantes.'));
  if(t.rawStatus==='settled'&&!t.reason)contents.append(node('small','Motivo: alcanzó los puntos de la partida.'));
  if(t.id)contents.append(node('small','ID: '+t.id));
  if(t.reason)contents.append(node('small','Motivo: '+({abandon:'Abandono',disconnect:'Desconexión','waiting-canceled':'Cancelada sin rival','draw-left':'Abandono antes de empezar','draw-cancel':'Cancelación antes de empezar',points:'Puntos',timeout:'Inactividad',inactivity:'Inactividad',admin:'Cierre del administrador'}[t.reason]||t.reason)));
  const detail=node('details');detail.append(node('summary','Ver movimientos y mensajes'));
  for(const e of t.history||[]){
   const row=node('div','','card');row.append(node('small',formatTableTime(e.at)+' · '+e.status));
   for(const c of e.changes||[])row.append(node('p',(users.find(u=>u.uid===c.uid)?.name||c.uid)+': saldo '+c.before+' → '+c.after+'; reservados '+c.reservedBefore+' → '+c.reservedAfter));
   for(const message of e.messages||[])row.append(node('p',message.text||''));detail.append(row);
  }
  if(!t.history?.length)detail.append(node('p','Registro anterior al historial detallado. Se muestran los datos conservados de la partida.'));
  contents.append(detail);
  if(!t.closedAt&&['waiting','reserved'].includes(t.rawStatus))contents.append(button('Cerrar mesa',()=>openEdit('close-table',t)));return card;
 };
 const query=$('table-search').value.trim().toLowerCase();
 const matches=t=>[...(t.players||[]),t.code,t.id].filter(Boolean).join(' ').toLowerCase().includes(query);
 const current=scope==='previous'?[]:(tableData.tables||[]).filter(matches);
 const previous=scope==='active'?[]:(tableData.archivedTables||[]).filter(t=>matches(t)&&(scope!=='finished'||t.status==='Terminada'));
 if(scope!=='previous'&&scope!=='finished'){
  const group=node('section','','table-group');group.append(node('h3','Mesas activas ('+current.length+')'));
  const cards=node('div','','cards');for(const t of sortedTables(current))cards.append(tableCard(t));
  if(!current.length)cards.append(node('p','No hay mesas activas.'));group.append(cards);list.append(group);
 }
 if(scope!=='active'){
  const group=node('section','','table-group');group.append(node('h3',(scope==='finished'?'Partidas terminadas':'Mesas anteriores')+' ('+previous.length+')'));
  const cards=node('div','','cards');for(const t of sortedTables(previous))cards.append(tableCard(t));
  if(!previous.length)cards.append(node('p','No hay mesas para este filtro.'));group.append(cards);list.append(group);
 }
}
$('table-search').addEventListener('input',renderTables);
$('table-order').addEventListener('change',renderTables);
$('table-state').addEventListener('change',renderTables);
$('search').addEventListener('input',renderUsers);$('more').onclick=()=>refresh(true);
function showTab(name){for(const section of ['metrics','users','tables','audit','reports'])$(section).hidden=section!==name;for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab.dataset.tab===name);}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
async function showUsers(scope){if(busy)return;userScope=scope;pagesLoaded=1;pageToken=null;users=[];$('search').value='';$('user-scope').value=scope;renderUsers();showTab('users');await refresh();}
for(const b of document.querySelectorAll('[data-scope]'))b.onclick=()=>showUsers(b.dataset.scope);
$('user-scope').onchange=()=>showUsers($('user-scope').value);
for(const id of ['close','cancel'])$(id).onclick=()=>{if(!$('save').disabled)$('edit').close();};
$('edit').addEventListener('cancel',e=>{if($('save').disabled)e.preventDefault();});
$('edit-form').onsubmit=async event=>{
 event.preventDefault();if(!selection||$('save').disabled)return;
 const {action,item,requestId}=selection;const data={action,requestId,reason:$('reason').value.trim()};
 if(action==='close-table')data.code=item.code;
 else{data.uid=item.uid;if(action==='credits'){data.balance=Number($('value').value);data.expectedBalance=item.balance;}if(action==='rename')data.name=$('value').value.trim();if(action==='block')data.disabled=!item.disabled;if(action==='delete')data.confirmName=$('delete-confirm').value;}
 $('save').disabled=true;$('edit-error').textContent='';
 try{await call(data);$('edit').close();say('Cambio guardado.');await refresh();}catch(e){$('edit-error').textContent=errorText(e);}finally{$('save').disabled=false;}
};
function renderHours(){
 $('hour-chart').replaceChildren();
 const day=metrics?.days.find(d=>d.day===$('metric-day').value),hours=day?.hours||Array.from({length:24},(_,hour)=>({hour,users:0}));
 const maximum=Math.max(1,...hours.map(h=>h.users));
 for(let start=0;start<24;start+=12){
  const group=node('div','','hour-group');
  const heading=node('div','','hour-row hour-heading');heading.append(node('span','Horario'),node('span','Actividad'),node('span','Usuarios'));group.append(heading);
  for(const h of hours.slice(start,start+12)){
   const row=node('div','','hour-row');
   const time=String(h.hour).padStart(2,'0')+':00 – '+String((h.hour+1)%24).padStart(2,'0')+':00';
   const track=node('div','','hour-track'),fill=node('div','','hour-fill');fill.style.width=(h.users/maximum*100)+'%';track.setAttribute('aria-hidden','true');track.append(fill);
   row.append(node('span',time),track,node('strong',String(h.users)));group.append(row);
  }
  $('hour-chart').append(group);
 }
}
function renderMetrics(){
 if(!metrics)return;
 $('metric-total').textContent=metrics.total;$('metric-active').textContent=metrics.active;$('metric-today').textContent=metrics.todayUsers;
 const selected=$('metric-day').value;$('metric-day').replaceChildren();
 const days=[...new Set([metrics.today,...metrics.days.map(d=>d.day)])];
 for(const day of days){const option=node('option',day);option.value=day;$('metric-day').append(option);}
 if(days.includes(selected))$('metric-day').value=selected;
 renderHours();$('day-chart').replaceChildren();
 for(const d of metrics.days){const card=node('article','','card');card.append(node('h3',d.day),node('strong',d.users+' usuarios únicos'));$('day-chart').append(card);}
 renderUsers();
}
async function refreshMetrics(){
 if(metricsBusy)return;metricsBusy=true;const generation=epoch;
 try{const data=(await call({action:'metrics'})).data;if(generation!==epoch)return;metrics=data;renderMetrics();}
 catch(e){if(generation===epoch)say(errorText(e));}
 finally{metricsBusy=false;}
}
$('metric-day').addEventListener('change',renderHours);
async function start(){
 try{
  let config;try{config=(await import('./firebase-config.js')).firebaseConfig;}catch{config=JSON.parse(localStorage.getItem('truco-firebase-config')||'null');}
  if(!config)throw new Error('Abrí el juego primero para cargar su configuración.');
  auth=getAuth(initializeApp(config));call=httpsCallable(getFunctions(auth.app,'us-central1'),'adminConsole');
  await setPersistence(auth,browserLocalPersistence);
  $('login').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){$('access-status').textContent=errorText(e);}};
  $('logout').onclick=()=>signOut(auth);
  onAuthStateChanged(auth,async user=>{
   const generation=++epoch;pagesLoaded=1;userScope='all';$('user-scope').value='all';clearInterval(metricsTimer);metricsTimer=null;metrics=null;users=[];pageToken=null;$('console').hidden=true;$('access').hidden=false;$('logout').hidden=!user;$('login').hidden=!!user;
   $('identity').textContent=user?'Tu UID: '+user.uid:'';$('access-status').textContent=user?'Verificando permisos…':'Iniciá sesión con tu cuenta administradora.';
   if(!user)return;
   try{const result=await call({action:'users'});if(generation!==epoch)return;users=result.data.users;pageToken=result.data.pageToken;$('access').hidden=true;$('console').hidden=false;renderUsers();await refresh();if(generation===epoch)metricsTimer=setInterval(()=>{if(!document.hidden&&!$('edit').open)refresh(false,true);},60000);}
   catch(e){if(generation===epoch)$('access-status').textContent=errorText(e);}
  });
 }catch(e){$('access-status').textContent=errorText(e);}
}
start();
