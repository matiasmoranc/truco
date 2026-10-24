import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,onAuthStateChanged,GoogleAuthProvider,signInWithPopup,signOut,browserLocalPersistence,setPersistence} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
const $=id=>document.getElementById(id);
let auth,call,users=[],pageToken=null,selection=null,busy=false,epoch=0,metrics=null,metricsBusy=false,metricsTimer=null,pagesLoaded=1,userScope='all',tableData={tables:[],archivedTables:[]};
function say(message){$('status').textContent=message;}
const number=value=>new Intl.NumberFormat('es-UY').format(Number(value)||0);
const PLATFORM_LABELS={'app-ios':'App iPhone','app-android':'App Android','web-ios':'Web iPhone','web-android':'Web Android','web-desktop':'Web computadora'};
const PAGE_LABELS={juego:'Juego',anotador:'Anotador',aprender:'Aprender a jugar',otra:'Reglas y otras'};
const TAB_TITLES={metrics:'Resumen',visits:'Visitas',users:'Usuarios y créditos',tables:'Mesas y partidas',reports:'Problemas reportados',audit:'Historial de cambios'};
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
  const card=node('details','','user-card');card.dataset.uid=u.uid;card.open=expanded.has(u.uid);
  const online=metrics?.online.includes(u.uid);
  const state=node('span','',u.disabled?'state blocked':online?'state online':'state');state.append(node('i'),document.createTextNode(u.disabled?'Bloqueado':online?'Jugando':'Desconectado'));
  const summary=node('summary','','user-row');
  summary.append(node('span',u.name||'Sin nombre','user-name'),node('span',u.email||'Sin correo','user-mail'),node('strong',number(u.balance),'num'),node('span',number(u.locked),'num reserved'),state,node('span',new Date(u.createdAt).toLocaleDateString('es-UY'),'joined'));card.append(summary);
  const detail=node('div','','user-detail');detail.append(node('small','UID: '+u.uid),node('small','Correo: '+(u.email||'Sin correo')),node('small','Saldo '+number(u.balance)+' · '+number(u.locked)+' reservados · Registro '+new Date(u.createdAt).toLocaleDateString('es-UY')));card.append(detail);
  const movements=node('details');movements.append(node('summary','Movimientos de créditos'));
  for(const e of Object.values(tableData.movements?.[u.uid]||{}).sort((a,b)=>b.at-a.at))movements.append(node('p',formatTableTime(e.at)+': saldo '+e.before+' → '+e.after+' · reservados '+e.reservedBefore+' → '+e.reservedAfter));detail.append(movements);
  const actions=node('div','','actions');actions.append(button('Editar créditos',()=>openEdit('credits',u)),button('Cambiar nombre',()=>openEdit('rename',u)),button(u.disabled?'Desbloquear':'Bloquear',()=>openEdit('block',u)),button('Eliminar usuario',()=>openEdit('delete',u)));detail.append(actions);$('user-list').append(card);
 }
 if(!$('user-list').children.length)$('user-list').append(node('p','No hay usuarios para mostrar.','empty'));
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
  if(!data.reports?.length)$('reports-list').append(node('p','No hay problemas reportados.','empty'));
  $('reports-count').hidden=!data.reports?.length;$('reports-count').textContent=data.reports?.length||'';
  $('kpi-tables').textContent=number(data.tables?.length||0);$('kpi-tables-note').textContent=(data.alerts?.length?data.alerts.length+' reservas por revisar':'En curso o esperando rival');
  $('audit-list').replaceChildren();for(const a of data.audit){
   const card=node('article','','card');card.append(node('h3',a.action),node('p',a.reason),node('p',a.uid||a.code||''),node('small',new Date(a.at).toLocaleString('es-UY')),node('small','Administrador: '+a.actor));
   if(a.before!==undefined)card.append(node('p',String(a.before)+' → '+String(a.after)));$('audit-list').append(card);
  }await refreshMetrics();say('');
  $('updated').textContent='Actualizado '+new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
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
$('search').addEventListener('input',renderUsers);$('more').onclick=()=>refresh(true);
function showTab(name){for(const section of Object.keys(TAB_TITLES))$(section).hidden=section!==name;for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab.dataset.tab===name);$('page-title').textContent=TAB_TITLES[name];}
$('refresh').onclick=()=>refresh(false,true);
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
  if(showValues)col.append(node('span',totals[i]?number(totals[i]):'','val'));
  const stack=node('div','','stack');stack.style.height=(totals[i]/maximum*100)+'%';
  for(const s of item.segments||[{value:item.value}]){if(!s.value)continue;const seg=node('div','','seg');seg.style.height=(s.value/(totals[i]||1)*100)+'%';if(s.key)seg.style.background='var(--'+s.key+')';stack.append(seg);}
  col.append(stack,node('span',i%labelEvery===0?item.label:'','lbl'));target.append(col);
 });
}
// Anything that opens more detail behaves like a button (mouse, touch and keyboard).
function clickable(el,onClick){
 if(!onClick)return el;
 el.classList.add('clickable');el.tabIndex=0;el.setAttribute('role','button');el.onclick=onClick;
 el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}};
 return el;
}
function bars(target,rows){
 target.replaceChildren();
 const total=rows.reduce((sum,r)=>sum+r.value,0);
 if(!total){target.append(node('p','Todavía no hay visitas registradas.','empty'));return;}
 const maximum=Math.max(...rows.map(r=>r.value));
 for(const r of rows){
  const row=node('div','','pbar'),name=node('span',r.label);clickable(row,r.onClick);
  if(r.color){const swatch=node('i','','swatch');swatch.style.background=r.color;name.prepend(swatch);}
  const track=node('div','','track'),fill=node('div','','fill');fill.style.width=(r.value/maximum*100)+'%';fill.style.background=r.color||'var(--gold)';track.append(fill);
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
const visitTime=at=>new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
let visitDetail=null,visitDetailRequest=0,visitGrouped=false;
// Opens the Visits section on one day or the current period, with a platform or page detail.
function goVisits({day=null,platform='all',page=null,measure=null}={}){
 showTab('visits');
 if(measure)$('visit-measure').value=measure;
 if(day){const today=metrics?.today;if(day===today)$('visit-range').value='today';else if(day===addDays(today,-1))$('visit-range').value='yesterday';else{$('visit-range').value='custom';$('visit-from').value=day;$('visit-to').value=day;}}
 visitDetail=null;renderVisits();openVisitDetail(platform,{page});
}
// The selected period as Uruguay days, clamped to the stored history.
function visitPeriod(){
 const today=metrics?.today||new Date(Date.now()-10800000).toISOString().slice(0,10),oldest=addDays(today,-89),choice=$('visit-range').value;
 const custom=choice==='custom';for(const field of document.querySelectorAll('.date-field'))field.hidden=!custom;
 for(const id of ['visit-from','visit-to']){$(id).min=oldest;$(id).max=today;}
 let from,to=today;
 if(choice==='today')from=today;
 else if(choice==='yesterday')from=to=addDays(today,-1);
 else if(custom){
  if(!$('visit-from').value)$('visit-from').value=addDays(today,-6);if(!$('visit-to').value)$('visit-to').value=today;
  from=$('visit-from').value;to=$('visit-to').value;
  if(from>to)[from,to]=[to,from];
 }else from=addDays(today,-(Number(choice)-1));
 if(from<oldest)from=oldest;if(to>today)to=today;
 return {from,to};
}
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
  k.classList.toggle('selected',visitDetail?.platform===key);
  k.append(title,node('strong',number(value)),node('span','Ver quién entró','delta'));k.onclick=()=>openVisitDetail(key);$('visit-totals').append(k);
 };
 card('all','Total '+unit,grand);for(const [key,label] of Object.entries(PLATFORM_LABELS))card(key,label,sum(key),'var(--'+key+')');
 bars($('visit-pages'),Object.entries(PAGE_LABELS).map(([key,label])=>({label,value:days.reduce((total,d)=>total+(d.pages?.[key]||0),0),onClick:()=>openVisitDetail('all',{page:key})})).sort((a,b)=>b.value-a.value));
 const hours=Array.from({length:24},(_,h)=>days.reduce((total,d)=>total+(d.hours?.[h]||0),0));
 columns($('visit-hours'),hours.map((value,h)=>({label:String(h).padStart(2,'0'),value,tooltip:String(h).padStart(2,'0')+':00 · '+value+' visitas'})),{labelEvery:3});
 const table=$('visit-table');table.replaceChildren();
 const head=node('tr');head.append(node('th','Día'),...Object.values(PLATFORM_LABELS).map(label=>node('th',label)),node('th','Total','total'));table.append(head);
 for(const d of [...days].reverse()){
  const row=clickable(node('tr'),()=>goVisits({day:d.day}));row.title='Ver quién entró ese día';row.append(node('td',longDay(d.day)));
  for(const key of Object.keys(PLATFORM_LABELS)){const value=d[measure][key]||0;row.append(node('td',number(value),value?'':'zero'));}
  row.append(node('td',number(d[totalKey]),'total'));table.append(row);
 }
 if(visitDetail&&(visitDetail.from!==from||visitDetail.to!==to))openVisitDetail(visitDetail.platform,{page:visitDetail.page});
}
function simpleTable(headers,rows){
 const wrap=node('div','','table-scroll'),table=node('table','','data-table'),head=node('tr');
 head.append(...headers.map(h=>node('th',h)));table.append(head);
 for(const cells of rows){const row=node('tr');for(const cell of cells)row.append(node('td',cell));table.append(row);}
 wrap.append(table);return wrap;
}
// Who came through one platform or page (or all) in the selected period.
async function openVisitDetail(platform,{page=null}={}){
 const {from,to}=visitPeriod(),request=++visitDetailRequest;
 visitDetail={platform,from,to,page};
 for(const k of $('visit-totals').children)k.classList.toggle('selected',!page&&k.dataset.platform===platform);
 const label=page?'Página: '+PAGE_LABELS[page]:platform==='all'?'Todas las plataformas':PLATFORM_LABELS[platform];
 $('visit-detail').hidden=false;$('visit-detail-title').textContent=label+' · '+(from===to?longDay(from):shortDay(from)+' al '+shortDay(to));
 $('visit-detail-body').replaceChildren(node('p','Cargando…','empty'));
 $('visit-detail').scrollIntoView({behavior:'smooth',block:'start'});
 let data;
 try{data=(await call({action:'visitors',from,to,platform,...(page?{page}:{})})).data;}
 catch(e){if(request===visitDetailRequest)$('visit-detail-body').replaceChildren(node('p',errorText(e),'empty'));return;}
 if(request!==visitDetailRequest)return;
 renderVisitDetail(data,platform);
}
function renderVisitDetail(data,platform){
 const body=$('visit-detail-body');body.replaceChildren();
 const names=new Map(data.players.map(p=>[p.uid,p.name||'Jugador sin nombre']));
 const withVisits=data.players.filter(p=>p.visits).length;
 // In words: how many visits came from players and how many from people without a session.
 body.append(node('p',number(data.totalVisits)+' visitas: '+number(data.signedVisits||0)+' de '+number(withVisits)+(withVisits===1?' jugador':' jugadores')+' con sesión · '+number(data.anonymousVisits||0)+' sin sesión'+(data.anonymousVisits?' (de unos '+number(Math.max(1,data.anonymousDevices||0))+' dispositivos)':'')+'.','detail-summary'));
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
  visits.append(simpleTable(headers,rows.map(({v,count})=>[visitTime(v.at),typeof v.uid==='string'?names.get(v.uid)||'Jugador':'Sin sesión',...(visitGrouped?[String(count)]:[]),...(platform==='all'?[PLATFORM_LABELS[v.platform]||v.platform]:[]),PAGE_LABELS[v.page]||v.page,v.os+(v.model?' · '+v.model:''),v.browser,v.origin||'Directo',v.first?'Nueva del día':'Repetida'])));
  if(data.totalVisits>300)visits.append(node('p','Se muestran las 300 más recientes.','note'));
 }else visits.append(node('p','No hay visitas con detalle en este período.','empty'));
 visits.append(node('p','"Sin sesión": la persona no inició sesión en esa visita. El jugador de cada visita se registra desde el 24/10/2026.','note'));
 body.append(players,visits);
}
$('go-visitors').onclick=()=>goVisits({day:metrics?.today,measure:'visitors'});
$('go-visits').onclick=()=>goVisits({day:metrics?.today,measure:'visits'});
$('go-tables').onclick=()=>{showTab('tables');$('table-state').value='active';renderTables();};
$('visit-detail-close').onclick=()=>{visitDetail=null;visitDetailRequest++;$('visit-detail').hidden=true;for(const k of $('visit-totals').children)k.classList.remove('selected');};
function renderMetrics(){
 if(!metrics)return;
 $('metric-total').textContent=number(metrics.total);$('metric-active').textContent=number(metrics.active);$('metric-today').textContent=number(metrics.todayUsers);
 const visitDays=metrics.visits?.days||[],today=visitDays[visitDays.length-1],yesterday=visitDays[visitDays.length-2];
 $('kpi-visitors').textContent=number(today?.totalVisitors||0);$('kpi-visits').textContent=number(today?.totalVisits||0);
 delta($('kpi-visitors-delta'),today?.totalVisitors||0,yesterday?.totalVisitors||0);delta($('kpi-visits-delta'),today?.totalVisits||0,yesterday?.totalVisits||0);
 bars($('platform-today'),Object.entries(PLATFORM_LABELS).map(([key,label])=>({label,value:today?.visitors[key]||0,color:'var(--'+key+')',onClick:()=>goVisits({day:metrics.today,platform:key})})));
 columns($('visits-mini'),visitDays.slice(-14).map(d=>({label:shortDay(d.day),segments:platformSegments(d.visitors),tooltip:platformTooltip(d.day,d.visitors,'visitantes'),onClick:()=>goVisits({day:d.day})})),{labelEvery:2});
 const selected=$('metric-day').value;$('metric-day').replaceChildren();
 const days=[...new Set([metrics.today,...metrics.days.map(d=>d.day)])];
 for(const day of days){const option=node('option',day===metrics.today?'Hoy':shortDay(day));option.value=day;$('metric-day').append(option);}
 if(days.includes(selected))$('metric-day').value=selected;
 renderHours();
 const byDay=new Map(metrics.days.map(d=>[d.day,d.users]));
 columns($('day-chart'),Array.from({length:30},(_,i)=>{const day=new Date(Date.parse(metrics.today+'T12:00:00Z')-(29-i)*86400000).toISOString().slice(0,10);return {label:shortDay(day),value:byDay.get(day)||0,tooltip:shortDay(day)+' · '+(byDay.get(day)||0)+' jugadores únicos',onClick:()=>goVisits({day})};}),{labelEvery:3});
 renderVisits();renderUsers();
}
for(const id of ['visit-range','visit-measure','visit-from','visit-to'])$(id).addEventListener('change',renderVisits);
legend();
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
  $('logout').onclick=$('switch-account').onclick=()=>signOut(auth);
  onAuthStateChanged(auth,async user=>{
   const generation=++epoch;pagesLoaded=1;userScope='all';$('user-scope').value='all';clearInterval(metricsTimer);metricsTimer=null;metrics=null;users=[];pageToken=null;$('console').hidden=true;$('access').hidden=false;$('logout').hidden=!user;$('switch-account').hidden=!user;$('login').hidden=!!user;
   $('identity').textContent=user?'Tu UID: '+user.uid:'';$('access-status').textContent=user?'Verificando permisos…':'Iniciá sesión con tu cuenta administradora.';
   if(!user)return;
   try{const result=await call({action:'users'});if(generation!==epoch)return;users=result.data.users;pageToken=result.data.pageToken;$('access').hidden=true;$('console').hidden=false;renderUsers();await refresh();if(generation===epoch)metricsTimer=setInterval(()=>{if(!document.hidden&&!$('edit').open)refresh(false,true);},60000);}
   catch(e){if(generation===epoch)$('access-status').textContent=errorText(e);}
  });
 }catch(e){$('access-status').textContent=errorText(e);}
}
start();
