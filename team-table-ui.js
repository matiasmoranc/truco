export const TEAM_SEATS=['player1','player2','player3','player4'];
export const playerTeam=p=>['player1','player3'].includes(p)?'player1':'player2';
export function teamSeatsFor(viewer){const i=TEAM_SEATS.indexOf(viewer);return [0,1,2,3].map(n=>TEAM_SEATS[(i+n)%4]);}
export function installTeamTable({$,getState,command,runAction,renderPlayerHand,orderedHand,cardImageStyle,cardAccessibleName,escapeHtml,renderTally,syncHeader,setTurnBadge,syncControls,gameTime,hasFlor,speakCall=()=>{}}){
 let scope='',known=new Set(),noticeKey='',declareKey='';
 const safe=escapeHtml;
 const ensure=(id,tag,parent,cls)=>{let el=$(id);if(!el){el=document.createElement(tag);el.id=id;el.className=cls;parent.append(el);}return el;};
 const send=(button,c)=>runAction(button,()=>command(c));
 function renderEnd(){const s=getState(),r=s.room;if(r?.mode!=='2v2')return;const visible=r.status==='complete'&&r.endReveal?.done;$('match-end').classList.toggle('hidden',!visible);if(!visible)return;
  const names=t=>TEAM_SEATS.filter(p=>playerTeam(p)===t).map(p=>r.players[p].name).join(' + '),won=r.matchResult.winner;
  $('match-end-title').textContent=playerTeam(s.playerId)===won?'¡Ganó tu equipo!':'Ganó el equipo rival';
  $('match-end-score').innerHTML=['player1','player2'].map(t=>`<div class="${won===t?'match-score-winner':''}"><strong>${r.scores[t]}</strong><span>${safe(names(t))}</span></div>`).join('<b>–</b>');
  $('match-session-score').textContent=r.creditResult?'Cada ganador recibe '+r.creditResult.payout+' créditos.':'Confirmando los créditos…';$('match-session-score').classList.remove('hidden');
  const votes=r.rematch?.status==='pending'?r.rematch.votes||{}:{};const voted=!!votes[s.playerId];
  $('match-end-message').textContent=Object.keys(votes).length?'Revancha: '+Object.keys(votes).length+' de 4 confirmaron.':'La revancha necesita la confirmación de los cuatro.';
  $('request-rematch').classList.toggle('hidden',voted);$('accept-rematch').classList.add('hidden');$('decline-rematch').classList.add('hidden');
 }
 function render(){const s=getState(),r=s.room,p=s.playerId;if(r?.mode!=='2v2')return;
  const game=$('game-view'),felt=$('felt-area'),seats=teamSeatsFor(p),mineTeam=playerTeam(p),enemyTeam=mineTeam==='player1'?'player2':'player1';
  game.classList.add('team-mode','player-mode','two-device-mode');game.classList.remove('learning-mode','folding-hand','declaring-envido');$('learning-toolbar').classList.add('hidden');$('learning-rounds').classList.add('hidden');$('call-notice').classList.add('hidden');$('opponent-hand').classList.add('hidden');$('game-sheet').classList.add('hidden');
  syncHeader();const marker=document.querySelector('.mobile-score');if(marker.parentElement!==felt)felt.append(marker);marker.classList.remove('hidden');
  document.documentElement.style.setProperty('--compact-tally-height',Math.max(76,20+r.targetPoints/10*56)+'px');
  $('mobile-tally-1').innerHTML=renderTally(r.scores[mineTeam]||0,r.targetPoints);$('mobile-tally-2').innerHTML=renderTally(r.scores[enemyTeam]||0,r.targetPoints);
  const layer=ensure('team-seats','div',felt,'team-seats');
  const pending=r.pendingBet,turn=pending?.revealMode?pending.revealTurn:pending?.responder||r.turn;
  const positions=['self','right','partner','left'];
  for(let i=0;i<4;i++){
   const q=seats[i],person=r.players[q],el=ensure('team-seat-'+q,'section',layer,'team-seat');el.className='team-seat team-'+positions[i]+(turn===q?' is-turn':'')+(r.folded?.[q]?' is-folded':'');el.dataset.player=q;
   const count=r.status==='drawing'?0:r.handCounts?.[q]||0,backs=i===0?'':`<div class="team-backs">${Array.from({length:count},(_,j)=>`<i class="opponent-card-back" style="--fan-index:${j-(count-1)/2}"></i>`).join('')}</div>`;
   const status=[i===2?'COMPAÑERO':'',r.mano===q?'MANO':'',r.folded?.[q]?'AL MAZO':''].filter(Boolean).join(' · ');
   el.innerHTML=`${i===0?(status?`<span class="team-self-status">${status}</span>`:''):`<span class="team-player-name">${safe(person?.name||'Jugador')}${status?`<small>${status}</small>`:''}</span>`}${backs}<div class="team-speech hidden"></div>`;
  }
  if(r.callNotice&&r.callNotice.handNumber===r.handNumber&&r.callNotice.from&&r.callNotice.text!=='Se reparte'){const speech=$('team-seat-'+r.callNotice.from)?.querySelector('.team-speech');if(speech){speech.textContent=r.callNotice.spoken||r.callNotice.text;speech.classList.remove('hidden');}if(noticeKey!==r.callNotice.id){noticeKey=r.callNotice.id;speakCall(r.callNotice.spoken||'');}}
  const drawing=r.status==='drawing';game.classList.toggle('drawing-mode',drawing);game.classList.toggle('reveal-mode',r.status==='revealing');$('opening-draw').classList.toggle('hidden',!drawing);
  if(drawing){const d=r.openingDraw,chosen=!!d.cards?.[p];$('opening-draw').innerHTML=`<div class="draw-prompt"><h2>${chosen?'Esperando a los demás':'Sorteo del repartidor'}</h2><p>Los cuatro sacan una carta. Reparte la mayor.</p></div><button class="draw-deck" id="draw-deck" ${chosen?'disabled':''} aria-label="Sacar carta"></button><div class="team-draw-results">${TEAM_SEATS.map(q=>`<div><span>${safe(r.players[q].name)}</span>${d.cards?.[q]?`<i class="sprite-card" style="${cardImageStyle(d.cards[q])}"></i>`:'<small>Esperando…</small>'}</div>`).join('')}</div>`;if(!chosen)$('draw-deck').onclick=e=>send(e.currentTarget,{kind:'draw'});}
  const playing=r.status==='started'&&!r.resolvingTrick&&!r.pendingNextHand;
  const myTurn=playing&&!pending&&r.turn===p&&!r.folded?.[p];if(!s.handGestureActive)renderPlayerHand(drawing?[]:orderedHand(),myTurn);
  $('fold-hand').classList.toggle('hidden',!playing||!!r.folded?.[p]);$('fold-hand').textContent='IRSE AL MAZO';
  const sample=r.muestra;$('deck-stack').classList.toggle('hidden',drawing||!sample);$('muestra-card').classList.toggle('hidden',drawing||!sample);$('muestra-card').classList.toggle('sprite-card',!!sample);if(sample){$('muestra-card').style.cssText=cardImageStyle(sample);$('muestra-card').setAttribute('aria-label',cardAccessibleName(sample)+', muestra');}
  const cards=$('trick-cards'),nextScope=[s.roomCode,r.matchNumber,r.handNumber].join(':'),same=scope===nextScope;const old=new Map([...cards.children].map(n=>[n.dataset.playedKey,n]));const keys=new Set();
  for(const item of r.trickCards||[]){const key=item.playerId+':'+item.card.id;keys.add(key);let el=old.get(key);if(!el){el=document.createElement('div');el.dataset.playedKey=key;cards.append(el);el.className='sprite-card team-played team-played-'+positions[seats.indexOf(item.playerId)];el.style.cssText=cardImageStyle(item.card);el.setAttribute('aria-label',r.players[item.playerId].name+': '+cardAccessibleName(item.card));
    if(same&&!known.has(key)&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const origin=item.playerId===p?$('hand'):$('team-seat-'+item.playerId),a=origin.getBoundingClientRect(),b=el.getBoundingClientRect();el.animate([{translate:`${a.left+a.width/2-b.left-b.width/2}px ${a.top+a.height/2-b.top-b.height/2}px`,opacity:.5},{translate:'0 0',opacity:1}],{duration:500,easing:'cubic-bezier(.22,.61,.36,1)'});}}
   old.delete(key);
  }for(const el of old.values())el.remove();known=keys;scope=nextScope;
  const evidence=$('end-hand-reveal'),groups=r.endReveal?.groups||[];evidence.classList.toggle('hidden',!groups.length||!['revealing','complete'].includes(r.status)||r.endReveal.done);if(!evidence.classList.contains('hidden'))evidence.innerHTML=groups.map(g=>`<section><strong>${safe(g.name)} · ${safe(g.label)}</strong><div>${g.cards.map(c=>`<i class="sprite-card" style="${cardImageStyle(c)}"></i>`).join('')}</div></section>`).join('');
  const picker=$('envido-picker'),declaring=playing&&pending?.revealMode&&pending.revealTurn===p;picker.classList.toggle('hidden',!declaring);if(declaring){const key=pending.id+':'+p;if(declareKey!==key){declareKey=key;picker.innerHTML='<label class="team-declare-label">Tus tantos <output id="team-declare-value">0</output><input id="team-declare-slider" type="range" min="0" max="37" value="0" /></label><div class="team-declare-buttons"><button class="call-button" id="team-declare">DECLARAR</button><button class="pass-button" id="team-good">SON BUENAS</button></div>';$('team-declare-slider').oninput=e=>{$('team-declare-value').textContent=e.target.value;};$('team-declare').onclick=e=>send(e.currentTarget,{kind:'declare',value:Number($('team-declare-slider').value)});$('team-good').onclick=e=>send(e.currentTarget,{kind:'declare',good:true});}}else declareKey='';
  const buttons=[];
  const add=(value,label,primary=false)=>buttons.push(`<button class="${primary?'call-button':'pass-button'}" data-team-action="${value}">${label}</button>`);
  if(playing&&!r.folded?.[p]){
   if(!pending&&r.turn===p){const flower=hasFlor(r,s.hand);if(!r.flors?.[p]&&(r.playedBy?.[p]||0)===0&&flower)add('flor','FLOR');if(!flower&&!r.envidoClosed&&(r.playedBy?.[p]||0)===0&&r.trickNo===1){add('envido','ENVIDO');add('real','REAL');add('falta','FALTA');}if((!flower||r.flors?.[p])&&r.trucoLevel<4&&r.lastTrucoTeam!==mineTeam)add(r.trucoLevel===1?'truco':r.trucoLevel===2?'retruco':'vale4',r.trucoLevel===1?'TRUCO':r.trucoLevel===2?'RETRUCO':'VALE 4',true);}
   if(pending&&!pending.revealMode&&pending.responder===p){if(pending.type!=='flor'&&hasFlor(r,s.hand)&&!r.flors?.[p])add('flor','FLOR',true);add('yes',pending.type==='flor'?'LA MÍA ES FLOR':'QUIERO',true);add('no','NO QUIERO');if(pending.type==='truco'){if(pending.stake<4)add('raise',pending.stake===2?'RETRUCO':'VALE 4');if(!r.envidoClosed&&(r.playedBy?.[p]||0)===0){add('envido','ENVIDO');add('real','REAL');add('falta','FALTA');}}if(pending.type==='envido'&&pending.called!=='falta'){add('raise-envido','ENVIDO');add('raise-real','REAL');add('raise-falta','FALTA');}if(pending.type==='flor'&&pending.called==='flor'){add('raise-conflor','CON FLOR ENVIDO');add('raise-faltaflor','CONTRA FLOR AL RESTO');}}
  }
  $('player-actions').classList.toggle('hidden',drawing||r.status==='complete');$('player-actions').innerHTML=buttons.length?'<div class="action-buttons compact-actions team-actions">'+buttons.join('')+'</div>':'';for(const b of $('player-actions').querySelectorAll('[data-team-action]'))b.onclick=e=>send(e.currentTarget,{kind:'call',value:b.dataset.teamAction});
  const time=r.turnClock?Math.max(0,Math.ceil((45000-(gameTime()-r.turnClock.startedAt))/1000)):null;setTurnBadge(drawing?'SORTEO':r.status==='revealing'||r.pendingNextHand||r.resolvingTrick?'NUEVA JUGADA':turn===p?(pending?'RESPONDÉ':'TU TURNO'):'Turno de '+(r.players[turn]?.name||'…'));
  const pause=$('round-pause-timer');pause.classList.add('hidden');renderEnd();syncControls();
 }
 return {render,renderEnd};
}
