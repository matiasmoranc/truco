import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
const $=id=>document.getElementById(id);
let auth,call,users=[],pageToken=null,selection=null,busy=false,epoch=0;
function say(message){$('status').textContent=message;}
function errorText(e){return e.code==='functions/not-found'?'Falta publicar las funciones de administración en Firebase.':e.message||'No se pudo completar el cambio.';}
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function button(text,handler){const el=node('button',text);el.type='button';el.addEventListener('click',handler);return el;}
function openEdit(action,item){
 selection={action,item,requestId:crypto.randomUUID()};$('edit-error').textContent='';$('reason').value='';
 const credits=action==='credits',rename=action==='rename';
 $('edit-title').textContent=credits?'Editar créditos':rename?'Cambiar nombre':action==='block'?(item.disabled?'Desbloquear usuario':'Bloquear usuario'):'Cerrar mesa';
 $('edit-description').textContent=action==='close-table'?'Mesa '+item.code+'. Se cerrará para ambos jugadores y se devolverán las apuestas pendientes.':(item.name||item.email||item.uid);
 $('value-label').hidden=!credits&&!rename;$('value').required=credits||rename;$('value').type=credits?'number':'text';$('value').min='0';$('value').max='1000000000';$('value').step='1';$('value').maxLength=18;$('value').value=credits?item.balance:rename?item.name:'';
 $('edit').showModal();
}
function renderUsers(){
 const query=$('search').value.toLocaleLowerCase();$('user-list').replaceChildren();
 for(const u of users.filter(u=>[u.name,u.email,u.uid].some(v=>v.toLocaleLowerCase().includes(query)))){
  const card=node('article','', 'card');card.append(node('h3',u.name||'Sin nombre'),node('p',u.email||'Sin correo'),node('small','UID: '+u.uid),node('strong',u.balance+' créditos'),node('small',u.locked+' reservados · '+(u.disabled?'Bloqueado':'Activo')));
  const actions=node('div','','actions');actions.append(button('Editar créditos',()=>openEdit('credits',u)),button('Cambiar nombre',()=>openEdit('rename',u)),button(u.disabled?'Desbloquear':'Bloquear',()=>openEdit('block',u)));card.append(actions);$('user-list').append(card);
 }
 if(!$('user-list').children.length)$('user-list').append(node('p','No hay usuarios para mostrar.'));
 $('more').hidden=!pageToken;
}
async function refresh(more=false){
 if(busy)return;busy=true;const generation=epoch;$('refresh').disabled=true;$('more').disabled=true;say('Cargando…');
 try{
  const result=(await call({action:'users',...(more&&pageToken?{pageToken}:{})})).data;
  if(generation!==epoch)return;
  users=more?[...users,...result.users]:result.users;pageToken=result.pageToken;renderUsers();
  const data=(await call({action:'tables'})).data;if(generation!==epoch)return;
  $('table-list').replaceChildren();for(const t of data.tables){
   const card=node('article','','card');card.append(node('h3','Mesa '+t.code),node('p',t.players.join(' / ')),node('p',t.targetPoints+' puntos · '+t.stake+' créditos · '+t.status),button('Cerrar mesa',()=>openEdit('close-table',t)));$('table-list').append(card);
  }
  if(!data.tables.length)$('table-list').append(node('p','No hay mesas activas.'));
  $('audit-list').replaceChildren();for(const a of data.audit){
   const card=node('article','','card');card.append(node('h3',a.action),node('p',a.reason),node('p',a.uid||a.code||''),node('small',new Date(a.at).toLocaleString('es-UY')),node('small','Administrador: '+a.actor));
   if(a.before!==undefined)card.append(node('p',String(a.before)+' → '+String(a.after)));$('audit-list').append(card);
  }say('');
 }catch(e){if(generation===epoch)say(errorText(e));}finally{busy=false;$('refresh').disabled=false;$('more').disabled=false;}
}
$('search').addEventListener('input',renderUsers);$('refresh').onclick=()=>refresh();$('more').onclick=()=>refresh(true);
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const section of ['users','tables','audit'])$(section).hidden=section!==b.dataset.tab;for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab===b);};
for(const id of ['close','cancel'])$(id).onclick=()=>{if(!$('save').disabled)$('edit').close();};
$('edit').addEventListener('cancel',e=>{if($('save').disabled)e.preventDefault();});
$('edit-form').onsubmit=async event=>{
 event.preventDefault();if(!selection||$('save').disabled)return;
 const {action,item,requestId}=selection;const data={action,requestId,reason:$('reason').value.trim()};
 if(action==='close-table')data.code=item.code;
 else{data.uid=item.uid;if(action==='credits'){data.balance=Number($('value').value);data.expectedBalance=item.balance;}if(action==='rename')data.name=$('value').value.trim();if(action==='block')data.disabled=!item.disabled;}
 $('save').disabled=true;$('edit-error').textContent='';
 try{await call(data);$('edit').close();say('Cambio guardado.');await refresh();}catch(e){$('edit-error').textContent=errorText(e);}finally{$('save').disabled=false;}
};
async function start(){
 try{
  let config;try{config=(await import('./firebase-config.js')).firebaseConfig;}catch{config=JSON.parse(localStorage.getItem('truco-firebase-config')||'null');}
  if(!config)throw new Error('Abrí el juego primero para cargar su configuración.');
  auth=getAuth(initializeApp(config));call=httpsCallable(getFunctions(auth.app,'us-central1'),'adminConsole');
  await setPersistence(auth,browserLocalPersistence);
  $('login').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){$('access-status').textContent=errorText(e);}};
  $('logout').onclick=()=>signOut(auth);
  onAuthStateChanged(auth,async user=>{
   const generation=++epoch;users=[];pageToken=null;$('console').hidden=true;$('access').hidden=false;$('logout').hidden=!user;$('login').hidden=!!user;
   $('identity').textContent=user?'Tu UID: '+user.uid:'';$('access-status').textContent=user?'Verificando permisos…':'Iniciá sesión con tu cuenta administradora.';
   if(!user)return;
   try{const result=await call({action:'users'});if(generation!==epoch)return;users=result.data.users;pageToken=result.data.pageToken;$('access').hidden=true;$('console').hidden=false;renderUsers();await refresh();}
   catch(e){if(generation===epoch)$('access-status').textContent=errorText(e);}
  });
 }catch(e){$('access-status').textContent=errorText(e);}
}
start();
