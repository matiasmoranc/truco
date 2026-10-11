export function installPlayerPanel({document,api,getState}){
 const $=id=>document.getElementById(id);
 const date=value=>value?new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Sin fecha';
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const dialog=document.createElement('dialog');dialog.className='player-overlay';
 const card=node('div','','player-panel-card');const close=node('button','×','account-close');close.type='button';close.setAttribute('aria-label','Cerrar');close.onclick=()=>dialog.close();
 const title=node('h2','');title.id='player-panel-title';dialog.setAttribute('aria-labelledby',title.id);const body=node('div','','player-panel-body');card.append(close,title,body);dialog.append(card);document.body.append(dialog);
 let generation=0;const localIds=new WeakMap();
 dialog.addEventListener('close',()=>generation++);
 function open(text){generation++;title.textContent=text;body.replaceChildren();if(!dialog.open)dialog.showModal();return generation;}
 const reasons={abandon:'Abandono',disconnect:'Desconexión',timeout:'Inactividad',inactivity:'Inactividad','waiting-canceled':'Cancelación sin rival','draw-left':'Cancelación antes de empezar','draw-cancel':'Cancelación antes de empezar',admin:'Cierre del administrador'};
 async function history(){
  const token=open('Mis partidas y créditos');body.append(node('p','Cargando historial…'));
  try{
   const data=await api('playerConsole',{action:'history'});if(token!==generation)return;
   body.replaceChildren();const stats=node('div','','player-stats');
   for(const [label,value] of [['Disponibles',data.balance],['Reservados',data.locked],['Máximo registrado',data.peak]]){const box=node('div','','player-stat');box.append(node('strong',String(value)),node('small',label));stats.append(box);}body.append(stats,node('p','El máximo se calcula con los registros disponibles. El seguimiento completo comienza con esta actualización.','muted'));
   for(const m of data.matches){const item=node('article','','player-history-item');item.append(node('h3',m.players.join(' vs. ')),node('small',date(m.finishedAt||m.createdAt)+' · Mesa '+m.code+' · Partida '+m.matchNumber));
    const status=m.status==='settled'?(m.winner?'Ganaste':'Perdiste'):m.status==='refunded'?'Créditos devueltos':m.status==='waiting'?'Esperando rival':'En juego';
    item.append(node('p',status+' · Apuesta: '+m.stake+' · '+(m.delta>0?'+':'')+m.delta+' créditos'));
    if(m.scores)item.append(node('p',m.players.map((n,i)=>n+': '+(m.scores['player'+(i+1)]||0)).join(' · ')));
    if(m.reason)item.append(node('small',reasons[m.reason]||m.reason));
    const details=node('details');details.append(node('summary','Movimientos de esta partida'));
    for(const e of m.history||[])for(const c of e.changes||[])details.append(node('p',date(e.at)+': saldo '+c.before+' → '+c.after+' · reservados '+c.reservedBefore+' → '+c.reservedAfter));item.append(details);body.append(item);
   }
   if(!data.matches.length)body.append(node('p','Todavía no hay partidas con apuestas registradas.'));
   const moves=node('details');moves.append(node('summary','Todos los movimientos de créditos'));
   for(const e of data.movements||[])moves.append(node('p',date(e.at)+': saldo '+e.before+' → '+e.after+' · reservados '+e.reservedBefore+' → '+e.reservedAfter));body.append(moves);
  }catch(e){if(token===generation)body.replaceChildren(node('p',e.message||'No pudimos cargar tu historial.'));}
 }
 function report(fromMatch=false){
  open('Reportar un problema');const state=getState(),matchId=fromMatch&&state.room?.managedCredits?state.room.creditMatch?.id:null;
  let localId=null;if(fromMatch&&state.localGame&&state.room){if(!localIds.has(state.room))localIds.set(state.room,'local_'+crypto.randomUUID());localId=localIds.get(state.room);}
  body.append(node('p',matchId||localId?'Se adjuntará el ID de esta partida.':'Contanos qué pasó para que podamos revisarlo.'));
  const form=document.createElement('form'),input=document.createElement('textarea');input.maxLength=1000;input.minLength=5;input.required=true;input.rows=5;input.placeholder='¿Qué pasó?';input.setAttribute('aria-label','Descripción del problema');
  const submit=node('button','Enviar reporte','button primary');submit.type='submit';const status=node('p','');status.setAttribute('role','status');form.append(input,submit,status);body.append(form);
  const requestId=crypto.randomUUID();let busy=false;
  form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;submit.textContent='Enviando…';try{await api('playerConsole',{action:'report',message:input.value,requestId,matchId,localId,mode:state.localGame?'bot':'general'});status.textContent='Reporte enviado. Gracias por avisarnos.';input.disabled=true;submit.hidden=true;}catch(e){status.textContent=e.message||'No pudimos enviar el reporte. Volvé a intentar.';submit.disabled=false;submit.textContent='Enviar reporte';}finally{busy=false;}};
 }
 $('player-history').onclick=history;
 for(const id of ['lobby-report','account-report'])$(id).onclick=()=>report();
 $('match-report').onclick=()=>report(true);
 $('account-open').addEventListener('click',()=>{$('player-account-name').textContent=$('account-username').textContent;$('player-account-balance').textContent=$('credits-header-balance').textContent;});
}
