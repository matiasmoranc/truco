export function installPlayerPanel({document,api,getState}){
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
   for(const [label,value] of [['Partidas ganadas',won],['Partidas perdidas',lost],['Porcentaje de victorias',percentage+'%'],['Máximo de créditos',data.peak??0]]){
    const box=node('div','','player-stat');box.append(node('strong',String(value)),node('small',label));stats.append(box);
   }
   body.append(stats);
  }catch(e){if(token===generation)body.replaceChildren(node('p',e.message||'No pudimos cargar tus estadísticas.'));}
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
 for(const id of ['lobby-report','account-report'])$(id).onclick=()=>report();
 $('match-report').onclick=()=>report(true);
 $('account-open').addEventListener('click',()=>{$('player-account-name').textContent=$('account-username').textContent;$('player-account-balance').textContent=$('credits-header-balance').textContent;});
}
