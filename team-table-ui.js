export function teamPie(room,player){
 const first=room.mano;
 const i=TEAM_SEATS.indexOf(first),order=[...TEAM_SEATS.slice(i),...TEAM_SEATS.slice(0,i)];
 return order.filter(q=>playerTeam(q)===playerTeam(player)&&!room.folded?.[q]).at(-1);
}
// Whether the best envido or flor declared so far is from `team`; ties go to the earlier seat from the mano.
export function teamLeadsDeclaration(bet,team){
 const reveals=bet?.reveals||{};
 const lead=(bet?.order||[]).filter(q=>(reveals[q]??-1)>=0).reduce((a,q)=>!a||reveals[q]>reveals[a]?q:a,null);
 return !!lead&&playerTeam(lead)===team;
}
export function visibleTeamNotice(notice,room,now){return !!notice&&notice.handNumber===room.handNumber&&(notice.trickNo==null||notice.trickNo===room.trickNo)&&now-notice.time>=0&&now-notice.time<(Number(notice.duration)||5000);}
export const TEAM_SEATS=['player1','player2','player3','player4'];
const FLOR_ICON=globalThis.document?.getElementById('opponent-flor')?.innerHTML||'';
export const playerTeam=p=>['player1','player3'].includes(p)?'player1':'player2';
export function teamSeatsFor(viewer){const i=TEAM_SEATS.indexOf(viewer);return [0,1,2,3].map(n=>TEAM_SEATS[(i+n)%4]);}
export function dealerPosition(dealer,viewer,teams=false){
 return teams?['self','right','partner','left'][teamSeatsFor(viewer).indexOf(dealer)]:(dealer===viewer?'self':'partner');
}
export function dealerDeckPose(seat,teams,width,height){
 // Team tables keep the deck a little away from the center, so played cards never cover the sample.
 const spots=teams?{self:[76,58],right:[78,16],partner:[22,16],left:[24,58]}:{self:[82,44],partner:[18,44]};
 const [left,top]=spots[seat]||spots.self;
 const dx=(50-left)*width/100,dy=(44-top)*height/100,length=Math.hypot(dx,dy)||1;
 const sampleAngle=Math.atan2(dx,-dy)*180/Math.PI;
 return {left,top,sampleAngle,deckAngle:sampleAngle+90,inwardX:dx/length,inwardY:dy/length};
}
// Where the four played cards land on this screen, measured once per felt size with hidden probes.
let playedSlots={key:'',boxes:[]};
function playedCardBoxes($,bounds){
 const key=Math.round(bounds.width)+'x'+Math.round(bounds.height),cards=$('trick-cards');
 if(playedSlots.key===key||!cards)return playedSlots.boxes;
 const boxes=['self','right','partner','left'].map(pos=>{const probe=document.createElement('div');probe.className='sprite-card team-played team-played-'+pos;probe.style.cssText='visibility:hidden;animation:none;transition:none';cards.append(probe);const box=probe.getBoundingClientRect();probe.remove();return box;});
 playedSlots={key,boxes:boxes.some(b=>b.width)?boxes:[]};return playedSlots.boxes;
}
const touches=(a,b,gap=4)=>a.left<b.right+gap&&b.left<a.right+gap&&a.top<b.bottom+gap&&b.top<a.bottom+gap;
// Team tables: the nudge that keeps deck and sample clear, chosen once per hand (scope)
// and screen size, so the deck never moves while the hand is played.
const deckNudges=new Map();
export function positionDealerDeck($,dealer,viewer,teams=false,scope=''){
 const seat=dealerPosition(dealer,viewer,teams)||'self',felt=$('felt-area');
 const bounds=felt.getBoundingClientRect(),pose=dealerDeckPose(seat,teams,bounds.width,bounds.height);
 const offset=($('muestra-card').offsetHeight||84)*.34;
 // push: pixels away from the center; side: pixels across that direction.
 const place=(push,side)=>{for(const id of ['deck-stack','muestra-card']){
  const el=$(id);if(el.parentElement!==felt)felt.append(el);
  el.dataset.dealerPosition=seat;
  const sample=id==='muestra-card',along=(sample?offset:0)-push;
  el.style.left=`calc(${pose.left}% + ${pose.inwardX*along-pose.inwardY*side}px)`;
  el.style.top=`calc(${pose.top}% + ${pose.inwardY*along+pose.inwardX*side}px)`;
  el.style.right='auto';el.style.transform=`translate(calc(-50% + ${sample?'var(--muestra-dx,0px)':'0px'}),calc(-50% + ${sample?'var(--muestra-dy,0px)':'0px'})) rotate(${sample?pose.sampleAngle:pose.deckAngle}deg)`;
  el.style.zIndex=sample?'3':'4';el.style.transformOrigin='50% 50%';
 }};
 if(!teams){place(0,0);return;}
 // Played cards must never cover the sample; the deck also stays off my hand and the seats.
 const handCards=[...(felt.querySelectorAll?.('#hand .hand-card')||[])];
 const key=[Math.round(bounds.width),Math.round(bounds.height),seat,scope||handCards.length].join(':');
 if(deckNudges.has(key)){const [push,side]=deckNudges.get(key);place(push,side);return;}
 place(0,0);
 const slots=playedCardBoxes($,bounds);if(!slots.length)return;
 const obstacles=[...slots,...[...handCards,...felt.querySelectorAll('.team-seat .team-player-name,.team-seat .team-backs>i')].map(el=>el.getBoundingClientRect())];
 const clear=()=>{const boxes=[$('muestra-card'),$('deck-stack')].map(el=>el.getBoundingClientRect()),d=boxes[1];
  return d.left>=bounds.left&&d.right<=bounds.right&&d.top>=bounds.top&&d.bottom<=bounds.bottom&&!boxes.some(b=>obstacles.some(o=>touches(b,o)));};
 let best=[0,0];
 search:for(let push=0;push<=120;push+=8)for(const side of [0,-16,16,-32,32,-48,48]){place(push,side);if(clear()){best=[push,side];break search;}}
 if(deckNudges.size>40)deckNudges.clear();
 deckNudges.set(key,best);place(...best);
}
export function renderTeamLobbySeats(code,room,safe,disabled=false){
 const group=(team,index)=>`<div class="lobby-team" role="group" aria-label="Equipo ${index}">${TEAM_SEATS.filter(p=>playerTeam(p)===team).map(p=>room.players?.[p]?`<span class="lobby-team-name" title="${safe(room.players[p].name)}">${safe(room.players[p].name)}</span>`:`<button class="lobby-team-join" data-room="${safe(code)}" data-seat="player" data-team="${team}" aria-label="Entrar al equipo ${index}" ${disabled?'disabled':''}>Entrar</button>`).join('<span class="lobby-team-dash" aria-hidden="true">–</span>')}</div>`;
 return `<div class="lobby-team-row">${group('player1',1)}<span class="lobby-team-versus">vs</span>${group('player2',2)}</div>`;
}
export function installTeamTable({$,getState,command,runAction,renderPlayerHand,orderedHand,cardImageStyle,cardAccessibleName,escapeHtml,renderTally,syncHeader,setTurnBadge,syncControls,gameTime,hasFlor,florPoints=()=>0,speakCall=()=>{}}){
 let scope='',known=new Set(),noticeKey='',declareKey='',partnerMatch='',partnerVisibleUntil=0,partnerTimer=null,noticeTimer=null,partnerFaceScope='',partnerWasFaceUp=false;
 function showPartner(){
  partnerVisibleUntil=Date.now()+3000;clearTimeout(partnerTimer);
  const s=getState(),key=s.roomCode+':'+s.room?.creditMatch?.id+':'+s.room?.matchNumber;
  partnerTimer=setTimeout(()=>{const current=getState();if(current.room?.mode==='2v2'&&key===current.roomCode+':'+current.room.creditMatch?.id+':'+current.room.matchNumber){partnerVisibleUntil=0;render();}},3000);
 }
 const safe=escapeHtml;
 const ensure=(id,tag,parent,cls)=>{let el=$(id);if(!el){el=document.createElement(tag);el.id=id;el.className=cls;parent.append(el);}return el;};
 const send=(button,c)=>runAction(button,()=>command(c));
 // A bot partner waits up to 10 s for the pie's signal (vení, jugá, gritá): a yellow
 // disc beside my cards empties clockwise from its top radius. startedAt null hides it.
 const SIGNAL_WAIT_MS=10000,SIGNAL_TIMER_SIZE=36;let signalTimerHide=null;
 function renderSignalTimer(startedAt){
  const timer=ensure('signal-timer','div',$('felt-area'),'signal-timer hidden');
  const left=Number.isFinite(startedAt)?SIGNAL_WAIT_MS-(gameTime()-startedAt):0;
  clearTimeout(signalTimerHide);
  if(left<=0){timer.classList.add('hidden');timer.dataset.key='';return;}
  if(timer.dataset.key!==String(startedAt)){timer.dataset.key=String(startedAt);timer.style.animation='none';void timer.offsetWidth;timer.style.animation=`signal-drain ${SIGNAL_WAIT_MS}ms linear ${left-SIGNAL_WAIT_MS}ms forwards`;}
  const card=$('hand').querySelector('.hand-card')||$('hand'),felt=$('felt-area').getBoundingClientRect(),box=card.getBoundingClientRect();
  timer.style.left=Math.max(4,box.left-felt.left-SIGNAL_TIMER_SIZE-10)+'px';timer.style.top=(box.top-felt.top+box.height/2-SIGNAL_TIMER_SIZE/2)+'px';
  timer.classList.remove('hidden');
  signalTimerHide=setTimeout(()=>timer.classList.add('hidden'),left);
 }
 function renderEnd(){const s=getState(),r=s.room;if(r?.mode!=='2v2')return;const visible=r.status==='complete'&&r.endReveal?.done;$('match-end').classList.toggle('hidden',!visible);if(!visible)return;
  const names=t=>TEAM_SEATS.filter(p=>playerTeam(p)===t).map(p=>r.players[p].name).join(' + '),won=r.matchResult.winner;
  $('match-end-title').textContent=playerTeam(s.playerId)===won?'¡Ganó tu equipo!':'Ganó el equipo rival';
  $('match-end-score').innerHTML=['player1','player2'].map(t=>`<div class="${won===t?'match-score-winner':''}"><strong>${r.scores[t]}</strong><span>${safe(names(t))}</span></div>`).join('<b>–</b>');
  $('match-session-score').textContent=r.creditResult?'Cada ganador recibe '+r.creditResult.payout+' créditos.':'Confirmando los créditos…';$('match-session-score').classList.remove('hidden');
  const votes=r.rematch?.status==='pending'?r.rematch.votes||{}:{};const voted=!!votes[s.playerId];
  $('match-end-message').textContent=Object.keys(votes).length?'Revancha: '+Object.keys(votes).length+' de 4 confirmaron.':'La revancha necesita la confirmación de los cuatro.';
  $('request-rematch').classList.toggle('hidden',voted);$('accept-rematch').classList.add('hidden');$('decline-rematch').classList.add('hidden');
 }
 function render(){const s=getState(),r=s.room,p=s.playerId;if(r?.mode!=='2v2'){$('signal-timer')?.classList.add('hidden');return;}
  const game=$('game-view'),felt=$('felt-area'),seats=teamSeatsFor(p),mineTeam=playerTeam(p),enemyTeam=mineTeam==='player1'?'player2':'player1';
  game.classList.add('team-mode','player-mode','two-device-mode');game.classList.remove('learning-mode','folding-hand','declaring-envido');$('learning-toolbar').classList.add('hidden');$('learning-rounds').classList.add('hidden');$('call-notice').classList.add('hidden');$('opponent-hand').classList.add('hidden');$('game-sheet').classList.add('hidden');
  syncHeader();const marker=document.querySelector('.mobile-score');if(marker.parentElement!==felt)felt.append(marker);marker.classList.remove('hidden');
  document.documentElement.style.setProperty('--compact-tally-height',Math.max(76,20+r.targetPoints/10*56)+'px');
  $('mobile-tally-1').innerHTML=renderTally(r.scores[mineTeam]||0,r.targetPoints);$('mobile-tally-2').innerHTML=renderTally(r.scores[enemyTeam]||0,r.targetPoints);
  const layer=ensure('team-seats','div',felt,'team-seats');
  const pending=r.pendingBet,turn=pending?.revealMode?pending.revealTurn:pending?.responder||r.turn;
  const positions=['self','right','partner','left'];
  const matchKey=s.roomCode+':'+r.creditMatch?.id+':'+r.matchNumber;
  if(r.status==='started'&&r.handNumber===1&&s.partnerHand?.length&&partnerMatch!==matchKey){partnerMatch=matchKey;showPartner();}
  const partnerVisible=Date.now()<partnerVisibleUntil;
  for(let i=0;i<4;i++){
   const q=seats[i],person=r.players[q],el=ensure('team-seat-'+q,'section',layer,'team-seat');el.className='team-seat team-'+positions[i]+(turn===q?' is-turn':'')+(r.folded?.[q]?' is-folded':'');el.dataset.player=q;
   const count=r.status==='drawing'?0:r.handCounts?.[q]||0;
   const faceUp=i===2&&partnerVisible&&s.partnerHand?.length===count;
   const faceScope=[s.roomCode,r.matchNumber,r.handNumber,q].join(':');
   const flip=i===2&&partnerFaceScope===faceScope&&partnerWasFaceUp!==!!faceUp;
   if(i===2){partnerFaceScope=faceScope;partnerWasFaceUp=!!faceUp;}
   const fan=Array.from({length:count},(_,j)=>`<i class="${faceUp?'sprite-card teammate-card':'opponent-card-back'}" style="--fan-index:${j-(count-1)/2};${faceUp?cardImageStyle(s.partnerHand[j]):''}"${faceUp?` aria-label="${safe(cardAccessibleName(s.partnerHand[j]))}"`:''}></i>`).join('');
   const backs=i===0?'':i===2?`<button class="team-backs team-partner-cards" type="button" aria-label="Ver cartas del compañero durante 3 segundos" aria-pressed="${faceUp}" ${count?'':'disabled'}>${fan}</button>`:`<div class="team-backs">${fan}</div>`;
   const status=r.folded?.[q]?'AL MAZO':'';
   // Rivals who sang flor show it beside their cards.
   const flor=(i===1||i===3)&&r.status==='started'&&r.flors?.[q]!=null?`<span class="team-flor flor-badge" role="img" aria-label="${safe(person?.name||'Jugador')} cantó flor">${FLOR_ICON}</span>`:'';
   el.innerHTML=`${i===0?(status?`<span class="team-self-status">${status}</span>`:''):`<span class="team-player-name">${safe(person?.name||'Jugador')}${status?`<small>${status}</small>`:''}</span>`}${backs}${flor}<div class="team-speech hidden"></div>`;
   if(i===2&&flip&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const card of el.querySelectorAll('.team-backs>i'))card.animate([{rotate:'y 90deg',opacity:.3,scale:'.94'},{rotate:'y 0deg',opacity:1,scale:'1'}],{duration:280,easing:'ease-out'});
   if(i===2)el.querySelector('.team-partner-cards').onclick=()=>{showPartner();render();};
  }
  clearTimeout(noticeTimer);
  const notices=[r.callNotice,r.teamSignal].filter(n=>visibleTeamNotice(n,r,gameTime())&&n.text!=='Se reparte');
  for(const n of notices){const speech=$('team-seat-'+n.from)?.querySelector('.team-speech');if(speech){speech.textContent=n.spoken||n.text;speech.classList.remove('hidden');}if(n===r.callNotice&&noticeKey!==n.id){noticeKey=n.id;speakCall(n.spoken||'');}}
  // All flowers are announced together: everyone who has one says "Flor", not only who sang it first.
  if(notices.some(n=>n===r.callNotice&&n.text==='Flor'))for(const q of Object.keys(r.flors||{})){const speech=$('team-seat-'+q)?.querySelector('.team-speech');if(speech){speech.textContent='Flor';speech.classList.remove('hidden');}}
  if(notices.length)noticeTimer=setTimeout(()=>{if(getState().room?.mode==='2v2')render();},Math.max(1,Math.min(...notices.map(n=>n.time+5000-gameTime()))));
  const drawing=r.status==='drawing';game.classList.toggle('drawing-mode',drawing);game.classList.toggle('reveal-mode',r.status==='revealing');$('opening-draw').classList.add('hidden');
  const playing=r.status==='started'&&!r.resolvingTrick&&!r.pendingNextHand;
  const myTurn=playing&&!pending&&r.turn===p&&!r.folded?.[p];if(!s.handGestureActive)renderPlayerHand(drawing?[]:orderedHand(),myTurn);
  $('fold-hand').classList.toggle('hidden',!playing||!!r.folded?.[p]);$('fold-hand').textContent='IRSE AL MAZO';
  const sample=r.muestra;$('deck-stack').classList.toggle('hidden',drawing||!sample);$('muestra-card').classList.toggle('hidden',drawing||!sample);$('muestra-card').classList.toggle('sprite-card',!!sample);if(sample){const el=$('muestra-card'),key=s.roomCode+':'+r.matchNumber+':'+r.handNumber;const dx=el.dataset.dragHand===key?el.style.getPropertyValue('--muestra-dx'):'0px',dy=el.dataset.dragHand===key?el.style.getPropertyValue('--muestra-dy'):'0px';el.dataset.dragHand=key;el.style.cssText=cardImageStyle(sample);el.style.setProperty('--muestra-dx',dx);el.style.setProperty('--muestra-dy',dy);$('muestra-card').setAttribute('aria-label',cardAccessibleName(sample)+', muestra');}
  positionDealerDeck($,r.dealer||'player4',p,true,[s.roomCode,r.matchNumber,r.handNumber].join(':'));
  const cards=$('trick-cards'),nextScope=[s.roomCode,r.matchNumber,r.handNumber].join(':'),same=scope===nextScope;const old=new Map([...cards.children].map(n=>[n.dataset.playedKey,n]));const keys=new Set();
  for(const item of r.trickCards||[]){const key=item.playerId+':'+item.card.id;keys.add(key);let el=old.get(key);if(!el){el=document.createElement('div');el.dataset.playedKey=key;cards.append(el);el.className='sprite-card team-played team-played-'+positions[seats.indexOf(item.playerId)];el.style.cssText=cardImageStyle(item.card);el.setAttribute('aria-label',r.players[item.playerId].name+': '+cardAccessibleName(item.card));
    if(same&&!known.has(key)&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const launched=item.playerId===p&&s.teamPlayOrigin?.cardId===item.card.id?s.teamPlayOrigin.rect:null;if(launched)s.teamPlayOrigin=null;const origin=item.playerId===p?$('hand'):$('team-seat-'+item.playerId),a=launched||origin.getBoundingClientRect(),b=el.getBoundingClientRect();el.animate([{translate:`${a.left+a.width/2-b.left-b.width/2}px ${a.top+a.height/2-b.top-b.height/2}px`,opacity:.5},{translate:'0 0',opacity:1}],{duration:500,easing:'cubic-bezier(.22,.61,.36,1)'});}}
   old.delete(key);
  }for(const el of old.values())el.remove();known=keys;scope=nextScope;
  const evidence=$('end-hand-reveal'),groups=r.endReveal?.groups||[];evidence.classList.toggle('hidden',!groups.length||!['revealing','complete'].includes(r.status)||r.endReveal.done);if(!evidence.classList.contains('hidden'))evidence.innerHTML=groups.map(g=>`<section><strong>${safe(g.name)} · ${safe(g.label)}</strong><div>${g.cards.map(c=>`<i class="sprite-card" style="${cardImageStyle(c)}"></i>`).join('')}</div></section>`).join('');
  const picker=$('envido-picker'),declaring=playing&&pending?.revealMode&&pending.revealTurn===p;picker.classList.toggle('hidden',!declaring);if(declaring){const key=pending.id+':'+p;if(declareKey!==key){declareKey=key;const flower=pending.type==='flor',start=flower&&s.hand.length===3?florPoints(s.hand,r.muestra):0;const best=Math.max(-1,...Object.values(pending.reveals||{})),max=flower?47:37;
   // The first to declare must say a number; after that, "paso" when my partner leads, otherwise "son buenas".
   const good=best<0?'':'<button class="pass-button" id="team-good">'+(teamLeadsDeclaration(pending,mineTeam)?'PASO':'SON BUENAS')+'</button>';
   if(best>=max||(flower&&best>=0&&start<=best)){picker.innerHTML='<p class="team-declare-label">'+(best>=max?(flower?'Declararon la flor más alta.':'Declararon el máximo de tantos.'):'Tu flor no supera la declarada.')+'</p><div class="team-declare-buttons">'+good+'</div>';}else{picker.innerHTML='<label class="team-declare-label">'+(flower?'Puntos de tu flor':'Tus tantos')+' <output id="team-declare-value">'+start+'</output><input id="team-declare-slider" type="range" min="0" max="'+(flower?47:37)+'" value="'+start+'" /></label><div class="team-declare-buttons"><button class="call-button" id="team-declare">DECLARAR</button>'+good+'</div>';$('team-declare-slider').oninput=e=>{$('team-declare-value').textContent=e.target.value;};$('team-declare').onclick=e=>send(e.currentTarget,{kind:'declare',value:Number($('team-declare-slider').value)});}
   if($('team-good'))$('team-good').onclick=e=>send(e.currentTarget,{kind:'declare',good:true});}}else declareKey='';
  const buttons=[];
  const add=(value,label,primary=false)=>buttons.push(`<button class="${primary?'call-button':'pass-button'}" data-team-action="${value}">${label}</button>`);
  if(playing&&!r.folded?.[p]){
   if(!pending&&r.turn===p){const flower=hasFlor(r,s.hand);if(!r.flors?.[p]&&(r.playedBy?.[p]||0)===0&&flower)add('flor','FLOR');if(!flower&&!r.envidoClosed&&(r.playedBy?.[p]||0)===0&&r.trickNo===1){add('envido','ENVIDO');add('real','REAL');add('falta','FALTA');}if((!flower||r.flors?.[p])&&r.trucoLevel<4&&r.lastTrucoTeam!==mineTeam)add(r.trucoLevel===1?'truco':r.trucoLevel===2?'retruco':'vale4',r.trucoLevel===1?'TRUCO':r.trucoLevel===2?'RETRUCO':'VALE 4',true);}
   // Holding an unsung flor, the only answer is to sing it: no envido, no quiero / no quiero yet.
   const owesFlor=pending&&!pending.revealMode&&pending.responder===p&&pending.type!=='flor'&&(r.playedBy?.[p]||0)===0&&hasFlor(r,s.hand)&&!r.flors?.[p];
   if(owesFlor)add('flor','FLOR',true);
   else if(pending&&!pending.revealMode&&pending.responder===p){add('yes',pending.type==='flor'&&hasFlor(r,s.hand)?'LA MÍA ES FLOR':'QUIERO',true);add('no','NO QUIERO');if(pending.type==='truco'){if(pending.stake<4)add('raise',pending.stake===2?'RETRUCO':'VALE 4');if(!r.envidoClosed&&(r.playedBy?.[p]||0)===0){add('envido','ENVIDO');add('real','REAL');add('falta','FALTA');}}if(pending.type==='envido'&&pending.called!=='falta'){add('raise-envido','ENVIDO');add('raise-real','REAL');add('raise-falta','FALTA');}if(pending.type==='flor'&&pending.called==='flor'){add('raise-conflor','CON FLOR ENVIDO');add('raise-faltaflor','CONTRA FLOR AL RESTO');}}
  }
  const signalButtons=playing&&!pending&&!r.folded?.[p]&&r.turn!==p&&playerTeam(r.turn)===mineTeam&&!r.folded?.[r.turn]&&teamPie(r,p)===p;
  if(signalButtons){
   // With a single card left there is nothing low to throw: only jugá or gritá make sense.
   const lastCard=(r.handCounts?.[r.turn]??3)<=1;
   for(const [value,label] of [['veni','Vení'],['juga','Jugá'],['grita','Gritá']].filter(([value])=>!(lastCard&&value==='veni')))buttons.push('<button class="pass-button team-signal-button" data-team-signal="'+value+'">'+label+'</button>');
  }
  const signaled=r.teamSignal?.to===r.turn&&r.teamSignal.handNumber===r.handNumber&&r.teamSignal.trickNo===r.trickNo;
  renderSignalTimer(signalButtons&&r.players[r.turn]?.bot&&!signaled?r.turnClock?.startedAt:null);
  $('player-actions').classList.toggle('hidden',drawing||r.status==='complete');$('player-actions').innerHTML=buttons.length?'<div class="action-buttons compact-actions team-actions">'+buttons.join('')+'</div>':'';
  // As in 1v1: quiero / no quiero always on the bottom row, every other call above.
  const actionBox=$('player-actions').querySelector('.team-actions'),answers=actionBox?[...actionBox.querySelectorAll('[data-team-action="yes"],[data-team-action="no"]')]:[];
  if(answers.length){const options=document.createElement('div'),response=document.createElement('div');options.className='bet-options-row';response.className='bet-answers-row';for(const b of actionBox.querySelectorAll('button'))(answers.includes(b)?response:options).append(b);actionBox.replaceChildren(...(options.children.length?[options]:[]),response);}for(const b of $('player-actions').querySelectorAll('[data-team-action]'))b.onclick=e=>send(e.currentTarget,{kind:'call',value:b.dataset.teamAction});
  for(const b of $('player-actions').querySelectorAll('[data-team-signal]'))b.onclick=e=>send(e.currentTarget,{kind:'team-signal',value:b.dataset.teamSignal});
  const time=r.turnClock?Math.max(0,Math.ceil((45000-(gameTime()-r.turnClock.startedAt))/1000)):null;setTurnBadge(drawing?'SORTEO':r.status==='revealing'||r.pendingNextHand||r.resolvingTrick?'NUEVA JUGADA':turn===p?(pending?'RESPONDÉ':'TU TURNO'):'Turno de '+(r.players[turn]?.name||'…'));
  renderEnd();syncControls();
 }
 return {render,renderEnd};
}

export function renderWaitingSeats(room,viewer,safe){
 const teams=room.mode==='2v2',players=room.players||{};
 const me=viewer||'player1',seats=teams?teamSeatsFor(me):[me,me==='player1'?'player2':'player1'];
 const positions=teams?['self','right','partner','left']:['self','partner'];
 // Only the creator can fill an empty seat of a team table with a bot.
 const botButtons=teams&&me==='player1'&&room.status==='waiting';
 return seats.map((key,i)=>{const player=players[key],team=playerTeam(key)==='player1'?'1':'2';
  return '<div class="waiting-player waiting-player-'+positions[i]+' '+(player?'occupied':'empty')+(player?.bot?' bot':'')+'"><span class="waiting-player-name">'+safe(player?.name||'Lugar disponible')+'</span>'+'<div class="waiting-player-cards" aria-hidden="true">'+(player?[-1,0,1].map(n=>'<span class="opponent-card-back" style="--fan-index:'+n+'"></span>').join(''):'<span class="waiting-empty-place">+</span>')+'</div>'+(!player&&botButtons?'<button type="button" class="waiting-bot-button" data-add-bot="'+key+'">Usar bot</button>':'')+'</div>';
 }).join('');
}
