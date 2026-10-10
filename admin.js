import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
const $=id=>document.getElementById(id);
let auth,call,users=[],pageToken=null,selection=null,busy=false,epoch=0,metrics=null,metricsBusy=false,metricsTimer=null,pagesLoaded=1,userScope='all';
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
  const tableCard=t=>{
   const card=node('article','','card');card.append(node('h3','Mesa '+t.code),node('p',t.players.join(' / ')),node('p',t.targetPoints+' puntos · '+t.stake+' créditos · '+t.status),button('Cerrar mesa',()=>openEdit('close-table',t)));return card;
  };
  $('table-list').replaceChildren();for(const t of data.tables)$('table-list').append(tableCard(t));
  if(!data.tables.length)$('table-list').append(node('p','No hay mesas activas.'));
  if(data.archivedTables?.length){
   const saved=node('details','','card');saved.append(node('summary','Mesas anteriores ('+data.archivedTables.length+')'));
   saved.append(node('p','Registros de partidas terminadas, mesas vencidas y del sistema anterior.'));
   for(const t of data.archivedTables)saved.append(tableCard(t));
   $('table-list').append(saved);
  }
  $('audit-list').replaceChildren();for(const a of data.audit){
   const card=node('article','','card');card.append(node('h3',a.action),node('p',a.reason),node('p',a.uid||a.code||''),node('small',new Date(a.at).toLocaleString('es-UY')),node('small','Administrador: '+a.actor));
   if(a.before!==undefined)card.append(node('p',String(a.before)+' → '+String(a.after)));$('audit-list').append(card);
  }await refreshMetrics();say('');
 }catch(e){if(generation===epoch)say(errorText(e));}finally{busy=false;$('more').disabled=false;$('user-scope').disabled=false;for(const b of document.querySelectorAll('[data-scope]'))b.disabled=false;}
}
$('search').addEventListener('input',renderUsers);$('more').onclick=()=>refresh(true);
function showTab(name){for(const section of ['metrics','users','tables','audit'])$(section).hidden=section!==name;for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab.dataset.tab===name);}
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
