import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import {getDatabase,ref,get} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js';
import {levelFor,pointsToReach} from './levels.js?v=20261115-people1';
// The same panel also reads Truco Argentino: its adminConsole answers the same actions.
const GAMES={
 uy:{label:'Truco Uruguayo',zone:'America/Montevideo'},
 ar:{label:'Truco Argentino',zone:'America/Argentina/Buenos_Aires',config:{apiKey:'AIzaSyC7NKRqDT_R4Uu9pOGyq7cU5C_z-FwHq3o',authDomain:'truco-argentino-ar.firebaseapp.com',databaseURL:'https://truco-argentino-ar-default-rtdb.firebaseio.com',projectId:'truco-argentino-ar',storageBucket:'truco-argentino-ar.firebasestorage.app',messagingSenderId:'275278687284',appId:'1:275278687284:web:f5a7b01ba97d7ed565ae61'}}
};
let GAME=new URLSearchParams(location.search).get('juego')==='ar'?'ar':'uy',ZONE=GAMES[GAME].zone;
function showGame(){
 ZONE=GAMES[GAME].zone;document.title='Administración · '+GAMES[GAME].label;
 for(const label of document.querySelectorAll('.game-name'))label.textContent=GAMES[GAME].label.toUpperCase();
 document.getElementById('page-kicker').textContent=GAMES[GAME].label+' · Administración';
 for(const picker of document.querySelectorAll('.game-picker'))picker.value=GAME;
}
showGame();
for(const picker of document.querySelectorAll('.game-picker'))picker.onchange=()=>useGame(picker.value);
const $=id=>document.getElementById(id);
const points=tenths=>(tenths/10).toLocaleString('es-UY',{maximumFractionDigits:1});
// Level filter: "from-to" levels, empty for all.
// Profile photos, read from avatars/<uid>: the saved data, {} when empty, null when it cannot be read.
const avatars=new Map();
function inPhoto(u){const filter=$('photo-filter').value,avatar=avatars.get(u.uid);if(!filter)return true;if(!avatar)return false;return !!avatar.photo===(filter==='with');}
function photoText(avatar){return avatar===undefined?'cargando…':avatar===null?'no se pudo leer':!avatar.photo?'no tiene':avatar.use==='icon'?'guardada, pero ahora usa un ícono':'en uso';}
function userPhoto(avatar,className){const src=avatar?.photo?.startsWith('data:image/')?avatar.photo:'';const el=node(src?'img':'span','',className+(src?'':' none'));if(src){el.src=src;el.alt='';}return el;}
async function loadAvatars(list){
 if(!list.length)return;
 const db=getDatabase(auth.app);
 await Promise.all(list.map(async({uid})=>{try{avatars.set(uid,(await get(ref(db,'avatars/'+uid))).val()||{});}catch{avatars.set(uid,null);}}));
 renderUsers();
}
function inLevel(u){const [from,to]=($('level-filter').value||'').split('-').map(Number);if(!from)return true;const level=levelFor(u.points||0).level;return level>=from&&level<=to;}
// Users list order: a column and its direction (1 up, -1 down); newest sign-ups first.
let sortBy={key:'joined',dir:-1};
let auth,call,users=[],pageToken=null,selection=null,busy=false,epoch=0,metrics=null,metricsBusy=false,metricsTimer=null,pagesLoaded=1,userScope='all',tableData={tables:[],archivedTables:[]};
function say(message){$('status').textContent=message;}
// Test accounts and test devices stay out of every number unless this switch is off.
function hideTest(){return $('hide-test').checked;}
try{$('hide-test').checked=localStorage.getItem('admin-show-test')!=='1';}catch{/* Storage unavailable: hide by default. */}
$('hide-test').onchange=()=>{try{localStorage.setItem('admin-show-test',hideTest()?'0':'1');}catch{}refresh(false,true).then(()=>{if(visitDetail)openVisitDetail(visitDetail.platform,{page:visitDetail.page,hour:visitDetail.hour});if(!$('usage').hidden)refreshUsage();});};
async function setTestUser(u,test){
 try{say(test?'Marcando como prueba…':'Quitando de prueba…');const result=(await call({action:'test-user',uid:u.uid,test})).data;await refresh(false,true);say((u.name||'El usuario')+(test?' quedó marcado como prueba':' vuelve a contar en los números')+(result?.moved?' ('+result.moved+' visitas movidas).':'.'));}
 catch(e){say(errorText(e));}
}
const number=value=>new Intl.NumberFormat('es-UY').format(Number(value)||0);
const PLATFORM_LABELS={'app-ios':'App iPhone','app-android':'App Android','web-ios':'Web iPhone','web-android':'Web Android','web-desktop':'Web computadora'};
const PAGE_LABELS={juego:'Juego',anotador:'Anotador',aprender:'Aprender a jugar',otra:'Reglas y otras'};
const TAB_TITLES={metrics:'Resumen',tasks:'Tareas',visits:'Visitas',usage:'Anotador y Aprender',retention:'Retención',users:'Usuarios',tables:'Mesas y partidas',reports:'Problemas reportados',messages:'Mensajes a jugadores',chat:'Chat de las mesas',audit:'Historial de cambios'};
function errorText(e){return e.code==='functions/not-found'?'Falta publicar las funciones de administración en Firebase.':e.message||'No se pudo completar el cambio.';}
const AUDIT_LABELS={level:'Cambio de nivel y puntos',rename:'Cambio de nombre',block:'Bloqueo',delete:'Eliminación de cuenta',credits:'Créditos','close-table':'Cierre de mesa','close-legacy-table':'Cierre de mesa','repair-reservation':'Reparación de reserva'};
// The device a player used last, as the panel names it.
const DEVICE_NAMES={'app-android':'App Android','app-ios':'App iPhone','web-android':'Web Android','web-ios':'Web iPhone','web-desktop':'Web computadora'};
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function button(text,handler){const el=node('button',text);if(text==='Eliminar usuario')el.classList.add('danger');el.type='button';el.addEventListener('click',handler);return el;}
function openEdit(action,item){
 selection={action,item,requestId:crypto.randomUUID()};$('edit-error').textContent='';$('reason').value='';
 const credits=action==='credits',rename=action==='rename',level=action==='level';
 $('level-fields').hidden=!level;$('level-value').required=$('points-value').required=level;
 if(level){$('level-value').value=levelFor(item.points||0).level;$('points-value').value=(item.points||0)/10;showLevelPreview();}
 $('delete-label').hidden=action!=='delete';$('delete-confirm').required=action==='delete';$('delete-confirm').value='';
 $('edit-title').textContent=action==='delete'?'Eliminar usuario':credits?'Editar créditos':rename?'Cambiar nombre':action==='block'?(item.disabled?'Desbloquear usuario':'Bloquear usuario'):level?'Cambiar nivel y puntos':'Cerrar mesa';
 $('edit-description').textContent=action==='delete'?'Se eliminará la cuenta de '+(item.name||item.uid)+'. Si vuelve a registrarse, se creará una cuenta nueva. Sus partidas se conservan.':action==='close-table'?'Mesa '+item.code+'. Se cerrará para todos los jugadores.':(item.name||item.email||item.uid);
 $('value-label').hidden=!credits&&!rename;$('value').required=credits||rename;$('value').type=credits?'number':'text';$('value').min='0';$('value').max='1000000000';$('value').step='1';$('value').maxLength=18;$('value').value=credits?item.balance:rename?item.name:'';
 $('edit').showModal();
}
// Level and points move together: a level starts at its first point, the points show their level.
function showLevelPreview(){const tenths=Math.round(Number($('points-value').value||0)*10),info=levelFor(tenths);$('level-preview').textContent='Quedará en nivel '+info.level+' con '+points(info.points)+' de '+points(info.need)+' puntos para el siguiente.';}
$('level-value').oninput=()=>{const level=Math.max(1,Math.floor(Number($('level-value').value)||1));$('points-value').value=pointsToReach(level)/10;showLevelPreview();};
$('points-value').oninput=()=>{$('level-value').value=levelFor(Math.round(Number($('points-value').value||0)*10)).level;showLevelPreview();};
// Audiences: groups of players by how they play, counted over the loaded users.
let audience='';
const audienceGames=()=>Math.max(1,Math.floor(Number($('audience-games').value)||1));
const audienceDays=()=>Math.max(1,Math.floor(Number($('audience-days').value)||1));
const audienceSince=()=>Date.now()-audienceDays()*86400000;
const AUDIENCES=[
 {id:'',name:()=>'Todos',test:()=>true},
 {id:'never',name:()=>'Se registraron y nunca jugaron',test:u=>!u.finished},
 {id:'one',name:()=>'Jugaron 1 sola partida',test:u=>u.finished===1},
 {id:'many',name:()=>'Jugaron '+audienceGames()+' partidas o más',test:u=>u.finished>=audienceGames()},
 {id:'nowin',name:()=>'Jugaron pero nunca ganaron',test:u=>u.finished>0&&!u.wins},
 {id:'new',name:()=>'Nuevos: se registraron en los últimos '+audienceDays()+' días',test:u=>(Date.parse(u.createdAt)||0)>=audienceSince()},
 {id:'active',name:()=>'Activos: jugaron en los últimos '+audienceDays()+' días',test:u=>(u.lastPlayedAt||0)>=audienceSince()},
 {id:'gone',name:()=>'Se alejaron: jugaron, pero no en los últimos '+audienceDays()+' días',test:u=>u.finished>0&&(u.lastPlayedAt||0)<audienceSince()},
 {id:'registered-only',name:()=>'Entraron en los últimos '+audienceDays()+' días sin jugar nunca',test:u=>!u.finished&&(Date.parse(u.lastSeenAt)||0)>=audienceSince()}
];
const inAudience=u=>(AUDIENCES.find(a=>a.id===audience)||AUDIENCES[0]).test(u);
function renderAudiences(base){
 const list=$('audience-list');list.replaceChildren();
 for(const a of AUDIENCES){
  const count=base.filter(a.test).length,share=base.length?Math.round(count*100/base.length):0;
  const b=node('button','','audience'+(a.id===audience?' active':''));b.type='button';b.setAttribute('aria-pressed',String(a.id===audience));
  b.append(node('span',a.name(),'audience-name'),node('strong',String(count),'audience-count'),node('small',a.id?share+'%':'usuarios','audience-share'));
  b.onclick=()=>{audience=a.id;renderUsers();};list.append(b);
 }
 $('audience-note').textContent='Calculado sobre '+base.length+' usuarios cargados'+(pageToken?'. Tocá «Cargar más usuarios» para incluir al resto.':'.');
}
$('audience-games').oninput=$('audience-days').oninput=()=>renderUsers();
const shortDate=value=>value?new Date(value).toLocaleDateString('es-UY'):'nunca';
function renderUsers(){
 const expanded=new Set([...$('user-list').querySelectorAll('details[open]')].map(el=>el.dataset.uid));
 const query=$('search').value.toLocaleLowerCase();$('user-list').replaceChildren();
 const tests=new Set(metrics?.testUids||[]);
 // With test data hidden, test accounts leave the list too (show it to unmark one).
 const stateRank=u=>u.disabled?0:metrics?.online.includes(u.uid)?2:1;
 const value={name:u=>(u.name||'').toLocaleLowerCase(),level:u=>levelFor(u.points||0).level,points:u=>u.points||0,finished:u=>u.finished||0,state:stateRank,joined:u=>Date.parse(u.createdAt)||0}[sortBy.key];
 const byColumn=(a,b)=>{const x=value(a),y=value(b);return (typeof x==='string'?x.localeCompare(y,'es'):x-y)*sortBy.dir;};
 for(const button of document.querySelectorAll('[data-sort]'))button.dataset.dir=button.dataset.sort===sortBy.key?(sortBy.dir>0?'up':'down'):'';
 const base=users.filter(u=>!hideTest()||!tests.has(u.uid));renderAudiences(base);
 for(const u of base.filter(u=>inLevel(u)&&inPhoto(u)&&inAudience(u)&&[u.name,u.email,u.uid].some(v=>v.toLocaleLowerCase().includes(query))).sort(byColumn)){
  const card=node('details','','user-card');card.dataset.uid=u.uid;card.open=expanded.has(u.uid);
  const online=metrics?.online.includes(u.uid);
  const state=node('span','',u.disabled?'state blocked':online?'state online':'state');state.append(node('i'),document.createTextNode(u.disabled?'Bloqueado':online?'Jugando':'Desconectado'));
  const summary=node('summary','','user-row');
  const avatar=avatars.get(u.uid),name=node('span',u.name||'Sin nombre','user-name');name.prepend(userPhoto(avatar,'user-photo'));if(tests.has(u.uid))name.append(node('em','Prueba','test-badge'));
  if(u.device){const d=node('em',(DEVICE_NAMES[u.device.platform]||u.device.platform)+(u.device.version?' '+u.device.version:''),'device-badge '+u.device.platform);d.title='Último dispositivo con el que jugó';name.append(d);}
  summary.append(name,node('span',u.email||'Sin correo','user-mail'),node('strong',String(levelFor(u.points||0).level),'num'),node('span',points(u.points||0),'num reserved'),node('span',String(u.finished||0),'num tables'),state,node('span',new Date(u.createdAt).toLocaleDateString('es-UY'),'joined'));card.append(summary);
  const detail=node('div','','user-detail');if(avatar?.photo)detail.append(userPhoto(avatar,'user-photo-large'));detail.append(node('small','Foto de perfil: '+photoText(avatar)),node('small','UID: '+u.uid),node('small','Correo: '+(u.email||'Sin correo')),node('small','Nivel '+levelFor(u.points||0).level+' · '+points(u.points||0)+' puntos · Registro '+new Date(u.createdAt).toLocaleDateString('es-UY')),node('small','Partidas: '+(u.finished||0)+' · Ganadas: '+(u.wins||0)+' · Última partida: '+shortDate(u.lastPlayedAt)+' · Última conexión: '+shortDate(u.lastSeenAt)),node('small','Último dispositivo: '+(u.device?(DEVICE_NAMES[u.device.platform]||u.device.platform)+(u.device.version?' '+u.device.version:u.device.platform.startsWith('app-')?' (versión anterior a 1.0.11)':'')+(u.device.at?' ('+shortDate(u.device.at)+')':u.device.day?' ('+u.device.day.split('-').reverse().slice(0,2).join('/')+')':''):'Sin datos todavía')));card.append(detail);
  const actions=node('div','','actions');actions.append(button('Cambiar nombre',()=>openEdit('rename',u)),button('Cambiar nivel y puntos',()=>openEdit('level',u)),button(u.disabled?'Desbloquear':'Bloquear',()=>openEdit('block',u)),button('Eliminar usuario',()=>openEdit('delete',u)),button(tests.has(u.uid)?'Quitar de prueba':'Marcar como prueba',()=>setTestUser(u,!tests.has(u.uid))),button('Escribir mensaje',()=>writeTo(u)));detail.append(actions);$('user-list').append(card);
 }
 if(!$('user-list').children.length)$('user-list').append(node('p','No hay usuarios para mostrar.','empty'));
 $('more').hidden=!pageToken;
}
// Sorting or filtering only makes sense over everyone: the pages still missing are loaded first.
async function loadAllUsers(){
 if(busy||!pageToken)return;busy=true;const generation=epoch;$('more').disabled=true;say('Cargando todos los usuarios para ordenar…');
 try{
  while(pageToken){
   const page=(await call({action:'users',scope:userScope,pageToken})).data;if(generation!==epoch)return;
   users=[...users,...page.users.filter(u=>!users.some(o=>o.uid===u.uid))];pageToken=page.pageToken;pagesLoaded++;renderUsers();void loadAvatars(page.users);
  }
  say('');
 }catch(e){if(generation===epoch)say(errorText(e));}
 finally{busy=false;if(generation===epoch){$('more').disabled=false;renderUsers();}}
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
  users=more?[...users,...result.users]:result.users;pageToken=result.pageToken;renderUsers();void loadAvatars(preservePages?users.filter(u=>!avatars.has(u.uid)):result.users);
  const data=(await call({action:'tables'})).data;if(generation!==epoch)return;
  tableData=data;renderUsers();renderTables();renderTableStats();renderTableDaily(data.daily);
  $('reservation-alerts').replaceChildren();
  for(const a of data.alerts||[]){const card=node('article','','card');card.append(node('h3','Partida anterior sin cerrar: '+(users.find(u=>u.uid===a.uid)?.name||a.uid)),node('p','No puede crear mesas hasta liberarla. '+a.reason));if(a.repairable)card.append(button('Liberar',async()=>{try{await call({action:'repair-reservation',uid:a.uid});await refresh();}catch(e){say(errorText(e));}}));$('reservation-alerts').append(card);}
  $('reports-list').replaceChildren();
  for(const r of data.reports||[]){const card=node('article','','card');card.append(node('h3',r.name),node('small',formatTableTime(r.at)),node('p',r.message),node('small',r.matchId?'Mesa '+r.code+' · ID '+r.matchId:r.localId?'Partida contra el bot · ID '+r.localId:'Reporte general del juego'));card.append(node('small','Usuario: '+r.uid));if(r.matchId)card.append(button('Ver partida',()=>{showTab('tables');$('table-search').value=r.matchId;$('table-state').value='all';renderTables();}));$('reports-list').append(card);}
  if(!data.reports?.length)$('reports-list').append(node('p','No hay problemas reportados.','empty'));
  $('reports-count').hidden=!data.reports?.length;$('reports-count').textContent=data.reports?.length||'';
  $('kpi-tables').textContent=number(data.tables?.length||0);$('kpi-tables-note').textContent=(data.alerts?.length?data.alerts.length+' reservas por revisar':'En curso o esperando rival');
  $('audit-list').replaceChildren();for(const a of data.audit){
   const card=node('article','','card');card.append(node('h3',AUDIT_LABELS[a.action]||a.action),node('p',a.reason),node('p',a.uid||a.code||''),node('small',new Date(a.at).toLocaleString('es-UY')),node('small','Administrador: '+a.actor));
   if(a.before!==undefined)card.append(node('p',String(a.before)+' → '+String(a.after)));$('audit-list').append(card);
  }await refreshMetrics();await loadMessages();loadTasks();say('');
  $('updated').textContent='Actualizado '+new Intl.DateTimeFormat('es-UY',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
 }catch(e){if(generation===epoch)say(errorText(e));}finally{busy=false;$('more').disabled=false;$('user-scope').disabled=false;for(const b of document.querySelectorAll('[data-scope]'))b.disabled=false;}
}
// Tables created by players and games finished in the chosen period (Uruguay days);
// games against the lobby's house players apart. A card opens the list, day by day.
const TABLE_KINDS={created:'Mesas creadas por jugadores',finished:'Partidas terminadas entre jugadores',house:'Partidas terminadas contra la casa'};
let tableDetail=null;
function tablePeriod(){
 const today=metrics?.today||new Date(Date.now()-10800000).toISOString().slice(0,10),oldest=addDays(today,-89),choice=$('table-range').value,custom=choice==='custom';
 for(const field of document.querySelectorAll('.table-date-field'))field.hidden=!custom;
 for(const id of ['table-from','table-to']){$(id).min=oldest;$(id).max=today;}
 let from,to=today;
 if(choice==='today')from=today;else if(choice==='yesterday')from=to=addDays(today,-1);
 else if(custom){if(!$('table-from').value)$('table-from').value=addDays(today,-6);if(!$('table-to').value)$('table-to').value=today;from=$('table-from').value;to=$('table-to').value;if(from>to)[from,to]=[to,from];}
 else from=addDays(today,-(Number(choice)-1));
 if(from<oldest)from=oldest;if(to>today)to=today;return {from,to};
}
function tableItems(kind,{from,to}){
 const e=tableData.events||{created:[],finished:[]},list=kind==='created'?e.created:e.finished.filter(x=>kind==='house'?x.house:!x.house);
 return list.filter(x=>x.day>=from&&x.day<=to);
}
// Three 30-day charts drawn like "Jugadores únicos · últimos 30 días" on the summary.
function renderTableDaily(daily){
 const charts=[['table-created-chart','created','mesas creadas'],['table-players-chart','vsPlayers','partidas entre jugadores'],['table-house-chart','vsHouse','partidas contra la casa']];
 for(const [id,key,unit] of charts){
  const target=$(id);if(!target)continue;
  if(!daily?.days){target.replaceChildren(node('p','Este juego todavía no guarda estos datos.','empty'));continue;}
  columns(target,daily.days.map(day=>{const n=daily[key]?.[day]||0;return {label:shortDay(day),value:n,tooltip:shortDay(day)+' · '+n+' '+unit};}),{labelEvery:3});
 }
}
function renderTableStats(){
 const period=tablePeriod(),box=$('table-stats');box.replaceChildren();
 $('table-period').textContent=period.from===period.to?'Período: '+longDay(period.from):'Período: del '+longDay(period.from)+' al '+longDay(period.to);
 for(const [kind,label] of Object.entries(TABLE_KINDS)){
  const k=node('button','','kpi metric-link');k.type='button';k.classList.toggle('selected',tableDetail?.kind===kind);
  k.append(node('small',label),node('strong',number(tableItems(kind,period).length)),node('span','Ver detalle','delta'));k.onclick=()=>openTableDetail(kind);box.append(k);
 }
 if(tableDetail)openTableDetail(tableDetail.kind,tableDetail.day);
}
function openTableDetail(kind,day=null){
 const period=tablePeriod(),items=tableItems(kind,period);tableDetail={kind,day};
 for(const k of $('table-stats').children)k.classList.toggle('selected',k.querySelector('small')?.textContent===TABLE_KINDS[kind]);
 $('table-detail').hidden=false;$('table-detail-title').textContent=TABLE_KINDS[kind]+(day?' · '+longDay(day):'');
 const days=[];for(let d=period.from;d<=period.to;d=addDays(d,1))days.push(d);
 columns($('table-detail-chart'),days.map(d=>({label:shortDay(d),value:items.filter(x=>x.day===d).length,tooltip:shortDay(d)+' · '+items.filter(x=>x.day===d).length+' · tocá para ver ese día',onClick:()=>openTableDetail(kind,d)})),{labelEvery:Math.max(1,Math.ceil(days.length/12))});
 const shown=day?items.filter(x=>x.day===day):items,body=$('table-detail-body');body.replaceChildren();
 if(day)body.append(button('Ver todo el período',()=>openTableDetail(kind)));
 if(!shown.length){body.append(node('p','No hay nada en este período.','empty'));return;}
 const status={waiting:'Esperando rival',reserved:'En juego',settled:'Terminada',refunded:'Sin rival (devuelta)'};
 const reason={abandon:'abandono',disconnect:'desconexión',inactivity:'inactividad',timeout:'inactividad'};
 const rows=shown.map(x=>[formatTableTime(x.at),x.code,x.players.join(' vs ')||'—',(x.targetPoints||'—')+' pts',kind==='created'?status[x.status]||x.status:'Ganó '+(x.winner||'—')+(x.scores?' ('+Object.values(x.scores).join(' a ')+')':'')+(reason[x.reason]?' por '+reason[x.reason]:'')]);
 body.append(simpleTable(['Fecha y hora','Mesa','Jugadores','Partida',kind==='created'?'Estado':'Resultado'],rows));
}
for(const id of ['table-range','table-from','table-to'])$(id).addEventListener('change',renderTableStats);
$('table-detail-close').onclick=()=>{tableDetail=null;$('table-detail').hidden=true;renderTableStats();};
function tableTime(table){return Number(table.finishedAt||table.createdAt)||0;}
function formatTableTime(value){
 if(!value)return 'Sin fecha registrada';
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return 'Sin fecha registrada';
 return new Intl.DateTimeFormat('es-UY',{timeZone:ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
function sortedTables(list){
 const order=$('table-order').value;
 return [...list].sort((a,b)=>{
  const dateDifference=tableTime(b)-tableTime(a);
  // Undated old records stay last in either chronological direction.
  if(order==='oldest')return !tableTime(a)?(!tableTime(b)?0:1):!tableTime(b)?-1:-dateDifference;
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
  summary.append(players,node('span',t.status,'table-status'),node('span',formatTableTime(t.createdAt),'table-summary-date'));card.append(summary);
  const contents=node('div','','table-expanded');card.append(contents);
  contents.append(node('h3','Mesa '+t.code+' · Partida '+(t.matchNumber||1)),node('small','Partida a '+t.targetPoints+' puntos'),node('small','Creada: '+formatTableTime(t.createdAt)));
  if(t.finishedAt)contents.append(node('small','Finalizada: '+formatTableTime(t.finishedAt)));
  if(t.scores){const score=node('p',t.players.map((name,i)=>name+': '+(t.scores['player'+(i+1)]||0)).join(' · '),'table-result');contents.append(score);}
  if(t.winnerName)contents.append(node('p','Ganó '+t.winnerName,'table-winner'));
  if(t.rawStatus==='refunded')contents.append(node('p','La mesa se cerró sin terminarse.'));
  if(t.rawStatus==='settled'&&!t.reason)contents.append(node('small','Motivo: alcanzó los puntos de la partida.'));
  if(t.id)contents.append(node('small','ID: '+t.id));
  if(t.reason)contents.append(node('small','Motivo: '+({abandon:'Abandono',disconnect:'Desconexión','waiting-canceled':'Cancelada sin rival','draw-left':'Abandono antes de empezar','draw-cancel':'Cancelación antes de empezar',points:'Puntos',timeout:'Inactividad',inactivity:'Inactividad',admin:'Cierre del administrador'}[t.reason]||t.reason)));
  if(!t.closedAt&&(['waiting','reserved'].includes(t.rawStatus)||t.status==='Sistema anterior'))contents.append(button('Cerrar mesa',()=>openEdit('close-table',t)));return card;
 };
 const query=$('table-search').value.trim().toLowerCase();
 const matches=t=>[...(t.players||[]),t.code,t.id].filter(Boolean).join(' ').toLowerCase().includes(query);
 const current=scope==='previous'?[]:(tableData.tables||[]).filter(matches);
 const cutoff=Date.now()-7*86400000;
 const previous=scope==='active'?[]:(tableData.archivedTables||[]).filter(t=>tableTime(t)>=cutoff&&matches(t)&&(scope!=='finished'||t.status==='Terminada'));
 if(scope!=='previous'&&scope!=='finished'){
  const group=node('section','','table-group');group.append(node('h3','Mesas activas ('+current.length+')'));
  const cards=node('div','','cards');for(const t of sortedTables(current))cards.append(tableCard(t));
  if(!current.length)cards.append(node('p','No hay mesas activas.'));group.append(cards);list.append(group);
 }
 if(scope!=='active'){
  const group=node('section','','table-group');group.append(node('h3',(scope==='finished'?'Partidas terminadas · últimos 7 días':'Mesas anteriores · últimos 7 días')+' ('+previous.length+')'));
  const cards=node('div','','cards');for(const t of sortedTables(previous))cards.append(tableCard(t));
  if(!previous.length)cards.append(node('p','No hay mesas para este filtro.'));group.append(cards);list.append(group);
 }
}
$('table-search').addEventListener('input',renderTables);
$('table-order').addEventListener('change',renderTables);
$('table-state').addEventListener('change',renderTables);
$('search').addEventListener('input',renderUsers);
// Tapping a column header orders by it; tapping it again flips the order.
for(const button of document.querySelectorAll('[data-sort]'))button.onclick=()=>{const key=button.dataset.sort;sortBy=sortBy.key===key?{key,dir:-sortBy.dir}:{key,dir:key==='name'?1:-1};renderUsers();void loadAllUsers();};$('photo-filter').onchange=$('level-filter').onchange=()=>{renderUsers();void loadAllUsers();};$('more').onclick=()=>refresh(true);
function showTab(name){for(const section of Object.keys(TAB_TITLES))$(section).hidden=section!==name;for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab.dataset.tab===name);$('page-title').textContent=TAB_TITLES[name];if(name==='usage')refreshUsage();if(name==='chat')loadChat();if(name==='retention')loadRetention();if(name==='tasks')loadTasks();if(name==='users')loadDevices();}
$('refresh').onclick=()=>{refresh(false,true);if(!$('usage').hidden)refreshUsage();if(!$('chat').hidden)loadChat();};
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
 else{data.uid=item.uid;if(action==='credits'){data.balance=Number($('value').value);data.expectedBalance=item.balance;}if(action==='rename')data.name=$('value').value.trim();if(action==='block')data.disabled=!item.disabled;if(action==='level'){data.points=Math.round(Number($('points-value').value)*10);data.expected=item.points||0;}if(action==='delete')data.confirmName=$('delete-confirm').value;}
 $('save').disabled=true;$('edit-error').textContent='';
 try{await call(data);$('edit').close();say('Cambio guardado.');await refresh();}catch(e){$('edit-error').textContent=errorText(e);}finally{$('save').disabled=false;}
};
const shortDay=day=>day.slice(8,10)+'/'+day.slice(5,7);
function legend(){
 for(const el of document.querySelectorAll('[data-legend]')){
  el.replaceChildren();
  for(const [key,label] of Object.entries(PLATFORM_LABELS)){const item=node('span',label);const swatch=node('i');swatch.style.background='var(--'+key+')';item.prepend(swatch);el.append(item);}
 }
}
// Column chart from plain values or per-platform segments. Every column has a
// tooltip with the exact numbers; labels thin out on narrow charts.
function columns(target,items,{labelEvery=1,showValues=true}={}){
 target.replaceChildren();
 const totals=items.map(item=>item.segments?item.segments.reduce((sum,s)=>sum+s.value,0):item.value);
 const maximum=Math.max(1,...totals);
 if(totals.every(total=>!total)){target.append(node('p','Todavía no hay datos para este período.','empty'));return;}
 items.forEach((item,i)=>{
  const col=node('div','','bar-col');col.title=item.tooltip||item.label+': '+totals[i];clickable(col,item.onClick);
  // The bar lives in its own area, so its height is exactly its share of the tallest one; any value above
  // zero shows at least as a thin line.
  const plot=node('div','','plot'),share=(totals[i]/maximum*100).toFixed(2)+'%';
  const stack=node('div','','stack');stack.style.height=share;
  if(item.selected)col.classList.add('selected');
  if(showValues&&totals[i]){const val=node('span',item.text??number(totals[i]),'val');val.style.bottom='calc('+share+' + 3px)';plot.append(val);}
  for(const s of item.segments||[{value:item.value}]){if(!s.value)continue;const seg=node('div','','seg');seg.style.flex=s.value+' 1 0';if(s.key)seg.style.background='var(--'+s.key+')';stack.append(seg);}
  plot.append(stack);col.append(plot,node('span',i%labelEvery===0?item.label:'','lbl'));target.append(col);
 });
}
// Anything that opens more detail behaves like a button (mouse, touch and keyboard).
function clickable(el,onClick){
 if(!onClick)return el;
 el.classList.add('clickable');el.tabIndex=0;el.setAttribute('role','button');el.onclick=onClick;
 el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}};
 return el;
}
function bars(target,rows,{total:whole=null}={}){
 target.replaceChildren();
 const total=whole??rows.reduce((sum,r)=>sum+r.value,0);
 if(!total){target.append(node('p','Todavía no hay visitas registradas.','empty'));return;}
 const maximum=Math.max(...rows.map(r=>r.value));
 for(const r of rows){
  const row=node('div','','pbar'),name=node('span',r.label);clickable(row,r.onClick);
  if(r.color){const swatch=node('i','','swatch');swatch.style.background=r.color;name.prepend(swatch);}
  const track=node('div','','track'),fill=node('div','','fill');fill.style.width=(r.value/maximum*100)+'%';if(r.value)fill.style.minWidth='3px';fill.style.background=r.color||'var(--gold)';track.append(fill);
  const value=node('strong',number(r.value));value.append(node('small',Math.round(r.value/total*100)+'%'));
  row.append(name,track,value);target.append(row);
 }
}
function delta(el,today,yesterday){
 el.className='delta';
 if(!yesterday){el.textContent=today?'Sin datos de ayer':'';return;}
 const change=Math.round((today-yesterday)/yesterday*100);
 el.textContent=(change>0?'+':'')+change+'% vs. ayer ('+number(yesterday)+')';el.classList.add(change>=0?'up':'down');
}
const platformSegments=counts=>Object.keys(PLATFORM_LABELS).map(key=>({key,value:counts[key]||0}));
const platformTooltip=(day,counts,unit)=>shortDay(day)+' · '+number(Object.values(counts).reduce((a,b)=>a+b,0))+' '+unit+'\n'+Object.entries(PLATFORM_LABELS).map(([key,label])=>label+': '+number(counts[key]||0)).join('\n');
function renderHours(){
 const day=metrics?.days.find(d=>d.day===$('metric-day').value),hours=day?.hours||Array.from({length:24},(_,hour)=>({hour,users:0}));
 columns($('hour-chart'),hours.map(h=>({label:String(h.hour).padStart(2,'0'),value:h.users,tooltip:String(h.hour).padStart(2,'0')+':00 – '+String((h.hour+1)%24).padStart(2,'0')+':00 · '+h.users+' jugadores'})),{labelEvery:3});
}
const addDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const longDay=day=>new Intl.DateTimeFormat('es-UY',{weekday:'short',day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const visitTime=at=>new Intl.DateTimeFormat('es-UY',{timeZone:ZONE,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
let visitDetail=null,visitDetailRequest=0,visitGrouped=false;
// Opens the Visits section on one day or the current period, with a platform or page detail.
function goVisits({day=null,platform='all',page=null,measure=null,guest=false}={}){
 showTab('visits');
 if(measure)$('visit-measure').value=measure;
 if(day){const today=metrics?.today;if(day===today)$('visit-range').value='today';else if(day===addDays(today,-1))$('visit-range').value='yesterday';else{$('visit-range').value='custom';$('visit-from').value=day;$('visit-to').value=day;}}
 visitDetail=null;renderVisits();openVisitDetail(platform,{page,guest});
}
// The selected period as Uruguay days, clamped to the stored history.
function selectedPeriod(prefix,fields){
 const today=metrics?.today||new Date(Date.now()-10800000).toISOString().slice(0,10),oldest=addDays(today,-89),choice=$(prefix+'-range').value;
 const custom=choice==='custom';for(const field of document.querySelectorAll(fields))field.hidden=!custom;
 for(const id of [prefix+'-from',prefix+'-to']){$(id).min=oldest;$(id).max=today;}
 let from,to=today;
 if(choice==='today')from=today;
 else if(choice==='yesterday')from=to=addDays(today,-1);
 else if(custom){
  if(!$(prefix+'-from').value)$(prefix+'-from').value=addDays(today,-6);if(!$(prefix+'-to').value)$(prefix+'-to').value=today;
  from=$(prefix+'-from').value;to=$(prefix+'-to').value;
  if(from>to)[from,to]=[to,from];
 }else from=addDays(today,-(Number(choice)-1));
 if(from<oldest)from=oldest;if(to>today)to=today;
 return {from,to};
}
const visitPeriod=()=>selectedPeriod('visit','.date-field');
// Scorer and learning: who uses them, on the web pages and inside the game, and what came next.
const JOURNEY_ROWS={
 anotador:[['landing','Llegaron por primera vez'],['used','Usaron el anotador'],['finished','Terminaron de anotar una partida'],['game','Llegaron al juego'],['entered','Entraron con cuenta o invitados'],['registered','Crearon cuenta'],['scorer','Abrieron el anotador del juego'],['played','Jugaron una partida'],['returned','Volvieron otro día']],
 aprender:[['landing','Llegaron por primera vez'],['used','Leyeron hasta el final'],['game','Llegaron al juego'],['entered','Entraron con cuenta o invitados'],['registered','Crearon cuenta'],['learn','Abrieron Aprender en el juego'],['played','Jugaron una partida'],['returned','Volvieron otro día']]
};
const ANOTADOR_ROWS=[['Página','Empezaron a anotar','anotador-web-start'],['Página','Terminaron una partida','anotador-web-finish'],['Página','Tocaron «Abrir» (pantalla completa)','anotador-web-promo'],['Página','Tocaron «Jugar truco online»','anotador-web-play'],['Juego','Abrieron el anotador','anotador-game-open'],['Juego','Empezaron a anotar','anotador-game-start'],['Juego','Terminaron una partida','anotador-game-finish'],['Juego','Compartieron el resultado','anotador-game-share']];
const APRENDER_ROWS=[['Guía web','Leyeron hasta el final','aprender-web-end'],['Guía web','Tocaron «Practicar gratis»','aprender-web-play'],['Juego','Abrieron Aprender','aprender-game-open'],['Juego','Vieron los videos','aprender-game-videos'],['Juego','Terminaron los videos','aprender-game-videos-end'],['Juego','Empezaron partida simple','aprender-game-stage-0'],['Juego','Terminaron partida simple','aprender-game-finish-0'],['Juego','Empezaron partida con envido','aprender-game-stage-1'],['Juego','Terminaron partida con envido','aprender-game-finish-1'],['Juego','Empezaron partida con flor','aprender-game-stage-2'],['Juego','Terminaron partida con flor','aprender-game-finish-2'],['Juego','Practicaron envido','aprender-game-envido'],['Juego','Practicaron flor','aprender-game-flor'],['Juego','Practicaron puntos de flor','aprender-game-flor-points'],['Juego','Abrieron la guía de cartas','aprender-game-guide']];
let usage=null,usageRequest=0;
const percent=(part,whole)=>whole?Math.round(part*100/whole)+'%':'—';
async function refreshUsage(){
 const period=selectedPeriod('usage','.usage-date-field'),request=++usageRequest;
 $('usage-period').textContent=period.from===period.to?'Período: '+longDay(period.from):'Período: del '+longDay(period.from)+' al '+longDay(period.to);
 try{const data=(await call({action:'usage',...period,includeTest:!hideTest()})).data;if(request!==usageRequest)return;usage=data;$('usage-status').hidden=true;renderUsage();}
 catch(e){if(request===usageRequest){$('usage-status').hidden=false;$('usage-status').textContent=e.code==='functions/invalid-argument'?'Falta publicar las funciones de administración en Firebase.':errorText(e);}}
}
function fillOrigins(select,journeys){
 const first=!select.options.length,previous=select.value,found=Object.keys(journeys||{}).sort((a,b)=>a==='Google'?-1:b==='Google'?1:a.localeCompare(b,'es'));
 select.replaceChildren(node('option','Todos'),...found.map(o=>node('option',o)));select.options[0].value='';
 select.value=first&&found.includes('Google')?'Google':found.includes(previous)?previous:'';
}
// Each step is measured against everyone who arrived, not against the previous step.
function renderJourney(page){
 const journeys=usage?.journeys?.[page]||{},select=$('journey-'+page+'-origin'),target=$('journey-'+page),origin=select.value,steps={};
 for(const [name,counts] of Object.entries(journeys))if(!origin||name===origin)for(const [step,value] of Object.entries(counts))steps[step]=(steps[step]||0)+value;
 const arrived=steps.landing||0,reached=steps.game||0;target.replaceChildren();
 $('journey-'+page+'-summary').textContent=arrived?number(arrived)+(arrived===1?' persona nueva':' personas nuevas')+(origin?' desde '+origin:'')+': '+number(reached)+' llegaron al juego ('+percent(reached,arrived)+') y '+number(Math.max(0,arrived-reached))+' se quedaron solo en la página.':'';
 if(!arrived){target.append(node('p','Todavía no hay datos para este período.','empty'));return;}
 for(const [key,label] of JOURNEY_ROWS[page]){
  const value=steps[key]||0,row=node('div','','pbar'),track=node('div','','track'),fill=node('div','','fill');
  fill.style.width=(value/arrived*100)+'%';fill.style.background='var(--gold)';track.append(fill);
  const total=node('strong',number(value));total.append(node('small',percent(value,arrived)));
  row.append(node('span',label),track,total);target.append(row);
 }
}
function usageTable(target,rows){
 const events=usage?.events||{};
 target.replaceChildren(simpleTable(['Dónde','Qué hicieron','Personas','Veces','Web','Apps'],rows.map(([place,label,key])=>{const e=events[key]||{};return [place,label,number(e.people),number(e.count),number(e.web),number(e.apps)];})));
}
function originBarsFor(page,target){
 const origins=usage?.pages?.[page]?.origins||{};
 bars(target,Object.entries(origins).map(([label,o])=>({label,value:o.people})).sort((a,b)=>b.value-a.value));
}
function usageDays(target,key){
 const days=usage?.days||[];
 columns(target,days.map(d=>({label:shortDay(d.day),segments:[{key:'usage-page',value:d[key].page},{key:'usage-game',value:d[key].game}],tooltip:shortDay(d.day)+'\nPágina: '+number(d[key].page)+' ('+number(d[key].google)+' desde Google)\nJuego: '+number(d[key].game)})),{labelEvery:Math.max(1,Math.ceil(days.length/12))});
}
function renderUsage(){
 if(!usage)return;
 const anotador=usage.pages?.anotador||{},aprender=usage.pages?.aprender||{},events=usage.events||{},kpis=$('usage-kpis');
 const google=page=>page.origins?.Google?.people||0;
 const kpi=(label,value,note)=>{const k=node('div','','kpi');k.append(node('small',label),node('strong',number(value)),node('span',note,'delta'));kpis.append(k);};
 kpis.replaceChildren();
 kpi('Página del anotador',anotador.people,number(anotador.visits)+' visitas');
 kpi('Anotador desde Google',google(anotador),percent(google(anotador),anotador.people)+' de la página');
 kpi('Anotador del juego',events['anotador-game-open']?.people,number(events['anotador-game-open']?.count)+' aperturas');
 kpi('Guía Aprender (web)',aprender.people,number(aprender.visits)+' visitas');
 kpi('Guía desde Google',google(aprender),percent(google(aprender),aprender.people)+' de la guía');
 kpi('Aprender del juego',events['aprender-game-open']?.people,number(events['aprender-game-open']?.count)+' aperturas');
 for(const page of ['anotador','aprender']){fillOrigins($('journey-'+page+'-origin'),usage.journeys?.[page]);renderJourney(page);}
 usageDays($('usage-anotador-days'),'anotador');usageDays($('usage-aprender-days'),'aprender');
 usageTable($('usage-anotador-table'),ANOTADOR_ROWS);usageTable($('usage-aprender-table'),APRENDER_ROWS);
 originBarsFor('anotador',$('usage-anotador-origins'));originBarsFor('aprender',$('usage-aprender-origins'));
 bars($('usage-targets'),Object.entries(usage.targets||{}).map(([target,value])=>({label:'A '+target,value})).sort((a,b)=>b.value-a.value));
}
for(const id of ['usage-range','usage-from','usage-to'])$(id).addEventListener('change',refreshUsage);
for(const page of ['anotador','aprender'])$('journey-'+page+'-origin').addEventListener('change',()=>renderJourney(page));
function renderVisits(){
 const all=metrics?.visits?.days||[],{from,to}=visitPeriod();
 const measure=$('visit-measure').value,unit=measure==='visits'?'visitas':'visitantes',totalKey=measure==='visits'?'totalVisits':'totalVisitors';
 const days=all.filter(d=>d.day>=from&&d.day<=to);
 $('visit-period').textContent=from===to?'Período: '+longDay(from):'Período: del '+longDay(from)+' al '+longDay(to)+' ('+days.length+' días)';
 $('visit-chart-title').textContent=(measure==='visits'?'Visitas':'Visitantes')+' por día y plataforma';
 columns($('visit-chart'),days.map(d=>({label:shortDay(d.day),segments:platformSegments(d[measure]),tooltip:platformTooltip(d.day,d[measure],unit),onClick:()=>goVisits({day:d.day})})),{labelEvery:Math.max(1,Math.ceil(days.length/12))});
 const sum=key=>days.reduce((total,d)=>total+(d[measure][key]||0),0),grand=days.reduce((total,d)=>total+d[totalKey],0);
 $('visit-totals').replaceChildren();
 const card=(key,label,value,color)=>{
  const k=node('button','','kpi metric-link'),title=node('small',label);k.type='button';k.dataset.platform=key;k.title='Ver quién entró';
  if(color){const swatch=node('i','','swatch');swatch.style.background=color;title.prepend(swatch);}
  k.classList.toggle('selected',key==='guests'?!!visitDetail?.guest:key==='signed'?!!visitDetail?.signed:!visitDetail?.guest&&!visitDetail?.signed&&visitDetail?.platform===key);
  k.append(title,node('strong',number(value)),node('span','Ver quién entró','delta'));k.onclick=()=>key==='guests'?openVisitDetail('all',{guest:true}):key==='signed'?openVisitDetail('all',{signed:true}):openVisitDetail(key);$('visit-totals').append(k);
 };
 card('all','Total '+unit,grand);for(const [key,label] of Object.entries(PLATFORM_LABELS))card(key,label,sum(key),'var(--'+key+')');
 const userTotal=days.reduce((total,d)=>total+(d.users?.[totalKey]||0),0);
 card('signed',measure==='visits'?'De usuarios con cuenta':'Usuarios con cuenta',userTotal);
 const guestTotal=days.reduce((total,d)=>total+(d.guests?.[totalKey]||0),0);
 card('guests','Invitados (sin cuenta)',guestTotal);
 bars($('visit-pages'),Object.entries(PAGE_LABELS).map(([key,label])=>({label,value:days.reduce((total,d)=>total+(d.pages?.[key]||0),0),onClick:()=>openVisitDetail('all',{page:key})})).sort((a,b)=>b.value-a.value));
 const hours=Array.from({length:24},(_,h)=>days.reduce((total,d)=>total+(d.hours?.[h]||0),0));
 columns($('visit-hours'),hours.map((value,h)=>({label:String(h).padStart(2,'0'),value,tooltip:String(h).padStart(2,'0')+':00 · '+value+' visitas · tocá para ver quién entró',onClick:()=>openVisitDetail('all',{hour:h})})),{labelEvery:3});
 // Sign-ups per day of the period; a day shows who registered.
 const signups=metrics?.registrations||{};
 const periodDays=[];for(let d=from;d<=to;d=addDays(d,1))periodDays.push(d);
 // The most players connected at once each day of the period, and the record day.
 const concurrentByDay=new Map((metrics?.days||[]).map(d=>[d.day,d.concurrent]));
 const peakTime=at=>at?new Intl.DateTimeFormat('es-UY',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at)):'';
 const periodPeaks=periodDays.map(d=>({day:d,peak:concurrentByDay.get(d)||null}));
 columns($('concurrent-chart'),periodPeaks.map(({day,peak})=>({label:shortDay(day),value:peak?.count||0,tooltip:shortDay(day)+' · '+(peak?.count||0)+' a la vez'+(peak?.at?' (a las '+peakTime(peak.at)+')':'')})),{labelEvery:Math.max(1,Math.ceil(periodDays.length/12))});
 const best=periodPeaks.reduce((a,b)=>(b.peak?.count||0)>(a?.peak?.count||0)?b:a,null),record=metrics?.concurrentRecord;
 $('concurrent-record').textContent=(best?.peak?.count?'En el período: máximo de '+best.peak.count+' el '+longDay(best.day)+' a las '+peakTime(best.peak.at)+'. ':'En el período todavía no hay datos. ')+(record?.count?'Récord histórico: '+record.count+' el '+longDay(new Date(record.at-10800000).toISOString().slice(0,10))+' a las '+peakTime(record.at)+'.':'');
 columns($('signup-chart'),periodDays.map(d=>({label:shortDay(d),value:(signups[d]||[]).length,tooltip:shortDay(d)+' · '+(signups[d]||[]).length+' registrados',onClick:()=>openSignupDetail(d)})),{labelEvery:Math.max(1,Math.ceil(periodDays.length/12))});
 const table=$('visit-table');table.replaceChildren();
 const head=node('tr');head.append(node('th','Día'),...Object.values(PLATFORM_LABELS).map(label=>node('th',label)),node('th','Total','total'),node('th','Usuarios'),node('th','Invitados'));table.append(head);
 for(const d of [...days].reverse()){
  const row=clickable(node('tr'),()=>goVisits({day:d.day}));row.title='Ver quién entró ese día';row.append(node('td',longDay(d.day)));
  for(const key of Object.keys(PLATFORM_LABELS)){const value=d[measure][key]||0;row.append(node('td',number(value),value?'':'zero'));}
  const users=d.users?.[totalKey]||0,guests=d.guests?.[totalKey]||0;
  row.append(node('td',number(d[totalKey]),'total'),node('td',number(users),users?'':'zero'),node('td',number(guests),guests?'':'zero'));table.append(row);
 }
 if(visitDetail&&(visitDetail.from!==from||visitDetail.to!==to))openVisitDetail(visitDetail.platform,{page:visitDetail.page,hour:visitDetail.hour,guest:visitDetail.guest,signed:visitDetail.signed});
}
function simpleTable(headers,rows){
 const wrap=node('div','','table-scroll'),table=node('table','','data-table'),head=node('tr');
 head.append(...headers.map(h=>node('th',h)));table.append(head);
 for(const cells of rows){const row=node('tr');for(const cell of cells)row.append(node('td',cell));table.append(row);}
 wrap.append(table);return wrap;
}
// Who came through one platform or page (or all) in the selected period.
async function openVisitDetail(platform,{page=null,hour=null,guest=false,signed=false}={}){
 const {from,to}=visitPeriod(),request=++visitDetailRequest;
 visitDetail={platform,from,to,page,hour,guest,signed};
 for(const k of $('visit-totals').children)k.classList.toggle('selected',guest?k.dataset.platform==='guests':signed?k.dataset.platform==='signed':!page&&hour==null&&k.dataset.platform===platform);
 const hh=h=>String(h).padStart(2,'0')+':00';
 const label=guest?'Invitados (Jugar sin cuenta)':signed?'Usuarios con cuenta':hour!=null?'De '+hh(hour)+' a '+hh((hour+1)%24):page?'Página: '+PAGE_LABELS[page]:platform==='all'?'Todas las plataformas':PLATFORM_LABELS[platform];
 $('visit-detail').hidden=false;$('visit-detail-title').textContent=label+' · '+(from===to?longDay(from):shortDay(from)+' al '+shortDay(to));
 $('visit-detail-body').replaceChildren(node('p','Cargando…','empty'));
 $('visit-detail').scrollIntoView({behavior:'smooth',block:'start'});
 let data;
 try{data=(await call({action:'visitors',from,to,platform,includeTest:!hideTest(),...(page?{page}:{}),...(hour!=null?{hour}:{}),...(guest?{guest:true}:{}),...(signed?{signed:true}:{})})).data;}
 catch(e){if(request===visitDetailRequest)$('visit-detail-body').replaceChildren(node('p',errorText(e),'empty'));return;}
 if(request!==visitDetailRequest)return;
 renderVisitDetail(data,platform);
}
// Who registered on one day, in the detail panel.
function openSignupDetail(day){
 visitDetail=null;visitDetailRequest++;for(const k of $('visit-totals').children)k.classList.remove('selected');
 const list=metrics?.registrations?.[day]||[];
 $('visit-detail').hidden=false;$('visit-detail-title').textContent='Registrados el '+longDay(day)+' ('+list.length+')';
 const body=$('visit-detail-body');body.replaceChildren();
 if(list.length)body.append(simpleTable(['Hora','Jugador','Correo'],list.map(u=>[visitTime(u.at).slice(-5),u.name||'Sin nombre todavía',u.email||'—'])));
 else body.append(node('p','Nadie se registró ese día.','empty'));
 $('visit-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderVisitDetail(data,platform){
 const body=$('visit-detail-body');body.replaceChildren();
 const names=new Map(data.players.map(p=>[p.uid,p.name||'Jugador sin nombre']));
 const withVisits=data.players.filter(p=>p.visits).length;
 // In words: how many visits came from players and how many from people without a session.
 body.append(node('p',number(data.totalVisits)+' visitas: '+number(data.signedVisits||0)+' de '+number(withVisits)+(withVisits===1?' jugador':' jugadores')+' con sesión · '+number(data.anonymousVisits||0)+' sin sesión'+(data.anonymousVisits?' (de unos '+number(Math.max(1,data.anonymousDevices||0))+' dispositivos)':'')+(data.guestVisits?' · '+number(data.guestVisits)+' entraron como invitados ('+number(data.guestDevices||0)+' invitados distintos)':'')+'.','detail-summary'));
 const players=node('div','','detail-block');players.append(node('h3','Jugadores con sesión ('+data.players.length+')'));
 if(data.players.length)players.append(simpleTable(['Jugador','Visitas','Plataformas','Días que entró','Última vez'],data.players.map(p=>[p.name||p.uid,String(p.visits||0),p.platforms.map(k=>PLATFORM_LABELS[k]).join(', '),String(p.days),p.lastDay?longDay(p.lastDay):'—'])));
 else players.append(node('p','Nadie con sesión iniciada entró por acá en este período.','empty'));
 const visits=node('div','','detail-block');visits.append(node('h3','Visitas registradas ('+number(data.totalVisits)+')'));
 if(data.visits.length){
  const origins={};for(const v of data.visits)origins[v.origin||'Directo']=(origins[v.origin||'Directo']||0)+1;
  const originBars=node('div','','platform-bars');bars(originBars,Object.entries(origins).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value])=>({label,value})));
  // Every visit, or one row per player (with how many times) plus the visits without a session.
  const toggle=node('div','','segmented');
  for(const [grouped,text] of [[false,'Todas las visitas'],[true,'Una por jugador']]){const b=node('button',text);b.type='button';b.classList.toggle('active',visitGrouped===grouped);b.onclick=()=>{visitGrouped=grouped;renderVisitDetail(data,platform);};toggle.append(b);}
  visits.append(node('h4','De dónde llegaron'),originBars,node('h4','Últimas visitas'),toggle);
  let rows=data.visits.slice(0,300).map(v=>({v,count:1}));
  if(visitGrouped){const seen=new Map();rows=[];for(const v of data.visits){if(typeof v.uid!=='string'){rows.push({v,count:1});continue;}const row=seen.get(v.uid);if(row)row.count++;else{const fresh={v,count:1};seen.set(v.uid,fresh);rows.push(fresh);}}rows=rows.slice(0,300);}
  const headers=['Fecha y hora','Jugador',...(visitGrouped?['Visitas']:[]),...(platform==='all'?['Plataforma']:[]),'Página','Dispositivo','Navegador','Origen','Tipo'];
  visits.append(simpleTable(headers,rows.map(({v,count})=>[visitTime(v.at),typeof v.uid==='string'?(names.get(v.uid)||'Jugador')+(v.guest?' (antes invitado)':''):v.guest?'Invitado':'Sin sesión',...(visitGrouped?[String(count)]:[]),...(platform==='all'?[PLATFORM_LABELS[v.platform]||v.platform]:[]),PAGE_LABELS[v.page]||v.page,v.os+(v.model?' · '+v.model:''),v.browser,v.origin||'Directo',v.first?'Nueva del día':'Repetida'])));
  if(data.totalVisits>300)visits.append(node('p','Se muestran las 300 más recientes.','note'));
 }else visits.append(node('p','No hay visitas con detalle en este período.','empty'));
 visits.append(node('p','"Invitado": entró con "Jugar sin cuenta" (se registra desde el 29/10/2026). "Sin sesión": no inició sesión ni eligió jugar sin cuenta. El jugador de cada visita se registra desde el 24/10/2026.','note'));
 body.append(players,visits);
}
$('go-visitors').onclick=()=>goVisits({day:metrics?.today,measure:'visitors'});
$('go-visits').onclick=()=>goVisits({day:metrics?.today,measure:'visits'});
$('go-guests').onclick=()=>goVisits({day:metrics?.today,measure:'visitors',guest:true});
$('go-tables').onclick=()=>{showTab('tables');$('table-state').value='active';renderTables();};
$('visit-detail-close').onclick=()=>{visitDetail=null;visitDetailRequest++;$('visit-detail').hidden=true;for(const k of $('visit-totals').children)k.classList.remove('selected');};
function renderMetrics(){
 if(!metrics)return;
 $('metric-total').textContent=number(metrics.total);$('metric-active').textContent=number(metrics.active);$('metric-today').textContent=number(metrics.todayUsers);
 const visitDays=metrics.visits?.days||[],today=visitDays[visitDays.length-1],yesterday=visitDays[visitDays.length-2];
 $('kpi-visitors').textContent=number(today?.totalVisitors||0);$('kpi-visits').textContent=number(today?.totalVisits||0);
 delta($('kpi-visitors-delta'),today?.totalVisitors||0,yesterday?.totalVisitors||0);delta($('kpi-visits-delta'),today?.totalVisits||0,yesterday?.totalVisits||0);
 $('kpi-guests').textContent=number(today?.guests?.totalVisitors||0);delta($('kpi-guests-delta'),today?.guests?.totalVisitors||0,yesterday?.guests?.totalVisitors||0);
 bars($('platform-today'),Object.entries(PLATFORM_LABELS).map(([key,label])=>({label,value:today?.visitors[key]||0,color:'var(--'+key+')',onClick:()=>goVisits({day:metrics.today,platform:key})})));
 columns($('visits-mini'),visitDays.slice(-14).map(d=>({label:shortDay(d.day),segments:platformSegments(d.visitors),tooltip:platformTooltip(d.day,d.visitors,'visitantes'),onClick:()=>goVisits({day:d.day})})),{labelEvery:2});
 const selected=$('metric-day').value;$('metric-day').replaceChildren();
 const days=[...new Set([metrics.today,...metrics.days.map(d=>d.day)])];
 for(const day of days){const option=node('option',day===metrics.today?'Hoy':shortDay(day));option.value=day;$('metric-day').append(option);}
 if(days.includes(selected))$('metric-day').value=selected;
 renderHours();
 const byDay=new Map(metrics.days.map(d=>[d.day,d.users]));
 columns($('day-chart'),Array.from({length:30},(_,i)=>{const day=new Date(Date.parse(metrics.today+'T12:00:00Z')-(29-i)*86400000).toISOString().slice(0,10);return {label:shortDay(day),value:byDay.get(day)||0,tooltip:shortDay(day)+' · '+(byDay.get(day)||0)+' jugadores únicos',onClick:()=>goVisits({day})};}),{labelEvery:3});
 // Sign-ups per day; a day opens who registered.
 const signupsByDay=metrics.registrations||{};
 columns($('signup-day-chart'),Array.from({length:30},(_,i)=>{const day=new Date(Date.parse(metrics.today+'T12:00:00Z')-(29-i)*86400000).toISOString().slice(0,10),list=signupsByDay[day]||[],n=list.length,counts={};for(const u of list){const k=PLATFORM_LABELS[u.platform]?u.platform:'unknown';counts[k]=(counts[k]||0)+1;}return {label:shortDay(day),value:n,segments:[...platformSegments(counts),{key:'unknown',value:counts.unknown||0}],tooltip:platformTooltip(day,counts,'registrados')+(counts.unknown?'\nSin dato: '+counts.unknown:''),onClick:()=>{goVisits({day});openSignupDetail(day);}};}),{labelEvery:3});
 renderVisits();renderUsers();
}
for(const id of ['visit-range','visit-measure','visit-from','visit-to'])$(id).addEventListener('change',renderVisits);
legend();
async function refreshMetrics(){
 if(metricsBusy)return;metricsBusy=true;const generation=epoch;
 try{const data=(await call({action:'metrics',includeTest:!hideTest()})).data;if(generation!==epoch)return;metrics=data;renderMetrics();}
 catch(e){if(generation===epoch)say(errorText(e));}
 finally{metricsBusy=false;}
}
$('metric-day').addEventListener('change',renderHours);
$('levels-seed').onclick=async()=>{
 $('levels-seed').disabled=true;$('levels-seed-status').textContent='Calculando…';
 try{const r=(await call({action:'levels-backfill'})).data;$('levels-seed-status').textContent=r.seeded+' jugadores recibieron su nivel inicial (de '+r.players+' con partidas ganadas).';}
 catch(e){$('levels-seed-status').textContent=errorText(e);}finally{$('levels-seed').disabled=false;}
};
// Messages to players: a player sees them in the game (never mid-match) and can answer.
let threads=[];const openThreads=new Set();
function peopleList(){
 const list=$('message-people');list.replaceChildren();
 for(const u of users.filter(u=>u.name))list.append(Object.assign(document.createElement('option'),{value:u.name}));
}
function writeTo(u){showTab('messages');$('message-to').value=u.name||'';$('message-text').focus();}
// Typed table chat (quick messages are not stored), newest first, grouped by day.
// Where players play: players active in the period, each counted once by the device they used last.
let devicesRequest=0;
async function loadDevices(){
 const request=++devicesRequest;$('devices-note').textContent='Cargando…';
 try{const data=(await call({action:'devices',days:Number($('devices-days').value)})).data;if(request!==devicesRequest)return;
  bars($('devices-chart'),Object.entries(PLATFORM_LABELS).map(([key,label])=>({label,value:data.counts[key]||0,color:'var(--'+key+')'})));
  const unknown=data.counts.unknown||0;
  $('devices-note').textContent=number(data.players)+' jugadores con cuenta jugaron en este período'+(unknown?' · '+number(unknown)+' sin dispositivo registrado todavía':'')+'.';
  // Which app version each app player has; the apps say it from 1.0.11 on.
  const versionRows=Object.entries(data.versions||{}).flatMap(([platform,list])=>Object.entries(list).sort(([a],[b])=>a==='old'?1:b==='old'?-1:b.localeCompare(a,undefined,{numeric:true})).map(([v,n])=>[DEVICE_NAMES[platform]||platform,v==='old'?'Anterior a 1.0.11':v,number(n)]));
  $('devices-versions').replaceChildren(...(versionRows.length?[simpleTable(['App','Versión','Jugadores'],versionRows)]:[]));
 }catch(e){if(request===devicesRequest)$('devices-note').textContent='No se pudo cargar'+(GAME==='ar'?' (este juego todavía no lo mide).':': '+errorText(e));}
}
$('devices-days').addEventListener('change',loadDevices);
// Tasks: what to check or do later, with a date, a status, a priority, an area and comments.
const TASK_STATUS={pendiente:'Pendiente','en-curso':'En curso',esperando:'Esperando',hecha:'Hecha',descartada:'Descartada'};
const TASK_PRIORITY={alta:'Alta',media:'Media',baja:'Baja'};
const TASK_AREAS={juego:'Juego',apps:'Apps',servidor:'Servidor y Cloudflare',admin:'Admin',marketing:'Marketing y videos',tiendas:'Tiendas',otros:'Otros'};
const PRIORITY_ORDER={alta:0,media:1,baja:2};
let tasks=[],tasksRequest=0;const openTasks=new Set();
const taskOpen=t=>!['hecha','descartada'].includes(t.status);
const taskToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const taskDays=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
const taskPlus=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const taskDay=d=>new Intl.DateTimeFormat('es-UY',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
const taskWhen=at=>new Date(at).toLocaleString('es-UY',{timeZone:ZONE,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
// "Venció hace 2 días", "Vence hoy", "Mañana", "En 4 días · mar 25 nov".
function dueLabel(t){
 if(!t.due)return null;
 const d=taskDays(taskToday(),t.due),open=taskOpen(t);
 if(!open)return {text:taskDay(t.due),cls:''};
 if(d<0)return {text:'Venció hace '+(-d)+(d===-1?' día':' días'),cls:'overdue'};
 if(d===0)return {text:'Vence hoy',cls:'today'};
 if(d===1)return {text:'Mañana · '+taskDay(t.due),cls:'soon'};
 if(d<7)return {text:'En '+d+' días · '+taskDay(t.due),cls:'soon'};
 return {text:taskDay(t.due),cls:''};
}
async function loadTasks(){
 const request=++tasksRequest;if(!tasks.length)$('task-status').textContent='Cargando…';
 try{const data=(await call({action:'tasks'})).data;if(request!==tasksRequest)return;tasks=data.tasks||[];renderTasks();}
 catch(e){if(request===tasksRequest)$('task-status').textContent='No se pudieron cargar las tareas: '+errorText(e);}
}
// One change, then the list as the server has it.
async function changeTask(op){
 const data=(await call({action:'task-change',op})).data;tasks=data.tasks||[];renderTasks();
}
function taskCounts(){
 const today=taskToday(),open=tasks.filter(taskOpen),due=t=>t.due?taskDays(today,t.due):null;
 return {open:open.length,overdue:open.filter(t=>due(t)<0).length,today:open.filter(t=>due(t)===0).length,
  week:open.filter(t=>t.due&&due(t)>=0&&due(t)<7).length,done:tasks.filter(t=>t.status==='hecha'&&Date.now()-(t.doneAt||0)<30*86400000).length};
}
function renderTasks(){
 const c=taskCounts(),urgent=c.overdue+c.today;
 $('tasks-count').hidden=!urgent;$('tasks-count').textContent=urgent||'';
 if($('tasks').hidden)return;
 const kpis=$('tasks-kpis');kpis.replaceChildren();
 for(const [label,value,filter,note,cls] of [['Abiertas',c.open,'open','Pendientes, en curso o esperando'],['Vencidas',c.overdue,'overdue','Ya pasó su fecha',c.overdue?'bad':''],['Para hoy',c.today,'week','Vencen hoy',c.today?'warn':''],['Próximos 7 días',c.week,'week','Con fecha esta semana'],['Hechas',c.done,'hecha','En los últimos 30 días']]){
  const k=node('button','','kpi metric-link'+(cls?' '+cls:''));k.type='button';k.append(node('small',label),node('strong',number(value)),node('span',note,'delta'));
  k.classList.toggle('selected',$('task-filter').value===filter&&label!=='Para hoy');
  k.onclick=()=>{$('task-filter').value=filter;renderTasks();};kpis.append(k);
 }
 const filter=$('task-filter').value,area=$('task-area-filter').value,order=$('task-order').value,query=$('task-search').value.trim().toLocaleLowerCase();
 const today=taskToday(),has=v=>String(v||'').toLocaleLowerCase().includes(query);
 const shown=tasks.filter(t=>{
  if(area&&t.area!==area)return false;
  if(query&&!(has(t.title)||has(t.notes)||t.comments.some(x=>has(x.text))))return false;
  const d=t.due?taskDays(today,t.due):null;
  if(filter==='open')return taskOpen(t);
  if(filter==='overdue')return taskOpen(t)&&d!=null&&d<0;
  if(filter==='week')return taskOpen(t)&&d!=null&&d<7;
  if(filter==='all')return true;
  return t.status===filter;
 });
 const byDue=(a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||PRIORITY_ORDER[a.priority]-PRIORITY_ORDER[b.priority]||a.createdAt-b.createdAt;
 const byPriority=(a,b)=>PRIORITY_ORDER[a.priority]-PRIORITY_ORDER[b.priority]||byDue(a,b);
 const list=$('task-list');list.replaceChildren();
 $('task-status').textContent=tasks.length?shown.length+(shown.length===1?' tarea':' tareas')+(query||area||filter!=='all'?' con estos filtros':'')+'.':'Todavía no hay tareas. Escribí la primera arriba.';
 if(!shown.length){if(tasks.length)list.append(node('p','No hay tareas con estos filtros.','empty'));return;}
 const groups=[];
 if(order==='date'){
  const open=shown.filter(taskOpen),closed=shown.filter(t=>!taskOpen(t)),d=t=>taskDays(today,t.due);
  groups.push(['Vencidas',open.filter(t=>t.due&&d(t)<0).sort(byDue),'overdue'],['Hoy',open.filter(t=>t.due&&d(t)===0).sort(byDue),'today'],
   ['Próximos 7 días',open.filter(t=>t.due&&d(t)>0&&d(t)<7).sort(byDue)],['Más adelante',open.filter(t=>t.due&&d(t)>=7).sort(byDue)],
   ['Sin fecha',open.filter(t=>!t.due).sort(byPriority)],['Hechas y descartadas',closed.sort((a,b)=>(b.doneAt||b.updatedAt)-(a.doneAt||a.updatedAt))]);
 }else groups.push(['',shown.sort(order==='priority'?byPriority:(a,b)=>b.updatedAt-a.updatedAt)]);
 for(const [title,items,cls] of groups){
  if(!items.length)continue;
  if(title){const h=node('h3','','task-group'+(cls?' '+cls:''));h.append(node('span',title),node('small',String(items.length)));list.append(h);}
  for(const t of items)list.append(taskCard(t));
 }
}
function taskCard(t){
 const card=node('article','','task prio-'+t.priority+' status-'+t.status+(openTasks.has(t.id)?' open':''));
 const row=node('div','','task-row');
 const check=node('button','','task-check');check.type='button';check.title=t.status==='hecha'?'Volver a pendiente':'Marcar como hecha';check.setAttribute('aria-label',check.title);
 check.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8"/></svg>';check.onkeydown=e=>e.stopPropagation();
 check.onclick=async e=>{e.stopPropagation();check.disabled=true;try{await changeTask({kind:'update',id:t.id,fields:{status:t.status==='hecha'?'pendiente':'hecha'}});}catch(err){check.disabled=false;say(errorText(err));}};
 const main=node('div','','task-main');main.append(node('strong',t.title,'task-title'));
 const meta=node('div','','task-meta');
 meta.append(node('span',TASK_STATUS[t.status],'task-pill s-'+t.status),node('span',TASK_PRIORITY[t.priority],'task-prio p-'+t.priority),node('span',TASK_AREAS[t.area]||t.area,'task-chip'));
 const due=dueLabel(t);if(due)meta.append(node('span',due.text,'task-due '+due.cls));
 const said=t.comments.filter(x=>x.kind!=='status').length;if(said)meta.append(node('span','💬 '+said,'task-chip'));
 main.append(meta);
 const arrow=node('span','','task-arrow');arrow.innerHTML='<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
 row.append(check,main,arrow);clickable(row,()=>{if(openTasks.has(t.id))openTasks.delete(t.id);else openTasks.add(t.id);renderTasks();});
 card.append(row);
 if(openTasks.has(t.id))card.append(taskDetail(t));
 return card;
}
function taskDetail(t){
 const box=node('div','','task-detail'),error=node('p','','task-error');error.hidden=true;
 const fail=e=>{error.textContent=errorText(e);error.hidden=false;};
 const field=(label,input)=>{const l=node('label',label);l.append(input);return l;};
 const select=(options,value)=>{const s=document.createElement('select');for(const [v,l] of Object.entries(options)){const o=node('option',l);o.value=v;o.selected=v===value;s.append(o);}return s;};
 const title=document.createElement('input');title.value=t.title;title.maxLength=140;
 const notes=document.createElement('textarea');notes.value=t.notes||'';notes.rows=3;notes.maxLength=3000;notes.placeholder='Detalle';
 const status=select(TASK_STATUS,t.status),priority=select(TASK_PRIORITY,t.priority),area=select(TASK_AREAS,t.area);
 const due=document.createElement('input');due.type='date';due.value=t.due||'';
 const grid=node('div','','task-edit-grid');grid.append(field('Estado',status),field('Prioridad',priority),field('Área',area),field('Fecha',due));
 const save=node('button','Guardar cambios','primary');save.type='button';
 save.onclick=async()=>{save.disabled=true;error.hidden=true;try{await changeTask({kind:'update',id:t.id,fields:{title:title.value,notes:notes.value,status:status.value,priority:priority.value,area:area.value,due:due.value||null}});}catch(e){save.disabled=false;fail(e);}};
 // Deleting asks once more on the same button.
 const del=node('button','Eliminar','danger');del.type='button';let armed=null;
 del.onclick=async()=>{if(!armed){del.textContent='¿Seguro? Tocá de nuevo';armed=setTimeout(()=>{armed=null;del.textContent='Eliminar';},4000);return;}
  clearTimeout(armed);del.disabled=true;try{openTasks.delete(t.id);await changeTask({kind:'delete',id:t.id});}catch(e){del.disabled=false;fail(e);}};
 const actions=node('div','','task-actions');actions.append(save,del);
 box.append(field('Título',title),field('Detalle',notes),grid,actions,error);
 // Comments, oldest first, and a box to add one.
 const thread=node('div','','task-thread');thread.append(node('h4','Comentarios e historial'));
 for(const c of t.comments){
  const line=node('div','','task-comment'+(c.kind==='status'?' is-status':''));
  const head=node('div','','task-comment-head');head.append(node('strong',c.by||'Admin'),node('small',taskWhen(c.at)));
  if(c.kind!=='status'){const x=node('button','Borrar','link-button');x.type='button';x.onclick=async()=>{x.disabled=true;try{await changeTask({kind:'delete-comment',id:t.id,commentId:c.id});}catch(e){x.disabled=false;fail(e);}};head.append(x);}
  line.append(head,node('p',c.text));thread.append(line);
 }
 if(!t.comments.length)thread.append(node('p','Todavía no hay comentarios.','note'));
 const reply=node('div','','task-reply'),text=document.createElement('textarea');text.rows=2;text.maxLength=1500;text.placeholder='Escribí un comentario o avance…';
 const send=node('button','Comentar');send.type='button';
 send.onclick=async()=>{if(!text.value.trim())return;send.disabled=true;try{await changeTask({kind:'comment',id:t.id,text:text.value});}catch(e){send.disabled=false;fail(e);}};
 reply.append(text,send);thread.append(reply);
 box.append(thread,node('p','Creada por '+(t.createdBy||'Admin')+' el '+taskWhen(t.createdAt)+(t.updatedAt!==t.createdAt?' · último cambio '+taskWhen(t.updatedAt):''),'note task-foot'));
 return box;
}
// The new task form: quick dates fill the date field.
for(const [id,first] of [['task-area',false],['task-area-filter',true]])for(const [v,l] of Object.entries(TASK_AREAS)){const o=node('option',l);o.value=v;if(!first&&v==='otros')o.selected=true;$(id).append(o);}
for(const b of $('task-quick').querySelectorAll('[data-days]'))b.onclick=()=>{
 for(const x of $('task-quick').querySelectorAll('[data-days]'))x.classList.toggle('active',x===b);
 $('task-due').value=b.dataset.days===''?'':taskPlus(taskToday(),Number(b.dataset.days));
};
$('task-due').addEventListener('input',()=>{for(const x of $('task-quick').querySelectorAll('[data-days]'))x.classList.toggle('active',x.dataset.days===''&&!$('task-due').value);});
$('task-form').addEventListener('submit',async e=>{
 e.preventDefault();const error=$('task-form-error');error.hidden=true;
 const button=e.submitter||$('task-form').querySelector('[type=submit]');button.disabled=true;
 try{
  await changeTask({kind:'create',fields:{title:$('task-title').value,notes:$('task-notes').value,priority:$('task-priority').value,area:$('task-area').value,due:$('task-due').value||null}});
  $('task-title').value='';$('task-notes').value='';$('task-due').value='';$('task-priority').value='media';
  for(const x of $('task-quick').querySelectorAll('[data-days]'))x.classList.toggle('active',x.dataset.days==='');
  $('task-title').focus();
 }catch(err){error.textContent=errorText(err);error.hidden=false;}
 finally{button.disabled=false;}
});
for(const id of ['task-filter','task-area-filter','task-order'])$(id).addEventListener('change',renderTasks);
$('task-search').addEventListener('input',renderTasks);
// Retention: whether registered players are playing (finished online games), how many and how
// much, for any dates and compared with other dates; below, the time spent per visit.
const AREA_NAMES={inicio:'Pantalla de inicio',lobby:'Lobby',sala:'Sala de espera',partida:'Partida en vivo',bot:'Contra el bot',aprender:'Aprender',anotador:'Anotador',otra:'Otras páginas'};
const PLATFORM_NAMES={'app-android':'App Android','app-ios':'App iPhone','web-android':'Web Android','web-ios':'Web iPhone','web-desktop':'Web computadora'};
const duration=s=>{s=Math.round(Number(s)||0);if(s<60)return s+' s';const m=Math.floor(s/60);if(m<60)return m+' min'+(s%60?' '+(s%60)+' s':'');return Math.floor(m/60)+' h '+(m%60)+' min';};
const share=(n,d)=>d?Math.round(n/d*100)+'%':'—';
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const ret={group:'day',metric:'players',data:null,request:0};
const uyToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plusDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const spanDays=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000)+1;
// The same day n months away (the 31st becomes the month's last day).
const plusMonths=(d,n)=>{const [y,m,day]=d.split('-').map(Number),first=new Date(Date.UTC(y,m-1+n,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,last))).toISOString().slice(0,10);};
const monthEnd=d=>plusDays(plusMonths(d.slice(0,8)+'01',1),-1);
function presetRange(preset,today){
 if(preset==='this-month')return {from:today.slice(0,8)+'01',to:today};
 if(preset==='last-month'){const from=plusMonths(today.slice(0,8)+'01',-1);return {from,to:monthEnd(from)};}
 if(preset==='year')return {from:today.slice(0,5)+'01-01',to:today};
 const n=Number(preset)||30;return {from:plusDays(today,-(n-1)),to:today};
}
// "The period before": a month (or the start of one) compares with the same days of the month
// before; any other range with the same number of days just before it.
function compareRange(kind,{from,to},today){
 const monthly=from.endsWith('-01')&&from.slice(0,7)===to.slice(0,7)&&(to===monthEnd(to)||to===today);
 if(kind==='month'||kind==='previous'&&monthly)return {from:plusMonths(from,-1),to:to===monthEnd(to)?monthEnd(plusMonths(from,-1)):plusMonths(to,-1)};
 if(kind==='previous'){const n=spanDays(from,to);return {from:plusDays(from,-n),to:plusDays(from,-1)};}
 return null;
}
const rangeText=(from,to)=>from===to?longDay(from):'del '+longDay(from)+' al '+longDay(to)+' ('+number(spanDays(from,to))+' días)';
const shortRange=(from,to)=>from===to?shortDay(from):shortDay(from)+' al '+shortDay(to);
function retDates(){
 const today=uyToday();
 for(const id of ['ret-from','ret-to','ret-cfrom','ret-cto'])$(id).max=today;
 if($('ret-preset').value!=='custom'){const r=presetRange($('ret-preset').value,today);$('ret-from').value=r.from;$('ret-to').value=r.to;}
 const kind=$('ret-compare').value,from=$('ret-from').value,to=$('ret-to').value;
 if(kind!=='custom'&&kind!=='none'&&from&&to){const c=compareRange(kind,{from,to},today);$('ret-cfrom').value=c.from;$('ret-cto').value=c.to;}
 for(const id of ['ret-cfrom','ret-cto']){$(id).disabled=kind!=='custom';$(id).closest('label').hidden=kind==='none';}
}
async function loadRetention(){
 retDates();
 const from=$('ret-from').value,to=$('ret-to').value,cfrom=$('ret-cfrom').value,cto=$('ret-cto').value,compare=$('ret-compare').value!=='none';
 if(!from||!to||from>to){$('ret-status').textContent='Elegí un período válido: la fecha "Desde" no puede ser posterior a "Hasta".';return;}
 if(compare&&(!cfrom||!cto||cfrom>cto)){$('ret-status').textContent='Elegí fechas válidas para comparar.';return;}
 const request=++ret.request;$('ret-status').textContent='Cargando…';$('retention').classList.add('loading');
 try{
  const data=(await call({action:'retention',from,to,group:ret.group,...(compare?{compareFrom:cfrom,compareTo:cto}:{})})).data;
  if(request!==ret.request)return;ret.data=data;renderRet();renderTime(data.time,from);
 }catch(e){if(request===ret.request)$('ret-status').textContent='No se pudo cargar'+(GAME==='ar'?' (este juego todavía no lo mide).':': '+errorText(e));}
 finally{if(request===ret.request)$('retention').classList.remove('loading');}
}
const atLeast=(histogram,min)=>Object.entries(histogram||{}).reduce((sum,[n,count])=>Number(n)>=min?sum+count:sum,0);
const ratio=(part,whole)=>whole?part/whole:null;
const pctText=v=>v==null?'—':(Math.round(v*1000)/10).toLocaleString('es-UY')+'%';
// One indicator: its value, what it means and how it changed against the compared dates.
function retKpi(target,label,value,sub,{now=null,before=null,pct=false,lowerIsBetter=false}={}){
 const k=node('div','','kpi');k.append(node('small',label),node('strong',value),node('span',sub,'ret-sub'));
 if(now!=null&&before!=null){
  const d=node('span','','delta');let diff;
  if(pct){diff=Math.round((now-before)*1000)/10;d.textContent=(diff>0?'+':'')+diff.toLocaleString('es-UY')+' puntos (antes '+pctText(before)+')';}
  else if(!before){diff=now;d.textContent=now?'Antes: 0':'Igual que antes (0)';}
  else{diff=Math.round((now-before)/before*100);d.textContent=(diff>0?'+':'')+diff+'% (antes '+number(before)+')';}
  if(diff)d.classList.add((diff>0)!==lowerIsBetter?'up':'down');
  k.append(d);
 }
 $(target).append(k);
}
function renderRet(){
 const data=ret.data;if(!data)return;
 const min=Number($('ret-min').value)||1,m=data.main,c=data.compare;
 $('ret-status').textContent='Mostrando '+rangeText(m.from,m.to)+(c?' · comparado con '+rangeText(c.from,c.to):'');
 // Indicators: how many play, and whether they keep playing.
 $('ret-kpis-play').replaceChildren();$('ret-kpis-keep').replaceChildren();
 const players=atLeast(m.histogram,min),cPlayers=c&&atLeast(c.histogram,min),any=atLeast(m.histogram,1),cAny=c&&atLeast(c.histogram,1);
 retKpi('ret-kpis-play',min>1?'Jugaron '+min+' partidas o más':'Jugaron',number(players),pctText(ratio(players,m.registered))+' de los '+number(m.registered)+' registrados'+(c?' (antes '+pctText(ratio(cPlayers,c.registered))+')':''),{now:players,before:c?cPlayers:null});
 retKpi('ret-kpis-play','Partidas terminadas',number(m.games),number(m.vsPeople)+' contra personas · '+number(m.vsBots)+' con bots',{now:m.games,before:c?c.games:null});
 const perPlayer=any?Math.round(m.plays/any*10)/10:null;
 retKpi('ret-kpis-play','Partidas por jugador',perPlayer==null?'—':perPlayer.toLocaleString('es-UY'),'Promedio de los que jugaron',{now:perPlayer,before:c&&cAny?Math.round(c.plays/cAny*10)/10:null});
 retKpi('ret-kpis-play','Juegan más de un día',pctText(ratio(m.severalDays,any)),number(m.severalDays)+' de '+number(any)+' jugaron en 2 días distintos o más',{now:ratio(m.severalDays,any),before:c?ratio(c.severalDays,cAny):null,pct:true});
 retKpi('ret-kpis-keep','Siguen jugando',pctText(ratio(m.previous.kept,m.previous.players)),number(m.previous.kept)+' de los '+number(m.previous.players)+' que jugaron los '+number(m.days)+' días anteriores',{now:ratio(m.previous.kept,m.previous.players),before:c?ratio(c.previous.kept,c.previous.players):null,pct:true});
 retKpi('ret-kpis-keep','Dejaron de jugar',number(m.previous.players-m.previous.kept),'Jugaron los '+number(m.days)+' días anteriores y en estas fechas no',{now:m.previous.players-m.previous.kept,before:c?c.previous.players-c.previous.kept:null,lowerIsBetter:true});
 retKpi('ret-kpis-keep','Cuentas nuevas que jugaron',pctText(ratio(m.newPlayed,m.newAccounts)),number(m.newPlayed)+' de '+number(m.newAccounts)+' cuentas creadas en estas fechas',{now:ratio(m.newPlayed,m.newAccounts),before:c?ratio(c.newPlayed,c.newAccounts):null,pct:true});
 if(m.entry)retKpi('ret-kpis-keep','Entraron y no jugaron',number(m.entry.withoutPlaying),'De '+number(m.entry.entered)+' registrados que abrieron el juego'+(m.entry.partial?' (datos desde el '+shortDay(data.entryFrom)+')':''),{now:m.entry.withoutPlaying,before:c?.entry&&!c.entry.partial?c.entry.withoutPlaying:null,lowerIsBetter:true});
 else retKpi('ret-kpis-keep','Entraron y no jugaron','—','Se guarda solo para los últimos 90 días');
 renderRetChart();
 // How much each registered player played.
 const between=(a,b)=>atLeast(m.histogram,a)-atLeast(m.histogram,b+1);
 bars($('ret-histogram'),[
  {label:'No jugaron',value:m.registered-any,color:'#ffffff33'},{label:'1 partida',value:between(1,1)},{label:'2 a 4 partidas',value:between(2,4)},
  {label:'5 a 9 partidas',value:between(5,9)},{label:'10 a 19 partidas',value:between(10,19)},{label:'20 o más',value:atLeast(m.histogram,20)}
 ],{total:m.registered});
 $('ret-histogram-note').textContent='Sobre los '+number(m.registered)+' registrados al '+shortDay(m.to)+'.'+(c?' Entre el '+shortRange(c.from,c.to)+' jugó al menos una partida el '+pctText(ratio(cAny,c.registered))+' de los '+number(c.registered)+' registrados de entonces.':'');
 // Who kept playing, who is new, who came back and who stopped, against the same number of days just before.
 const p=m.previous,back=Math.max(0,any-p.kept-m.newPlayed);
 bars($('ret-flow'),[
  {label:'Siguieron jugando',value:p.kept,color:'var(--green)'},{label:'Cuentas nuevas que jugaron',value:m.newPlayed,color:'var(--gold)'},
  {label:'Volvieron a jugar',value:back,color:'var(--web-android)'},{label:'Dejaron de jugar',value:p.players-p.kept,color:'var(--red)'}
 ]);
 $('ret-flow-note').textContent='Jugadores del '+shortRange(m.from,m.to)+' contra los del '+shortRange(p.from,p.to)+'. "Volvieron": cuentas anteriores que no jugaron esos días y ahora sí. "Dejaron": jugaron esos días y ahora no.';
 renderCohorts();
 // Lists, with a link to each player's account.
 const who=uid=>{const b=node('button',data.names?.[uid]||'Sin nombre','link-button');b.type='button';b.onclick=()=>{$('search').value=data.names?.[uid]||uid;showTab('users');renderUsers();};return b;};
 const table=(headers,rows)=>{const wrap=node('div','','table-scroll'),t=node('table','','data-table'),head=node('tr');head.append(...headers.map(h=>node('th',h)));t.append(head);for(const cells of rows){const tr=node('tr');for(const cell of cells){const td=node('td',typeof cell==='string'?cell:'');if(typeof cell!=='string')td.append(cell);tr.append(td);}t.append(tr);}wrap.append(t);return wrap;};
 $('ret-top').replaceChildren(m.top.length?table(['Jugador','Partidas','Días que jugó','Última'],m.top.map(r=>[who(r.uid),number(r.games),number(r.days),shortDay(r.last)])):node('p','Nadie terminó una partida en estas fechas.','empty'));
 $('ret-stopped-note').textContent='Jugaron entre el '+shortRange(p.from,p.to)+' y no terminaron ninguna partida entre el '+shortRange(m.from,m.to)+'.';
 $('ret-stopped').replaceChildren(m.stopped.length?table(['Jugador','Partidas antes','Última partida'],m.stopped.map(r=>[who(r.uid),number(r.games),shortDay(r.last)])):node('p','Nadie dejó de jugar.','empty'));
}
const groupLabel=(s,group,long=false)=>group==='month'?(long?MONTHS[Number(s.from.slice(5,7))-1]+' '+s.from.slice(0,4):MONTHS[Number(s.from.slice(5,7))-1].slice(0,3)):group==='week'?(long?'Semana del '+shortRange(s.from,s.to):shortDay(s.from)):long?longDay(s.from):shortDay(s.from);
// Bars for the dates shown and a dashed line for the compared ones (lined up by position).
function renderRetChart(){
 const data=ret.data;if(!data)return;
 const min=Number($('ret-min').value)||1,group=data.group,metric=ret.metric;
 const valueOf=s=>metric==='games'?s.games:metric==='accounts'?s.newAccounts:atLeast(s.histogram,min);
 const unit=metric==='games'?'partidas':metric==='accounts'?'cuentas nuevas':'jugadores';
 $('ret-chart-title').textContent=(metric==='games'?'Partidas terminadas':metric==='accounts'?'Cuentas nuevas':min>1?'Registrados que jugaron '+min+' partidas o más':'Registrados que jugaron')+' por '+(group==='month'?'mes':group==='week'?'semana':'día');
 const cur=data.main.series,prev=data.compare?.series||[],box=$('ret-chart');
 const values=cur.map(valueOf),before=prev.map(valueOf);
 if(!values.some(Boolean)&&!before.some(Boolean)){box.replaceChildren(node('p','Todavía no hay datos para estas fechas.','empty'));$('ret-legend').replaceChildren();return;}
 const W=Math.max(320,box.clientWidth||800),H=240,left=34,right=8,top=18,bottom=24,plotW=W-left-right,plotH=H-top-bottom,n=cur.length;
 const raw=Math.max(1,...values,...before.slice(0,n)),quarter=raw/4,scale=Math.pow(10,Math.floor(Math.log10(quarter))),tick=Math.max(1,[1,1.5,2,2.5,3,4,5,6,8,10].map(f=>Math.round(f*scale*1000)/1000).find(v=>v>=quarter&&Number.isInteger(v))||Math.ceil(quarter));
 const max=tick*4,x=i=>left+plotW*(i+.5)/n,y=v=>top+plotH*(1-v/max),bw=Math.max(2,Math.min(42,plotW/n*.64));
 const ns='http://www.w3.org/2000/svg',el=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!=null)e.textContent=text;return e;};
 const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':$('ret-chart-title').textContent});
 for(let t=0;t<=4;t++){const v=tick*t,yy=y(v);svg.append(el('line',{x1:left,x2:W-right,y1:yy,y2:yy,stroke:'#ffffff14'}),el('text',{x:left-6,y:yy+4,'text-anchor':'end','font-size':11,fill:'#9db3a7'},v.toLocaleString('es-UY')));}
 const every=Math.ceil(n/12);
 cur.forEach((s,i)=>{
  const g=el('g',{}),v=values[i],h=Math.max(v?2:0,plotH*v/max);
  const tip=groupLabel(s,group,true)+': '+number(v)+' '+unit+(prev[i]?'\n'+groupLabel(prev[i],group,true)+': '+number(before[i])+' '+unit:'');
  g.append(el('title',{},tip),el('rect',{x:x(i)-plotW/n/2,y:top,width:plotW/n,height:plotH,fill:'transparent'}),el('rect',{x:x(i)-bw/2,y:top+plotH-h,width:bw,height:h,rx:Math.min(3,bw/2),fill:'#e8c983'}));
  if(v&&n<=31)g.append(el('text',{x:x(i),y:top+plotH-h-4,'text-anchor':'middle','font-size':10,fill:'#eef2ea'},number(v)));
  if(i%every===0)g.append(el('text',{x:x(i),y:H-6,'text-anchor':'middle','font-size':11,fill:'#9db3a7'},groupLabel(s,group)));
  svg.append(g);
 });
 const points=before.slice(0,n).map((v,i)=>[x(i),y(v)]);
 if(points.length){svg.append(el('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#6fb7e8','stroke-width':2,'stroke-dasharray':'5 4','pointer-events':'none'}));for(const [px,py] of points)svg.append(el('circle',{cx:px,cy:py,r:2.5,fill:'#6fb7e8','pointer-events':'none'}));}
 box.replaceChildren(svg);
 const legend=[],item=(cls,text)=>{const s=node('span',text);s.prepend(node('i','',cls));legend.push(s);};
 item('bar',shortRange(data.main.from,data.main.to));
 if(data.compare)item('line','Comparado: '+shortRange(data.compare.from,data.compare.to)+(prev.length!==n?' (tiene otra cantidad de '+(group==='month'?'meses':group==='week'?'semanas':'días')+')':''));
 $('ret-legend').replaceChildren(...legend);
}
// Sign-up groups: share of each group that finished a game in its 1st, 2nd… week (or 30 days).
function renderCohorts(){
 const {span,columns,rows}=ret.data.cohorts,monthly=span===30,box=$('ret-cohorts');
 $('ret-cohort-note').textContent='Cada fila son las cuentas creadas '+(monthly?'ese mes':'esa semana')+' dentro de las fechas elegidas. Cada columna muestra qué porcentaje terminó al menos una partida en su '+(monthly?'1º, 2º… período de 30 días':'1ª, 2ª… semana')+' desde que creó la cuenta (la primera incluye el día en que la creó). Con * todavía no terminó para todos.';
 if(!rows.length){box.replaceChildren(node('p','No se crearon cuentas en estas fechas.','empty'));return;}
 const wrap=node('div','','table-scroll'),t=node('table','','data-table ret-cohorts'),head=node('tr');
 head.append(node('th',monthly?'Mes en que crearon la cuenta':'Semana en que crearon la cuenta'),node('th','Cuentas'),...Array.from({length:columns},(_,k)=>node('th',monthly?'Mes '+(k+1):'Sem. '+(k+1))));t.append(head);
 for(const r of rows){
  const tr=node('tr');tr.append(node('td',monthly?groupLabel(r,'month',true).replace(/^./,ch=>ch.toUpperCase()):'Semana del '+shortDay(r.from)),node('td',number(r.size)));
  for(let k=0;k<columns;k++){
   const cell=r.cells[k],td=node('td',cell?share(cell.played,cell.players)+(cell.complete?'':'*'):'');
   if(cell){const v=cell.players?cell.played/cell.players:0;td.style.background='rgba(232,201,131,'+(0.05+v*0.55).toFixed(2)+')';td.title=cell.played+' de '+cell.players+(cell.complete?'':' (todavía en curso)');if(!cell.complete)td.classList.add('partial');}
   tr.append(td);
  }
  t.append(tr);
 }
 wrap.append(t);box.replaceChildren(wrap);
}
// Time spent per visit, for the same dates (visits are kept for 90 days).
function renderTime(time,from){
 if(!time){for(const id of ['retention-kpis','retention-daily','retention-buckets','retention-areas','retention-platforms','retention-accounts'])$(id).replaceChildren();$('retention-status').textContent='No hay visitas medidas en estas fechas: se guardan los últimos 90 días.';return;}
 $('retention-status').textContent='Visitas '+rangeText(time.from,time.to)+(time.from>from?' (las visitas se guardan los últimos 90 días)':'')+(time.sessions?'':' · Todavía no hay visitas medidas en estas fechas.');
 const kpis=$('retention-kpis');kpis.replaceChildren();
 const kpi=(label,value,note)=>{const k=node('div','','kpi');k.append(node('small',label),node('strong',value),node('span',note||'','delta'));kpis.append(k);};
 const quick=time.buckets.find(b=>b.id==='lt1')?.count||0;
 kpi('Visitas',number(time.sessions),'Cada vez que abren la app o la página');
 kpi('Tiempo promedio',duration(time.average),'Por visita');
 kpi('Tiempo total',duration(time.seconds),'Sumando todas las visitas');
 kpi('Se van en menos de 1 min',share(quick,time.sessions),number(quick)+' visitas');
 columns($('retention-daily'),time.days.map(day=>{const d=time.daily[day]||{};return {label:shortDay(day),value:Math.round((d.average||0)/6)/10,tooltip:shortDay(day)+' · '+duration(d.average)+' promedio · '+number(d.sessions)+' visitas'};}),{labelEvery:Math.ceil(time.days.length/15)});
 bars($('retention-buckets'),time.buckets.map(b=>({label:b.label,value:b.count,color:b.id==='lt1'?'var(--red)':undefined})));
 bars($('retention-areas'),Object.entries(time.areas).sort((a,b)=>b[1]-a[1]).map(([area,secs])=>({label:AREA_NAMES[area]||area,value:Math.round(secs/60)})));
 const rows=(entries,names)=>entries.sort((a,b)=>b[1].n-a[1].n).map(([key,v])=>[names[key]||key,number(v.n),duration(v.n?v.t/v.n:0)]);
 $('retention-platforms').replaceChildren(time.sessions?simpleTable(['Dispositivo','Visitas','Tiempo promedio'],rows(Object.entries(time.platforms),PLATFORM_NAMES)):node('p','Todavía no hay visitas medidas.','empty'));
 $('retention-accounts').replaceChildren(time.sessions?simpleTable(['','Visitas','Tiempo promedio'],rows(Object.entries(time.accounts).filter(([,v])=>v.n),{signed:'Con cuenta',guest:'Sin cuenta'})):node('p','Todavía no hay visitas medidas.','empty'));
}
$('ret-preset').addEventListener('change',loadRetention);
for(const id of ['ret-from','ret-to'])$(id).addEventListener('change',()=>{$('ret-preset').value='custom';loadRetention();});
for(const id of ['ret-compare','ret-cfrom','ret-cto'])$(id).addEventListener('change',loadRetention);
$('ret-min').addEventListener('change',renderRet);
for(const button of $('ret-group').querySelectorAll('[data-group]'))button.addEventListener('click',()=>{
 if(ret.group===button.dataset.group)return;ret.group=button.dataset.group;
 for(const b of $('ret-group').querySelectorAll('[data-group]'))b.classList.toggle('active',b===button);loadRetention();
});
for(const button of $('ret-metric').querySelectorAll('[data-metric]'))button.addEventListener('click',()=>{
 ret.metric=button.dataset.metric;for(const b of $('ret-metric').querySelectorAll('[data-metric]'))b.classList.toggle('active',b===button);renderRetChart();
});
{let resize;addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(()=>{if(!$('retention').hidden)renderRetChart();},150);});}
let chatLog=[],chatGroups=[],chatRequest=0;
async function loadChat(){
 const request=++chatRequest;$('chat-summary').textContent='Cargando…';
 try{const data=(await call({action:'chat-log',days:Number($('chat-days').value)})).data;if(request!==chatRequest)return;chatLog=data.messages||[];chatGroups=data.groups||[];renderChat();}
 catch(e){if(request===chatRequest){chatLog=[];chatGroups=[];$('chat-list').replaceChildren();$('chat-summary').textContent='No se pudo cargar el chat'+(GAME==='ar'?' (este juego todavía no lo guarda).':'.');}}
}
// One card per table: its players (also the ones who never wrote) and its chat, in order.
function renderChat(){
 const query=$('chat-search').value.trim().toLocaleLowerCase(),has=v=>String(v||'').toLocaleLowerCase().includes(query);
 const all=chatGroups.length?chatGroups:chatLog.length?[{key:'all',code:'',mode:'',players:[],messages:[...chatLog].reverse(),lastAt:chatLog[0].at,games:1}]:[];
 const groups=all.filter(g=>!query||has(g.code)||g.players.some(p=>has(p.name))||g.messages.some(m=>has(m.name)||has(m.text)));
 const total=groups.reduce((n,g)=>n+g.messages.length,0);
 $('chat-summary').textContent=groups.length?groups.length+(groups.length===1?' mesa':' mesas')+' · '+total+(total===1?' mensaje':' mensajes')+(query?' que coinciden con la búsqueda':''):(query?'Ninguna mesa coincide con la búsqueda.':'Todavía no hay mensajes escritos en este período.');
 const time=at=>new Date(at).toLocaleTimeString('es-UY',{timeZone:ZONE,hour:'2-digit',minute:'2-digit'});
 const date=at=>new Date(at).toLocaleDateString('es-UY',{timeZone:ZONE,weekday:'short',day:'numeric',month:'short'});
 const toUser=(name,uid)=>{$('search').value=name||uid;showTab('users');renderUsers();};
 const box=$('chat-list');box.replaceChildren();
 for(const g of groups){
  const card=node('article','','chat-table'),head=node('div','','chat-table-head');
  const first=g.messages[0]?.at,last=g.lastAt;
  head.append(node('strong',g.code?'Mesa '+g.code:'Mensajes'),node('span',(g.mode==='2v2'?'2 vs 2':g.mode==='1v1'?'1 vs 1':'')+(g.games>1?' · '+g.games+' partidas':'')),node('small',date(first)+' · '+time(first)+(last!==first?' a '+time(last):'')));
  const people=node('div','','chat-table-people');
  for(const p of g.players){const chip=node('button',(p.name||'Sin nombre')+(p.bot?' (bot)':''),'chat-person'+(p.wrote?' wrote':'')+(p.bot?' bot':''));chip.type='button';chip.title=p.wrote?'Escribió en esta mesa':'No escribió';if(p.bot)chip.disabled=true;else chip.onclick=()=>toUser(p.name,p.uid);people.append(chip);}
  const log=node('div','','chat-table-log');
  for(const m of g.messages){const row=node('div','','chat-line'),who=node('button',m.name||'Sin nombre','chat-who');who.type='button';who.onclick=()=>toUser(m.name,m.uid);row.append(node('time',time(m.at)),who,node('span',m.text,'chat-text'));log.append(row);}
  card.append(head,people,log);box.append(card);
 }
}
$('chat-days').addEventListener('change',loadChat);
$('chat-search').addEventListener('input',renderChat);
async function loadMessages(){
 try{threads=(await call({action:'messages'})).data.threads||[];}catch(e){return;}
 const unread=threads.reduce((n,t)=>n+t.unread,0);$('messages-count').hidden=!unread;$('messages-count').textContent=unread||'';
 renderThreads();
}
function renderThreads(){
 peopleList();const box=$('message-threads');box.replaceChildren();
 if(!threads.length){box.append(node('p','Todavía no le escribiste a ningún jugador.','empty'));return;}
 for(const t of threads){
  const card=node('details','','card thread');card.open=openThreads.has(t.uid);
  const summary=node('summary','','thread-head');summary.append(node('strong',t.name||t.uid));
  if(t.unread)summary.append(node('span',t.unread+(t.unread===1?' respuesta nueva':' respuestas nuevas'),'badge'));
  summary.append(node('small',formatTableTime(t.lastAt)));card.append(summary);
  // Opening a conversation marks the player's answers as seen.
  card.addEventListener('toggle',()=>{if(card.open){openThreads.add(t.uid);if(t.unread){t.unread=0;call({action:'messages-seen',uid:t.uid}).then(loadMessages).catch(()=>{});}}else openThreads.delete(t.uid);});
  const log=node('div','','thread-log');
  for(const m of t.messages){const bubble=node('div','',m.from==='admin'?'bubble mine':'bubble theirs');bubble.append(node('p',m.text),node('small',(m.from==='admin'?'Vos':t.name||'Jugador')+' · '+formatTableTime(m.at)+(m.from==='admin'?(m.readAt?' · Leído':' · Sin leer'):'')));log.append(bubble);}
  const form=node('form','','thread-reply'),field=node('textarea','');field.maxLength=800;field.rows=2;field.placeholder='Responder a '+(t.name||'este jugador');field.required=true;
  const send=node('button','Enviar','primary');send.type='submit';const error=node('p','','thread-error');
  form.append(field,send,error);
  form.onsubmit=async event=>{event.preventDefault();send.disabled=true;error.textContent='';try{await call({action:'send-message',uid:t.uid,text:field.value});field.value='';openThreads.add(t.uid);await loadMessages();}catch(e){error.textContent=errorText(e);}finally{send.disabled=false;}};
  card.append(log,form);box.append(card);
 }
}
$('message-form').onsubmit=async event=>{
 event.preventDefault();const name=$('message-to').value.trim().toLocaleLowerCase('es');
 const matches=users.filter(u=>(u.name||'').toLocaleLowerCase('es')===name);
 if(matches.length!==1){$('message-error').textContent=matches.length?'Hay más de un jugador con ese nombre.':'Elegí un jugador de la lista.';return;}
 $('message-send').disabled=true;$('message-error').textContent='';
 try{await call({action:'send-message',uid:matches[0].uid,text:$('message-text').value});$('message-text').value='';$('message-to').value='';openThreads.add(matches[0].uid);await loadMessages();say('Mensaje enviado a '+matches[0].name+'.');}
 catch(e){$('message-error').textContent=errorText(e);}
 finally{$('message-send').disabled=false;}
};
// Each game loads as the default Firebase app of the page. Its session is saved under its
// own key in this browser, so switching reloads the page but signs in only once per game.
// (A second, named app in the same page never finished the Google popup sign-in.)
// Truco Argentino has its own panel on trucoargentino.net: signing in to another
// project from this domain fails on iPhone and in some browsers.
function useGame(game){if(game==='ar')location.href='https://trucoargentino.net/admin.html';}
if(GAME==='ar')location.replace('https://trucoargentino.net/admin.html');
async function start(){
 try{
  let config=GAMES[GAME].config;
  if(!config)try{config=(await import('./firebase-config.js')).firebaseConfig;}catch{config=JSON.parse(localStorage.getItem('truco-firebase-config')||'null');}
  if(!config)throw new Error('Abrí el juego primero para cargar su configuración.');
  auth=getAuth(initializeApp(config));call=httpsCallable(getFunctions(auth.app,'us-central1'),'adminConsole');
  await setPersistence(auth,browserLocalPersistence);
  $('login').onclick=async()=>{try{await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){$('access-status').textContent=errorText(e);}};
  $('logout').onclick=$('switch-account').onclick=()=>signOut(auth);
  onAuthStateChanged(auth,showSession);
 }catch(e){$('access-status').textContent=errorText(e);}
}
async function showSession(user){
 const generation=++epoch;pagesLoaded=1;userScope='all';$('user-scope').value='all';clearInterval(metricsTimer);metricsTimer=null;metrics=null;users=[];avatars.clear();pageToken=null;$('console').hidden=true;$('access').hidden=false;$('logout').hidden=!user;$('switch-account').hidden=!user;$('login').hidden=!!user;
 $('identity').textContent=user?'Tu UID: '+user.uid:'';$('access-status').textContent=user?'Verificando permisos…':'Iniciá sesión con tu cuenta administradora.';
 if(!user)return;
 try{const result=await call({action:'users'});if(generation!==epoch)return;users=result.data.users;pageToken=result.data.pageToken;$('access').hidden=true;$('console').hidden=false;renderUsers();await refresh();}
  // No automatic refresh: each one read the whole credit bank (Cloudflare bills rows read).
  // The panel updates when it opens and with the Actualizar button.

 catch(e){if(generation===epoch)$('access-status').textContent=errorText(e);}
}
start();
