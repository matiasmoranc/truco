const FIREBASE_VERSION = '12.4.0';
const $ = (id) => document.getElementById(id);
const views = ['welcome-view', 'invite-view', 'setup-view', 'waiting-view', 'game-view', 'config-view', 'learn-view'];
const storageKey = 'truco-firebase-config';
let state = { role: 'table', joining: false, config: null, firebase: null, roomCode: null, selectedRoom: null, uid: null, playerId: null, unsubscribe: null, privateUnsubscribe: null, lobbyUnsubscribe: null, room: null, hand: [], handOrder: [], handOrderKey: null, localGame: false, localHands: {}, nextAction: null, resolutionTimer: null, resolutionTimerKey: null, playActionInFlight: false, legacyRepairKey: null, emptyHandRepairKey: null };

const cardImageCache=[];
let cardImagesPromise=null;
function preloadCardImages(){
  if(cardImagesPromise)return cardImagesPromise;
  cardImagesPromise=Promise.all(Array.from({length:13},(_,index)=>new Promise((resolve,reject)=>{
    const image=new Image();cardImageCache.push(image);
    image.decoding='async';
    image.onload=()=>{(typeof image.decode==='function'?image.decode():Promise.resolve()).then(resolve,reject);};
    image.onerror=()=>reject(new Error('No se pudo cargar la imagen de cartas '+(index+1)));
    image.src=new URL('./assets/cards/'+(index+1)+'.jpg',document.baseURI).href;
  }))).catch(error=>{cardImagesPromise=null;cardImageCache.length=0;throw error;});
  return cardImagesPromise;
}
async function prepareCardImages(){
  try{await preloadCardImages();return true;}
  catch(error){console.error('[truco:cards]',error);toast('No se pudieron cargar las cartas. Volvé a intentar.',true);return false;}
}
// Keep the decoded originals in memory throughout the game.
preloadCardImages().catch(()=>{});

const CHAT_LIMIT=40,CHAT_NOTICE_MS=4000;
let chatMuted=false;

const matchChat={key:null,messages:[],seen:new Set(),open:false,unread:0,sending:false,noticeTimers:new Map(),signature:''};
function chatAvailable(){return !!(state.room&&!state.localGame&&['player1','player2'].includes(state.playerId)&&state.room.players?.player1&&state.room.players?.player2&&state.room.status!=='closed');}
function peerChatMuted(room=state.room){
  const peer=otherPlayer(state.playerId),preference=room?.chatPreferences?.[peer];
  return !!(preference?.muted&&preference.uid===room?.players?.[peer]?.uid);
}
function renderChatComposer(){
  const blocked=peerChatMuted(),input=$('chat-input');
  $('chat-muted').disabled=liveActionsBlocked();
  input.disabled=blocked||liveActionsBlocked()||matchChat.sending;input.classList.toggle('hidden',blocked);
  $('chat-send').disabled=blocked||matchChat.sending||liveActionsBlocked();$('chat-send').classList.toggle('hidden',blocked);
  $('chat-count').classList.toggle('hidden',blocked);
  $('chat-blocked').classList.toggle('hidden',!blocked);
  $('chat-blocked').textContent=blocked?`${state.room.players[otherPlayer(state.playerId)].name||'El rival'} ha silenciado los mensajes.`:'';
  for(const button of $('chat-quick').querySelectorAll('button'))button.disabled=blocked||liveActionsBlocked()||matchChat.sending;
  $('chat-quick').classList.toggle('hidden',blocked);
  if(blocked)$('chat-error').classList.add('hidden');
}
let publishingChatMute=false;
async function publishChatMute(){
  if(liveActionsBlocked()||!chatAvailable()||publishingChatMute)return;
  const preference=state.room.chatPreferences?.[state.playerId];
  if(!!preference?.muted===chatMuted&&(!preference||preference.uid===state.uid))return;
  const key=chatContextKey(),desired=chatMuted,player=state.playerId,uid=state.uid,matchNumber=Number(state.room.matchNumber||1),fb=state.firebase;
  publishingChatMute=true;
  try{
    const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${state.roomCode}/public`),room=>{
      if(!room||room.status==='closed'||Number(room.matchNumber||1)!==matchNumber||room.players?.[player]?.uid!==uid)return;
      return {...room,chatPreferences:{...(room.chatPreferences||{}),[player]:{uid,muted:desired}}};
    },{applyLocally:false});
    if(!result.committed)throw new Error('chat-unavailable');
  }catch(error){
    console.error('[truco:chat-mute]',error);
    if(key===chatContextKey()&&chatMuted===desired){
      const current=state.room?.chatPreferences?.[player];chatMuted=!!(current?.muted&&current.uid===uid);
      $('chat-muted').checked=chatMuted;updateChatUnread();
      $('chat-error').textContent='No se pudo cambiar el silencio. Volvé a intentar.';$('chat-error').classList.remove('hidden');
    }
  }finally{
    publishingChatMute=false;
    if(key!==chatContextKey()||chatMuted!==desired)publishChatMute();
  }
}
function chatContextKey(){return `${state.roomCode}:${state.room?.createdAt||''}:${state.room?.matchNumber||1}:${state.playerId}`;}
function clearChatNotices(){
  for(const timer of matchChat.noticeTimers.values())clearTimeout(timer);
  matchChat.noticeTimers.clear();$('chat-notices')?.replaceChildren();
}
function closeMatchChat(clearNotices=false){
  matchChat.open=false;$('chat-backdrop')?.classList.add('hidden');$('match-chat')?.classList.add('hidden');$('chat-toggle')?.setAttribute('aria-expanded','false');
  if(clearNotices)clearChatNotices();
}
function chatMessageList(room){
  return Object.entries(room?.chatMessages||{}).filter(([,message])=>message&&['player1','player2'].includes(message.sender)&&typeof message.text==='string'&&message.text.trim()&&message.text.length<=CHAT_LIMIT&&Number.isFinite(message.at)).map(([id,message])=>({id,...message})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
function renderChatHistory(){
  const history=$('chat-history');
  const previousScroll=history.scrollTop;
  const nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<32;
  history.replaceChildren();
  if(!matchChat.messages.length){const empty=document.createElement('p');empty.className='chat-empty';empty.textContent='Todavía no hay mensajes.';history.append(empty);}
  for(const message of matchChat.messages){
    const item=document.createElement('div');item.className='chat-message'+(message.sender===state.playerId?' chat-message-mine':'');
    const name=document.createElement('strong');name.textContent=message.sender===state.playerId?'Vos':state.room.players?.[message.sender]?.name||'Rival';
    const text=document.createElement('p');text.textContent=message.text;
    item.append(name,text);history.append(item);
  }
  history.scrollTop=nearBottom||!matchChat.open?history.scrollHeight:previousScroll;
}
function updateChatUnread(){
  $('chat-toggle').setAttribute('aria-label',(chatMuted?'Abrir chat, mensajes silenciados':'Abrir chat')+(matchChat.unread?`, ${matchChat.unread} mensajes nuevos`:''));
  $('chat-toggle').classList.toggle('chat-is-muted',chatMuted);
}
function showChatNotice(message){
  const notice=document.createElement('div');notice.className='chat-notice';
  const content=document.createElement('div'),name=document.createElement('strong'),text=document.createElement('p'),close=document.createElement('button');
  name.textContent=state.room.players?.[message.sender]?.name||'Rival';text.textContent=message.text;
  close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar mensaje');
  const dismiss=()=>{clearTimeout(matchChat.noticeTimers.get(message.id));matchChat.noticeTimers.delete(message.id);notice.remove();};
  close.addEventListener('click',dismiss);content.append(name,text);notice.append(content,close);$('chat-notices').append(notice);
  matchChat.noticeTimers.set(message.id,setTimeout(dismiss,CHAT_NOTICE_MS));
}
function syncMatchChat(){
  const available=chatAvailable();$('chat-toggle').classList.toggle('hidden',!available);
  if(!available){closeMatchChat(true);return;}
  const key=chatContextKey(),messages=chatMessageList(state.room),fresh=matchChat.key!==key;
  if(fresh){
    chatMuted=false;
    closeMatchChat(true);matchChat.key=key;matchChat.seen=new Set(messages.map(message=>message.id));matchChat.unread=0;matchChat.signature='';matchChat.sending=false;
    $('chat-input').value='';$('chat-count').textContent='0/40';$('chat-send').disabled=false;$('chat-error').classList.add('hidden');
  }
  if(!fresh)for(const message of messages){
    if(matchChat.seen.has(message.id))continue;
    matchChat.seen.add(message.id);
    if(message.sender===state.playerId)continue;
    if(!matchChat.open)matchChat.unread++;
    if(!chatMuted&&!matchChat.open&&$('game-view').classList.contains('active'))showChatNotice(message);
  }
  matchChat.messages=messages;
  const signature=JSON.stringify(messages);
  if(signature!==matchChat.signature){matchChat.signature=signature;renderChatHistory();}
  $('chat-muted').checked=chatMuted;updateChatUnread();renderChatComposer();
  if(fresh)publishChatMute();
}
function openMatchChat(){
  syncMatchChat();if(!chatAvailable())return;
  matchChat.open=true;matchChat.unread=0;clearChatNotices();updateChatUnread();
  $('chat-backdrop').classList.remove('hidden');$('match-chat').classList.remove('hidden');$('chat-toggle').setAttribute('aria-expanded','true');
  $('chat-history').scrollTop=$('chat-history').scrollHeight;$('chat-close').focus();
}
async function sendMatchChat(event){
  event.preventDefault();if(liveActionsBlocked()||!chatAvailable()||matchChat.sending||peerChatMuted()){renderChatComposer();return;}
  const input=$('chat-input'),draft=input.value,text=draft.trim();
  if(!text||text.length>CHAT_LIMIT)return;
  const code=state.roomCode,key=chatContextKey(),sender=state.playerId,uid=state.uid,matchNumber=Number(state.room.matchNumber||1);
  matchChat.sending=true;$('chat-send').disabled=true;$('chat-error').classList.add('hidden');
  try{
    const fb=state.firebase,messageRef=fb.push(fb.ref(fb.db,`rooms/${code}/public/chatMessages`));
    const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
      if(!room||room.status==='closed'||Number(room.matchNumber||1)!==matchNumber||room.players?.[sender]?.uid!==uid||!room.players?.[otherPlayer(sender)]||peerChatMuted(room))return;
      return {...room,chatMessages:{...(room.chatMessages||{}),[messageRef.key]:{sender,text,at:gameTime()}}};
    },{applyLocally:false});
    if(!result.committed){
      if(key===chatContextKey()&&peerChatMuted(result.snapshot?.val())){state.room=result.snapshot.val();renderChatComposer();return;}
      throw new Error('chat-unavailable');
    }
    if(key===chatContextKey()&&input.value===draft){input.value='';$('chat-count').textContent='0/40';input.focus();}
  }catch(error){
    console.error('[truco:chat]',error);
    if(key===chatContextKey()){$('chat-error').textContent='No se pudo enviar. Volvé a intentar.';$('chat-error').classList.remove('hidden');}
  }finally{if(key===chatContextKey()){matchChat.sending=false;renderChatComposer();}}
}
function showView(id) { document.documentElement.classList.remove('opening-invitation'); views.forEach((name) => $(name).classList.toggle('active', name === id)); if(id!=='game-view')closeMatchChat(true); }
function liveActionsBlocked(){
  return !!(state.room&&!state.localGame&&(navigator.onLine===false||state.firebaseConnected!==true||state.connectionReady!==true));
}
function syncLiveControls(){
  const blocked=liveActionsBlocked(),busy=!!(state.liveAction||state.playActionInFlight||state.foldInFlight);
  $('game-view').classList.toggle('connection-recovering',blocked);
  $('game-view').classList.toggle('action-sending',busy);
  for(const button of document.querySelectorAll('#player-actions button,#envido-picker button,#draw-deck,#request-rematch,#accept-rematch,#decline-rematch'))button.disabled=blocked||busy||rematchInFlight;
  $('fold-hand').disabled=blocked||busy||!canFoldHand(state.room,state.playerId);
  for(const card of $('hand').querySelectorAll('.hand-card'))card.disabled=blocked||busy;
}
async function refreshLiveConnection(){
  if(!state.room||state.localGame||state.firebaseConnected!==true)return;
  const code=state.roomCode,epoch=state.connectionEpoch||0,key=code+':'+epoch;
  if(state.connectionSyncKey===key)return;
  state.connectionSyncKey=key;state.connectionReady=false;
  try{
    const fb=state.firebase,player=state.playerId;
    const [publicSnap,privateSnap]=await Promise.all([
      fb.get(fb.ref(fb.db,'rooms/'+code+'/public')),
      player==='table'?Promise.resolve(null):fb.get(fb.ref(fb.db,'hands/'+code+'/'+state.uid))
    ]);
    if(state.localGame||state.roomCode!==code||(state.connectionEpoch||0)!==epoch||state.firebaseConnected!==true)return;
    const room=publicSnap.val();
    if(!room||room.status==='closed'){returnToLobby('La mesa ya no está disponible.');return;}
    if(roomSeatForUid(room,state.uid)!==player){returnToLobby('Tu lugar ya no está disponible.');return;}
    const deal=privateSnap?.val();
    if(player!=='table'&&['started','timed-out'].includes(room.status)&&!privateHandMatchesRoom(deal,room))throw new Error('hand-sync-pending');
    state.room=room;state.privateDeal=deal||null;syncPrivateHand();
    await syncRoomPresence();
    if(state.roomCode!==code||state.localGame||(state.connectionEpoch||0)!==epoch||state.firebaseConnected!==true)return;
    if(player!=='table'&&['started','timed-out'].includes(state.room.status)&&!privateHandMatchesRoom(state.privateDeal,state.room))throw new Error('hand-sync-pending');
    state.connectionReady=true;renderGame();publishChatMute();
  }catch(error){
    console.warn('[truco:resync]',error);
    if(state.roomCode===code&&(state.connectionEpoch||0)===epoch&&state.firebaseConnected===true){
      clearTimeout(state.connectionSyncRetry);
      state.connectionSyncRetry=setTimeout(refreshLiveConnection,1000);
    }
  }finally{if(state.connectionSyncKey===key)state.connectionSyncKey=null;syncLiveControls();}
}
function touchFeedback(button){
  if(!button)return;
  button.animate?.([{filter:'brightness(1)'},{filter:'brightness(1.3)'},{filter:'brightness(1)'}],{duration:220});
}
async function runLiveAction(button,action){
  if(liveActionsBlocked()||state.liveAction||state.playActionInFlight||state.foldInFlight)return;
  touchFeedback(button);
  if(state.localGame){await action();return;}
  const token={code:state.roomCode,buttonId:button?.id,action:button?.dataset?.action};state.liveAction=token;
  button?.classList.add('action-pending');button?.setAttribute('aria-busy','true');syncLiveControls();renderConnectionNotice();
  try{await action();}
  catch(error){console.error('[truco:action]',error);toast(firebaseError(error),true);}
  finally{
    if(state.liveAction===token)state.liveAction=null;
    button?.classList.remove('action-pending');button?.removeAttribute('aria-busy');
    if(state.roomCode===token.code){renderGame();syncLiveControls();}
  }
}
function suitSvg(suit){
  const paths={
    table:'<path d="M5 14h38v6H5zM9 20h5v23H9zM34 20h5v23h-5zM10 5h28l5 9H5z"/>',
    oro:'<path d="M24 3 42 24 24 45 6 24 24 3Z"/><path d="m24 11 11 13-11 13-11-13 11-13Z" class="suit-cutout"/>',
    copa:'<path d="M5 8h38v5c0 12-7 20-16 22v5h9v5H12v-5h9v-5C12 33 5 25 5 13V8Z"/><path d="M10 13c0 9 5 15 14 18 9-3 14-9 14-18H10Z" class="suit-cutout"/>',
    espada:'<path d="M24 3C19 12 6 20 6 31c0 8 6 12 13 10l-5 5h20l-5-5c7 2 13-2 13-10C42 20 29 12 24 3Z"/><path d="M24 12 12 29c-2 4 0 8 4 8 3 0 5-2 8-6 3 4 5 6 8 6 4 0 6-4 4-8L24 12Z" class="suit-cutout"/>',
    basto:'<path d="M19 5c-8-6-17 2-12 10-9 4-5 17 5 16 3 0 5-1 7-4l2 7-7 7v4h20v-4l-7-7 2-7c2 3 4 4 7 4 10 1 14-12 5-16 5-8-4-16-12-10l-5 5-5-5Z"/><path d="M14 12c-3-3-6 0-4 3-4 1-3 6 1 6 2 0 3-1 4-3l5 11 2 1 2-1 5-11c1 2 2 3 4 3 4 0 5-5 1-6 2-3-1-6-4-3l-6 6-6-6Z" class="suit-cutout"/>'
  };
  return `<svg class="suit-icon suit-${suit}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${paths[suit]||paths.basto}</svg>`;
}
function setupSuitIcons(root=document){root.querySelectorAll('[data-suit-icon]').forEach(el=>{el.innerHTML=suitSvg(el.dataset.suitIcon);});}
function updateMode(mode){
  const two=mode==='two';$('device-mode').value=mode;
  $('use-table-device').checked=!two;
  $('role-options').classList.toggle('hidden',two);$('role-label').classList.toggle('hidden',two);
  if(two)pickRole('player1');
}
function renderPointsPicker(){
  const menu=$('points-picker-menu'),select=$('target-points');
  menu.innerHTML=[10,20,30,40,50,60].map(points=>`<button type="button" class="points-option ${Number(select.value)===points?'selected':''}" role="option" aria-selected="${Number(select.value)===points}" data-points="${points}">${points}<span>puntos</span></button>`).join('');
  $('points-picker-trigger').querySelector('span').textContent=`${select.value} puntos`;
  menu.querySelectorAll('[data-points]').forEach(option=>option.addEventListener('click',()=>{
    select.value=option.dataset.points;renderPointsPicker();menu.classList.add('hidden');$('points-picker-trigger').setAttribute('aria-expanded','false');
  }));
}
function toast(message, global = false) {
  const el = $(global ? 'global-toast' : 'toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}
function makeCode() { return Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join(''); }
const callSeen=new Map();
const receivedCallNotices=new Map();
let soundEnabled=localStorage.getItem('truco-call-sound')==='on';
let voiceUnlocked=false;
let activeVoiceUtterance=null;
function unlockVoice(){
  if(voiceUnlocked||!soundEnabled||!('speechSynthesis' in window))return;
  // Start a silent synthesis session directly inside the user's gesture on iOS.
  try{
    const synth=window.speechSynthesis;
    const primer=new SpeechSynthesisUtterance('.');
    primer.lang='es-ES';primer.volume=0;
    activeVoiceUtterance=primer;
    synth.speak(primer);
    synth.resume();
    voiceUnlocked=true;
  }catch(error){console.warn('[truco:voice] unlock failed',error);}
}
let callNoticeTimer=null;
const CALL_NOTICE_DURATION=4000;
function spokenCall(text=''){
  if(/\bdice QUIERO\b/i.test(text))return 'Quiero';
  if(/\bresponde:\s*tiene\b/i.test(text))return 'Tiene';
  if(/se fue al mazo/i.test(text))return 'Me voy al mazo';
  const points=text.match(/\bcanta (\d+) (tantos|son mejores|son iguales)\b/i);
  if(points)return `${points[1]} ${points[2]}`;
  if(/: son buenas\./i.test(text))return 'Son buenas';
  if(!/\b(canta|dice|responde|quiere)\b/i.test(text))return null;
  if(/no quiere/i.test(text))return 'No quiero';
  if(/quiere/i.test(text))return 'Quiero';
  return ['contra flor al resto','con flor envido','falta envido','real envido','envido','vale cuatro','retruco','truco','flor'].find(call=>text.toLowerCase().includes(call))||null;
}
function callNoticeText(text=''){
  return text.replace(/\bcanta (?=(?:envido|real envido|falta envido|truco|retruco|vale cuatro)\b)/gi,'dice ').replace(/(\bcanta flor\.)[\s\S]*$/i,'$1');
}
function callNoticeHtml(notice,room=state.room){
  const main=notice.spoken||spokenCall(notice.text||'');
  if(!main)return escapeHtml(callNoticeText(notice.text||''));
  const name=room?.players?.[notice.from]?.name||'Tu rival';
  const verb=main.toLowerCase()==='flor'?'canta':'dice';
  return `${escapeHtml(name)} ${verb} <strong>${escapeHtml(main.toLocaleUpperCase('es-UY'))}</strong>`;
}
function makeCallNotice(text){
  text=callNoticeText(text);
  const spoken=spokenCall(text);
  if(!spoken||!['player1','player2'].includes(state.playerId))return null;
  return {...(spoken==='Me voy al mazo'?{kind:'fold'}:{}),id:crypto.randomUUID(),from:state.playerId,to:state.playerId==='player1'?'player2':'player1',text:spoken==='Tiene'||spoken==='Me voy al mazo'?text.split('.')[0]+'.':/\bcanta \d+ (tantos|son mejores|son iguales)\b/i.test(text)?spoken:text,spoken,time:Date.now(),handNumber:state.room?.handNumber||1};
}

let roundPauseTimer=null;
const roundPauseArrivals=new Map();
function gameTime(){return Date.now()+(state.localGame?0:Number(state.serverTimeOffset)||0);}
function roundPauseInfo(room=state.room){
  if(!room)return null;
  let key,endsAt,duration,label;
  if(room.resolvingTrick){
    key='trick:'+room.resolutionId;endsAt=room.resolutionEndsAt;duration=3000;
    const next=room.resolvedTrickWinner||room.mano;
    label=room.handComplete?'Siguiente mano':next===state.playerId?'Jugás en':'Pausa';
  }else if(room.status==='revealing'&&room.endReveal){
    key='reveal:'+room.endReveal.id;endsAt=room.endReveal.endsAt;duration=state.learning?3000:5000;label='Siguiente mano';
  }else if(room.pendingNextHand){
    key='redeal:'+room.pendingNextHand.id;endsAt=room.pendingNextHand.endsAt;duration=3000;label='Siguiente mano';
  }else return null;
  const arrivalKey=`${state.roomCode}:${room.handNumber}:${key}`;
  if(!Number.isFinite(Number(endsAt))||endsAt==null){
    if(!roundPauseArrivals.has(arrivalKey))roundPauseArrivals.set(arrivalKey,gameTime()+duration);
    endsAt=roundPauseArrivals.get(arrivalKey);
  }
  return {key,label,endsAt:Number(endsAt),seconds:Math.max(0,Math.ceil((Number(endsAt)-(state.learning?.paused?(state.learning.pausedAt??gameTime()):gameTime()))/1000))};
}
function pauseMessage(){
  const pause=roundPauseInfo();
  if(!pause)return null;
  return pause.seconds>0?`Pausa entre jugadas: faltan ${pause.seconds} ${pause.seconds===1?'segundo':'segundos'}.`:'La pausa terminó. Esperá un instante mientras continúa la partida.';
}
function renderRoundPauseTimer(){
  clearTimeout(roundPauseTimer);roundPauseTimer=null;
  const el=$('round-pause-timer'),pause=roundPauseInfo();
  const visible=!!pause&&state.playerId!=='table'&&$('game-view').classList.contains('active');
  el.classList.toggle('hidden',!visible);
  $('turn-badge').classList.toggle('pause-countdown',!!pause);
  if(!visible){el.textContent='';return;}
  if(el.parentElement!==$('turn-badge'))$('turn-badge').append(el);
  el.textContent=pause.seconds+' s';
  roundPauseTimer=setTimeout(()=>renderRoundPauseTimer(),200);
}

function speakCall(text){
  if(!soundEnabled||!voiceUnlocked||!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(text);
  utterance.lang='es-UY';utterance.rate=.88;utterance.pitch=.55;
  const voices=window.speechSynthesis.getVoices();
  utterance.voice=voices.find(v=>v.lang==='es-UY')||voices.find(v=>/^es[-_]/i.test(v.lang))||null;
  utterance.lang=utterance.voice?.lang||'es-ES';
  activeVoiceUtterance=utterance;
  utterance.volume=1;
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
}
function renderCallNotice(){
  const role=state.playerId,key=`${state.roomCode}:${role}`;
  const liveNotice=state.room?.callNotice;
  const cached=receivedCallNotices.get(key)?.notice;
  const notice=liveNotice||cached;
  const button=$('player-sound-toggle');
  button.classList.toggle('hidden',role==='table');
  button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/>${soundEnabled?'<path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>':'<path d="m3 3 18 18"/>'}</svg>`;
  button.setAttribute('aria-label',soundEnabled?'Silenciar voz':'Activar voz');
  button.title=soundEnabled?'Silenciar voz':'Activar voz';
  button.setAttribute('aria-pressed',String(soundEnabled));
  const el=$('call-notice');
  clearTimeout(callNoticeTimer);callNoticeTimer=null;
  const addressed=notice?.to===role&&(notice.kind==='fold'||!notice.handNumber||notice.handNumber===state.room?.handNumber);
  let received=receivedCallNotices.get(key);
  if(addressed&&received?.id!==notice.id){
    received={id:notice.id,at:Date.now(),pinned:false,notice};
    receivedCallNotices.set(key,received);
  }
  const remaining=received&&notice&&received.id===notice.id?CALL_NOTICE_DURATION-(Date.now()-received.at):0;
  const pending=state.room?.pendingBet;
  const awaitingResponse=addressed&&notice?.kind!=='fold'&&pending&&notice.from===pending.caller&&
    (pending.revealMode?pending.revealTurn===role:pending.responder===role);
  if(awaitingResponse&&received)received.pinned=true;
  const foldVisible=notice?.kind==='fold'&&remaining>0;
  const visible=addressed&&(foldVisible||(notice?.kind!=='fold'&&(awaitingResponse||(!received?.pinned&&remaining>0))));
  const tutorialOpen=$('learning-hint').open&&!!state.learning?.activeTutorial;
  const teachingNotice=visible&&!tutorialOpen&&$('learning-hint').open&&!state.learning?.activeScoreMessage;
  const helpNotice=$('learning-call-notice');
  helpNotice.classList.toggle('hidden',!teachingNotice);
  helpNotice.innerHTML=teachingNotice?callNoticeHtml(notice):'';
  el.classList.toggle('hidden',!visible||teachingNotice||tutorialOpen);
  el.innerHTML=visible?callNoticeHtml(notice):'';
  if(!visible)return;
  if(!awaitingResponse)callNoticeTimer=setTimeout(()=>{callNoticeTimer=null;renderCallNotice();},Math.max(0,remaining));
  if(callSeen.get(key)!==notice.id){
    callSeen.set(key,notice.id);
    speakCall(notice.spoken);
  }
}
function cleanName(value, fallback) { return value.trim().slice(0,18) || fallback; }
function savedPlayerName() {
  try { return localStorage.getItem('truco-player-name') || ''; } catch { return ''; }
}
function rememberPlayerName(name) {
  try {
    if(name) localStorage.setItem('truco-player-name', name);
    else localStorage.removeItem('truco-player-name');
  } catch { /* The game can still be used when browser storage is unavailable. */ }
}
$('player-name').value = savedPlayerName();
$('player-name').addEventListener('input', event => {
  rememberPlayerName(cleanName(event.target.value, ''));
});
function pickRole(role) {
  state.role = role;
  document.querySelectorAll('.role-card').forEach((card) => card.classList.toggle('selected', card.dataset.role === role));
  $('enter-room').textContent = 'Crear mesa';
  document.querySelectorAll('.role-card').forEach(card=>card.setAttribute('aria-pressed',String(card.dataset.role===role)));
}
function isCoordinator() { return state.playerId === 'table' || (state.room?.deviceMode === 'two' && state.room.table?.uid === state.uid); }
function configureSetup() {
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  state.invitationEntry=false;
  $('play-bot').checked=false;updateBotSetup();
  state.joining = false;
  $('role-options').classList.remove('single');
  $('role-options').querySelectorAll('.role-card').forEach((card) => card.classList.remove('hidden'));
  updateMode('two');
  pickRole('player1');
  showView('setup-view');
}
function firebaseConfigValid(config) { return !!(config && config.apiKey && config.databaseURL && config.projectId && config.appId); }
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
}
let firebaseReadyPromise=null;
async function firebaseServices() {
  if(state.firebase)return state.firebase;
  if(firebaseReadyPromise)return firebaseReadyPromise;
  firebaseReadyPromise=(async()=>{
    const [appSdk,dbSdk,authSdk]=await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]);
    const app=appSdk.getApps().length?appSdk.getApp():appSdk.initializeApp(state.config);
    const auth=authSdk.getAuth(app);
    await auth.authStateReady();
    if(!auth.currentUser)await authSdk.signInAnonymously(auth);
    state.uid=auth.currentUser.uid;
    state.firebase={db:dbSdk.getDatabase(app,state.config.databaseURL),...dbSdk};
    dbSdk.onValue(dbSdk.ref(state.firebase.db,'.info/serverTimeOffset'),snapshot=>{state.serverTimeOffset=Number(snapshot.val())||0;},error=>console.error('[truco:clock]',error));
    dbSdk.onValue(dbSdk.ref(state.firebase.db,'.info/connected'),snapshot=>{
      state.firebaseConnected=snapshot.val()===true;
      state.connectionEpoch=(state.connectionEpoch||0)+1;state.connectionReady=false;
      if(state.firebaseConnected){roomPresenceContext=null;presenceWriteSerial++;syncRoomPresence();retryRoomRestore();refreshLiveConnection();}
      if(state.room)renderTurnTimer();
    },error=>console.error('[truco:connection]',error));
    console.info('[truco:connection] authentication ready');
    return state.firebase;
  })().catch(error=>{firebaseReadyPromise=null;throw error;});
  return firebaseReadyPromise;
}
async function runPendingAction() {
  const action = state.nextAction; state.nextAction = null;
  if (action === 'enter') await enterRoom();
  if (action === 'lobby') await openLobby();
}
function showConfig() {
  $('firebase-config').value = state.config ? JSON.stringify(state.config, null, 2) : '';
  showView('config-view');
}
function roomSeatForUid(room,uid){
  if(!room||!uid)return null;
  return ['player1','player2'].find(key=>room.players?.[key]?.uid===uid)
    ||(room.deviceMode!=='two'&&room.table?.uid===uid?'table':null);
}
function claimRoomSeat(current,person,role){
  // An uncached null must be retried against the server, not treated as a full table.
  if(current===null)return null;
  if(current.status==='closed'||roomExpired(current))return;
  if(roomSeatForUid(current,person.uid))return current;
  if(current.status!=='waiting')return;
  const players=current.players||{};
  if(role==='table'&&current.deviceMode!=='two'){
    if(current.table)return;
    return {...current,table:person};
  }
  const seat=!players.player1?'player1':!players.player2?'player2':null;
  if(!seat)return;
  return {...current,players:{...players,[seat]:person}};
}

function savedRoomSeat(){
  try{
    const seat=JSON.parse(localStorage.getItem('truco-last-seat')||'null');
    return /^[A-Z2-9]{5}$/.test(seat?.code||'')?seat:null;
  }catch{return null;}
}
function setRoomUrl(code){
  const url=new URL(location.href);
  if(code)url.searchParams.set('mesa',code);else url.searchParams.delete('mesa');
  history.replaceState(null,'',url);
}
function forgetRoomSeat(code){
  const saved=savedRoomSeat();
  if(!code||saved?.code===code){try{localStorage.removeItem('truco-last-seat');}catch{}}
  if(!code||new URLSearchParams(location.search).get('mesa')===code)setRoomUrl(null);
}
function rememberRoomSeat(){
  state.persistedRoomCreatedAt=state.room?.createdAt;
  setRoomUrl(state.roomCode);
  try{localStorage.setItem('truco-last-seat',JSON.stringify({code:state.roomCode,role:state.playerId,uid:state.uid,createdAt:state.room?.createdAt}));}catch{}
}
function attachLiveRoom(code,seat,room){
  state.privateUnsubscribe?.();state.privateUnsubscribe=null;state.privateHandKey=null;state.privateDeal=null;
  state.roomCode=code;state.playerId=seat;state.role=seat;state.joining=false;state.invitationEntry=false;
  state.localGame=false;state.hand=[];state.room=room;state.restorePending=null;state.connectionReady=false;
  state.lobbyUnsubscribe?.();state.lobbyUnsubscribe=null;
  rememberRoomSeat();
  showView(['drawing','started','revealing','complete','timed-out'].includes(room.status)?'game-view':'waiting-view');
  watchRoom();
  if(room.status==='waiting')renderWaiting();
  refreshLiveConnection();
}
async function restoreRoom(code){
  if(!/^[A-Z2-9]{5}$/.test(code||'')||!firebaseConfigValid(state.config))return false;
  const epoch=state.navigationEpoch||0;
  try{
    const fb=await firebaseServices();
    if(epoch!==(state.navigationEpoch||0))return false;
    const snapshot=await fb.get(fb.ref(fb.db,'rooms/'+code+'/public'));
    if(epoch!==(state.navigationEpoch||0))return false;
    const room=snapshot.val(),saved=savedRoomSeat();
    const seat=roomSeatForUid(room,state.uid);
    if(!room||room.status==='closed'||roomExpired(room)){
      forgetRoomSeat(code);return false;
    }
    if(!seat||(saved?.code===code&&saved.createdAt!=null&&saved.createdAt!==room.createdAt)){
      if(saved?.code===code){try{localStorage.removeItem('truco-last-seat');}catch{}}
      return false;
    }
    attachLiveRoom(code,seat,room);
    return true;
  }catch(error){
    console.error('[truco:restore]',error);
    if(epoch===(state.navigationEpoch||0))state.restorePending={code,epoch};
    return false;
  }
}
async function retryRoomRestore(){
  const pending=state.restorePending;
  if(!pending||state.room||pending.epoch!==(state.navigationEpoch||0))return;
  state.restorePending=null;
  await restoreRoom(pending.code);
}
async function openInitialRoom(){
  const epoch=state.navigationEpoch||0;
  const invitedRoom=new URLSearchParams(location.search).get('mesa');
  const code=invitedRoom||savedRoomSeat()?.code;
  if(code&&await restoreRoom(code))return;
  if(epoch!==(state.navigationEpoch||0)||state.room)return;
  if(invitedRoom&&new URLSearchParams(location.search).get('mesa')===invitedRoom)await openInvitation(invitedRoom);
  else if(firebaseConfigValid(state.config))await openLobby();
}

async function enterRoom() {
  if(state.enteringRoom)return;
  const entryEpoch=state.navigationEpoch;
  state.enteringRoom=true;$('enter-room').disabled=true;
  const cardsReady=await prepareCardImages();
  state.enteringRoom=false;$('enter-room').disabled=false;
  if(!cardsReady||state.navigationEpoch!==entryEpoch)return;
  if(state.invitationEntry&&!$('player-name').value.trim()){showInvitationForm();$('invite-name').focus();return;}
  const name=cleanName($('player-name').value,state.role==='table'?'La mesa':'Jugador');
  if(!state.joining&&$('play-bot').checked){await startBotGame(name);return;}
  if(!firebaseConfigValid(state.config)){state.nextAction='enter';showConfig();return;}
  state.enteringRoom=true;
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  const request={joining:state.joining,code:state.selectedRoom,role:state.role};
  $('enter-room').disabled=true;
  console.info('[truco:join] begin',{joining:request.joining,code:request.code||null});
  try{
    const fb=await firebaseServices();
    let joinedRoom;
    if(request.joining){
      const code=request.code,roomRef=fb.ref(fb.db,`rooms/${code}/public`);
      const snap=await fb.get(roomRef);
      if(!snap.exists()){toast('La invitación ya no está disponible.',true);await openLobby();return;}
      let room=snap.val(),seat=roomSeatForUid(room,state.uid);
      if(room.status==='closed'||roomExpired(room)){toast('La mesa ya está cerrada.',true);await openLobby();return;}
      // Existing players may reconnect even after the automatic start.
      if(!seat){
        if(room.status!=='waiting'){toast('La partida ya empezó y no tenés un lugar en esta mesa.',true);await openLobby();return;}
        const person={uid:state.uid,name,online:true};
        const claim=await fb.runTransaction(roomRef,current=>claimRoomSeat(current,person,request.role),{applyLocally:false});
        room=claim.snapshot.val();
        seat=roomSeatForUid(room,state.uid);
        if(!seat||room?.status==='closed'||roomExpired(room)){
          toast('La mesa se cerró o ya no hay lugares disponibles.',true);await openLobby();return;
        }
      }
      state.roomCode=code;state.playerId=seat;joinedRoom=room;
    }else{
      const code=makeCode(),deviceMode=$('device-mode').value;
      const role=deviceMode==='two'?'player1':request.role;
      const person={uid:state.uid,name,online:true};
      const targetPoints=normalizeTargetPoints($('target-points').value);
      joinedRoom={deviceMode,status:'waiting',createdAt:Date.now(),targetPoints,
        table:deviceMode==='two'||role==='table'?person:null,
        players:{player1:role==='player1'?person:null,player2:role==='player2'?person:null},
        scores:{player1:0,player2:0},handNumber:1,deckCount:40,trickCards:[],
        feed:[{text:`${name} abrió una mesa a ${targetPoints}. Faltan los demás.`,time:Date.now()}]};
      await fb.set(fb.ref(fb.db,`rooms/${code}/public`),joinedRoom);
      state.roomCode=code;state.playerId=role;
    }
    rememberPlayerName(name);
    attachLiveRoom(state.roomCode,state.playerId,joinedRoom);
    console.info('[truco:join] seated',{code:state.roomCode,role:state.playerId,status:joinedRoom.status});
  }catch(error){
    console.error('[truco:join] failed',error);toast(firebaseError(error),true);
    if(state.invitationEntry)showInvitationForm();
  }finally{
    state.enteringRoom=false;$('enter-room').disabled=false;
  }
}
function invitationLink(code){
  const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('mesa',code);return url.href;
}
function updateInvitation(){
  const link=$('invite-whatsapp');
  link.classList.toggle('hidden',!state.roomCode||state.localGame||state.room?.status!=='waiting');
  if(state.roomCode){const message=`Te da para un truquito? Entra a mi mesa: ${invitationLink(state.roomCode)}`;link.href=`https://wa.me/?text=${encodeURIComponent(message)}`;}
}
function showInvitationForm(){
  showView('invite-view');
  $('invite-loading').classList.add('hidden');
  $('invite-form').classList.remove('hidden');
  $('invite-name').focus();
}
async function openInvitation(code){
  showView('invite-view');
  if(!/^[A-Z2-9]{5}$/.test(code)){toast('La invitación no es válida.',true);await openLobby();return;}
  state.joining=true;state.invitationEntry=true;state.selectedRoom=code;state.role='player';
  $('invite-name').value=savedPlayerName();
  showInvitationForm();
}
$('invite-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name=$('invite-name').value.trim();
  if(!name){$('invite-name').focus();return;}
  $('player-name').value=name;
  $('invite-form').classList.add('hidden');
  $('invite-loading').classList.remove('hidden');
  showView('invite-view');
  await enterRoom();
});
$('invite-cancel').addEventListener('click',()=>{
  if(state.enteringRoom)return;
  state.invitationEntry=false;state.joining=false;
  const url=new URL(location.href);url.searchParams.delete('mesa');history.replaceState(null,'',url);
  openLobby();
});
async function openLobby() {
  if (!firebaseConfigValid(state.config)) { state.nextAction = 'lobby'; showConfig(); return; }
  try {
    const navigationEpoch=state.navigationEpoch||0;
    const fb = await firebaseServices();
    if(navigationEpoch!==(state.navigationEpoch||0))return;
    showView('welcome-view');
    $('open-room-list').innerHTML = '<p class="muted">Buscando mesas abiertas…</p>';
    if (state.lobbyUnsubscribe) state.lobbyUnsubscribe();
    state.lobbyUnsubscribe = fb.onValue(fb.ref(fb.db, 'rooms'), (snapshot) => {state.lobbyRooms=snapshot.val()||{};renderLobby(state.lobbyRooms);}, (error) => {
      console.error(error); $('open-room-list').innerHTML = '<p class="muted">No pudimos cargar las mesas. Revisá las reglas de Firebase.</p>';
    });
  } catch (error) {
    console.error(error);
    $('open-room-list').innerHTML = '<p class="muted">No pudimos cargar las mesas. Revisá la conexión y las reglas de Firebase.</p>';
    toast(firebaseError(error));
  }
}
const ROOM_WAIT_LIMIT=10*60*1000;
function roomExpired(room,now=Date.now()){
  return room?.status==='waiting' && !(room.players?.player1&&room.players?.player2) && Number.isFinite(room.createdAt) && now-room.createdAt>=ROOM_WAIT_LIMIT;
}
const closingRooms=new Set();
async function closeExpiredRoom(code){
  if(!state.firebase||closingRooms.has(code))return;
  closingRooms.add(code);
  try {const fb=state.firebase;await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>roomExpired(room)?{...room,status:'closed',closedAt:Date.now()}:undefined);}
  catch(error){console.error(error);}
  finally{closingRooms.delete(code);}
}
setInterval(()=>{
  if(state.lobbyUnsubscribe&&state.lobbyRooms)renderLobby(state.lobbyRooms);
  if(!state.localGame&&roomExpired(state.room))closeExpiredRoom(state.roomCode);
},1000);
function renderLobby(rooms) {
  Object.entries(rooms).forEach(([code,value])=>{if(roomExpired(value?.public))closeExpiredRoom(code);});
  const open = Object.entries(rooms).filter(([, value]) => value?.public?.status === 'waiting' && !roomExpired(value.public) && (!value.public.table || !value.public.players?.player1 || !value.public.players?.player2)).sort((a,b) => (b[1].public.createdAt || 0) - (a[1].public.createdAt || 0));
  if (!open.length) { $('open-room-list').innerHTML = '<div class="empty-lobby"><strong>No hay mesas abiertas todavía</strong></div>'; setupSuitIcons($('open-room-list')); return; }
  $('open-room-list').innerHTML = open.map(([code, value]) => {
    const room = value.public, players = room.players || {}, seats = (room.deviceMode === 'two' ? [] : [['table','La mesa',room.table]]).concat([['player1','Jugador 1',players.player1],['player2','Jugador 2',players.player2]]);
    const title = room.table?.name || players.player1?.name || players.player2?.name || 'Mesa abierta';
    const available = seats.filter(([, , person]) => !person);
    const actions=[];
    if(!players.player1||!players.player2)actions.push(['player','Entrar']);
    if(room.deviceMode!=='two'&&!room.table)actions.push(['table','Mesa']);
    if(room.deviceMode!=='two'&&actions.some(([key])=>key==='player'))actions[0][1]='Jugador';
    return `<article class="lobby-card"><div class="lobby-card-top"><div><h3>${escapeHtml(title)}</h3><p class="lobby-meta">${targetPoints(room)} puntos${room.deviceMode==='two'?'':' · 2 jugadores + mesa'}</p></div><span class="lobby-count" aria-label="${available.length} lugares disponibles">${seats.length-available.length}/${seats.length}</span></div><div class="lobby-join-options">${actions.map(([key,label])=>`<button class="button lobby-player-button" data-room="${code}" data-seat="${key}">${key==='table'?suitSvg('table'):''}${label}</button>`).join('')}</div></article>`;
  }).join('');
}
function joinOpenRoom(code, seat) {
  state.joining = true; state.selectedRoom = code; state.role = seat;
  const name = cleanName($('player-name').value||savedPlayerName(), seat === 'table' ? 'La mesa' : 'Jugador');
  $('player-name').value = name;
  enterRoom();
}
function firebaseError(error) {
  if (error?.code === 'auth/operation-not-allowed') return 'Activá el inicio de sesión anónimo en Firebase y volvé a intentar.';
  if (error?.code?.includes('permission-denied')) return 'Firebase rechazó el acceso. Revisá las reglas de la base.';
  if (error?.message?.includes('Failed to fetch')) return 'No se pudo conectar con Firebase. Revisá la configuración y la conexión.';
  return 'No pudimos conectar la mesa. Revisá la configuración de Firebase.';
}
function watchRoom() {
  const fb = state.firebase,code=state.roomCode;
  const version=(state.roomWatchVersion||0)+1;state.roomWatchVersion=version;
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = fb.onValue(fb.ref(fb.db, `rooms/${code}/public`), (snapshot) => {
    if(code!==state.roomCode||version!==state.roomWatchVersion)return;
    if (!snapshot.exists()) { if(state.unsubscribe){state.unsubscribe();state.unsubscribe=null;}console.warn('[truco:room] unavailable',{code});returnToLobby('La mesa ya no está disponible.');return; }
    const incoming=snapshot.val();
    if(Number(incoming.matchNumber||1)!==Number(state.room?.matchNumber||1)){
      state.privateUnsubscribe?.();state.privateUnsubscribe=null;state.privateHandKey=null;state.privateDeal=null;
      state.hand=[];state.handOrder=[];state.renderedHandNumber=null;state.finalEvidenceKey=null;state.verifiedEnvido=null;
      clearTimeout(state.resolutionTimer);state.resolutionTimer=null;state.resolutionTimerKey=null;
    }
    state.room = incoming;
    if(state.persistedRoomCreatedAt!==incoming.createdAt)rememberRoomSeat();
    syncRoomPresence();
    if(state.room.status==='closed'||roomExpired(state.room)){if(roomExpired(state.room))closeExpiredRoom(state.roomCode);if(state.unsubscribe){state.unsubscribe();state.unsubscribe=null;}const reason=state.room.closeReason;returnToLobby(reason==='draw-timeout'?'Se acabó el tiempo para elegir carta. La partida no comenzó.':reason==='draw-left'?'Un participante salió del sorteo. La partida no comenzó.':'La mesa cerró por inactividad.');return;}
    if(isCoordinator()&&state.room.status==='started'&&!state.room.resolvingTrick&&state.room.trickCards?.length===2&&(state.room.tricks||[]).length>0)recoverLegacyTrick(state.room);
    if(isCoordinator()&&state.room.status==='complete'&&!state.room.endReveal&&(Object.keys(state.room.flors||{}).length||state.room.envidoAudit)){
      const key=`${state.roomCode}:${state.room.handNumber}`;
      if(state.finalEvidenceKey!==key){
        state.finalEvidenceKey=key;
        finishLiveHand(state.room.mano,state.room.scores||{},state.room.feed?.[0]?.text||'Partida terminada.').catch(error=>{state.finalEvidenceKey=null;toast(firebaseError(error));});
      }
    }
    if (isCoordinator()) scheduleTableResolution();
    if (['drawing','started','revealing','complete','timed-out'].includes(state.room.status)) { showView('game-view'); if(state.room.status!=='drawing')watchPrivateHand(); renderGame(); }
    if(isCoordinator()&&state.room.status==='drawing')finishOpeningDraw().catch(error=>toast(firebaseError(error)));
    else if (state.room.status === 'waiting') { renderWaiting(); if (!$('waiting-view').classList.contains('active')) showView('waiting-view'); }
  },error=>{if(code!==state.roomCode||version!==state.roomWatchVersion)return;console.error('[truco:room] subscription failed',{code,error});toast(firebaseError(error),true);});
}
function privateHandMatchesRoom(deal,room){
  if(!deal||!room||(deal.handNumber!=null&&Number(deal.handNumber)!==Number(room.handNumber||1)))return false;
  const expected=room.handCounts?.[state.playerId];
  return expected==null||(deal.hand||[]).length===Number(expected);
}
function syncPrivateHand(){
  if(state.localGame||state.playerId==='table')return;
  const handNumber=state.room?.handNumber||1;
  if(state.renderedHandNumber!==handNumber){
    state.renderedHandNumber=handNumber;state.handGestureActive=false;handGesture=null;
    state.cardLaunchOrigin=null;state.launchingCardId=null;
  }
  state.hand=privateHandMatchesRoom(state.privateDeal,state.room)?(state.privateDeal.hand||[]):[];
}
function watchPrivateHand() {
  if (state.playerId === 'table') return;
  const subscriptionKey=`${state.roomCode}:${state.uid}`;
  if(state.privateUnsubscribe&&state.privateHandKey===subscriptionKey)return;
  if(state.privateUnsubscribe)state.privateUnsubscribe();
  state.privateHandKey=subscriptionKey;
  const fb = state.firebase;
  state.privateUnsubscribe = fb.onValue(fb.ref(fb.db, `hands/${state.roomCode}/${state.uid}`), (snapshot) => {
    if(state.privateHandKey!==subscriptionKey)return;
    state.privateDeal=snapshot.val();
    syncPrivateHand();renderGame();
  },error=>{if(state.privateHandKey!==subscriptionKey)return;console.error('[truco:hand] subscription failed',error);toast(firebaseError(error),true);});
}
function renderWaiting() {
  if (!state.room) return;
  updateInvitation();
  const players = state.room.players || {};
  const ready = !!(state.room.table && players.player1 && players.player2);
  $('room-status').textContent = ready?'Todo listo':state.room.deviceMode==='two'?'Esperando rival':'Esperando jugadores';
  const seatData = (state.room.deviceMode === 'two' ? [] : [['table','LA MESA',state.room.table]]).concat([['player1','JUGADOR 1',players.player1],['player2','JUGADOR 2',players.player2]]);
  $('seats').innerHTML = seatData.map(([key,label,value]) => `<div class="seat ${value?'seat-occupied':'seat-free'}"><span class="seat-icon" data-suit-icon="${key==='table'?'table':key==='player1'?'espada':'copa'}"></span><span class="seat-name"><strong>${escapeHtml(value?.name || (key==='table'?'Dispositivo de mesa':'Lugar disponible'))}</strong>${state.room.deviceMode==='two'?'':`<small>${label}</small>`}</span><span class="seat-state ${value?'ready':''}">${value?'Ocupado':'Libre'}</span></div>`).join('');setupSuitIcons($('seats'));
  if(ready&&isCoordinator())startGame().catch(error=>toast(firebaseError(error),true));
  $('waiting-hint').textContent = ready?'La partida está por comenzar.':players.player1&&players.player2&&!state.room.table?'Falta conectar el dispositivo de mesa.':'Invitá a un amigo para empezar a jugar.';
  $('game-room-code').textContent = 'MESA ABIERTA';
}
function shuffleDeck() {
  const suits = [{name:'oro',symbol:'♦',red:true},{name:'copa',symbol:'♥',red:true},{name:'espada',symbol:'♠',red:false},{name:'basto',symbol:'♣',red:false}];
  const deck = [];
  for (const suit of suits) for (const rank of [1,2,3,4,5,6,7,10,11,12]) deck.push({id:`${suit.name}-${rank}`, rank, suit:suit.symbol, red:suit.red, label:String(rank)});
  for (let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
let startingGame=false;
async function startGame() {
  if(startingGame||state.room?.status!=='waiting'||!isCoordinator()||!state.room.table||!state.room.players?.player1||!state.room.players?.player2)return;
  startingGame=true;
  try{
    const fb=state.firebase,pool=shuffleDeck();
    await fb.runTransaction(fb.ref(fb.db,`rooms/${state.roomCode}/public`),room=>{
      if(room===null)return null;
      if(room.status!=='waiting'||!room.table||!room.players?.player1||!room.players?.player2)return;
      return {...room,status:'drawing',openingDraw:newOpeningDraw(pool),feed:topFeed(room,'Cada jugador toca el mazo para sortear quién reparte.')};
    },{applyLocally:false});
  }finally{startingGame=false;}
}
const OPENING_DRAW_SECONDS=30;
function newOpeningDraw(pool=shuffleDeck()){
  return {pool,cards:{},endsAt:gameTime()+OPENING_DRAW_SECONDS*1000};
}
function openingDrawExpired(room,now=gameTime()){
  const draw=room?.openingDraw;
  return room?.status==='drawing'&&Number.isFinite(draw?.endsAt)&&now>=draw.endsAt&&!(draw.cards?.player1&&draw.cards?.player2);
}
function returnToLobby(message=''){
  stopRoomPresence();
  stopBot();
  clearTimeout(openingTimerHandle);openingTimerHandle=null;
  state.roomWatchVersion=(state.roomWatchVersion||0)+1;
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  state.unsubscribe?.();state.unsubscribe=null;
  state.privateUnsubscribe?.();state.privateUnsubscribe=null;
  state.privateHandKey=null;state.privateDeal=null;
  clearTimeout(state.resolutionTimer);state.resolutionTimer=null;state.resolutionTimerKey=null;
  state.room=null;state.roomCode=null;state.localGame=false;state.hand=[];
  forgetRoomSeat();
  showView('welcome-view');openLobby();
  if(message)toast(message,true);
}
let openingTimerHandle=null,closingOpeningDraw=false;
async function closeOpeningDraw(reason){
  if(closingOpeningDraw||state.room?.status!=='drawing')return;
  closingOpeningDraw=true;
  try{
    if(state.localGame){returnToLobby(reason==='draw-timeout'?'Se acabó el tiempo para elegir carta. La partida no comenzó.':'Volviste al inicio.');return;}
    const fb=state.firebase,code=state.roomCode;
    await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
      if(room===null)return null;
      if(room.status!=='drawing'||(reason==='draw-timeout'&&!openingDrawExpired(room)))return;
      return {...room,status:'closed',closedAt:gameTime(),closeReason:reason};
    },{applyLocally:false});
  }catch(error){console.error('[truco:draw-close]',error);toast(firebaseError(error));}
  finally{closingOpeningDraw=false;}
}
function renderOpeningTimer(){
  clearTimeout(openingTimerHandle);openingTimerHandle=null;
  const room=state.room,el=$('opening-timer');
  if(room?.status!=='drawing'||!$('game-view').classList.contains('active'))return;
  const draw=room.openingDraw;
  if(draw?.cards?.player1&&draw?.cards?.player2){
    if(el){el.textContent='Sorteo completo';el.classList.remove('draw-timer-warning');}
    return;
  }
  if(Number.isFinite(draw?.endsAt)){
    const seconds=Math.max(0,Math.ceil((draw.endsAt-gameTime())/1000));
    if(el){el.textContent=seconds+' s para elegir';el.classList.toggle('draw-timer-warning',seconds<=10);}
    if(openingDrawExpired(room))closeOpeningDraw('draw-timeout');
  }else if(state.localGame)room.openingDraw=newOpeningDraw();
  else if(isCoordinator()&&!closingOpeningDraw){
    // Add a shared deadline to rooms created before this version.
    closingOpeningDraw=true;
    const fb=state.firebase,code=state.roomCode;
    fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),current=>{
      if(current===null)return null;
      if(current.status!=='drawing'||Number.isFinite(current.openingDraw?.endsAt))return;
      return {...current,openingDraw:{...(current.openingDraw||newOpeningDraw()),endsAt:gameTime()+OPENING_DRAW_SECONDS*1000}};
    },{applyLocally:false}).catch(console.error).finally(()=>closingOpeningDraw=false);
  }
  openingTimerHandle=setTimeout(renderOpeningTimer,200);
}
let finishingDraw=false;
let drawInFlight=false;
function otherPlayer(player){return player==='player1'?'player2':'player1';}
async function drawOpeningCard(){
  if(liveActionsBlocked())return;
  const player=state.playerId;
  if(drawInFlight||state.room?.status!=='drawing'||!['player1','player2'].includes(player)||state.room.openingDraw?.cards?.[player])return;
  drawInFlight=true;
  try{
    if(state.localGame){
      const opening=state.room.openingDraw||newOpeningDraw();
      if(openingDrawExpired(state.room)){await closeOpeningDraw('draw-timeout');return;}
      if(!opening.pool?.length)return;
      opening.cards={...(opening.cards||{}),[player]:opening.pool[0]};
      opening.pool=opening.pool.slice(1);
      state.room.openingDraw=opening;renderGame();
      if(opening.cards.player1&&opening.cards.player2)finishOpeningDraw();
      return;
    }
    const fb=state.firebase;
    await fb.runTransaction(fb.ref(fb.db,`rooms/${state.roomCode}/public`),room=>{
      if(room===null)return null;
      const current=room.openingDraw;
      if(room.status!=='drawing'||openingDrawExpired(room)||current?.cards?.[player]||!current?.pool?.length)return;
      return {...room,openingDraw:{...current,cards:{...(current.cards||{}),[player]:current.pool[0]},pool:current.pool.slice(1)}};
    },{applyLocally:false});
  }finally{drawInFlight=false;renderGame();}
}
async function finishOpeningDraw(){
  const draw=state.room?.openingDraw?.cards;
  if(state.room?.status!=='drawing'||!draw?.player1||!draw?.player2||finishingDraw)return;
  finishingDraw=true;
  const code=state.roomCode,room=state.room,deadline=room.openingDraw?.endsAt;
  try{
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(state.roomCode!==code||state.room?.status!=='drawing'||state.room.openingDraw?.endsAt!==deadline)return;
    if(Number(draw.player1.rank)===Number(draw.player2.rank)){
      if(state.localGame){state.room.openingDraw=newOpeningDraw();localFeed('Empate en el saque. Vuelvan a tocar el mazo.');renderGame();}
      else await writeRoom({openingDraw:newOpeningDraw(),feed:topFeed(state.room,'Empate en el saque. Vuelvan a tocar el mazo.')});
      return;
    }
    const dealer=Number(draw.player1.rank)>Number(draw.player2.rank)?'player1':'player2';
    if(state.localGame){state.room.dealer=dealer;state.room.mano=otherPlayer(dealer);state.room.turn=state.room.mano;state.room.status='started';state.hand=state.playerId==='table'?[]:[...state.localHands[state.playerId]];localFeed(`${state.room.players[dealer].name} reparte. Empieza ${state.room.players[state.room.mano].name}.`);}
    else await dealOpeningHand(dealer);
  }finally{finishingDraw=false;if(state.localGame)renderGame();}
}
async function dealOpeningHand(dealer) {
  const code=state.roomCode,drawDeadline=state.room.openingDraw?.endsAt;
  const fb = state.firebase; const deck = shuffleDeck(); const players = state.room.players;
  const hand1 = deck.slice(0,3); const hand2 = deck.slice(3,6);
  const muestra = deck[6];
  const patches = {};
  patches[`hands/${code}/${players.player1.uid}/hand`] = hand1;
  patches[`hands/${code}/${players.player2.uid}/hand`] = hand2;
  patches[`hands/${code}/${players.player1.uid}/handNumber`] = state.room.handNumber||1;
  patches[`hands/${code}/${players.player2.uid}/handNumber`] = state.room.handNumber||1;
  patches[`hands/${code}/${state.room.table.uid}/envidoTruth`] = {player1:handEnvido(hand1,muestra),player2:handEnvido(hand2,muestra)};
  patches[`hands/${code}/${state.room.table.uid}/originalHands`] = {player1:hand1,player2:hand2};
  patches[`rooms/${code}/public/endReveal`] = null;
  patches[`rooms/${code}/public/status`] = 'started';
  patches[`rooms/${code}/public/deckCount`] = 33;
  patches[`rooms/${code}/public/muestra`] = muestra;
  patches[`rooms/${code}/public/handCounts`] = {player1:3,player2:3};
  patches[`rooms/${code}/public/handClaims`] = {player1:3,player2:3};
  patches[`rooms/${code}/public/dealer`] = dealer;
  patches[`rooms/${code}/public/turn`] = otherPlayer(dealer);
  patches[`rooms/${code}/public/mano`] = otherPlayer(dealer);
  patches[`rooms/${code}/public/trickCards`] = [];
  patches[`rooms/${code}/public/trickNo`] = 1;
  patches[`rooms/${code}/public/tricks`] = [];
  patches[`rooms/${code}/public/trucoLevel`] = 1;
  patches[`rooms/${code}/public/lastTrucoCaller`] = null;
  patches[`rooms/${code}/public/pendingBet`] = null;
  patches[`rooms/${code}/public/florSettled`] = false;
  patches[`rooms/${code}/public/flors`] = {};
  patches[`rooms/${code}/public/envidoClosed`] = false;
  patches[`rooms/${code}/public/playedCount`] = 0;
  patches[`rooms/${code}/public/feed`] = [{text:`${players[dealer].name} reparte. Empieza ${players[otherPlayer(dealer)].name}.`,time:Date.now()}];
  const publicPrefix=`rooms/${code}/public/`,privatePatches={},publicChanges={};
  for(const [path,value] of Object.entries(patches)){
    if(path.startsWith(publicPrefix))publicChanges[path.slice(publicPrefix.length)]=value;
    else privatePatches[path]=value;
  }
  await fb.update(fb.ref(fb.db),privatePatches);
  await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
    if(room===null)return null;
    if(room.status!=='drawing'||room.openingDraw?.endsAt!==drawDeadline||!room.openingDraw?.cards?.player1||!room.openingDraw?.cards?.player2)return;
    return {...room,...publicChanges};
  },{applyLocally:false});
}
function pieceOrder(card, muestra) {
  if (!muestra) return 0;
  let rank = Number(card.rank);
  if (card.suit !== muestra.suit) return 0;
  if ([2,4,5,10,11].includes(Number(muestra.rank))) {
    if (rank === Number(muestra.rank)) rank = 12;
    else if (rank === 12) rank = Number(muestra.rank);
  }
  return ({2:5,4:4,5:3,11:2,10:1})[rank] || 0;
}
function cardStrength(card, muestra) {
  const piece = pieceOrder(card, muestra);
  if (piece) return 100 + piece;
  const matas = {'♠-1':90,'♣-1':89,'♠-7':88,'♦-7':87};
  const mata = matas[`${card.suit}-${card.rank}`];
  if (mata) return mata;
  const common = {3:80,2:70,1:60,12:50,11:40,10:30,7:20,6:10,5:5,4:0};
  return common[card.rank] || 0;
}
function envidoValue(card, muestra) {
  const piece = pieceOrder(card, muestra);
  if (piece) return ({5:30,4:29,3:28,2:27,1:27})[piece];
  return [10,11,12].includes(Number(card.rank)) ? 0 : Number(card.rank);
}
function hasFlor(hand, muestra) {
  // Flor: tres del mismo palo, dos o más piezas, o una pieza y dos del mismo palo.
  const pieces = hand.filter((card)=>pieceOrder(card,muestra)>0);
  const suits = hand.reduce((all,card)=>{all[card.suit]=(all[card.suit]||0)+1;return all;},{});
  const nonPieces=hand.filter((card)=>!pieceOrder(card,muestra));
  const twoSameSuit=nonPieces.length===2&&nonPieces[0].suit===nonPieces[1].suit;
  const threeSameSuit=Object.values(suits).some((n)=>n===3);
  return threeSameSuit || pieces.length>=2 || (pieces.length===1&&twoSameSuit);
}
function handEnvido(hand, muestra) {
  const values=hand.map((card)=>envidoValue(card,muestra));let best=Math.max(...values);
  const pieces=hand.map((card,index)=>pieceOrder(card,muestra)?index:-1).filter((index)=>index>=0);
  if(pieces.length===1){const p=pieces[0],others=values.filter((_,index)=>index!==p);best=Math.max(best,values[p]+Math.max(...others));}
  for(let a=0;a<hand.length;a++)for(let b=a+1;b<hand.length;b++)if(!pieceOrder(hand[a],muestra)&&!pieceOrder(hand[b],muestra)&&hand[a].suit===hand[b].suit)best=Math.max(best,20+values[a]+values[b]);
  return best;
}
function florValue(hand,muestra) {
  const pieces=hand.filter(card=>pieceOrder(card,muestra)>0).map(card=>envidoValue(card,muestra)).sort((a,b)=>b-a);
  const common=hand.filter(card=>!pieceOrder(card,muestra)).reduce((sum,card)=>sum+envidoValue(card,muestra),0);
  return pieces.length?pieces[0]+pieces.slice(1).reduce((sum,value)=>sum+value%10,0)+common:20+common;
}
function topFeed(room,text) { return [{text,time:Date.now()},...(room.feed||[]).slice(0,7)]; }
const VALID_TARGET_POINTS=[10,20,30,40,50,60];
function normalizeTargetPoints(value) {
  const parsed=Number(value);
  return VALID_TARGET_POINTS.includes(parsed)?parsed:30;
}
function capScores(room,scores){
  const maximum=targetPoints(room);
  return Object.fromEntries(Object.entries(scores||{}).map(([player,value])=>[player,Math.min(maximum,Math.max(0,Number(value)||0))]));
}
function florAnswers(bet,hasFlower){
  if(bet.single)return hasFlower?[['yes','FLOR'],['raise-conflor','CON FLOR ENVIDO'],['raise-faltaflor','CONTRA FLOR AL RESTO']]:[['no','TIENE']];
  if(bet.called==='falta')return [['yes','QUIERO'],['no','NO QUIERO']];
  if(bet.called==='conflor')return [['yes','QUIERO'],['no','NO QUIERO'],['raise-faltaflor','CONTRA FLOR AL RESTO']];
  return [['yes','LA MÍA ES FLOR'],['raise-conflor','CON FLOR ENVIDO'],['raise-faltaflor','CONTRA FLOR AL RESTO']];
}
function targetPoints(room) { return normalizeTargetPoints(room?.targetPoints); }
function faltanParaGanar(room) { return Math.max(1,targetPoints(room)-Math.max(Number(room.scores?.player1)||0,Number(room.scores?.player2)||0)); }
function faltaEnvidoPoints(room){
  const target=targetPoints(room),leader=Math.max(Number(room.scores?.player1)||0,Number(room.scores?.player2)||0);
  return leader<target/2?target:faltanParaGanar(room);
}
function envidoBetPoints(room,kind,base=0){
  if(kind==='falta')return faltaEnvidoPoints(room);
  const points=(Number(base)||0)+(kind==='real'?3:2);
  return points>faltanParaGanar(room)?2:points;
}
function florBetPoints(room,kind){
  return kind==='falta'?targetPoints(room):5;
}
function declinedFlorPoints(bet){
  return bet.called==='conflor'?3:(Number(bet.accepted)||3);
}


function betCallNames(bet){
  const names=bet.type==='flor'?{flor:'Flor',conflor:'Con flor envido',falta:'Contra flor al resto'}:{envido:'Envido',real:'Real envido',falta:'Falta envido'};
  return (bet.calls?.length?bet.calls:[bet.called||(bet.type==='flor'?'flor':'envido')]).map(kind=>names[kind]||kind);
}
function declinedBetExplanation(room,bet){
  const points=bet.type==='flor'?declinedFlorPoints(bet):(Number(bet.accepted)||1);
  const rival=room.players?.[bet.responder]?.name||'el rival',calls=betCallNames(bet);
  const reason=bet.type==='flor'?(bet.called==='conflor'?'Se suman solo los 3 puntos de la flor.':'Se suman '+points+' puntos de la flor ya en juego.'):Number(bet.accepted)>0?'Se suman los '+points+' puntos del canto anterior; el último canto no fue aceptado.':'Un envido no querido suma 1 punto.';
  return calls.join(' + ')+' no querido por '+rival+'. '+reason;
}
function acceptedEnvidoExplanation(audit){
  const bet={...audit,type:'envido'},calls=betCallNames(bet),kinds=audit.calls||[audit.called||'envido'];
  const values=kinds.map(kind=>kind==='envido'?2:kind==='real'?3:null);
  const sum=values.every(value=>value!==null)?values.reduce((total,value)=>total+value,0):null;
  const points=Number(audit.stake)||0;
  const calculation=sum===points?values.join(' + ')+' = '+points+' puntos.':kinds.includes('falta')?'Se juega por '+points+' puntos de falta envido.':'Se juega por 2 puntos porque el canto supera lo que falta para ganar.';
  return calls.join(' + ')+' querido. '+calculation;
}

function scoringEntries(room,scores,reason,truth=null){
  const entries=[...(room.handScoreEntries||[])];
  const remaining={player1:Number(scores.player1||0)-Number(room.scores?.player1||0),player2:Number(scores.player2||0)-Number(room.scores?.player2||0)};
  const add=(player,points,detail)=>{if(points>0){entries.push({player,points,detail});remaining[player]-=points;}};
  if(room.envidoAudit&&truth){
    const audit=room.envidoAudit,award=auditEnvidoScores(room,{player1:0,player2:0},truth);
    const names=p=>room.players?.[p]?.name||'Jugador';
    const details=['player1','player2'].map(p=>audit.reveals?.[p]!=null?`${names(p)} declaró ${audit.reveals[p]} y tenía ${truth[p]}.`:`${names(p)} tenía ${truth[p]} tantos.`);
    const liars=Object.keys(audit.reveals||{}).filter(p=>Number(audit.reveals[p])!==Number(truth[p]));
    const result=liars.length===2?'Ambos declararon tantos incorrectos: nadie suma.':liars.length===1?`${names(liars[0])} declaró tantos incorrectos; los puntos pasan al rival.`:audit.reveals?.player1===audit.reveals?.player2&&audit.reveals?.player1!=null?'Empate: gana quien es mano.':'Gana el envido.';
    const detail=acceptedEnvidoExplanation(audit)+' '+details.join(' ')+' '+result;
    for(const p of ['player1','player2'])if(award[p]>0&&remaining[p]>=award[p])add(p,award[p],detail);
    if(!award.player1&&!award.player2)entries.push({player:room.mano||'player1',points:0,detail});
  }
  if(['envido','flor'].includes(room.pendingBet?.type)&&/no (?:quiere|querido)|responde: tiene/i.test(reason||'')){
    for(const player of ['player1','player2'])if(remaining[player]>0)add(player,remaining[player],declinedBetExplanation(room,room.pendingBet));
    return entries;
  }
  if(room.pendingBet?.type==='flor'&&room.pendingBet.called==='conflor'){
    for(const player of ['player1','player2'])if(remaining[player]>=5){
      add(player,3,'Con flor envido · 3 puntos de la flor.');
      add(player,2,'Con flor envido · 2 puntos del envido.');
    }
  }
  const flowers=Object.keys(room.flors||{});
  if(flowers.length===1&&!room.florSettled&&remaining[flowers[0]]>=3)add(flowers[0],3,`Flor sin rival (${room.flors[flowers[0]]} tantos): suma 3 puntos.`);
  for(const p of ['player1','player2'])if(remaining[p]>0)add(p,remaining[p],reason?.includes('gana la mano')?`Mano ganada${Number(room.trucoLevel)>1?' · '+({2:'Truco',3:'Retruco',4:'Vale cuatro'}[room.trucoLevel]||'Truco')+' aceptado':''}.`:(reason||'Puntos de la mano.'));
  return entries;
}
function verifiedHandTruth(room){
  const audit=state.verifiedEnvido;
  return state.localGame?state.localTruth:(audit?.code===state.roomCode&&audit?.handNumber===room.handNumber?audit.truth:null);
}
function buildHandSummary(room,scores,reason,truth=verifiedHandTruth(room)){
  const entries=scoringEntries(room,scores,reason,truth);
  const totals={player1:0,player2:0};
  entries.forEach(entry=>{totals[entry.player]+=Number(entry.points)||0;});
  return {handNumber:room.handNumber||1,totals,entries,names:{player1:room.players?.player1?.name||'Jugador 1',player2:room.players?.player2?.name||'Jugador 2'},time:Date.now()};
}
function handScoreHistory(room, summary=null){
  const history={...(room?.handScoreHistory||{})};
  for(const hand of [room?.lastHandScore,summary]){
    if(hand)history[hand.handNumber]=hand;
  }
  return history;
}
function openScoreDetails(){
  const dialog=$('score-details');
  const history=Object.values(handScoreHistory(state.room)).sort((a,b)=>b.handNumber-a.handNumber);
  $('score-details-title').textContent='Historial de manos';
  $('score-session-score').textContent=state.learning?'':sessionScoreText(state.room);
  $('score-details-content').innerHTML=history.length?history.map(summary=>`<section class="score-detail-hand"><h3>Mano ${summary.handNumber}</h3>${['player1','player2'].map(player=>`<section class="score-detail-player"><header><strong>${escapeHtml(summary.names[player])}</strong><b>+${summary.totals[player]||0} puntos</b></header>${(summary.entries||[]).filter(entry=>entry.player===player).map(entry=>`<p><span>+${entry.points}</span>${escapeHtml(entry.detail)}</p>`).join('')||'<p>No sumó puntos en esta mano.</p>'}</section>`).join('')}</section>`).join(''):'<p class="score-details-empty">Todavía no terminó ninguna mano.</p>';
  $('score-details-content').scrollTop=0;
  dialog.showModal();
}

async function writeRoom(changes) {
  if(changes.scores)changes={...changes,scores:capScores(state.room,changes.scores)};
  if(changes.scores&&!changes.lastHandScore){
    const bet=state.room.pendingBet;
    const label=bet?({envido:bet.called==='real'?'Real envido':bet.called==='falta'?'Falta envido':'Envido',flor:'Flor',truco:Number(bet.stake)===3?'Retruco':Number(bet.stake)===4?'Vale cuatro':'Truco'}[bet.type]||''):'';
    const detail=(label?label+' · ':'')+(changes.feed?.[0]?.text||'Puntos de la mano.');
    const entries=scoringEntries(state.room,changes.scores,detail);
    changes={...changes,handScoreEntries:entries};
    if(changes.status==='complete')changes={...changes,lastHandScore:buildHandSummary(state.room,changes.scores,detail),handScoreEntries:[]};
  }
  if(changes.lastHandScore)changes={...changes,handScoreHistory:handScoreHistory(state.room,changes.lastHandScore)};
  const fb=state.firebase; const updates={};
  const newBet=changes.pendingBet;
  const callLabel=newBet?.caller===state.playerId&&!newBet.revealMode
    ?(newBet.type==='envido'?({envido:'envido',real:'real envido',falta:'falta envido'}[newBet.called]||'envido'):newBet.type==='truco'?({2:'truco',3:'retruco',4:'vale cuatro'}[newBet.stake]||'truco'):null):null;
  const notice=makeCallNotice(callLabel?`${state.room.players[state.playerId].name} dice ${callLabel}.`:changes.feed?.[0]?.text);
  if(notice)changes={...changes,callNotice:notice};
  for(const [key,value] of Object.entries(changes)) updates[`rooms/${state.roomCode}/public/${key}`]=value;
  await fb.update(fb.ref(fb.db),updates);
}
async function addPoints(playerId,points,description) {
  const scores={...state.room.scores}; scores[playerId]=(scores[playerId]||0)+Math.max(0,Number(points)||0);
  const won=scores[playerId]>=targetPoints(state.room);
  await writeRoom({scores,status:won?'complete':'started',feed:topFeed(state.room,`${state.room.players[playerId].name} ${description} (+${points}).`)});
}
function canCallFirstRoundEnvido(room,player,hand){
  if(!room||room.practiceRules?.envido===false||room.status!=='started'||!['player1','player2'].includes(player)||room.resolvingTrick||room.pendingNextHand||Number(room.trickNo||1)!==1)return false;
  if(room.envidoClosed||Object.keys(room.flors||{}).length>0||room.pendingBet?.type==='flor'||room.florSettled||Number(room.playedCount||0)>=2||(room.trickCards||[]).some(item=>item.playerId===player))return false;
  return !!hand?.length&&!room.flors?.[player]&&!room.flors?.[otherPlayer(player)]&&!roomHasFlor(room,hand);
}

async function callBet(kind) {
  if(liveActionsBlocked())return;
  if(state.localGame){localCallAction(kind);return;}
  const room=state.room, caller=state.playerId, other=caller==='player1'?'player2':'player1', pending=room.pendingBet;
  const overTruco=pending?.type==='truco'&&pending.responder===caller;
  const isEnvido=['envido','real','falta'].includes(kind);
  if(!room||caller==='table'||(pending&&!overTruco)||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||!state.hand.length)return;
  const played=Number(room.playedCount)||0;
  if(kind==='envido'||kind==='real'||kind==='falta'){
    if(!canCallFirstRoundEnvido(room,caller,state.hand)){toast('Cantá envido antes de tirar.');return;}
    if(roomHasFlor(room,state.hand)){toast('Tenés flor. Cantá flor.');return;}
    if(room.flors?.[other]){toast('Hay flor. No hay envido.');return;}
    const base=pending?.type==='envido'?(pending.stake||0):0;
    const stake=envidoBetPoints(room,kind,base);
    await writeRoom({pendingBet:{type:'envido',caller,responder:other,stake,accepted:base,first:!pending,called:kind,calls:[kind],reveals:{},suspendedBet:overTruco?pending:null},feed:topFeed(room,`${room.players[caller].name} canta ${kind==='real'?'real envido':kind==='falta'?'falta envido':'envido'}.`)});
    return;
  }
  if(kind==='truco'||kind==='retruco'||kind==='vale4'){
    const current=Number(room.trucoLevel)||1;
    const wanted={truco:2,retruco:3,vale4:4}[kind];
    if(pending||wanted!==current+1||current>=4||(current>1&&room.lastTrucoCaller===caller)){toast('Ese canto no está disponible.');return;}
    await writeRoom({pendingBet:{type:'truco',caller,responder:other,stake:wanted},lastTrucoCaller:caller,feed:topFeed(room,`${room.players[caller].name} canta ${kind==='vale4'?'vale cuatro':kind}.`)});
  }
}
function declinedTrucoChanges(room,player){
  const bet=room.pendingBet,points=Math.max(1,Number(bet.stake||2)-1);
  const message=(room.players?.[player]?.name||'El jugador')+' no quiere. '+(room.players?.[bet.caller]?.name||'El rival')+' suma '+points+'.';
  return {turn:null,turnClock:null,pendingBet:null,envidoClosed:true,
    pendingNextHand:{id:'declined:'+crypto.randomUUID(),winner:bet.caller,foldPoints:points,message,endsAt:gameTime()+3000},
    callNotice:makeCallNotice((room.players?.[player]?.name||'El jugador')+' no quiere.'),
    feed:topFeed(room,message)};
}
function scheduleLocalNextHand(room){
  const pending=room.pendingNextHand;
  if(!pending)return;
  clearTimeout(state.resolutionTimer);state.resolutionTimerKey=pending.id;
  state.resolutionTimer=scheduleLocalTransition(room,()=>{
    if(!state.localGame||state.room!==room||room.pendingNextHand?.id!==pending.id)return;
    room.pendingNextHand=null;state.resolutionTimer=null;state.resolutionTimerKey=null;
    localFinishHand(pending.winner,pending.foldPoints,pending.id.startsWith('fold:')?'fold':'declined');
  },Math.max(0,pending.endsAt-gameTime()));
}

async function answerBet(answer) {
  if(liveActionsBlocked())return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const bet=state.room?.pendingBet;if(!bet||bet.responder!==state.playerId)return;
  if(bet.type==='envido'&&roomHasFlor(state.room,state.hand)){toast('Tenés flor. Cantá flor.');return;}
  if(bet.type==='flor'&&!florAnswers(bet,roomHasFlor(state.room,state.hand)).some(([action])=>action===answer))return;
  if(bet.type==='flor' && bet.single && answer==='yes'){ await callFlor(); return; }
  if(answer==='raise'){
    if(bet.type==='truco'){
      const raised=Number(bet.stake)===2?'retruco':'vale4',value=raised==='retruco'?3:4;
      await writeRoom({pendingBet:{...bet,caller:state.playerId,responder:bet.caller,stake:value},lastTrucoCaller:state.playerId,feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${raised==='vale4'?'vale cuatro':raised}.`)});return;
    }
  }
  if(answer.startsWith('raise-')&&bet.type==='envido'){
    const kind=answer.slice(6),stake=envidoBetPoints(state.room,kind,bet.stake);
    await writeRoom({pendingBet:{...bet,caller:state.playerId,responder:bet.caller,accepted:bet.stake,stake,called:kind,calls:[...(bet.calls||[bet.called||'envido']),kind],reveals:{}},feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${kind==='falta'?'falta envido':kind==='real'?'real envido':'envido'}.`)});return;
  }
  if(bet.type==='flor'&&(answer==='raise-conflor'||answer==='raise-faltaflor')){
    const kind=answer==='raise-faltaflor'?'falta':'conflor',stake=florBetPoints(state.room,kind);
    await writeRoom({flors:{...state.room.flors,[state.playerId]:florValue(state.hand,state.room.muestra)},pendingBet:{...bet,single:false,caller:state.playerId,responder:bet.caller,accepted:bet.stake,stake,called:kind,calls:[...(bet.calls||[bet.called||'flor']),kind]},feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${kind==='falta'?'contra flor al resto':'con flor envido'}.`)});return;
  }
  if(answer==='no'){
    if(bet.type==='truco'){await writeRoom(declinedTrucoChanges(state.room,state.playerId));return;}
    const points=bet.type==='truco'?Math.max(1,(bet.stake||2)-1):bet.type==='flor'?declinedFlorPoints(bet):(bet.accepted||((bet.stake>1)?1:0)||1);
    const scores={...state.room.scores};scores[bet.caller]=(scores[bet.caller]||0)+points;
    const status=scores[bet.caller]>=targetPoints(state.room)&&!state.room.envidoAudit?'complete':'started';
    const msg=`${state.room.players[bet.responder].name} ${bet.type==='flor'&&bet.single?'responde: tiene':'no quiere'}. ${state.room.players[bet.caller].name} suma ${points}.`;
    await writeRoom({scores,status,...(bet.type==='flor'?{florSettled:true}:{}),pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,pendingNextHand:null,feed:topFeed(state.room,msg)});
    return;
  }
  if(bet.type==='envido'){
    await writeRoom({pendingBet:{...bet,reveals:{},revealMode:true,revealTurn:state.room.mano},feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere el envido. Declara primero ${state.room.players[state.room.mano].name}.`)});return;
  }
  if(bet.type==='flor'){
    const flowers=state.room.flors||{},winner=flowers.player1===flowers.player2?(state.room.mano||'player1'):(flowers.player1>flowers.player2?'player1':'player2');
    const scores={...state.room.scores};scores[winner]=(scores[winner]||0)+bet.stake;
    const status=scores[winner]>=targetPoints(state.room)?'complete':'started';
    await writeRoom({scores,florSettled:true,pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere. Flores: ${flowers.player1} a ${flowers.player2}. ${state.room.players[winner].name} suma ${bet.stake}.`),status});return;
  }
  await writeRoom({trucoLevel:bet.stake,pendingBet:null,feed:topFeed(state.room,`${state.room.players[state.playerId].name} dice QUIERO`) });
}
async function revealEnvido(good=false,declaredNumber=null) {
  if(liveActionsBlocked())return;
  if(state.learning?.paused)return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const room=state.room,bet=room?.pendingBet,player=state.playerId;
  if(bet?.type!=='envido'||!bet.revealMode||bet.revealTurn!==player)return;
  const first=room.mano,second=otherPlayer(first),number=Number(declaredNumber??($('envido-picker').dataset.value||0));
  if(good&&player!==second)return;
  if(!good&&(!Number.isInteger(number)||number<0||number>50||(player===second&&number<bet.reveals?.[first]))){toast('Igualá o superá los tantos.');return;}
  const reveals={...(bet.reveals||{})};if(!good)reveals[player]=number;
  let changes;
  if(player===first){changes={pendingBet:{...bet,reveals,revealTurn:second},feed:topFeed(room,`${room.players[player].name} canta ${number} tantos.`)};}
  else{
    const winner=good||number===Number(bet.reveals?.[first])?first:second;
    changes={pendingBet:bet.suspendedBet||null,envidoClosed:true,envidoAudit:{reveals,winner,stake:bet.stake,called:bet.called||'envido',calls:bet.calls||[bet.called||'envido'],handNumber:room.handNumber},feed:topFeed(room,good?`${room.players[player].name}: son buenas.`:`${room.players[player].name} canta ${number} ${number===Number(bet.reveals?.[first])?'son iguales':'son mejores'}.`)};
  }
  if(state.localGame){queueLearningAction(good?'good':'declare',bet);const notice=makeCallNotice(changes.feed?.[0]?.text);if(notice)changes.callNotice=notice;Object.assign(room,changes);renderGame();}else await writeRoom(changes);
}
function settleSingleFlor(room,scores) {
  const flowers=Object.keys(room.flors||{});
  if(flowers.length!==1||room.florSettled)return scores;
  const player=flowers[0];return {...scores,[player]:(Number(scores[player])||0)+3};
}
function auditEnvidoScores(room,scores,truth){
  const audit=room.envidoAudit;if(!audit)return scores;
  const liars=Object.entries(audit.reveals||{}).filter(([player,value])=>Number(value)!==Number(truth[player])).map(([player])=>player);
  const declaredWinner=Number.isFinite(audit.reveals?.player1)&&audit.reveals.player1===audit.reveals.player2?room.mano:audit.winner;
  const winner=liars.length===2?null:liars.length===1?otherPlayer(liars[0]):declaredWinner;
  const result={...scores};if(winner)result[winner]=(result[winner]||0)+Number(audit.stake);
  return result;
}
async function verifyEnvido(scores){
  if(!state.room.envidoAudit)return scores;
  const fb=state.firebase,snapshot=await fb.get(fb.ref(fb.db,`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`));
  if(!snapshot.exists())throw new Error('Faltan las cartas originales para verificar el envido.');
  const truth=snapshot.val(),result=auditEnvidoScores(state.room,scores,truth);
  state.verifiedEnvido={code:state.roomCode,handNumber:state.room.handNumber,truth};
  return result;
}
async function callFlor() {
  if(liveActionsBlocked())return;
  const room=state.room,player=state.playerId;if(!room||player==='table'||(room.playedCount||0)>0||room.flors?.[player]!=null||!roomHasFlor(room,state.hand)){toast('No tenés flor.');return;}
  const flors={...(room.flors||{}),[player]:florValue(state.hand,room.muestra)};
  const other=player==='player1'?'player2':'player1';
  const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
  if(flors[other]){
    await writeRoom({flors,envidoClosed:true,pendingBet:{type:'flor',caller:player,responder:other,stake:3,accepted:0,called:'flor',suspendedBet},feed:topFeed(room,`${room.players[player].name} también canta flor. ¿La mía?`)});
  }else{
    await writeRoom({flors,envidoClosed:true,pendingBet:{type:'flor',single:true,caller:player,responder:other,stake:3,accepted:0,called:'flor',suspendedBet},feed:topFeed(room,`${room.players[player].name} canta flor. El rival debe responder si tiene flor.`)});
  }
}
function settleHand(tricks,room){
  if(tricks.length<2)return null;
  const first=tricks[0].winner,second=tricks[1].winner;
  if(first&&(!second||first===second))return first;
  if(!first&&second)return second;
  if(tricks.length<3)return null;
  return tricks[2].winner||first||room.mano||'player1';
}
async function nextHand(winner, scores, handNumber, message, envidoVerified=false) {
  if(!envidoVerified){scores=await verifyEnvido(scores);scores=settleSingleFlor(state.room,scores);}
  scores=capScores(state.room,scores);
  const summary=state.room.endReveal?.summary||buildHandSummary(state.room,scores,message);
  const deck=shuffleDeck(),p1=state.room.players.player1,p2=state.room.players.player2,muestra=deck[6];
  const mano=otherPlayer(state.room.mano||'player1'),dealer=otherPlayer(mano);
  const patches={};
  patches[`rooms/${state.roomCode}/public/lastHandScore`]=summary;
  patches[`rooms/${state.roomCode}/public/handScoreHistory`]=handScoreHistory(state.room,summary);
  patches[`rooms/${state.roomCode}/public/handScoreEntries`]=[];
  patches[`hands/${state.roomCode}/${p1.uid}/hand`]=deck.slice(0,3);patches[`hands/${state.roomCode}/${p2.uid}/hand`]=deck.slice(3,6);
  patches[`hands/${state.roomCode}/${p1.uid}/handNumber`]=handNumber+1;
  patches[`hands/${state.roomCode}/${p2.uid}/handNumber`]=handNumber+1;
  patches[`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`]={player1:handEnvido(deck.slice(0,3),muestra),player2:handEnvido(deck.slice(3,6),muestra)};
  patches[`hands/${state.roomCode}/${state.room.table.uid}/originalHands`]={player1:deck.slice(0,3),player2:deck.slice(3,6)};
  patches[`rooms/${state.roomCode}/public/endReveal`]=null;
  patches[`rooms/${state.roomCode}/public/status`]=Math.max(...Object.values(scores))>=targetPoints(state.room)?'complete':'started';
  patches[`rooms/${state.roomCode}/public/scores`]=scores;patches[`rooms/${state.roomCode}/public/handNumber`]=handNumber+1;
  patches[`rooms/${state.roomCode}/public/trickNo`]=1;patches[`rooms/${state.roomCode}/public/trickCards`]=[];patches[`rooms/${state.roomCode}/public/tricks`]=[];
  patches[`rooms/${state.roomCode}/public/deckCount`]=33;patches[`rooms/${state.roomCode}/public/muestra`]=muestra;
  patches[`rooms/${state.roomCode}/public/handCounts`]={player1:3,player2:3};
  patches[`rooms/${state.roomCode}/public/handClaims`]={player1:3,player2:3};
  patches[`rooms/${state.roomCode}/public/turn`]=mano;patches[`rooms/${state.roomCode}/public/mano`]=mano;patches[`rooms/${state.roomCode}/public/dealer`]=dealer;
  patches[`rooms/${state.roomCode}/public/envidoAudit`]=null;
  patches[`rooms/${state.roomCode}/public/trucoLevel`]=1;patches[`rooms/${state.roomCode}/public/pendingBet`]=null;
  patches[`rooms/${state.roomCode}/public/lastTrucoCaller`]=null;
  patches[`rooms/${state.roomCode}/public/florSettled`]=false;patches[`rooms/${state.roomCode}/public/flors`]={};patches[`rooms/${state.roomCode}/public/envidoClosed`]=false;patches[`rooms/${state.roomCode}/public/playedCount`]=0;
  patches[`rooms/${state.roomCode}/public/resolutionEndsAt`]=null;
  patches[`rooms/${state.roomCode}/public/resolvingTrick`]=false;patches[`rooms/${state.roomCode}/public/resolutionId`]=null;patches[`rooms/${state.roomCode}/public/resolvedWinner`]=null;patches[`rooms/${state.roomCode}/public/resolvedTrickWinner`]=null;patches[`rooms/${state.roomCode}/public/handComplete`]=false;patches[`rooms/${state.roomCode}/public/pendingNextHand`]=null;
  patches[`rooms/${state.roomCode}/public/feed`]=[{text:`${message} Se reparte la siguiente mano.`,time:Date.now()},...(state.room.feed||[]).slice(0,6)];
  await state.firebase.update(state.firebase.ref(state.firebase.db),patches);
}

function envidoEvidenceCards(hand,muestra){
  if(!hand?.length)return [];
  const options=hand.map(card=>({cards:[card],value:envidoValue(card,muestra)}));
  for(let a=0;a<hand.length;a++)for(let b=a+1;b<hand.length;b++){
    const x=hand[a],y=hand[b],px=pieceOrder(x,muestra),py=pieceOrder(y,muestra);
    if(px||py)options.push({cards:[x,y],value:envidoValue(x,muestra)+envidoValue(y,muestra)});
    else if(x.suit===y.suit)options.push({cards:[x,y],value:20+envidoValue(x,muestra)+envidoValue(y,muestra)});
  }
  return options.find(option=>option.value===handEnvido(hand,muestra))?.cards||hand;
}
function buildEndEvidence(room,originals){
  const groups=[];
  for(const player of Object.keys(room.flors||{})){
    const cards=originals[player]||[];
    if(cards.length===3)groups.push({player,label:'Flor',cards});
  }
  const audit=room.envidoAudit;
  if(audit){
    const truth={player1:handEnvido(originals.player1||[],room.muestra),player2:handEnvido(originals.player2||[],room.muestra)};
    const liars=Object.entries(audit.reveals||{}).filter(([player,value])=>originals[player]?.length===3&&Number(value)!==truth[player]).map(([player])=>player);
    const declaredWinner=audit.reveals?.player1===audit.reveals?.player2&&audit.reveals?.player1!=null?room.mano:audit.winner;
    const winner=liars.length===2?null:liars.length===1?otherPlayer(liars[0]):declaredWinner;
    for(const player of new Set([winner,...liars].filter(Boolean))){
      if(originals[player]?.length!==3)continue;
      const declared=audit.reveals?.[player];
      const label=liars.includes(player)?`Envido · dijo ${declared}, tenía ${truth[player]}`:`Envido · ${truth[player]} tantos`;
      groups.push({player,label,cards:envidoEvidenceCards(originals[player],room.muestra)});
    }
  }
  return groups;
}
async function finishLiveHand(winner,scores,message){
  scores=capScores(state.room,scores);
  const current=state.room,summary=current.lastHandScore?.handNumber===current.handNumber&&current.status==='complete'?current.lastHandScore:buildHandSummary(current,scores,message);
  const snapshot=await state.firebase.get(state.firebase.ref(state.firebase.db,`hands/${state.roomCode}/${current.table.uid}/originalHands`));
  const groups=buildEndEvidence(current,snapshot.val()||{});
  const terminal=Math.max(...Object.values(scores))>=targetPoints(current);
  if(groups.length){
    await writeRoom({status:'revealing',scores,lastHandScore:summary,handScoreEntries:[],turn:null,pendingBet:null,pendingNextHand:null,trickCards:[],resolvingTrick:false,resolutionId:null,handComplete:false,
      endReveal:{id:crypto.randomUUID(),endsAt:gameTime()+5000,handNumber:current.handNumber,winner:winner||current.mano,scores,message,summary,terminal,groups},feed:topFeed(current,message)});
  }else if(terminal){
    await writeRoom({scores,lastHandScore:summary,handScoreEntries:[],envidoAudit:null,status:'complete',trickCards:[],resolvingTrick:false,resolutionId:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,pendingNextHand:null,endReveal:{done:true},feed:topFeed(current,message)});
  }else await nextHand(winner,scores,current.handNumber||1,message,true);
}
function renderEndEvidence(room,sharedTable){
  const el=$('end-hand-reveal'),active=room.status==='revealing'&&!!room.endReveal;
  el.classList.toggle('hidden',!active||!sharedTable);
  if(!active||!sharedTable){el.innerHTML='';return;}
  el.innerHTML=room.endReveal.groups.map(group=>`<section class="end-reveal-group"><h3>${escapeHtml(room.players[group.player]?.name||'Jugador')}<span>${escapeHtml(group.label)}</span></h3><div class="end-reveal-cards">${group.cards.map(card=>`<div class="end-reveal-card sprite-card" style="${cardImageStyle(card)}" role="img" aria-label="${cardAccessibleName(card)}"></div>`).join('')}</div></section>`).join('');
}

function scheduleTableResolution() {
  const room=state.room;
  if(!room||!isCoordinator()||liveActionsBlocked())return;
  const isReveal=room.status==='revealing'&&!!room.endReveal;
  const isTrick=room.resolvingTrick&&room.trickCards?.length===2;
  const isRedeal=!!room.pendingNextHand;
  if(!isTrick&&!isRedeal&&!isReveal){state.resolutionTimerKey=null;clearTimeout(state.resolutionTimer);state.resolutionTimer=null;return;}
  const key=isReveal?`reveal:${room.endReveal.id}`:isTrick?`trick:${room.resolutionId}`:`redeal:${room.pendingNextHand.id}`;
  const pause=roundPauseInfo(room),delay=Math.max(0,(pause?.endsAt||gameTime()+(isReveal?5000:3000))-gameTime());
  if(state.resolutionTimerKey===key)return;
  clearTimeout(state.resolutionTimer);state.resolutionTimerKey=key;
  state.resolutionTimer=setTimeout(async()=>{
    try{
      const current=state.room;
      if(isReveal&&current?.status==='revealing'&&current.endReveal?.id===room.endReveal.id){
        const result=current.endReveal;
        if(result.terminal)await writeRoom({status:'complete',envidoAudit:null});
        else await nextHand(result.winner,result.scores,result.handNumber,result.message,true);
      }else if(isTrick&&current?.resolvingTrick&&current.resolutionId===room.resolutionId){
        const winner=current.resolvedWinner, trickWinner=current.resolvedTrickWinner;
        if(current.handComplete&&winner){
          let scores={...current.scores};const points=Number(current.trucoLevel)||1;
          scores[winner]=(scores[winner]||0)+points;
          const florists=Object.keys(current.flors||{});
          scores=settleSingleFlor(current,scores);
          scores=await verifyEnvido(scores);
          const msg=`${current.players[winner].name} gana la mano y suma ${points} ${points===1?'tanto':'tantos'}.${florists.length===1&&!current.florSettled?' Además cobra 3 por la flor.':''}`;
          await finishLiveHand(winner,scores,msg);
        }else{
          await writeRoom({trickCards:[],resolvingTrick:false,resolutionId:null,resolutionEndsAt:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,trickNo:(Number(current.trickNo)||1)+1,turn:trickWinner||current.mano||'player1',feed:topFeed(current,trickWinner?`${current.players[trickWinner].name} gana la ronda.`:'Ronda parda. Sigue la mano.')});
        }
      }else if(isRedeal&&state.room?.pendingNextHand?.id===room.pendingNextHand.id){
        const pending=state.room.pendingNextHand;
        if(state.room.status!=='complete'){
          let scores=await verifyEnvido(state.room.scores||{});
          scores=settleSingleFlor(state.room,scores);
          if(pending.foldPoints)scores[pending.winner]=(Number(scores[pending.winner])||0)+pending.foldPoints;
          await finishLiveHand(pending.winner,scores,pending.message||'La mano terminó.');
        }
        else await writeRoom({pendingNextHand:null});
      }
    }catch(error){console.error(error);toast(firebaseError(error));}
    finally{if(state.resolutionTimerKey===key){state.resolutionTimer=null;state.resolutionTimerKey=null;}}
  },delay);
}
async function recoverLegacyTrick(room) {
  const key=`${state.roomCode}:${room.handNumber||1}:${room.trickNo||1}`;
  if(state.legacyRepairKey===key)return;
  state.legacyRepairKey=key;
  try{
    const tricks=Array.isArray(room.tricks)?room.tricks:[],wins={player1:0,player2:0};
    for(const trick of tricks)if(trick.winner)wins[trick.winner]++;
    const handWasOver=wins.player1>=2||wins.player2>=2||(Number(room.trickNo)||1)>3;
    if(handWasOver){
      const winner=await settleHand(tricks,room)||room.mano||'player1';
      await writeRoom({trickCards:[],pendingNextHand:{id:`recovery:${key}`,winner,message:'La mano anterior terminó. Se reparte una nueva.'}});
    }else{
      const previousWinner=tricks.at(-1)?.winner;
      await writeRoom({trickCards:[],turn:previousWinner||room.mano||'player1'});
    }
  }catch(error){console.error(error);state.legacyRepairKey=null;toast(firebaseError(error));}
}
function canFoldHand(room,player){
  return !!room&&['player1','player2'].includes(player)&&room.status==='started'&&!room.resolvingTrick&&!room.pendingNextHand;
}
function foldHandChanges(room,loser){
  const winner=otherPlayer(loser),points=Number(room.trucoLevel)||1;
  const message=(room.players?.[loser]?.name||'El jugador')+' se fue al mazo. '+(room.players?.[winner]?.name||'El rival')+' gana la mano y suma '+points+' '+(points===1?'tanto.':'tantos.');
  const bet=room.pendingBet,sideChanges={};
  if(bet&&['envido','flor'].includes(bet.type)){
    const sidePoints=bet.revealMode?Number(bet.stake)||0:bet.type==='flor'?declinedFlorPoints(bet):Number(bet.accepted)||1;
    const scores={...room.scores};
    scores[winner]=(Number(scores[winner])||0)+sidePoints;
    sideChanges.scores=capScores(room,scores);
    sideChanges.envidoClosed=true;
    if(bet.type==='flor')sideChanges.florSettled=true;
  }
  const notice={kind:'fold',id:crypto.randomUUID(),from:loser,to:winner,text:(room.players?.[loser]?.name||'El rival')+' se fue al mazo.',spoken:'Me voy al mazo',time:Date.now(),handNumber:room.handNumber||1};
  return {...sideChanges,callNotice:notice,turn:null,turnClock:null,pendingBet:null,pendingNextHand:{id:'fold:'+crypto.randomUUID(),winner,foldPoints:points,message,endsAt:gameTime()+3000},feed:topFeed(room,message)};
}
function animateFoldedHand(){
  const room=state.room,notice=room?.callNotice;
  const folding=!!(room?.pendingNextHand?.id?.startsWith('fold:')&&notice?.from===state.playerId&&notice.kind==='fold');
  $('game-view').classList.toggle('folding-hand',folding);
  if(!folding||state.foldAnimationKey===room.pendingNextHand.id)return;
  const cards=[...$('hand').querySelectorAll('.hand-card')],deck=$('deck-stack');
  if(!cards.length||!deck)return;
  state.foldAnimationKey=room.pendingNextHand.id;
  const target=deck.getBoundingClientRect();
  cards.forEach((source,index)=>{
    const rect=source.getBoundingClientRect(),flight=source.cloneNode(true);
    flight.classList.remove('dragging','launching-card');flight.classList.add('card-flight','fold-card-flight');
    flight.removeAttribute('data-card');flight.setAttribute('aria-hidden','true');flight.tabIndex=-1;
    Object.assign(flight.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    document.body.append(flight);
    const dx=target.left+target.width/2-(rect.left+rect.width/2),dy=target.top+target.height/2-(rect.top+rect.height/2);
    flight.animate?.([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(.28) rotate(12deg)`,opacity:0}],{duration:650,delay:index*80,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
    setTimeout(()=>flight.remove(),700+index*80);
  });
}
async function foldHand(){
  if(liveActionsBlocked())return;
  if(state.foldInFlight||state.playActionInFlight||!canFoldHand(state.room,state.playerId))return;
  state.foldInFlight=true;
  try{
    if(state.localGame){
      const room=state.room,changes=foldHandChanges(room,state.playerId),pending=changes.pendingNextHand;
      queueLearningAction('fold');Object.assign(room,changes);
      // Keep the fold notice and the pending hand alive for the full 3-second pause.
      renderGame();
      scheduleLocalNextHand(room);
      return;
    }
    const fb=state.firebase,code=state.roomCode,player=state.playerId,handNumber=state.room.handNumber;
    const result=await fb.runTransaction(fb.ref(fb.db,'rooms/'+code+'/public'),current=>{
      if(current===null)return null;
      if(!canFoldHand(current,player)||current.handNumber!==handNumber||current.players?.[player]?.uid!==state.uid)return;
      return {...current,...foldHandChanges(current,player)};
    },{applyLocally:false});
    if(state.roomCode!==code||state.localGame)return;
    if(result.committed){state.room=result.snapshot.val();renderGame();}
    else{toast('La mano cambió. Volvé a intentar irte al mazo.');}
  }catch(error){console.error('[truco:fold]',error);toast(firebaseError(error));}
  finally{state.foldInFlight=false;renderGame();}
}
async function playCard(card) {
  if(liveActionsBlocked())return;
  syncPrivateHand();
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const launchOrigin=state.cardLaunchOrigin;
  state.cardLaunchOrigin=null;
  if (state.localGame) { localPlay(card,launchOrigin); return; }
  if (!state.room || state.room.status!=='started' || state.playerId==='table' || !state.hand.some((item)=>item.id===card.id)) return;
  const players=state.room.players||{};
  const other=state.playerId==='player1'?'player2':'player1';
  if (!players[state.playerId] || !players[other]) { toast('Esperando al otro jugador.'); return; }
  const pause=pauseMessage();
  if(pause){renderRoundPauseTimer();return;}
  if(state.room.pendingBet){shakeTurnBadge();return;}
  if (state.room.turn !== state.playerId) {
    shakeTurnBadge();
    return;
  }
  if (state.playActionInFlight) return;
  state.playActionInFlight=true;state.pendingCardId=card.id;
  syncLiveControls();
  animatePlayedHandCard(card,launchOrigin);
  const fb = state.firebase; const newHand = state.hand.filter((item) => item.id !== card.id);
  const previousTrick = state.room.trickCards || [];
  const played = [...previousTrick.slice(-1), { playerId:state.playerId, name:players[state.playerId].name, card }];
  const patches = {};
  patches[`hands/${state.roomCode}/${state.uid}/hand`] = newHand;
  patches[`hands/${state.roomCode}/${state.uid}/handNumber`] = state.room.handNumber||1;
  const handCounts={...(state.room.handCounts||{}),[state.playerId]:newHand.length};
  patches[`rooms/${state.roomCode}/public/handCounts`]=handCounts;
  patches[`rooms/${state.roomCode}/public/handClaims/${state.playerId}`]=newHand.length;
  if (played.length < 2) {
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/turn`] = other;
    patches[`rooms/${state.roomCode}/public/playedCount`] = (state.room.playedCount||0)+1;
    patches[`rooms/${state.roomCode}/public/envidoClosed`] = state.room.envidoClosed||false;
    patches[`rooms/${state.roomCode}/public/feed`] = topFeed(state.room,`${players[state.playerId].name} jugó ${card.label} ${card.suit}.`);
  } else {
    const muestra=state.room.muestra;
    const a = played[0], b = played[1], winner = cardStrength(a.card,muestra) === cardStrength(b.card,muestra) ? null : cardStrength(a.card,muestra)>cardStrength(b.card,muestra) ? a.playerId : b.playerId;
    const tricks=[...(state.room.tricks||[]),{winner,played}], trickNo=(state.room.trickNo||1);
    const decided=await settleHand(tricks,state.room), ended=!!decided || trickNo>=3;
    const handWinner=ended?(decided||await settleHand(tricks,state.room)):null;
    const resolutionId=`${state.room.handNumber||1}:${trickNo}:${Date.now()}`;
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/tricks`] = tricks;
    patches[`rooms/${state.roomCode}/public/turn`] = null;
    patches[`rooms/${state.roomCode}/public/resolvingTrick`] = true;
    patches[`rooms/${state.roomCode}/public/resolutionEndsAt`] = gameTime()+3000;
    patches[`rooms/${state.roomCode}/public/resolutionId`] = resolutionId;
    patches[`rooms/${state.roomCode}/public/resolvedTrickWinner`] = winner;
    patches[`rooms/${state.roomCode}/public/resolvedWinner`] = handWinner;
    patches[`rooms/${state.roomCode}/public/handComplete`] = ended;
    patches[`rooms/${state.roomCode}/public/playedCount`] = (state.room.playedCount||0)+1;
    patches[`rooms/${state.roomCode}/public/feed`] = topFeed(state.room,winner?`${state.room.players[winner].name} gana la ronda.`:'Ronda parda.');
  }
  try{await fb.update(fb.ref(fb.db), patches);}catch(error){console.error(error);toast(firebaseError(error));}finally{state.playActionInFlight=false;state.pendingCardId=null;renderGame();syncLiveControls();}
}
function cardImage(card){
  const rank=Number(card.rank);
  const suitGroups={'♦':0,'♥':3,'♠':6,'♣':9};
  const index=rank-1,group=Math.floor(index/4),column=index%4;
  const file=(suitGroups[card.suit]??6)+group+1;
  return {image:`url('./assets/cards/${file}.jpg')`,position:`${column/3*100}% 0%`};
}
function cardImageStyle(card){
  const {image,position}=cardImage(card);
  return `--sprite-image:${image};--sprite-position:${position}`;
}
function cardAccessibleName(card) {
  const suits={'♠':'espadas','♥':'copas','♦':'oros','♣':'bastos'};
  return `${card.label} de ${suits[card.suit]||card.suit}`;
}

function handOrderKey(){return `truco-hand-order:${state.roomCode||'local'}:${state.playerId||'player1'}`;}
function orderedHand(){
  const key=handOrderKey();
  if(state.handOrderKey!==key){
    state.handOrderKey=key;
    try{state.handOrder=JSON.parse(localStorage.getItem(key)||'[]');}catch{state.handOrder=[];}
    if(!Array.isArray(state.handOrder))state.handOrder=[];
  }
  const cards=state.hand||[],valid=new Set(cards.map(card=>card.id));
  let order=(state.handOrder||[]).filter(id=>valid.has(id));
  for(const card of cards)if(!order.includes(card.id))order.push(card.id);
  if(order.length!==(state.handOrder||[]).length||order.some((id,index)=>id!==state.handOrder[index])){
    state.handOrder=order;
    try{localStorage.setItem(handOrderKey(),JSON.stringify(order));}catch{}
  }
  return order.map(id=>cards.find(card=>card.id===id)).filter(Boolean);
}
function saveHandOrder(order){
  state.handOrder=order;state.handOrderKey=handOrderKey();
  try{localStorage.setItem(state.handOrderKey,JSON.stringify(order));}catch{}
}

let turnTimerHandle=null,turnClockWritePending=false,turnTimeoutSettling=false;
const turnClockDisplayCache=new Map();
function beginTurnClockWrite(){
  if(turnClockWritePending&&gameTime()-turnClockWritePending.startedAt<10000)return null;
  const token={startedAt:gameTime()};turnClockWritePending=token;return token;
}
function endTurnClockWrite(token){
  if(turnClockWritePending===token)turnClockWritePending=false;
}
function turnClockPlayer(room=state.room){
  if(room?.status==='timed-out')return room.turnTimeout?.loser||otherPlayer(room.turnTimeout?.winner);
  if(room?.pendingBet)return room.pendingBet.revealMode?room.pendingBet.revealTurn:room.pendingBet.responder;
  return room?.turn;
}
function turnClockKey(room=state.room){
  if(state.learning&&state.localGame)return null;
  if(room?.status==='timed-out'&&room.turnTimeout)return ['timeout',room.handNumber||1,room.turnTimeout.loser||otherPlayer(room.turnTimeout.winner),room.timeoutCounts?.[room.turnTimeout.loser||otherPlayer(room.turnTimeout.winner)]||1].join(':');
  if(!room||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||room.endReveal&&!room.endReveal.done)return null;
  const player=turnClockPlayer(room);
  if(!['player1','player2'].includes(player))return null;
  const bet=room.pendingBet;
  if(bet)return ['bet',room.handNumber||1,room.trickNo||1,room.playedCount||0,bet.type,bet.called||'',bet.stake||0,bet.caller,player,bet.revealMode?'reveal':'answer',Object.keys(bet.reveals||{}).length].join(':');
  return [room.handNumber||1,room.trickNo||1,room.playedCount||0,player].join(':');
}
function turnClockRemaining(clock,now=gameTime()){
  const elapsed=Math.max(0,now-Number(clock.startedAt));
  return {extra:elapsed>=30000,seconds:Math.max(0,Math.ceil(((elapsed<30000?30000:45000)-elapsed)/1000)),expired:elapsed>=45000};
}
async function settleTurnTimeout(room){
  if(turnTimeoutSettling||room.status!=='timed-out'||!room.turnTimeout||(!state.localGame&&!isCoordinator()))return;
  turnTimeoutSettling=true;
  try{
    const winner=room.turnTimeout.winner,points=Number(room.trucoLevel)||1;
    if(state.localGame){localFeed(room.turnTimeout.message);localFinishHand(winner,points);return;}
    let scores=await verifyEnvido({...room.scores});
    scores=settleSingleFlor(room,scores);scores[winner]=(Number(scores[winner])||0)+points;
    await finishLiveHand(winner,scores,room.turnTimeout.message);
  }catch(error){console.error('[truco:turn-timeout]',error);toast(firebaseError(error));}
  finally{turnTimeoutSettling=false;}
}
function turnTimeoutChanges(room){
  const loser=turnClockPlayer(room),winner=otherPlayer(loser);
  const timeoutCounts={...(room.timeoutCounts||{})};
  timeoutCounts[loser]=(Number(timeoutCounts[loser])||0)+1;
  const name=room.players?.[loser]?.name||'El jugador';
  if(timeoutCounts[loser]<3){
    return {timeoutCounts,status:'timed-out',turn:null,turnClock:null,pendingBet:null,turnTimeout:{winner,loser,message:name+' agotó su tiempo y pierde la mano ('+timeoutCounts[loser]+' de 3 faltas por inactividad).'}};
  }
  const message=name+' agotó los 45 segundos por tercera vez y pierde la partida. '+(room.players?.[winner]?.name||'El rival')+' gana por inactividad.';
  return {timeoutCounts,status:'complete',turn:null,turnClock:null,turnTimeout:null,
    scores:{...room.scores,[winner]:targetPoints(room)},
    matchResult:{winner,loser,reason:'inactivity',message},
    pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionId:null,resolutionEndsAt:null,
    resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,trickCards:[],envidoAudit:null,
    endReveal:{done:true},feed:topFeed(room,message)};
}
async function expireTurnClock(clock){
  const token=beginTurnClockWrite();if(!token)return;
  try{
    if(state.localGame){
      if(turnClockKey()!==clock.key||!turnClockRemaining(clock).expired)return;
      Object.assign(state.room,turnTimeoutChanges(state.room));
      await settleTurnTimeout(state.room);renderGame();return;
    }
    const fb=state.firebase,code=state.roomCode;
    const result=await fb.runTransaction(fb.ref(fb.db,'rooms/'+code+'/public'),current=>{
      if(!current||turnClockKey(current)!==clock.key||current.turnClock?.key!==clock.key||!turnClockRemaining(current.turnClock).expired)return;
      return {...current,...turnTimeoutChanges(current)};
    },{applyLocally:false});
    if(result.committed&&state.roomCode===code){state.room=result.snapshot.val();renderGame();settleTurnTimeout(state.room);}
  }catch(error){console.error('[truco:turn-clock]',error);}
  finally{endTurnClockWrite(token);}
}
function shakeTurnBadge(){
  const badge=$('turn-badge');
  if(!badge)return;
  badge.getAnimations?.().forEach(animation=>animation.cancel());
  clearTimeout(badge._shakeTimer);
  badge.classList.add('turn-rejected');
  badge.animate?.([{translate:'0 0'},{translate:'-5px 0'},{translate:'5px 0'},{translate:'-4px 0'},{translate:'4px 0'},{translate:'0 0'}],{duration:400,easing:'ease-out'});
  badge._shakeTimer=setTimeout(()=>badge.classList.remove('turn-rejected'),400);
}
function waitingTurnLabel(room=state.room){
  const pending=room?.pendingBet;
  const player=pending?(pending.revealMode?pending.revealTurn:pending.responder):(room?.turn||otherPlayer(state.playerId));
  return 'Turno de '+(room?.players?.[player]?.name||'tu rival');
}
function inactivityWarningLabel(room=state.room,viewer=state.playerId){
  const player=turnClockPlayer(room);
  if(!turnClockKey(room)||room.turnClock?.key!==turnClockKey(room)||Number(room.timeoutCounts?.[player]||0)<2||!turnClockRemaining(room.turnClock).extra)return '';
  return player===viewer?'Perderás el partido en:':(room.players?.[player]?.name||'Tu rival')+' perderá el partido en:';
}
function inactivityLifeStatus(room=state.room){
  const player=turnClockPlayer(room);
  if(!turnClockKey(room)||!['player1','player2'].includes(player))return null;
  const lost=Math.min(2,Math.max(0,Number(room.timeoutCounts?.[player])||0));
  return {player,lost,name:room.players?.[player]?.name||'Jugador'};
}
function renderInactivityLife(){
  let el=$('inactivity-life');
  if(!el){el=document.createElement('span');el.id='inactivity-life';el.className='inactivity-life';el.setAttribute('role','img');$('turn-badge').append(el);}
  const status=inactivityLifeStatus();
  el.classList.toggle('hidden',!status);
  if(!status){el.replaceChildren();return;}
  el.setAttribute('aria-label',status.name+': '+(3-status.lost)+' vidas restantes');
  el.innerHTML=[0,1].map(index=>'<i class="inactivity-circle'+(index<status.lost?' life-lost':'')+'" aria-hidden="true"></i>').join('');
}
function setTurnBadge(text){
  text=roundPauseInfo()?'':inactivityWarningLabel()||text;
  if(text==='ESPERÁ'||text==='ESPERANDO')text=waitingTurnLabel();
  if(state.learning&&state.localGame&&!roundPauseInfo()){
    const player=turnClockPlayer(state.room),name=state.room?.players?.[player]?.name;
    text=player===state.playerId?'TU TURNO':name?'Turno de '+name:'';
  }
  const badge=$('turn-badge');
  let label=badge.querySelector('.turn-badge-label');
  if(!label){
    Array.from(badge.childNodes).filter(node=>node.nodeType===3).forEach(node=>node.remove());
    label=document.createElement('span');label.className='turn-badge-label';badge.prepend(label);
  }
  label.textContent=text;
}

const RECONNECT_GRACE_MS=45000;
let roomPresenceContext=null,presenceWriteSerial=0,disconnectExpiryPending=null;
function disconnectedPlayer(room,now=gameTime()){
  if(!room||!['started','timed-out','revealing'].includes(room.status))return null;
  for(const player of ['player1','player2']){
    const presence=room.connectionPresence?.[player];
    if(presence?.uid!==room.players?.[player]?.uid||Number(presence?.matchNumber)!==Number(room.matchNumber||1)||presence.online!==false||!Number.isFinite(presence.disconnectedAt))continue;
    return {player,presence,seconds:Math.max(0,Math.ceil((presence.disconnectedAt+RECONNECT_GRACE_MS-now)/1000))};
  }
  return null;
}
function stopRoomPresence(){
  const previous=roomPresenceContext;roomPresenceContext=null;presenceWriteSerial++;
  if(previous){
    previous.disconnect.cancel().catch(console.error);
    state.firebase.set(previous.ref,{uid:previous.uid,matchNumber:previous.matchNumber,session:previous.session,online:false,disconnectedAt:state.firebase.serverTimestamp()}).catch(console.error);
  }
}
async function syncRoomPresence(){
  if(state.localGame||!state.firebase||!state.room||!['player1','player2'].includes(state.playerId)||state.firebaseConnected!==true)return;
  const room=state.room,code=state.roomCode,player=state.playerId,uid=state.uid,matchNumber=Number(room.matchNumber||1);
  if(room.players?.[player]?.uid!==uid)return;
  const key=[code,room.createdAt,matchNumber,player,uid].join(':');
  if(roomPresenceContext?.key===key)return;
  stopRoomPresence();
  const fb=state.firebase,ref=fb.ref(fb.db,'rooms/'+code+'/public/connectionPresence/'+player),disconnect=fb.onDisconnect(ref);
  const serial=++presenceWriteSerial,session=crypto.randomUUID(),context={key,ref,disconnect,uid,matchNumber,session};
  roomPresenceContext=context;
  try{
    await disconnect.set({uid,matchNumber,session,online:false,disconnectedAt:fb.serverTimestamp()});
    if(serial!==presenceWriteSerial||state.firebaseConnected!==true||state.roomCode!==code){await disconnect.cancel();return;}
    await fb.set(ref,{uid,matchNumber,session,online:true});
  }catch(error){
    console.error('[truco:presence]',error);
    if(roomPresenceContext===context)roomPresenceContext=null;
  }
}
function disconnectMatchChanges(room,loser){
  const winner=otherPlayer(loser),message=(room.players?.[loser]?.name||'El rival')+' no volvió a conectarse y pierde la partida.';
  return {status:'complete',scores:capScores(room,{...room.scores,[winner]:targetPoints(room)}),
    matchResult:{winner,loser,reason:'disconnect',message},turn:null,turnClock:null,turnTimeout:null,
    pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionId:null,resolutionEndsAt:null,
    handComplete:false,trickCards:[],envidoAudit:null,endReveal:{done:true},feed:topFeed(room,message)};
}
async function expireDisconnectedPlayer(info){
  if(state.firebaseConnected!==true||state.playerId===info.player)return;
  const code=state.roomCode,matchNumber=Number(state.room.matchNumber||1),key=[code,matchNumber,info.player,info.presence.session].join(':');
  if(disconnectExpiryPending===key)return;disconnectExpiryPending=key;
  try{
    const fb=state.firebase;
    const result=await fb.runTransaction(fb.ref(fb.db,'rooms/'+code+'/public'),room=>{
      if(!room||Number(room.matchNumber||1)!==matchNumber)return;
      const current=disconnectedPlayer(room);
      if(!current||current.player!==info.player||current.presence.session!==info.presence.session||current.seconds>0)return;
      return {...room,...disconnectMatchChanges(room,info.player)};
    },{applyLocally:false});
    if(result.committed&&state.roomCode===code){state.room=result.snapshot.val();renderGame();}
  }catch(error){console.error('[truco:disconnect-expiry]',error);}
  finally{if(disconnectExpiryPending===key)disconnectExpiryPending=null;}
}
function renderConnectionNotice(){
  let el=$('connection-notice');
  if(!el){el=document.createElement('div');el.id='connection-notice';el.className='connection-notice hidden';el.setAttribute('role','status');$('game-view').append(el);}
  const room=state.room,playing=room&&room.status!=='closed'&&!state.localGame;
  const info=playing&&disconnectedPlayer(room),ownOffline=liveActionsBlocked();
  el.classList.toggle('hidden',!playing||(!info&&!ownOffline));
  syncLiveControls();
  if(!playing)return null;
  if(ownOffline){el.textContent='Reconectando…';return null;}
  if(info){
    const mine=info.player===state.playerId,name=room.players?.[info.player]?.name||'El rival';
    el.textContent=mine?'Reconectando…':name+' perdió la conexión. Tiene '+info.seconds+' s para volver.';
    if(info.seconds===0)expireDisconnectedPlayer(info);
    return info;
  }
  return null;
}

function renderTurnTimer(){
  syncRoomPresence();
  const disconnected=renderConnectionNotice();
  renderInactivityLife();
  clearTimeout(turnTimerHandle);turnTimerHandle=null;
  let el=$('turn-timer');
  if(!el){el=document.createElement('div');el.id='turn-timer';el.className='turn-timer hidden';el.setAttribute('role','timer');$('turn-badge').append(el);}
  if(el.parentElement!==$('turn-badge'))$('turn-badge').append(el);
  const room=state.room,key=turnClockKey(room),visible=$('game-view').classList.contains('active');
  el.classList.toggle('hidden',!visible||!key||state.playerId==='table');
  if(!visible||!room)return;
  if(liveActionsBlocked()){el.classList.add('hidden');turnTimerHandle=setTimeout(renderTurnTimer,250);return;}
  if(disconnected){el.classList.add('hidden');turnTimerHandle=setTimeout(renderTurnTimer,250);return;}
  if(room.status==='timed-out')settleTurnTimeout(room);
  if(!key){
    turnTimerHandle=setTimeout(renderTurnTimer,250);return;
  }
  const cacheKey=[state.roomCode,room.createdAt,room.matchNumber||1,key].join(':');
  let clock=room.turnClock;
  if(clock?.key===key)turnClockDisplayCache.set(cacheKey,clock);
  else{
    if(state.localGame){clock=room.turnClock={key,startedAt:gameTime()};}
    else{
      // Keep a visible clock while the shared start is confirmed or retried.
      clock=turnClockDisplayCache.get(cacheKey)||{key,startedAt:gameTime()};
      turnClockDisplayCache.set(cacheKey,clock);
      if(isCoordinator()||['player1','player2'].includes(state.playerId)){
        const token=beginTurnClockWrite();
        if(token){
          const fb=state.firebase,code=state.roomCode,matchNumber=Number(room.matchNumber||1);
          fb.runTransaction(fb.ref(fb.db,'rooms/'+code+'/public'),current=>{
            if(!current||Number(current.matchNumber||1)!==matchNumber||turnClockKey(current)!==key||current.turnClock?.key===key)return;
            return {...current,turnClock:{key,startedAt:gameTime()}};
          },{applyLocally:false}).then(result=>{
            if(result.committed&&state.roomCode===code&&turnClockKey()===key){state.room=result.snapshot.val();renderTurnTimer();}
          }).catch(error=>console.error('[truco:clock-start]',error)).finally(()=>endTurnClockWrite(token));
        }
      }
    }
  }
  if(turnClockDisplayCache.size>100)turnClockDisplayCache.delete(turnClockDisplayCache.keys().next().value);
  if(clock?.key===key){
    const remaining=turnClockRemaining(clock),name=room.players?.[turnClockPlayer(room)]?.name||'Jugador';
    el.classList.toggle('turn-timer-warning',remaining.extra);
    const tick=clock.key+':'+remaining.seconds;
    if(remaining.extra&&el.dataset.warningTick!==tick){
      el.dataset.warningTick=tick;
      el.animate?.([{transform:'translateX(0)'},{transform:'translateX(-3px)'},{transform:'translateX(3px)'},{transform:'translateX(-2px)'},{transform:'translateX(0)'}],{duration:280});
    }
    if(!remaining.extra)delete el.dataset.warningTick;
    const warning=inactivityWarningLabel(room);if(warning)setTurnBadge(warning);
    if(room.status==='timed-out')setTurnBadge(name+' · Inactividad');
    el.textContent=remaining.seconds+' s';
    el.setAttribute('aria-label',name+(remaining.extra?(Number(room.timeoutCounts?.[turnClockPlayer(room)]||0)>=2?' perderá el partido en ':' perderá la mano en '):' tiene ')+remaining.seconds+' segundos');
    if(remaining.expired&&room.turnClock?.key===key&&(state.localGame||isCoordinator()||['player1','player2'].includes(state.playerId)))expireTurnClock(clock);
  }
  turnTimerHandle=setTimeout(renderTurnTimer,200);
}

function renderGame() {
  if (!state.room||state.botActing) return;
  syncMatchChat();
  renderLearning();
  scheduleBot();
  renderMatchEnd();
  syncPrivateHand();
  if(state.localGame&&state.room.status==='complete'&&!state.room.endReveal){
    const groups=buildEndEvidence(state.room,state.localOriginalHands||{});
    if(groups.length)localShowEvidence(groups);
  }
  renderCallNotice();
  renderTurnTimer();
  const room = state.room, players=room.players||{}, isTable=state.playerId==='table', mine=players[state.playerId], opponent=players[state.playerId==='player1'?'player2':'player1'];
  document.documentElement.style.setProperty('--tally-board-height',`${50+(targetPoints(room)/10*42+12)*2}px`);
  const compactTallyHeight=Math.max(76,20+(targetPoints(room)/10)*56);
  document.documentElement.style.setProperty('--compact-tally-height',compactTallyHeight+'px');
  $('game-view').classList.toggle('reveal-mode',room.status==='revealing');
  $('game-view').classList.toggle('table-mode', isTable);
  $('game-view').classList.toggle('player-mode', !isTable);
  const sharedTable = isTable || room.deviceMode === 'two';
  renderEndEvidence(room,sharedTable);
  renderRoundPauseTimer();
  $('game-view').classList.toggle('two-device-mode', !isTable && room.deviceMode === 'two');
  const mobileMarker=document.querySelector('.mobile-score'),felt=$('felt-area');
  if(room.deviceMode==='two'&&!isTable){if(mobileMarker.parentElement!==felt)felt.append(mobileMarker);}
  else if(mobileMarker.parentElement===felt)$('game-view').querySelector('.game-layout').after(mobileMarker);
  const drawing=room.status==='drawing';
  $('game-view').classList.toggle('drawing-mode',drawing);
  $('game-home').setAttribute('aria-label',drawing?'Volver al lobby':'Volver a la mesa');
  mobileMarker.classList.toggle('hidden',drawing);
  $('opening-draw').classList.toggle('hidden',!drawing);
  if(drawing){
    const cards=room.openingDraw?.cards||{},canDraw=!isTable&&!cards[state.playerId];
    const dealer=cards.player1&&cards.player2&&Number(cards.player1.rank)!==Number(cards.player2.rank)
      ?(Number(cards.player1.rank)>Number(cards.player2.rank)?'player1':'player2'):null;
    const mano=dealer?otherPlayer(dealer):null;
    const bothChosen=!!(cards.player1&&cards.player2);
    const prompt=bothChosen?'Los dos eligieron su carta':isTable?'Sorteo de quién reparte':cards[state.playerId]?'Ya elegiste tu carta':'Elegí tu carta';
    const hint=bothChosen?(dealer?'':'Empataron. Van a sacar otra carta.') :isTable?'Cada jugador debe tocar el mazo en su celular.':cards[state.playerId]?'Esperando que el otro jugador toque el mazo.':'Tocá el mazo para sortear quién reparte.';
    $('opening-draw').innerHTML=`<div class="draw-prompt"><h2>${prompt}</h2>${hint?`<p>${hint}</p>`:''}</div><div id="opening-timer" class="opening-timer" role="timer" aria-label="Tiempo para elegir carta"></div><button class="draw-deck" id="draw-deck" ${canDraw?'':'disabled'} aria-label="Sacar carta para sortear repartidor"></button><div class="draw-results">${['player1','player2'].map(player=>`<div class="draw-result ${dealer===player?'draw-winner':''}"><span>${escapeHtml(players[player]?.name||player)}${dealer===player?' · REPARTE':mano===player?' · EMPIEZA':''}</span>${cards[player]?`<div class="draw-card sprite-card ${cards[player].justDrawn?'draw-card-new':''}" style="${cardImageStyle(cards[player])}" aria-label="${cardAccessibleName(cards[player])}"></div>`:`<p>${isTable?'Esperando que toque el mazo':'Esperando carta'}</p>`}</div>`).join('')}</div>`;
    if(canDraw)$('draw-deck').addEventListener('click',event=>runLiveAction(event.currentTarget,drawOpeningCard));
    $('hand').innerHTML='';$('player-actions').classList.add('hidden');$('fold-hand').classList.add('hidden');$('fold-hand').disabled=true;$('trick-cards').innerHTML='';$('deck-stack').classList.add('hidden');$('muestra-card').classList.add('hidden');$('envido-picker').classList.add('hidden');renderOpeningTimer();syncLiveControls();return;
  }
  clearTimeout(openingTimerHandle);openingTimerHandle=null;
  const tableName=room.table?.name||'La mesa';
  $('tally-1').innerHTML=renderTally(room.scores?.player1||0,targetPoints(room));$('tally-2').innerHTML=renderTally(room.scores?.player2||0,targetPoints(room));
  const twoPhones=room.deviceMode==='two'&&!isTable;
  const tallyRenderer=twoPhones?renderCompactTally:renderTally;
  const leftPlayer=twoPhones?state.playerId:'player1',rightPlayer=otherPlayer(leftPlayer);
  $('mobile-tally-1').innerHTML=tallyRenderer(room.scores?.[leftPlayer]||0,targetPoints(room));$('mobile-tally-2').innerHTML=tallyRenderer(room.scores?.[rightPlayer]||0,targetPoints(room));
  $('deck-count').textContent=room.deckCount??40;
  $('game-room-code').textContent=state.learning?'PRÁCTICA':state.bot?'CONTRA BOT · '+botLevelLabel(state.botDifficulty).toUpperCase():'MESA ABIERTA';
  $('my-name').textContent=isTable?tableName:(mine?.name||'Vos'); $('my-avatar').textContent=(isTable?tableName:(mine?.name||'V')).slice(0,1).toUpperCase();
  $('opponent-name').textContent=isTable?'Los jugadores':(opponent?.name||'Esperando rival'); $('opponent-avatar').textContent=(isTable?'T':(opponent?.name||'J').slice(0,1)).toUpperCase();
  const myTurn=!isTable&&room.turn===state.playerId&&room.status==='started'&&!room.resolvingTrick&&state.hand.length>0&&!room.pendingBet&&!room.pendingNextHand;
  setTurnBadge(isTable?'MESA':myTurn?'TU TURNO':'ESPERÁ'); $('turn-badge').classList.toggle('waiting-turn',!myTurn);
  const visibleHand=isTable?[]:orderedHand();
  if(!state.handGestureActive)$('hand').innerHTML=visibleHand.map((card) => `<button class="hand-card sprite-card ${card.red?'card-red':''} ${state.launchingCardId===card.id?'launching-card':''} ${state.pendingCardId===card.id?'card-pending':''}" style="${cardImageStyle(card)}" aria-label="${cardAccessibleName(card)}" aria-disabled="${!myTurn}" data-card="${card.id}"><span class="sr-only">${cardAccessibleName(card)}</span></button>`).join('');
  animateFoldedHand();

  $('trick-cards').innerHTML=sharedTable?(room.trickCards||[]).filter(({card,playerId})=>!(state.launchingCardId===card.id&&playerId===state.playerId)).map(({card,playerId})=>`<div class="played-card played-card-${playerId||'player1'} sprite-card ${card.red?'card-red':''}" style="${cardImageStyle(card)}" role="img" aria-label="${cardAccessibleName(card)}"><span class="sr-only">${cardAccessibleName(card)}</span></div>`).join(''):'';
  const sample=room.muestra;
  $('muestra-card').classList.toggle('hidden',!sharedTable||!sample);
  $('muestra-card').classList.toggle('sprite-card',!!(sharedTable&&sample));
  if (sample && $('muestra-card').dataset.cardId !== sample.id) {
    $('muestra-card').dataset.cardId = sample.id;
    $('muestra-card').style.setProperty('--muestra-dx','0px');
    $('muestra-card').style.setProperty('--muestra-dy','0px');
  }
  const sampleImage=sample?cardImage(sample):null;
  $('muestra-card').style.setProperty('--sprite-image',sampleImage?.image||'none');
  $('muestra-card').style.setProperty('--sprite-position',sampleImage?.position||'0% 0%');
  $('muestra-card').setAttribute('aria-label',sample?`${cardAccessibleName(sample)}, muestra`:'Muestra');
  $('muestra-card').innerHTML=sharedTable&&sample?`<span class="sr-only">${cardAccessibleName(sample)}, muestra</span>`:'';
  $('deck-stack').classList.toggle('hidden',!sharedTable);
  $('table-hint').classList.toggle('hidden',!isTable||(room.trickCards||[]).length>0);
  const visibleFeed=(room.feed||[]).filter(({text=''})=>isTable||!/\bjug[oó]/i.test(text));
  $('round-feed').innerHTML=visibleFeed.slice(0,7).map(({text})=>`<div class="feed-item"><i></i><span>${escapeHtml(text)}</span></div>`).join('');
  $('fold-hand').classList.toggle('hidden',isTable);
  $('fold-hand').disabled=state.foldInFlight||state.playActionInFlight||!canFoldHand(room,state.playerId);
  const actions=$('player-actions');actions.classList.toggle('hidden',isTable||room.status==='complete');
  const pending=room.pendingBet, other=state.playerId==='player1'?'player2':'player1';
  const canEnvido=canCallFirstRoundEnvido(room,state.playerId,state.hand);
  const mustDeclareFlor=pending?.type==='envido'&&pending.responder===state.playerId&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId];
  let buttons=[];
  if(mustDeclareFlor){buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');}
  else if(pending?.revealMode){buttons.push('<span class="action-wait">'+(pending.revealTurn===state.playerId?'Deslizá para elegir tus tantos':'Esperando los tantos del rival…')+'</span>');}
  else if(pending?.type==='flor'){if(pending.responder===state.playerId)buttons.push(...florAnswers(pending,roomHasFlor(room,state.hand)).map(([action,label])=>`<button class="${action==='yes'?'call-button':'pass-button'}" data-action="${action}">${label}</button>`));else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else if(pending){if(pending.responder===state.playerId){if(['envido','truco'].includes(pending.type)&&(room.playedCount||0)===0&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');if(pending.type==='truco'&&canEnvido)buttons.push('<button class="pass-button" data-action="envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="real"><strong>REAL ENVIDO</strong></button><button class="pass-button" data-action="falta"><strong>FALTA ENVIDO</strong></button>');if(pending.type==='envido'&&!Object.keys(room.flors||{}).length){buttons.push('<div class="envido-action-grid"><div class="envido-action-row envido-raises"><button class="pass-button" data-action="raise-envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="raise-real"><strong>REAL ENVIDO</strong></button><button class="pass-button" data-action="raise-falta"><strong>FALTA ENVIDO</strong></button></div><div class="envido-action-row envido-answer"><button class="call-button" data-action="yes">QUIERO</button><button class="pass-button" data-action="no">NO QUIERO</button></div></div>');}else{buttons.push(`${pending.type==='flor'&&pending.single&&!roomHasFlor(room,state.hand)?'':`<button class="call-button" data-action="yes">${pending.type==='flor'?(pending.single?'FLOR':'LA MÍA ES FLOR'):'QUIERO'}</button>`}<button class="pass-button" data-action="no">${pending.type==='flor'&&pending.single?'TIENE':'NO QUIERO'}</button>`);}if(pending.type==='truco'&&pending.stake<4)buttons.push(`<button class="pass-button" data-action="raise">${pending.stake===2?'RETRUCO':'VALE 4'}</button>`);if(pending.type==='flor'&&!pending.single){buttons.push('<button class="pass-button" data-action="raise-conflor">CON FLOR ENVIDO</button><button class="pass-button" data-action="raise-faltaflor">CONTRA FLOR AL RESTO</button>');}}else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else {
    if((room.playedCount||0)===0&&state.hand.length&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');
    if(canEnvido)buttons.push('<button class="pass-button" data-action="envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="real"><strong>REAL</strong></button><button class="pass-button" data-action="falta"><strong>FALTA</strong></button>');
    if(!isTable&&room.status==='started'&&state.hand.length&&!room.resolvingTrick&&!room.pendingNextHand){
    const level=Number(room.trucoLevel)||1;if(level<4&&(level===1||room.lastTrucoCaller!==state.playerId))buttons.push(`<button class="call-button" data-action="${level===1?'truco':level===2?'retruco':'vale4'}"><strong>${level===1?'TRUCO':level===2?'RETRUCO':'VALE 4'}</strong></button>`);
    }else if(!buttons.length)buttons.push('<span class="action-wait">ESPERÁ TU TURNO</span>');
  }
  const foldButton=$('fold-hand');
  if(foldButton.parentElement===actions)actions.parentElement.append(foldButton);
  const canAct=room.status==='started'&&!room.resolvingTrick&&!room.pendingNextHand;
  const availableButtons=canAct?buttons.filter(button=>button.includes('data-action=')):[];
  actions.innerHTML=availableButtons.length?'<div class="action-buttons compact-actions">'+availableButtons.join('')+'</div>':'';
  foldButton.classList.toggle('hidden',isTable||!!state.learning?.complete);
  renderEnvidoPicker(room);
  alignHandWithControls();
  actions.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>runLiveAction(button,()=>{const act=button.dataset.action;if(state.localGame)return localAction(act);if(['yes','no','raise'].includes(act)||act.startsWith('raise-'))return answerBet(act);if(act==='reveal')return revealEnvido();if(act==='flor')return callFlor();return callBet(act);})));
  setTurnBadge(isTable?'MESA':roundPauseInfo(room)?'ESPERÁ':pending?(pending.responder===state.playerId?'RESPONDÉ':'ESPERANDO'):myTurn?'TU TURNO':'ESPERÁ');$('turn-badge').classList.toggle('waiting-turn',!myTurn||!!pending);
  renderMatchEnd();syncLiveControls();
}
function matchEndKey(room=state.room){
  return [state.roomCode,room?.matchNumber||1,room?.rematch?.id||'',room?.rematch?.status||''].join(':');
}
function matchWinner(room){
  return room.matchResult?.winner||['player1','player2'].find(player=>Number(room.scores?.[player])>=targetPoints(room))||null;
}
function matchFinished(room){
  return room?.status==='complete'&&!!(room.endReveal||(!room.envidoAudit&&!Object.keys(room.flors||{}).length));
}
function sessionMatchResults(room){
  const results={...(room?.sessionResults||{})},winner=room&&matchWinner(room);
  if(room&&matchFinished(room)&&winner)results[String(room.matchNumber||1)]={winner,scores:capScores(room,room.scores)};
  return results;
}
function sessionWins(room){
  const wins={player1:0,player2:0};
  for(const result of Object.values(sessionMatchResults(room)))if(result?.winner in wins)wins[result.winner]++;
  return wins;
}
function sessionScoreText(room){
  const wins=sessionWins(room);
  return 'Partidas de esta mesa: '+(room.players?.player1?.name||'Jugador 1')+' '+wins.player1+' – '+wins.player2+' '+(room.players?.player2?.name||'Jugador 2');
}
function rematchRoom(room){
  return {
    deviceMode:room.deviceMode,targetPoints:targetPoints(room),table:room.table,players:room.players,
    sessionResults:sessionMatchResults(room),
    matchNumber:Number(room.matchNumber||1)+1,status:'drawing',createdAt:gameTime(),
    scores:{player1:0,player2:0},handNumber:1,deckCount:40,trickCards:[],tricks:[],
    openingDraw:newOpeningDraw(),feed:topFeed({feed:[]},'Revancha. Elegí una carta para sortear quién reparte.')
  };
}
function rematchChanges(room,player,action,id){
  if(!matchFinished(room)||!room.players?.[player])return null;
  const request=room.rematch;
  if(action==='request'){
    if(request?.status==='pending')return request.requester===player?null:rematchRoom(room);
    return {rematch:{id,requester:player,status:'pending'}};
  }
  if(request?.status!=='pending'||request.id!==id||request.requester===player)return null;
  if(action==='accept')return rematchRoom(room);
  if(action==='decline')return {rematch:{...request,status:'declined'}};
  return null;
}
let rematchInFlight=false;
async function respondRematch(action){
  if(liveActionsBlocked())return;
  if(rematchInFlight||!['player1','player2'].includes(state.playerId))return;
  rematchInFlight=true;
  const code=state.roomCode,player=state.playerId,matchNumber=Number(state.room?.matchNumber||1);
  const id=action==='request'?crypto.randomUUID():state.room?.rematch?.id;
  try{
    if(state.localGame){
      const changes=rematchChanges(state.room,player,action,id);
      if(changes){
        if(changes.status==='drawing'){
          state.room=changes;state.hand=[];
          const deck=shuffleDeck();state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};
          state.localOriginalHands=structuredClone(state.localHands);
          state.localTruth={player1:handEnvido(state.localHands.player1,deck[6]),player2:handEnvido(state.localHands.player2,deck[6])};
          state.room.muestra=deck[6];state.finalEvidenceKey=null;state.verifiedEnvido=null;
        }else Object.assign(state.room,changes);
      }
    }else{
      const fb=state.firebase;
      await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
        if(room===null)return null;
        if(Number(room.matchNumber||1)!==matchNumber||room.players?.[player]?.uid!==state.uid)return;
        const changes=rematchChanges(room,player,action,id);
        if(!changes)return;
        return changes.status==='drawing'?changes:{...room,...changes};
      },{applyLocally:false});
    }
  }catch(error){console.error('[truco:rematch]',error);toast(firebaseError(error));}
  finally{rematchInFlight=false;renderGame();}
}
function renderMatchEnd(){
  const panel=$('match-end'),room=state.room,winner=room&&matchWinner(room);
  const visible=!state.learning&&matchFinished(room)&&!!winner&&state.dismissedMatchEnd!==matchEndKey(room);
  panel.classList.toggle('hidden',!visible);
  if(!visible)return;
  const name=room.players?.[winner]?.name||'Jugador';
  $('match-end-title').textContent='Ganó '+name;
  $('match-session-score').textContent=sessionScoreText(room);
  $('match-end-score').innerHTML=['player1','player2'].map(player=>`<div class="${player===winner?'match-score-winner':''}"><strong>${capScores(room,room.scores)[player]||0}</strong><span>${escapeHtml(room.players?.[player]?.name||'Jugador')}</span></div>`).join('<b aria-hidden="true">–</b>');
  const request=room.rematch,player=state.playerId,isPlayer=['player1','player2'].includes(player);
  const pending=request?.status==='pending',incoming=pending&&request.requester!==player;
  $('match-end-message').textContent=pending?(incoming?(room.players?.[request.requester]?.name||'Tu rival')+' quiere jugar la revancha.':'Revancha enviada. Esperando al rival…'):request?.status==='declined'?'La revancha no fue aceptada.':room.matchResult?.reason==='inactivity'?'Victoria por inactividad.':room.matchResult?.reason==='disconnect'?'Victoria por desconexión.':'Partida terminada';
  $('request-rematch').classList.toggle('hidden',!isPlayer||pending);
  $('accept-rematch').classList.toggle('hidden',!isPlayer||!incoming);
  $('decline-rematch').classList.toggle('hidden',!isPlayer||!incoming);
  for(const id of ['request-rematch','accept-rematch','decline-rematch'])$(id).disabled=rematchInFlight;
  if(state.focusedMatchEnd!==matchEndKey(room)){
    state.focusedMatchEnd=matchEndKey(room);
    (isPlayer?(incoming?$('accept-rematch'):pending?$('close-match-end'):$('request-rematch')):$('close-match-end')).focus({preventScroll:true});
  }
}
$('close-match-end').addEventListener('click',()=>{state.dismissedMatchEnd=matchEndKey();renderMatchEnd();});
$('request-rematch').addEventListener('click',event=>runLiveAction(event.currentTarget,()=>respondRematch('request')));
$('accept-rematch').addEventListener('click',event=>runLiveAction(event.currentTarget,()=>respondRematch('accept')));
$('decline-rematch').addEventListener('click',event=>runLiveAction(event.currentTarget,()=>respondRematch('decline')));
$('match-end').addEventListener('keydown',event=>{
  if(event.key==='Escape'){$('close-match-end').click();return;}
  if(event.key!=='Tab')return;
  const buttons=[...$('match-end').querySelectorAll('button')].filter(button=>!button.disabled&&!button.classList.contains('hidden'));
  const first=buttons[0],last=buttons.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});

function alignHandWithControls(){
  requestAnimationFrame(()=>{
    if(state.handGestureActive)return;
    const hand=$('hand'),controls=document.querySelector('.player-controls');
    const cards=hand?.querySelectorAll('.hand-card:not(.launching-card)');
    if(!controls||!cards?.length||!$('game-view').classList.contains('player-mode'))return;
    const left=Math.min(...Array.from(cards,card=>card.getBoundingClientRect().left));
    const offset=Number.parseFloat(hand.style.getPropertyValue('--hand-edge-offset'))||0;
    hand.style.setProperty('--hand-edge-offset',(offset+controls.getBoundingClientRect().left-left)+'px');
  });
}
function renderCompactTally(points,target){
  const limit=normalizeTargetPoints(target),n=Math.min(Math.max(0,Math.floor(Number(points)||0)),limit),slots=limit/10;
  const halfHeight=slots*28+8,height=halfHeight*2,lines=[];
  for(let group=0;group<Math.ceil(n/5);group++){
    const x=5,y=5+(group%slots)*28+(group>=slots?halfHeight:0),size=Math.min(5,n-group*5),d=20;
    const sides=[[x,y,x,y+d],[x,y+d,x+d,y+d],[x+d,y+d,x+d,y],[x+d,y,x,y],[x,y+d,x+d,y]];
    lines.push(...sides.slice(0,size).map(([a,b,c,d])=>`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`));
  }
  return `<svg class="compact-score-sticks" viewBox="0 0 30 ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="${n} puntos de ${limit}"><line x1="0" y1="${halfHeight}" x2="30" y2="${halfHeight}" stroke="#efebd7" stroke-opacity=".4"/><g fill="none" stroke="#f0eee2" stroke-width="2.5" stroke-linecap="round">${lines.join('')}</g></svg>`;
}
function renderTally(points,target){
  const limit=normalizeTargetPoints(target),n=Math.min(Math.max(0,Math.floor(Number(points)||0)),limit);
  const halfHeight=(limit/10)*42+12,height=halfHeight*2;
  const lines=[];
  const line=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  for(let group=0;group<Math.ceil(n/5);group++){
    const size=Math.min(5,n-group*5),slots=limit/10;
    const y=6+(group%slots)*42+(group>=slots?halfHeight:0),x=6,s=30;
    const sides=[[x,y,x,y+s],[x,y+s,x+s,y+s],[x+s,y+s,x+s,y],[x+s,y,x,y],[x,y+s,x+s,y]];
    lines.push(...sides.slice(0,size).map(coords=>line(...coords)));
  }
  return `<svg class="score-sticks" xmlns="http://www.w3.org/2000/svg" width="90" height="${height}" viewBox="0 0 90 ${height}" role="img" aria-label="${n} puntos de ${limit}" style="display:block;width:100%;height:${height}px;overflow:visible"><line x1="0" y1="${halfHeight}" x2="90" y2="${halfHeight}" stroke="#efebd7" stroke-opacity=".42" stroke-width="2"/><g fill="none" stroke="#f0eee2" stroke-width="4" stroke-linecap="round">${lines.join('')}</g></svg>`;
}
function enableMouseWheelDrag(wheel,stopHint,syncWheel){
  let drag=null,suppressClick=false;
  wheel.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    stopHint();suppressClick=false;
    drag={id:event.pointerId,x:event.clientX,left:wheel.scrollLeft,moved:false};
  });
  wheel.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const delta=event.clientX-drag.x;
    if(!drag.moved&&Math.abs(delta)<4)return;
    if(!drag.moved){drag.moved=true;wheel.setPointerCapture(event.pointerId);wheel.style.scrollSnapType='none';wheel.classList.add('mouse-dragging');}
    event.preventDefault();wheel.scrollLeft=drag.left-delta;syncWheel();
  });
  const finish=event=>{
    if(!drag||event.pointerId!==drag.id)return;
    suppressClick=drag.moved;
    if(wheel.hasPointerCapture(event.pointerId))wheel.releasePointerCapture(event.pointerId);
    wheel.style.scrollSnapType='';wheel.classList.remove('mouse-dragging');
    if(drag.moved){const step=wheel.querySelector('[data-number]').getBoundingClientRect().width;wheel.scrollTo({left:Math.round(wheel.scrollLeft/step)*step,behavior:'smooth'});}
    drag=null;
  };
  wheel.addEventListener('pointerup',finish);
  wheel.addEventListener('pointercancel',finish);
  wheel.addEventListener('pointerleave',event=>{if(drag&&!drag.moved)drag=null;});
  wheel.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
}
function renderEnvidoPicker(room){
  const el=$('envido-picker'),bet=room.pendingBet,active=bet?.revealMode&&bet.revealTurn===state.playerId;
  el.classList.toggle('hidden',!active);
  $('game-view').classList.toggle('declaring-envido',!!active);
  if(!active){el.stopWheelHint?.();el.dataset.key='';return;}
  const first=room.mano,opponentPoints=bet.reveals?.[first],second=state.playerId!==first,min=second?Number(opponentPoints):0;
  const key=`${room.handNumber}:${state.playerId}:${opponentPoints??'first'}`;
  if(el.dataset.key===key)return;el.stopWheelHint?.();el.dataset.key=key;const initial=Math.min(50,Math.max(20,min));el.dataset.value=String(initial);
  el.innerHTML=`<p>Arrastra los números para seleccionar</p><div class="number-wheel" role="listbox" aria-label="Tantos del 0 al 50">${Array.from({length:51},(_,number)=>`<button role="option" aria-selected="${number===min}" ${number<min?'disabled':''} data-number="${number}">${number}</button>`).join('')}</div><div class="declaration-buttons">${min<=50?'<button id="declare-points" class="call-button">DECLARAR <span id="selected-points">'+min+'</span></button>':''}${second?'<button id="good-points" class="pass-button">SON BUENAS</button>':''}</div>`;
  const wheel=el.querySelector('.number-wheel');
  const step=()=>wheel.querySelector('[data-number]').getBoundingClientRect().width;
  let hintRunning=false,hintFrame=null;
  const select=number=>{el.dataset.value=String(number);el.querySelectorAll('[data-number]').forEach(button=>{const distance=Math.abs(Number(button.dataset.number)-number);button.setAttribute('aria-selected',String(distance===0));button.dataset.distance=String(Math.min(distance,4));});const label=$('selected-points');if(label)label.textContent=number;};
  const syncWheel=()=>{const buttons=[...wheel.querySelectorAll('[data-number]')],center=wheel.getBoundingClientRect().left+wheel.clientWidth/2;let nearest=null,best=Infinity;buttons.forEach(button=>{const rect=button.getBoundingClientRect(),distance=Math.abs((rect.left+rect.width/2)-center);if(distance<best){best=distance;nearest=button;}const steps=distance/step();button.style.opacity=String(steps<.65?1:steps<1.65?.78:steps<2.65?.48:steps<3.65?.25:.1);});if(nearest&&!hintRunning)select(Math.max(Math.min(50,min),Number(nearest.dataset.number)));};
  const stopHint=()=>{
    if(!hintRunning)return;
    hintRunning=false;cancelAnimationFrame(hintFrame);
    wheel.style.scrollSnapType='';wheel.scrollLeft=initial*step();select(initial);syncWheel();
  };
  el.stopWheelHint=stopHint;
  wheel.addEventListener('pointerdown',stopHint,{once:true,passive:true});
  wheel.addEventListener('touchstart',stopHint,{once:true,passive:true});
  wheel.addEventListener('keydown',stopHint,{once:true});
  enableMouseWheelDrag(wheel,stopHint,syncWheel);
  wheel.addEventListener('scroll',syncWheel,{passive:true});
  wheel.querySelectorAll('[data-number]').forEach(button=>button.addEventListener('click',()=>{stopHint();select(Number(button.dataset.number));wheel.scrollTo({left:Number(button.dataset.number)*step(),behavior:'smooth'});}));
  wheel.scrollLeft=initial*step();select(initial);requestAnimationFrame(syncWheel);
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    hintRunning=true;wheel.style.scrollSnapType='none';
    let started=null;
    const animate=now=>{
      if(!hintRunning)return;
      if(!active||el.dataset.key!==key){stopHint();return;}
      started??=now;
      const progress=Math.min(1,(now-started)/2400);
      wheel.scrollLeft=(initial+2*Math.sin(progress*2*Math.PI))*step();syncWheel();
      if(progress<1)hintFrame=requestAnimationFrame(animate);else stopHint();
    };
    hintFrame=requestAnimationFrame(animate);
  }
  $('declare-points')?.addEventListener('click',()=>{stopHint();runLiveAction($('declare-points'),()=>revealEnvido());});
  $('good-points')?.addEventListener('click',()=>runLiveAction($('good-points'),()=>revealEnvido(true)));
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }


function botLevelLabel(level){return {easy:'Fácil',normal:'Normal',hard:'Difícil'}[level]||'Normal';}
function updateBotSetup(){
  const enabled=$('play-bot').checked;
  $('bot-levels').classList.toggle('hidden',!enabled);
  $('use-table-device').closest('label').classList.toggle('hidden',enabled);
  if(enabled)updateMode('two');
  $('enter-room').textContent=enabled?'Jugar contra Bot':'Crear mesa';
}
function stopBot(){clearTimeout(state.learning?.transition?.timer);$('learning-hint')?.close();state.learning=null;$('learning-toolbar')?.classList.add('hidden');$('game-view').classList.remove('learning-mode');clearTimeout(state.botTimer);state.botTimer=null;state.bot=false;state.botMemory=null;}
async function startBotGame(name){
  if(!await startLocalBotGame())return;
  state.bot=true;state.botDifficulty=$('bot-level').value;
  state.roomCode='BOT1';state.room.targetPoints=Number($('target-points').value);
  state.room.players={player1:{name},player2:{name:'Bot · '+botLevelLabel(state.botDifficulty)}};
  try{localStorage.setItem('truco-player-name',name);}catch{}
  state.dismissedMatchEnd=null;renderGame();
}
// Estimate the remaining hand from public cards and sampled unseen rival cards.
function botDeck(){
  const suits=[['oro','♦'],['copa','♥'],['espada','♠'],['basto','♣']];
  return suits.flatMap(([name,suit])=>[1,2,3,4,5,6,7,10,11,12].map(rank=>({id:name+'-'+rank,suit,rank})));
}
function botHandOutcome(room,mine,rival,winners,turn,pending=null,forced=null){
  const tricks=winners.map(winner=>({winner})),winner=settleHand(tricks,room);
  if(winner)return winner==='player2'?1:0;
  const cards=turn==='player2'?mine:rival;
  if(!cards.length)return room.mano==='player2'?1:0;
  const choices=forced?cards.filter(card=>card.id===forced.id):cards;
  const outcomes=choices.map(card=>{
    const nextMine=turn==='player2'?mine.filter(c=>c.id!==card.id):mine;
    const nextRival=turn==='player1'?rival.filter(c=>c.id!==card.id):rival;
    if(!pending)return botHandOutcome(room,nextMine,nextRival,winners,otherPlayer(turn),{playerId:turn,card});
    const first=cardStrength(pending.card,room.muestra),second=cardStrength(card,room.muestra);
    const won=first===second?null:first>second?pending.playerId:turn;
    return botHandOutcome(room,nextMine,nextRival,[...winners,won],won||room.mano);
  });
  return turn==='player2'?Math.max(...outcomes):Math.min(...outcomes);
}
function rememberBotCards(room,memory){
  memory.played??=[];
  const cards=[...(room.tricks||[]).flatMap(trick=>trick.played||[]),...(room.trickCards||[])];
  for(const item of cards)if(item.card&&!memory.played.some(card=>card.id===item.card.id))memory.played.push({...item.card});
}
function botRiskAdjustment(room,stake){
  const target=targetPoints(room),mine=target-Number(room.scores?.player2||0),rival=target-Number(room.scores?.player1||0);
  // Avoid risking the match unnecessarily; press a real advantage when it can finish it.
  return (rival<=stake?0.12:rival<=stake*2?0.05:0)-(mine<=stake?0.05:0);
}
function assessBotHand(room,hand,level,memory,random=Math.random){
  rememberBotCards(room,memory);
  const played=room.trickCards||[],pending=played.length===1?played[0]:null;
  const known=new Set([...hand,...(memory.played||[]),...played.map(item=>item.card),room.muestra].filter(Boolean).map(card=>card.id));
  const unseen=botDeck().filter(card=>!known.has(card.id));
  const count=Math.max(0,3-(room.tricks||[]).length-played.filter(item=>item.playerId==='player1').length);
  const samples=level==='hard'?144:level==='normal'?72:36;
  const totals=new Map(hand.map(card=>[card.id,0]));
  const winners=(room.tricks||[]).map(trick=>trick.winner);
  let wins=0;
  for(let sample=0;sample<samples;sample++){
    const pool=[...unseen],rival=[];
    for(let i=0;i<count&&pool.length;i++)rival.push(pool.splice(Math.min(pool.length-1,Math.floor(random()*pool.length)),1)[0]);
    const turn=pending?otherPlayer(pending.playerId):room.turn||room.mano;
    if(turn==='player2'){
      let best=0;
      for(const card of hand){const result=botHandOutcome(room,hand,rival,winners,turn,pending,card);totals.set(card.id,totals.get(card.id)+result);best=Math.max(best,result);}
      wins+=best;
    }else wins+=botHandOutcome(room,hand,rival,winners,turn,pending);
  }
  return {chance:wins/samples,cards:hand.map(card=>({card,chance:totals.get(card.id)/samples}))};
}
// The policy never receives the rival's hand or the original deal.
function chooseBotDecision(room,hand,level,memory,random=Math.random){
  const me='player2',bet=room.pendingBet,flower=roomHasFlor(room,hand);
  const tantos=handEnvido(hand,room.muestra);
  const easy=level==='easy',hard=level==='hard';
  let assessment;
  const evaluate=()=>assessment||(assessment=assessBotHand(room,hand,level,memory,random));
  if(bet?.revealMode){
    if(bet.revealTurn!==me)return null;
    return {kind:'reveal',value:tantos,good:room.mano!==me&&tantos<Number(bet.reveals?.[room.mano])};
  }
  if(bet&&bet.responder!==me)return null;
  if(!room.playedCount&&flower&&room.flors?.[me]==null)return {kind:'action',value:'flor'};
  if(bet){
    if(bet.type==='flor'){
      if(bet.single)return {kind:'action',value:flower?'yes':'no'};
      const value=room.flors?.[me]||0;
      if(hard&&value>=38&&!memory.florRaised&&bet.called!=='falta'){
        memory.florRaised=true;return {kind:'action',value:bet.called==='conflor'?'raise-faltaflor':'raise-conflor'};
      }
      return {kind:'action',value:bet.called==='falta'&&value<32?'no':'yes'};
    }
    if(bet.type==='envido'){
      
      if(hard&&tantos>=32&&!memory.envidoRaised&&bet.called!=='falta'){
        memory.envidoRaised=true;return {kind:'action',value:'raise-real'};
      }
      const threshold=(bet.called==='falta'?30:bet.called==='real'?26:23)+Math.round(botRiskAdjustment(room,bet.stake)*20);
      return {kind:'action',value:(easy?random()<0.65:tantos>=threshold)?'yes':'no'};
    }
    if(bet.type==='truco'){
      if(!memory.envidoCalled&&tantos>=27&&canCallFirstRoundEnvido(room,me,hand)){
        memory.envidoCalled=true;return {kind:'action',value:'envido'};
      }
      const chance=evaluate().chance;
      if(chance===0)return {kind:'action',value:'no'};
      if(hard&&bet.stake<4&&chance>=(bet.stake===2?0.84:0.93)+botRiskAdjustment(room,bet.stake+1))return {kind:'action',value:'raise'};
      const threshold=bet.stake>=4?0.68:bet.stake>=3?0.56:0.44;
      const accepts=easy?chance>=0.3&&random()<0.65:chance>=threshold+(hard?0.04:0)+botRiskAdjustment(room,bet.stake);
      return {kind:'action',value:accepts?'yes':'no'};
    }
    return null;
  }
  if(room.turn!==me||!hand.length)return null;
  if(!memory.envidoCalled&&canCallFirstRoundEnvido(room,me,hand)){
    memory.envidoCalled=true;
    if(easy?random()<0.4:tantos>=25)return {kind:'action',value:hard&&tantos>=33?'real':'envido'};
  }
  const trucoLevel=Number(room.trucoLevel)||1;
  if(!state.learning?.guided&&trucoLevel<4&&(trucoLevel===1||room.lastTrucoCaller!==me)&&!memory.trucoCalled){
    const chance=evaluate().chance;
    if(chance>=(trucoLevel===1?0.7:trucoLevel===2?0.82:0.92)+botRiskAdjustment(room,trucoLevel+1)&&(easy?random()<0.25:true)){memory.trucoCalled=true;return {kind:'action',value:trucoLevel===1?'truco':trucoLevel===2?'retruco':'vale4'};}
  }
  const sorted=[...hand].sort((a,b)=>cardStrength(a,room.muestra)-cardStrength(b,room.muestra));
  let card;
  if(easy)card=hand[Math.min(hand.length-1,Math.floor(random()*hand.length))];
  else if(!easy){
    const options=evaluate().cards.sort((a,b)=>b.chance-a.chance||cardStrength(a.card,room.muestra)-cardStrength(b.card,room.muestra));
    card=options[0].card;
  }
  return {kind:'play',card};
}
function scheduleBot(){
  const room=state.room;
  if(!state.bot||!room){clearTimeout(state.botTimer);state.botTimer=null;return;}
  const key=(room.matchNumber||1)+':'+room.handNumber;
  if(state.botMemory?.key!==key)state.botMemory={key,played:[]};
  rememberBotCards(room,state.botMemory);
  if(state.botActing||state.learning?.paused){clearTimeout(state.botTimer);state.botTimer=null;return;}
  if(room.resolvingTrick||room.pendingNextHand||room.status==='revealing'){clearTimeout(state.botTimer);state.botTimer=null;return;}
  const ready=room.status==='drawing'?!room.openingDraw?.cards?.player2:
    room.status==='complete'?room.rematch?.status==='pending'&&room.rematch.requester==='player1':
    room.status==='started'&&(room.pendingBet?(room.pendingBet.revealMode?room.pendingBet.revealTurn==='player2':room.pendingBet.responder==='player2'):room.turn==='player2'||(!room.playedCount&&roomHasFlor(room,localHand('player2'))&&room.flors?.player2==null));
  if(!ready){clearTimeout(state.botTimer);state.botTimer=null;return;}
  const actionKey=room.status==='drawing'?key+':draw:'+room.openingDraw?.endsAt:
    room.status==='complete'?key+':rematch:'+room.rematch?.id:
    key+':'+turnClockKey(room)+':'+room.trucoLevel+':'+(room.flors?.player2??'');
  if(state.botTimer&&state.botTimerRoom===room&&state.botTimerKey===actionKey)return;
  clearTimeout(state.botTimer);state.botTimerRoom=room;state.botTimerKey=actionKey;
  const delay=3000;
  state.botTimer=setTimeout(()=>{
    state.botTimer=null;if(!state.bot||state.room!==room||state.learning?.paused)return;
    const action=room.status==='drawing'?{kind:'draw'}:room.status==='complete'?{kind:'rematch'}:
      chooseBotDecision(room,[...localHand('player2')],state.botDifficulty,state.botMemory);
    if(!action)return;
    const human=state.playerId;state.botActing=true;state.playerId='player2';state.hand=[...localHand('player2')];
    try{
      if(action.kind==='draw')drawOpeningCard();
      else if(action.kind==='rematch')respondRematch('accept');
      else if(action.kind==='reveal')revealEnvido(action.good,action.value);
      else if(action.kind==='play')localPlay(action.card);
      else localAction(action.value);
    }finally{
      state.playerId=human;state.hand=state.room?.status==='drawing'?[]:[...localHand(human)];state.botActing=false;renderGame();
    }
  },delay);
}

async function startLocalBotGame() {
  const role='player1',deviceMode='two';
  if(!await prepareCardImages())return false;
  forgetRoomSeat();
  stopBot();state.lobbyUnsubscribe?.();state.lobbyUnsubscribe=null;
  if(state.unsubscribe)state.unsubscribe();
  if(state.privateUnsubscribe)state.privateUnsubscribe();
  state.unsubscribe=null;state.privateUnsubscribe=null;state.privateHandKey=null;
  clearTimeout(state.resolutionTimer);state.resolutionTimer=null;state.resolutionTimerKey=null;
  drawInFlight=false;finishingDraw=false;
  state.localGame=true;state.roomCode='BOT1';state.playerId=role;const deck=shuffleDeck();
  state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};state.localOriginalHands=structuredClone(state.localHands);state.hand=role==='table'?[]:[...state.localHands[role]];
  state.room={deviceMode,status:'started',targetPoints:30,muestra:deck[6],table:{name:'La mesa'},players:{player1:{name:cleanName($('player-name').value,'Jugador')},player2:{name:'Bot'}},scores:{player1:0,player2:0},handNumber:1,deckCount:34,turn:'player1',mano:'player1',trickNo:1,trickCards:[],tricks:[],feed:[],playedCount:0,trucoLevel:1,lastTrucoCaller:null,pendingBet:null,flors:{},envidoClosed:false};
  state.room.status='drawing';state.room.openingDraw=newOpeningDraw();state.hand=[];
  state.localTruth={player1:handEnvido(state.localHands.player1,deck[6]),player2:handEnvido(state.localHands.player2,deck[6])};
  $('game-room-code').textContent='CONTRA BOT';renderGame();showView('game-view');return true;
}
function localHand(player){return state.localHands?.[player]||[];}
function localFeed(text){state.room.feed=[{text,time:Date.now()},...(state.room.feed||[])].slice(0,8);const notice=makeCallNotice(text);if(notice)state.room.callNotice=notice;}
function localScore(player,points,description){
  const amount=Math.max(0,Number(points)||0);if(!amount)return;
  const before={...state.room,scores:{...state.room.scores}};
  state.room.scores[player]=Math.min(targetPoints(state.room),(state.room.scores[player]||0)+amount);
  state.room.handScoreEntries=scoringEntries(before,state.room.scores,description);
  queueLearningPoints(before,state.room.scores,state.room.handScoreEntries);
  localFeed(`${state.room.players[player].name} ${description} (+${amount}).`);
  if(state.room.scores[player]>=targetPoints(state.room)){state.room.status='complete';state.room.lastHandScore=buildHandSummary(before,state.room.scores,description,null);state.room.handScoreHistory=handScoreHistory(state.room,state.room.lastHandScore);}
}
function localResolveFlor(bet){
  const values=state.room.flors||{};if(values.player1==null||values.player2==null)return;
  const winner=values.player1===values.player2?(state.room.mano||'player1'):(values.player1>values.player2?'player1':'player2');
  localScore(winner,bet.stake||3,`gana las flores (${values.player1} a ${values.player2})`);
  state.room.pendingBet=bet.suspendedBet||null;state.room.envidoClosed=true;state.room.florSettled=true;
}
function localCallAction(kind){
  if(state.learning?.paused)return;
  const room=state.room,caller=state.playerId;if(!room||caller==='table'||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||!localHand(caller).length)return;
  const other=otherPlayer(caller),pending=room.pendingBet;
  const overTruco=pending?.type==='truco'&&pending.responder===caller;
  
  if(pending&&!overTruco){toast('Respondé el canto.');return;}
  if(['envido','real','falta'].includes(kind)){
    if(!canCallFirstRoundEnvido(room,caller,localHand(caller))){toast('El envido está cerrado o hay flor.');return;}
    const base=pending?.type==='envido'?(pending.stake||0):0;
    room.pendingBet={type:'envido',caller,responder:other,stake:envidoBetPoints(room,kind,base),accepted:base,called:kind,calls:[kind],reveals:{},suspendedBet:overTruco?pending:null};
    queueLearningAction(kind);localFeed(`${room.players[caller].name} canta ${kind==='real'?'real envido':kind==='falta'?'falta envido':'envido'}.`);renderGame();return;
  }
  if(['truco','retruco','vale4'].includes(kind)){
    const wanted={truco:2,retruco:3,vale4:4}[kind],level=Number(room.trucoLevel)||1;
    if(pending||wanted!==level+1||level>=4||(level>1&&room.lastTrucoCaller===caller)){toast('Ese canto no está disponible.');return;}
    room.pendingBet={type:'truco',caller,responder:other,stake:wanted};room.lastTrucoCaller=caller;
    queueLearningTrucoCall(wanted,caller);
    localFeed(`${room.players[caller].name} canta ${kind==='vale4'?'vale cuatro':kind}.`);renderGame();
  }
}
function localAnswerAction(answer){
  if(state.learning?.paused)return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const room=state.room,bet=room?.pendingBet,player=state.playerId;if(!bet)return;
  if(bet.type==='envido'&&bet.revealMode&&answer==='yes'){
    revealEnvido();return;
  }
  if(bet.responder!==player)return;
  if(bet.type==='envido'&&roomHasFlor(room,localHand(player))){toast('Tenés flor. Cantá flor.');return;}
  if(bet.type==='flor'&&!florAnswers(bet,roomHasFlor(room,localHand(player))).some(([action])=>action===answer))return;
  if(bet.type==='flor'&&bet.single&&answer==='yes'){localAction('flor');return;}
  if(answer==='raise'&&bet.type==='truco'){
    const value=bet.stake===2?3:4;room.pendingBet={...bet,caller:player,responder:bet.caller,stake:value};room.lastTrucoCaller=player;queueLearningTrucoCall(value,player);localFeed(`${room.players[player].name} canta ${value===3?'retruco':'vale cuatro'}.`);renderGame();return;
  }
  if(answer.startsWith('raise-')&&bet.type==='envido'){
    const kind=answer.slice(6),value=envidoBetPoints(room,kind,bet.stake);
    room.pendingBet={...bet,caller:player,responder:bet.caller,accepted:bet.stake,stake:value,called:kind,calls:[...(bet.calls||[bet.called||'envido']),kind],reveals:{}};queueLearningAction(answer);localFeed(`${room.players[player].name} canta ${kind==='falta'?'falta envido':kind==='real'?'real envido':'envido'}.`);renderGame();return;
  }
  if(bet.type==='flor'&&(answer==='raise-conflor'||answer==='raise-faltaflor')){
    const kind=answer==='raise-faltaflor'?'falta':'conflor',value=florBetPoints(room,kind);room.flors={...room.flors,[player]:florValue(localHand(player),room.muestra)};room.pendingBet={...bet,single:false,caller:player,responder:bet.caller,accepted:bet.stake,stake:value,called:kind,calls:[...(bet.calls||[bet.called||'flor']),kind]};queueLearningAction(answer);localFeed(`${room.players[player].name} responde ${kind==='conflor'?'con flor envido':'contra flor al resto'}.`);renderGame();return;
  }
  if(answer==='yes'||answer==='no')queueLearningAction(answer,bet);
  if(answer==='no'){
    localFeed(`${room.players[player].name} ${bet.type==='flor'&&bet.single?'responde: tiene':'no quiere'}.`);
    const points=bet.type==='truco'?Math.max(1,(bet.stake||2)-1):bet.type==='flor'?declinedFlorPoints(bet):(bet.accepted||1);
    if(bet.type==='truco'){Object.assign(room,declinedTrucoChanges(room,player));renderGame();scheduleLocalNextHand(room);return;}
    if(bet.type==='flor')room.florSettled=true;
    localScore(bet.caller,points,`${bet.type==='envido'?'Envido':bet.type==='flor'?'Flor':'Truco'} no querido por ${room.players[player].name}`);room.pendingBet=bet.suspendedBet||null;room.envidoClosed=true;renderGame();return;
  }
  if(bet.type==='envido'){
    room.pendingBet={...bet,reveals:{},revealMode:true,revealTurn:room.mano};localFeed(`${room.players[player].name} quiere. Declara primero ${room.players[room.mano].name}.`);renderGame();return;
  }
  if(bet.type==='flor'){localFeed(`${room.players[player].name} quiere.`);localResolveFlor(bet);renderGame();return;}
  room.trucoLevel=bet.stake;room.pendingBet=null;localFeed(`${room.players[player].name} dice QUIERO`);renderGame();
}
function localAction(action){
  if(state.learning?.paused)return;
  if(action==='reveal')localAnswerAction('yes');
  else if(action==='flor'){
    const room=state.room,player=state.playerId;if(player==='table'||room.playedCount>0||room.flors?.[player]!=null||!roomHasFlor(room,localHand(player))){toast('No tenés flor.');return;}
    const other=otherPlayer(player);room.flors={...(room.flors||{}),[player]:florValue(localHand(player),room.muestra)};room.envidoClosed=true;
    const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
    room.pendingBet={type:'flor',called:'flor',single:!room.flors[other],caller:player,responder:other,stake:3,accepted:0,suspendedBet};
    queueLearningAction('flor');localFeed(`${room.players[player].name} canta flor.`);renderGame();
  } else if(['yes','no','raise'].includes(action)||action.startsWith('raise-'))localAnswerAction(action);
  else localCallAction(action);
}
function localPlay(card,launchOrigin=null) {
  if(state.learning?.paused)return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const player=state.playerId;if(player==='table')return;
  const pause=pauseMessage();if(pause){renderRoundPauseTimer();return;}
  if(state.room.status!=='started')return;
  if(state.room.pendingBet){shakeTurnBadge();return;}
  if(state.room.turn!==player){shakeTurnBadge();return;}
  animatePlayedHandCard(card,launchOrigin);
  state.localHands[player]=(state.localHands[player]||[]).filter((item)=>item.id!==card.id);state.hand=[...state.localHands[player]];state.room.playedCount=(state.room.playedCount||0)+1;
  state.room.trickCards=[...(state.room.trickCards||[]),{playerId:player,name:state.room.players[player].name,card}];state.room.deckCount--;
  if(state.room.trickCards.length===2){
    const first=state.room.trickCards[0],second=state.room.trickCards[1],winner=cardStrength(first.card,state.room.muestra)===cardStrength(second.card,state.room.muestra)?null:(cardStrength(first.card,state.room.muestra)>cardStrength(second.card,state.room.muestra)?first.playerId:second.playerId);
    state.room.tricks=[...(state.room.tricks||[]),{winner,played:[...state.room.trickCards]}];
    const handWinner=settleHand(state.room.tricks,state.room);
    if(winner)state.room.feed.unshift({text:`${state.room.players[winner].name} se lleva la ronda.`,time:Date.now()});
    state.room.resolvingTrick=true;state.room.resolutionId=crypto.randomUUID();state.room.resolutionEndsAt=gameTime()+3000;state.room.resolvedTrickWinner=winner;state.room.handComplete=!!handWinner;
    const resolvingRoom=state.room;
    scheduleLocalTransition(resolvingRoom,()=>{if(!state.localGame||state.room!==resolvingRoom)return;state.room.resolvingTrick=false;state.room.resolutionEndsAt=null;state.room.handComplete=false;state.room.trickCards=[];if(handWinner){localFinishHand(handWinner,state.room.trucoLevel||1);return;}else{state.room.turn=winner||state.room.mano;state.room.trickNo++;}state.hand=state.playerId==='table'?[]:[...(state.localHands[state.playerId]||[])];renderGame();},3000);
  }else state.room.turn=player==='player1'?'player2':'player1';
  renderGame();
}
function localFinishHand(winner,points,ending='rounds'){
  const room=state.room,before={...room,scores:{...room.scores}},groups=buildEndEvidence(room,state.localOriginalHands||{});
  room.scores=auditEnvidoScores(room,room.scores,state.localTruth||{});room.envidoAudit=null;
  room.scores[winner]=(room.scores[winner]||0)+points;
  room.scores=capScores(room,settleSingleFlor(room,room.scores));
  const reason=ending==='fold'?'Cuando te vas al mazo, el rival gana los puntos que estaban en juego hasta ese momento.':ending==='declined'?`${room.players[otherPlayer(winner)].name} dijo NO QUIERO. ${room.players[winner].name} gana ${points} ${points===1?'punto':'puntos'} por los puntos que estaban en juego hasta ese momento y se vuelve a repartir.`:`${room.players[winner].name} gana la mano (${points} puntos).`;
  room.lastHandScore=buildHandSummary(before,room.scores,reason,state.localTruth||{});room.handScoreEntries=[];
  room.handScoreHistory=handScoreHistory(room,room.lastHandScore);
  queueLearningPoints(before,room.scores,room.lastHandScore.entries);
  if(state.learning?.stage===0){state.learning.completedHands=(state.learning.completedHands||0)+1;if(state.learning.completedHands>=3&&!state.learning.hasCalledTruco){state.learning.trucoReminderPending=true;state.learning.trucoReminderAfterHand=room.handNumber;}}
  if(groups.length){localShowEvidence(groups);renderGame();return;}
  localDealAfterHand();
}
function localShowEvidence(groups){
  const room=state.room,delay=state.learning?3000:5000;
  room.status='revealing';room.pendingBet=null;room.trickCards=[];room.turn=null;room.endReveal={id:crypto.randomUUID(),endsAt:gameTime()+delay,groups};
  scheduleLocalTransition(room,()=>{if(!state.localGame||state.room!==room||room.status!=='revealing')return;localDealAfterHand();},delay);
}
function localDealAfterHand(){
  if(state.learning&&(state.learning.scoreMessages?.length||state.learning.activeScoreMessage)){
    state.learning.afterScoreMessage=localDealAfterHand;renderGame();return;
  }
  if(finishLearningHand())return;
  const room=state.room;
  if(Math.max(...Object.values(room.scores))>=targetPoints(room)){room.status='complete';room.pendingBet=null;room.endReveal={done:true};renderGame();return;}
  const deck=learningDeck(room),mano=otherPlayer(room.mano);
  state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};
  state.localOriginalHands=structuredClone(state.localHands);
  state.localTruth={player1:handEnvido(state.localHands.player1,deck[6]),player2:handEnvido(state.localHands.player2,deck[6])};
  Object.assign(room,{status:'started',resolutionEndsAt:null,resolvingTrick:false,endReveal:null,mano,dealer:otherPlayer(mano),turn:mano,handNumber:room.handNumber+1,tricks:[],trickCards:[],trickNo:1,muestra:deck[6],deckCount:33,playedCount:0,trucoLevel:1,pendingBet:null,lastTrucoCaller:null,flors:{},florSettled:false,envidoClosed:false,callNotice:null});
  state.hand=state.playerId==='table'?[]:[...state.localHands[state.playerId]];
  localFeed(`${room.players[room.dealer].name} reparte. Empieza ${room.players[mano].name}.`);renderGame();
}


function animatePlayedHandCard(card,origin=null){
  const source=$('hand').querySelector('[data-card="'+CSS.escape(card.id)+'"]');
  if(!source)return;
  const rect=origin?.cardId===card.id?origin.rect:source.getBoundingClientRect();
  const flight=source.cloneNode(true);
  flight.classList.remove('dragging','launching-card');
  flight.classList.add('card-flight');
  const twoDevice=$('game-view').classList.contains('two-device-mode');
  if(twoDevice){
    flight.classList.add('two-device-flight');
    const tableRect=$('trick-cards').getBoundingClientRect();
    const targetX=tableRect.left+tableRect.width*(state.playerId==='player1'?.2:.4);
    const targetY=tableRect.top+tableRect.height*.5;
    flight.style.setProperty('--flight-x',(targetX-(rect.left+rect.width/2))+'px');
    flight.style.setProperty('--flight-y',(targetY-(rect.top+rect.height/2))+'px');
    flight.style.setProperty('--flight-scale',String(Math.min(62/rect.width,90/rect.height)));
  }else flight.style.setProperty('--flight-y',-(rect.bottom+80)+'px');
  flight.removeAttribute('data-card');flight.removeAttribute('aria-disabled');
  flight.setAttribute('aria-hidden','true');flight.tabIndex=-1;
  flight.style.left=rect.left+'px';flight.style.top=rect.top+'px';
  flight.style.width=rect.width+'px';flight.style.height=rect.height+'px';
  state.launchingCardId=card.id;source.classList.add('launching-card');
  document.body.appendChild(flight);
  setTimeout(()=>{
    flight.remove();
    if(state.launchingCardId===card.id){state.launchingCardId=null;renderGame();}
    $('hand').querySelector('[data-card="'+CSS.escape(card.id)+'"]')?.classList.remove('launching-card');
  },430);
}
let handGesture=null,ignoreHandClickUntil=0;
const handSurface=$('hand');
function handCards(){return [...handSurface.querySelectorAll('.hand-card')];}
function updateHandPreview(drag,dx){
  if(!drag.slots.length)return;
  const from=drag.originalOrder.indexOf(drag.cardId);
  const center=drag.slots[from].x+dx;
  let to=0;
  for(let i=1;i<drag.slots.length;i++){
    if(Math.abs(center-drag.slots[i].x)<Math.abs(center-drag.slots[to].x))to=i;
  }
  const order=[...drag.originalOrder];
  order.splice(from,1);order.splice(to,0,drag.cardId);
  drag.previewOrder=order;
  for(const el of handCards()){
    if(el.dataset.card===drag.cardId)continue;
    const initial=drag.originalOrder.indexOf(el.dataset.card),preview=order.indexOf(el.dataset.card);
    if(initial<0||preview<0)continue;
    el.style.setProperty('--preview-x',(drag.slots[preview].x-drag.slots[initial].x)+'px');
  }
}
function clearHandPreview(){
  handCards().forEach(el=>{
    el.classList.remove('dragging','card-touch');
    for(const key of ['--drag-x','--drag-y','--preview-x'])el.style.removeProperty(key);
  });
}
function finishHandGesture(event,cancelled=false){
  const drag=handGesture;if(!drag||drag.pointerId!==event.pointerId)return;
  const dragged=handSurface.querySelector('[data-card="'+CSS.escape(drag.cardId)+'"]');
  const launchRect=dragged?.getBoundingClientRect();
  handGesture=null;state.handGestureActive=false;
  try{handSurface.releasePointerCapture(event.pointerId);}catch{}
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
  const moved=drag.moved||Math.abs(dx)>9||Math.abs(dy)>9;
  if(cancelled){clearHandPreview();renderGame();return;}
  if(moved){
    if(dy<=-40){
      state.cardLaunchOrigin=launchRect?{cardId:drag.cardId,rect:launchRect}:null;
      clearHandPreview();
      ignoreHandClickUntil=Date.now()+500;
      const played=state.hand.find(item=>item.id===drag.cardId);
      if(played)playCard(played);
      return;
    }
    updateHandPreview(drag,dx);
    saveHandOrder(drag.previewOrder||drag.originalOrder);
    clearHandPreview();renderGame();
    ignoreHandClickUntil=Date.now()+400;
    return;
  }
  clearHandPreview();
  ignoreHandClickUntil=Date.now()+500;
  const played=state.hand.find(item=>item.id===drag.cardId);
  if(played)playCard(played);
}
handSurface.addEventListener('pointerdown',event=>{
  const card=event.target.closest('.hand-card');
  if(liveActionsBlocked()||state.liveAction||handGesture||state.playActionInFlight||!card||state.playerId==='table'||!state.hand.some(item=>item.id===card.dataset.card))return;
  if(event.button!=null&&event.button!==0)return;
  const originalOrder=orderedHand().map(item=>item.id);
  const slots=originalOrder.map(id=>{
    const el=handSurface.querySelector('[data-card="'+CSS.escape(id)+'"]'),r=el.getBoundingClientRect();
    return {x:r.left+r.width/2};
  });
  handGesture={pointerId:event.pointerId,cardId:card.dataset.card,startX:event.clientX,startY:event.clientY,moved:false,originalOrder,slots,previewOrder:originalOrder};
  state.handGestureActive=true;card.classList.add('card-touch');
  try{handSurface.setPointerCapture(event.pointerId);}catch{}
});
handSurface.addEventListener('pointermove',event=>{
  const drag=handGesture;if(!drag||drag.pointerId!==event.pointerId)return;
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
  if(!drag.moved&&Math.hypot(dx,dy)<7)return;
  drag.moved=true;
  const card=handSurface.querySelector('[data-card="'+CSS.escape(drag.cardId)+'"]');
  if(card){card.classList.add('dragging');card.style.setProperty('--drag-x',dx+'px');card.style.setProperty('--drag-y',dy+'px');}
  updateHandPreview(drag,dx);
});
handSurface.addEventListener('pointerup',event=>finishHandGesture(event));
handSurface.addEventListener('pointercancel',event=>finishHandGesture(event,true));
handSurface.addEventListener('click',event=>{
  if(Date.now()<ignoreHandClickUntil)event.preventDefault();
});
handSurface.addEventListener('keydown',event=>{
  const card=event.target.closest('.hand-card');
  if(!card||!['Enter',' '].includes(event.key))return;
  event.preventDefault();const played=state.hand.find(item=>item.id===card.dataset.card);if(played)playCard(played);
});

document.querySelectorAll('.scoreboard,.mobile-score').forEach(marker=>{
  marker.setAttribute('role','button');marker.setAttribute('tabindex','0');marker.setAttribute('aria-label','Ver historial de puntos de todas las manos');
  marker.addEventListener('click',openScoreDetails);
  marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openScoreDetails();}});
});
$('close-score-details').addEventListener('click',()=>$('score-details').close());
$('dismiss-score-details').addEventListener('click',()=>$('score-details').close());
$('score-details').addEventListener('click',event=>{if(event.target===$('score-details'))$('score-details').close();});
$('play-bot').addEventListener('change',updateBotSetup);
$('use-table-device').addEventListener('change',event=>updateMode(event.target.checked?'three':'two'));
$('points-picker-trigger').addEventListener('click',()=>{const menu=$('points-picker-menu'),opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);$('points-picker-trigger').setAttribute('aria-expanded',String(opening));});
document.addEventListener('click',event=>{if(!event.target.closest('.points-picker')){$('points-picker-menu').classList.add('hidden');$('points-picker-trigger').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('points-picker-menu').classList.add('hidden');$('points-picker-trigger').setAttribute('aria-expanded','false');}});
$('create-room').addEventListener('click',()=>configureSetup());
$('open-room-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-room][data-seat]');if(button)joinOpenRoom(button.dataset.room,button.dataset.seat);});
$('role-options').querySelectorAll('.role-card').forEach((card)=>{
  card.addEventListener('click',()=>{
    if(!card.classList.contains('hidden')) pickRole(card.dataset.role);
  });
});
$('back-home').addEventListener('click',()=>{showView('welcome-view');openLobby();});
$('fold-hand').addEventListener('click',event=>runLiveAction(event.currentTarget,foldHand));
$('enter-room').addEventListener('click',enterRoom);
$('leave-room').addEventListener('click',()=>{stopRoomPresence();stopBot();state.roomWatchVersion=(state.roomWatchVersion||0)+1;state.navigationEpoch=(state.navigationEpoch||0)+1;forgetRoomSeat();if(state.unsubscribe)state.unsubscribe();if(state.privateUnsubscribe)state.privateUnsubscribe();state.privateUnsubscribe=null;state.privateHandKey=null;state.room=null;state.localGame=false;showView('welcome-view');openLobby();});
$('game-home').addEventListener('click',()=>{if(state.room?.status==='drawing'){closeOpeningDraw('draw-left');return;}if(state.localGame){stopBot();state.localGame=false;showView('welcome-view');openLobby();return;}showView('waiting-view');});
function limitMuestraOffset(x,y){
  const distance=Math.hypot(x,y),scale=distance>15?15/distance:1;
  return {x:x*scale,y:y*scale};
}
$('muestra-card').addEventListener('pointerdown',(event)=>{
  if (!state.localGame && state.playerId !== 'table' && state.room?.deviceMode !== 'two') return;
  const card=$('muestra-card'); if(card.classList.contains('hidden')) return;
  card.setPointerCapture?.(event.pointerId); card.classList.add('dragging');
  card._drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,baseX:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dx'))||0,baseY:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dy'))||0};
});
$('muestra-card').addEventListener('pointermove',(event)=>{
  const card=$('muestra-card'),drag=card._drag; if(!drag||drag.pointerId!==event.pointerId)return;
  const offset=limitMuestraOffset(drag.baseX+event.clientX-drag.startX,drag.baseY+event.clientY-drag.startY);
  card.style.setProperty('--muestra-dx',`${offset.x}px`);
  card.style.setProperty('--muestra-dy',`${offset.y}px`);
});
const endMuestraDrag=(event)=>{const card=$('muestra-card');if(card._drag?.pointerId===event.pointerId){card.releasePointerCapture?.(event.pointerId);card._drag=null;card.classList.remove('dragging');}};
$('muestra-card').addEventListener('pointerup',endMuestraDrag);
$('muestra-card').addEventListener('pointercancel',endMuestraDrag);
let lastTouchEnd=0;
document.addEventListener('touchend',(event)=>{
  const now=Date.now();
  if(now-lastTouchEnd<=320)event.preventDefault();
  lastTouchEnd=now;
},{passive:false});
$('player-sound-toggle').addEventListener('click',()=>{
  soundEnabled=!soundEnabled;
  if(soundEnabled)unlockVoice();
  localStorage.setItem('truco-call-sound',soundEnabled?'on':'off');
  if(!soundEnabled)window.speechSynthesis?.cancel();
  renderCallNotice();
});
document.addEventListener('click',event=>{if(event.isTrusted)unlockVoice();},{capture:true});
document.addEventListener('touchend',event=>{if(event.isTrusted)unlockVoice();},{capture:true,passive:true});
$('sound-toggle').addEventListener('click',()=>$('player-sound-toggle').click());
$('chat-quick').addEventListener('click',event=>{const button=event.target.closest('[data-quick-message]');if(!button||button.disabled||peerChatMuted()||liveActionsBlocked())return;touchFeedback(button);$('chat-input').value=button.dataset.quickMessage;sendMatchChat(event);});
$('chat-toggle').addEventListener('click',()=>matchChat.open?closeMatchChat():openMatchChat());
$('chat-close').addEventListener('click',()=>{closeMatchChat();$('chat-toggle').focus();});
$('chat-backdrop').addEventListener('click',()=>{closeMatchChat();$('chat-toggle').focus();});
$('chat-form').addEventListener('submit',sendMatchChat);
$('chat-input').addEventListener('input',()=>{$('chat-input').value=$('chat-input').value.slice(0,CHAT_LIMIT);$('chat-count').textContent=`${$('chat-input').value.length}/${CHAT_LIMIT}`;});
$('chat-muted').addEventListener('change',()=>{chatMuted=$('chat-muted').checked;if(chatMuted)clearChatNotices();updateChatUnread();publishChatMute();});
$('match-chat').addEventListener('keydown',event=>{if(event.key==='Escape'){closeMatchChat();$('chat-toggle').focus();}});
$('close-config').addEventListener('click',()=>showView('setup-view'));
$('save-config').addEventListener('click',()=>{try{const cfg=JSON.parse($('firebase-config').value);if(!firebaseConfigValid(cfg))throw new Error('missing');state.config=cfg;localStorage.setItem(storageKey,JSON.stringify(cfg));toast('Configuración guardada.',true);runPendingAction();}catch{toast('Pegá una configuración Firebase válida.',true);}});
if(new URLSearchParams(location.search).has('mesa'))showView('invite-view');
state.config=loadConfig();
setupSuitIcons();renderPointsPicker();



document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.room){renderGame();renderTurnTimer();if(!state.localGame&&isCoordinator())scheduleTableResolution();}});
window.addEventListener('offline',()=>{state.connectionReady=false;state.connectionEpoch=(state.connectionEpoch||0)+1;if(state.room)renderGame();});
window.addEventListener('online',()=>{if(state.room){refreshLiveConnection();renderGame();}else retryRoomRestore();});



const LEARNING_STAGES=[
  {title:'Lo básico',intro:'Reciben 3 cartas cada uno.\nEl que gane 2 de 3 manos (rondas) gana los puntos en juego.\nSe comienza jugando por 1 punto.\nEl que gane una mano y empate otra mano también gana.'},
  {title:'Sumamos el envido',intro:'Ahora podés cantar envido antes de tirar tu primera carta.\nSi el rival acepta, el que tenga más tantos de envido gana 2 puntos; si no acepta, vos ganás 1 punto.\nLuego el partido se sigue jugando con normalidad.\nYa te mostraremos cómo sumar tus puntos.'},
  {title:'Sumamos la flor',intro:'Se juega con envido y flor. Tenés flor con 3 cartas del mismo palo, 2 o más piezas, o una pieza y 2 cartas comunes del mismo palo. Con flor no se juega envido. Para sumar varias piezas: la mayor vale completa y las otras aportan su última cifra.'}
];
function learningDeck(room){
  let deck;do{deck=shuffleDeck();}while(room?.practiceRules?.envido&&room.practiceRules.flor===false&&(hasFlor(deck.slice(0,3),deck[6])||hasFlor(deck.slice(3,6),deck[6])));
  return deck;
}
function roomHasFlor(room,hand){return room?.practiceRules?.flor!==false&&hasFlor(hand,room?.muestra);}
function openLearning(){
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  $('learn-coach-dialog').close();
  if(state.learning){stopBot();clearTimeout(state.resolutionTimer);state.room=null;state.localGame=false;}
  showView('learn-view');
}
async function startLearning(stage=0){
  if(state.learningStarting)return;state.learningStarting=true;
  try{
    $('learn-coach-dialog').close();
    if(!await startLocalBotGame())return;
    state.learning={stage,hints:true,pointsInfo:true,paused:true,pausedAt:gameTime(),complete:false,scoreMessages:[],tutorialMessages:[{title:'Guía de cartas',pointAtGuide:true,text:'Podés tocar este ícono cuando quieras para abrir la guía. Te ayuda a reconocer tus cartas y saber cuáles son más poderosas.'}]};
    state.bot=true;state.botDifficulty='normal';state.botMemory=null;
    state.room.players={player1:{name:cleanName($('player-name').value||savedPlayerName(),'Vos')},player2:{name:'Bot de práctica'}};
    Object.assign(state.room,{targetPoints:10,status:'started',openingDraw:null,createdAt:gameTime(),matchNumber:1,turnClock:null,practiceRules:{envido:stage>=1,flor:stage>=2}});
    if(stage===1){
      const deck=learningDeck(state.room);state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};
      state.localOriginalHands=structuredClone(state.localHands);state.room.muestra=deck[6];
      state.localTruth={player1:handEnvido(state.localHands.player1,deck[6]),player2:handEnvido(state.localHands.player2,deck[6])};
    }
    state.hand=[...state.localHands.player1];
    state.dismissedMatchEnd=null;state.focusedMatchEnd=null;
    renderGame();showView('game-view');openLearningHelp();
  }catch(error){console.error('[truco:learning]',error);toast('No se pudo iniciar la práctica. Volvé a intentar.');}
  finally{state.learningStarting=false;}
}
function learningGuidance(){
  const room=state.room,learning=state.learning;if(!learning||!room)return [];
  const original=state.localOriginalHands?.player1||state.hand,muestra=room.muestra,bet=room.pendingBet;
  if(learning.complete){
    const winner=matchWinner(room),name=room.players?.[winner]?.name||'El jugador';
    return [name+' ganó. Resultado: '+room.scores.player1+' a '+room.scores.player2+'. La partida era a 10.',
      learning.stage===0?'Podés seguir practicando lo básico o sumar el envido.':learning.stage===1?'Podés seguir con envido, volver a lo básico o sumar la flor.':'Podés seguir con todas las reglas, quitar la flor o volver a lo básico.'];
  }
  if(bet?.revealMode&&bet.revealTurn==='player1')return ['Arrastrá los números y tocá DECLARAR. Si no superás al rival, podés decir SON BUENAS.',explainEnvido(original,muestra).explanation];
  if(bet?.responder==='player1'){
    if(bet.type==='truco'){
      const stake=Number(bet.stake)||2,declined=stake-1;
      const text='QUIERO hace que jueguen por '+stake+' puntos. NO QUIERO le da '+declined+' '+(declined===1?'punto':'puntos')+' al rival y se vuelve a repartir.';
      const raise=stake<4?({2:'RETRUCO',3:'VALE CUATRO'}[stake]+' es una pregunta al rival: si acepta, juegan por '+(stake+1)+' puntos; si no acepta, ganás '+stake+' puntos.'):'';
      return [text,...(raise?[raise]:[])];
    }
    if(bet.type==='envido'){const points=Number(bet.stake)||2,declined=Number(bet.accepted)||1;return ['Si aceptás, el que sume más tantos de envido gana '+points+' puntos. Si no aceptás, el rival gana '+declined+' '+(declined===1?'punto':'puntos')+'.'];}
    if(bet.type==='flor'){const points=Number(bet.stake)||3,declined=declinedFlorPoints(bet);return [bet.single&&!roomHasFlor(room,original)?'Si no tenés flor, el rival gana 3 puntos.':'Si aceptás, el que sume más tantos de flor gana '+points+' puntos. Si no aceptás, el rival gana '+declined+' '+(declined===1?'punto':'puntos')+'.'];}
  }
  if(bet)return ['Esperá la respuesta del bot. No hay límite de tiempo.'];
  if(roomHasFlor(room,original)&&!room.florSettled&&!room.flors?.player1)return ['Tenés FLOR de '+florValue(original,muestra)+' tantos. Cantala antes de tirar; con flor no se juega envido.',explainFlor(original,muestra).explanation];
  if(room.resolvingTrick||room.pendingNextHand||room.status==='revealing')return ['Mirá las cartas y el resultado de la ronda. Cerrá este mensaje para continuar.'];
  const guidance=[];
  if(canCallFirstRoundEnvido(room,'player1',state.hand))guidance.push('Tenés '+handEnvido(original,muestra)+' tantos. Podés cantar ENVIDO antes de tirar tu primera carta.');
  if(room.turn==='player1'&&state.hand.length){
    const opponent=(room.trickCards||[]).find(item=>item.playerId==='player2')?.card;
    const sorted=[...state.hand].sort((a,b)=>cardStrength(a,muestra)-cardStrength(b,muestra));
    const choice=opponent?sorted.find(card=>cardStrength(card,muestra)>cardStrength(opponent,muestra)):sorted[sorted.length-1];
    guidance.push(choice?'Podés probar '+cardStudyName(choice)+(pieceOrder(choice,muestra)?', una pieza.':opponent?' para ganar esta ronda.':', tu carta más fuerte.'):'No podés superar esa carta. Podés guardar tu mejor carta para otra ronda.');
  }else guidance.push('Ahora juega el bot. Mirá cómo se resuelve la ronda.');
  return guidance;
}
function learningMessageKey(){
  return JSON.stringify([state.room?.handNumber,state.room?.trickNo,learningGuidance()]);
}
function queueLearningPoints(before,after,entries){
  if(!state.learning||state.learning.pointsInfo===false)return;
  for(const player of ['player1','player2']){
    const points=(after[player]||0)-(before.scores[player]||0);if(points<=0)continue;
    const details=(entries||[]).slice((before.handScoreEntries||[]).length).filter(entry=>entry.player===player).map(entry=>entry.detail);
    const wonRounds=(before.tricks||[]).filter(round=>round.winner===player).length;
    const reason=details.map(detail=>{
      if(!detail.startsWith('Mano ganada'))return detail;
      const level=Number(before.trucoLevel)||1;
      if(level>1)return 'Se jugó '+({2:'truco',3:'retruco',4:'vale cuatro'}[level]||'truco')+'. '+({2:'Truco = 2 puntos',3:'Retruco = 3 puntos',4:'Vale cuatro = 4 puntos'}[level]||'');
      if(wonRounds>=2)return (player==='player1'?'Ganaste':'Ganó')+' dos rondas.';
      if(wonRounds===1)return 'Ganó una ronda y la otra empató. Una ronda ganada y una empatada alcanzan para ganar la mano.';
      return 'El rival se fue al mazo o no quiso el truco. La mano sin truco vale 1 punto.';
    }).join('\n');
    const subject=player==='player1'?'Sumaste':(before.players?.[player]?.name||'El bot')+' sumó';
    state.learning.scoreMessages??=[];
    state.learning.scoreMessages.push(subject+' '+points+' '+(points===1?'punto':'puntos')+'.\n'+(reason||'Por los puntos de esta mano.')+(after[player]>=targetPoints(before)?'\n'+(player==='player1'?'Llegaste':'Llegó')+' al límite de la partida: '+targetPoints(before)+' puntos.':''));
  }
}
function positionLearningScoreArrow(){
  const tipActive=$('learning-points-tip').open;
  $('learning-points-arrow').classList.toggle('hidden',!tipActive);
  if(tipActive)$('learning-score-arrow').classList.add('hidden');
  const dialog=tipActive?$('learning-points-tip'):$('learning-hint'),arrow=$(tipActive?'learning-points-arrow':'learning-score-arrow'),path=$(tipActive?'learning-points-arrow-path':'learning-score-arrow-path');
  const scoreActive=dialog.open&&state.learning?.activeScoreMessage,trucoActive=dialog.open&&state.learning?.activeTutorial?.pointAtTruco;
  const guideActive=dialog.open&&state.learning?.activeTutorial?.pointAtGuide;
  const active=tipActive||scoreActive||trucoActive||guideActive;
  arrow.classList.toggle('hidden',!active);
  document.querySelectorAll('.scoreboard,.mobile-score').forEach(marker=>marker.classList.toggle('learning-score-highlight',!!scoreActive));
  if(!active)return;
  if(guideActive){
    const button=$('game-sheet'),target=button?.getBoundingClientRect();
    if(!target?.width||!target.height){arrow.classList.add('hidden');return;}
    const box=dialog.getBoundingClientRect(),x1=box.left+box.width*.65,y1=box.top-4,x2=target.left+target.width/2,y2=target.bottom+8;
    arrow.setAttribute('viewBox','0 0 '+window.innerWidth+' '+window.innerHeight);
    path.setAttribute('d','M '+x1+' '+y1+' C '+x1+' '+(y1-35)+' '+x2+' '+(y2+35)+' '+x2+' '+y2);
    return;
  }
  if(trucoActive){
    const button=$('player-actions').querySelector('[data-action="truco"]');
    if(!button){arrow.classList.add('hidden');return;}
    const box=dialog.getBoundingClientRect(),target=button.getBoundingClientRect(),x=target.left+target.width/2,y1=box.bottom-4,y2=target.top-6;
    arrow.setAttribute('viewBox','0 0 '+window.innerWidth+' '+window.innerHeight);
    path.setAttribute('d','M '+x+' '+y1+' C '+x+' '+(y1+20)+' '+x+' '+(y2-20)+' '+x+' '+y2);
    return;
  }
  const marker=[...document.querySelectorAll('.mobile-score,.scoreboard')].find(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height);
  if(!marker){arrow.classList.add('hidden');return;}
  const box=dialog.getBoundingClientRect(),target=marker.getBoundingClientRect();
  const x1=Math.max(box.left+20,Math.min(box.right-24,target.left-40)),y1=box.top+12,x2=target.left-8,y2=target.top+target.height*.65;
  arrow.setAttribute('viewBox','0 0 '+window.innerWidth+' '+window.innerHeight);
  path.setAttribute('d','M '+x1+' '+y1+' C '+x1+' '+y2+' '+(x2-28)+' '+y2+' '+x2+' '+y2);
}
const learningSeen=new Set((()=>{try{return JSON.parse(localStorage.getItem('truco-learning-seen-v1')||'[]');}catch{return [];}})());
function learningHelpTopic(bet=state.room?.pendingBet){
  return ['response',bet?.type,bet?.called,bet?.stake,!!bet?.single,!!bet?.revealMode,!!bet?.suspendedBet].join(':');
}
function enqueueLearningHelp(message,topic){
  const learning=state.learning;
  if(!learning?.hints||learningSeen.has(topic))return;
  learning.tutorialMessages??=[];
  if(!learning.tutorialMessages.some(item=>item.topic===topic))learning.tutorialMessages.push({...message,topic});
}
function rememberLearningHelp(topic){
  if(!topic)return;
  learningSeen.add(topic);
  try{localStorage.setItem('truco-learning-seen-v1',JSON.stringify([...learningSeen]));}catch{}
}
function queueLearningAction(action,bet=state.room?.pendingBet){
  const learning=state.learning,room=state.room;
  if(!learning?.hints||state.playerId!=='player1'||!room)return;
  const pointsText=value=>value+' '+(value===1?'punto':'puntos');
  const stake=Number(bet?.stake)||1;
  const declined=bet?.type==='truco'?Math.max(1,stake-1):bet?.type==='flor'?declinedFlorPoints(bet):Number(bet?.accepted)||1;
  let title,text;
  if(action==='fold'){
    title='Te fuiste al mazo';text='El rival gana los puntos que estaban en juego hasta ese momento. Se vuelve a repartir.';
  }else if(action==='declare'||action==='good'){
    title=action==='good'?'Dijiste SON BUENAS':'Declaraste tus tantos';
    text=action==='good'?'Aceptaste que el rival tiene más tantos. Los puntos del envido se verifican al terminar la mano.':'El rival compara sus tantos con los que declaraste. Gana quien tenga más; si empatan, gana quien es mano. Los tantos se verifican al terminar la mano.';
  }else if(action==='yes'||action==='no'){
    const singleFlor=bet?.type==='flor'&&bet.single;
    title=singleFlor&&action==='no'?'Dijiste TIENE':bet?.type==='flor'&&bet.called==='flor'&&action==='yes'?'Dijiste LA MÍA ES FLOR':'Dijiste '+(action==='yes'?'QUIERO':'NO QUIERO');
    if(action==='no')text='El rival gana '+pointsText(declined)+'. '+(bet?.type==='truco'?'Se vuelve a repartir.':'La mano sigue jugando con normalidad.');
    else if(bet?.type==='truco')text='Aceptaste jugar la mano por '+pointsText(stake)+'.';
    else text='El que tenga más tantos de '+(bet?.type==='flor'?'flor':'envido')+' gana '+pointsText(stake)+'. Si empatan, gana quien es mano. '+(bet?.type==='envido'?'Ahora hay que declarar los tantos.':'Después se sigue jugando la mano.');
  }else if(bet&&['envido','flor'].includes(bet.type)){
    title='Dijiste '+betCallNames(bet).join(' + ').toUpperCase();
    text='Si el rival acepta, el que tenga más tantos de '+bet.type+' gana '+pointsText(stake)+'. Si no acepta, ganás '+pointsText(declined)+'. Después se sigue jugando la mano.';
    if(bet.suspendedBet?.type==='truco')text+=' Primero se resuelve el '+bet.type+' y después se responde el truco.';
  }else return;
  enqueueLearningHelp({title,text},['action',action,bet?.type,bet?.called,stake,!!bet?.single,!!bet?.suspendedBet].join(':'));
}
function queueLearningTrucoCall(stake,player){
  const learning=state.learning;
  if(!learning||player!=='player1')return;
  learning.hasCalledTruco=true;learning.trucoReminderPending=false;
  if(!learning.hints)return;
  const name={2:'TRUCO',3:'RETRUCO',4:'VALE 4'}[stake],declined=stake-1;
  enqueueLearningHelp({title:'Dijiste '+name,text:'Si el rival acepta, juegan por '+stake+' puntos. Si el rival no acepta, ganás '+declined+' '+(declined===1?'punto':'puntos')+' y se vuelve a repartir.'},'truco-call:'+stake);
}
function queueLearningTrucoReminder(){
  const learning=state.learning,room=state.room;
  if(!learning||learning.stage!==0||!learning.hints||!learning.trucoReminderPending||Number(room.handNumber)<=Number(learning.trucoReminderAfterHand)||learning.hasCalledTruco||learning.trucoReminderShown||room.status!=='started'||room.pendingBet||room.resolvingTrick||room.pendingNextHand||room.endReveal&&!room.endReveal.done)return;
  learning.trucoReminderPending=false;learning.trucoReminderShown=true;
  learning.tutorialMessages??=[];
  learning.tutorialMessages.push({title:'Podés gritar TRUCO',pointAtTruco:true,text:'Si tocás TRUCO, podés aumentar los puntos en juego. Sin truco se juega por 1 punto. Con truco se juega por 2 puntos. El rival tiene que aceptar; si no acepta, ganás 1 punto.'});
}
function showLearningMessage(){
  if(!state.learning||state.learning.paused||state.learning.complete||document.querySelector('.learn-coach-dialog[open]'))return;
  if(state.learning.pointsInfo===false)state.learning.scoreMessages=[];
  if(!state.learning.hints)state.learning.tutorialMessages=[];
  queueLearningTrucoReminder();
  const tutorial=state.learning.tutorialMessages?.shift();
  const room=state.room,bet=room.pendingBet,scoreMessage=tutorial?null:state.learning.scoreMessages?.shift();
  if(!tutorial&&!scoreMessage&&!state.learning.hints)return;
  // Explain actual scoring and new calls; ordinary turns and round pauses need no popup.
  if(!tutorial&&!scoreMessage&&(!bet||(bet.revealMode?bet.revealTurn!=='player1':bet.responder!=='player1')))return;
  const key=tutorial?'tutorial:'+crypto.randomUUID():scoreMessage?'score:'+crypto.randomUUID():learningMessageKey();
  if(!tutorial&&!scoreMessage&&(state.learning.acknowledgedMessage===key||learningSeen.has(learningHelpTopic(bet))))return;
  if(!scoreMessage){const topic=tutorial?.topic||learningHelpTopic(bet);rememberLearningHelp(topic);}
  pauseLearning();state.learning.activeMessage=key;state.learning.activeScoreMessage=!!scoreMessage;state.learning.activeTutorial=tutorial||null;
  $('learning-message-title').textContent=scoreMessage?'':tutorial?.title||'Antes de responder';
  $('learning-message-title').classList.toggle('hidden',!!scoreMessage);
  $('learning-hint').classList.toggle('score-message',!!scoreMessage);
  if(scoreMessage){$('learning-hint').removeAttribute('aria-labelledby');$('learning-hint').setAttribute('aria-label','Puntos de la mano');}
  else{$('learning-hint').removeAttribute('aria-label');$('learning-hint').setAttribute('aria-labelledby','learning-message-title');}
  const body=$('learning-message-body');body.replaceChildren();
  (tutorial?[tutorial.text]:scoreMessage?[scoreMessage]:learningGuidance()).flatMap(text=>text.replace(/\.\s*/g,'.\n').split('\n')).filter(text=>text.trim()).forEach(text=>{const p=document.createElement('p');p.textContent=text;body.append(p);});
  const studyButton=$('learning-message-study'),kind=!tutorial&&!scoreMessage&&['envido','flor'].includes(bet?.type)?bet.type:null;
  studyButton.classList.toggle('hidden',!kind);
  studyButton.dataset.studyKind=kind||'';
  studyButton.textContent=kind==='flor'?'Cómo sumar mis puntos de flor':'Cómo sumar mis puntos de envido';
  $('learning-hint').showModal();
  requestAnimationFrame(positionLearningScoreArrow);
}
function positionLearningControls(){
  if(!state.learning||!state.localGame)return;
  const game=$('game-view'),box=game.getBoundingClientRect(),header=game.querySelector('.game-topbar'),hand=$('hand').getBoundingClientRect();
  if(header)game.style.setProperty('--learning-exit-top',(header.getBoundingClientRect().bottom-box.top+10)+'px');
  game.style.setProperty('--learning-options-top',(hand.top+hand.height/2-box.top)+'px');
  const cards=[...$('hand').querySelectorAll('.hand-card')].map(card=>card.getBoundingClientRect());
  if(cards.length){
    const felt=$('felt-area').getBoundingClientRect(),rounds=$('learning-rounds');
    rounds.style.top=(Math.min(...cards.map(card=>card.top))-felt.top-18)+'px';
    rounds.style.left=((Math.min(...cards.map(card=>card.left))+Math.max(...cards.map(card=>card.right)))/2-felt.left)+'px';
  }
}
function renderLearningRounds(){
  const el=$('learning-rounds'),active=!!(state.learning&&state.localGame);
  el.classList.toggle('hidden',!active);
  if(!active){el.replaceChildren();return;}
  const rounds=state.room?.tricks||[],labels=[];
  el.innerHTML=[0,1,2].map(index=>{
    const round=rounds[index],result=!round?'pending':round.winner===state.playerId?'won':round.winner?'lost':'tied';
    labels.push('Ronda '+(index+1)+': '+({pending:'pendiente',won:'ganada',lost:'perdida',tied:'empate'}[result]));
    return '<i class="inactivity-circle round-'+result+'" aria-hidden="true"></i>';
  }).join('');
  el.setAttribute('aria-label',labels.join('. '));
}
function renderLearning(){
  const active=!!(state.learning&&state.localGame);
  $('learning-toolbar').classList.toggle('hidden',!active);$('game-view').classList.toggle('learning-mode',active);
  renderLearningRounds();
  if(!active){if($('learning-hint').open)$('learning-hint').close();return;}
  $('learn-hints').checked=state.learning.hints;
  $('learn-points-info').checked=state.learning.pointsInfo!==false;
  requestAnimationFrame(positionLearningControls);
  showLearningMessage();
  if(state.learning.paused)return;
  if(!state.learning.complete&&state.room.status==='complete'&&(!state.room.endReveal||state.room.endReveal.done)){
    const room=state.room;queueMicrotask(()=>{if(state.room===room&&room.status==='complete'&&(!room.endReveal||room.endReveal.done))finishLearningHand();});
  }
}
function armLearningTransition(transition){
  transition.dueAt=gameTime()+transition.remaining;
  transition.timer=setTimeout(()=>{
    if(!state.learning||state.learning.transition!==transition||state.room!==transition.room||state.learning.paused)return;
    state.learning.transition=null;transition.callback();
  },transition.remaining);
  return transition.timer;
}
function scheduleLocalTransition(room,callback,delay){
  if(!state.learning)return setTimeout(callback,delay);
  clearTimeout(state.learning.transition?.timer);
  const transition={room,callback,remaining:Math.max(0,delay),timer:null,dueAt:null};
  state.learning.transition=transition;
  return state.learning.paused?null:armLearningTransition(transition);
}
function pauseLearning(){
  const learning=state.learning;if(!learning)return;
  if(!learning.paused){learning.pausedAt=gameTime();learning.paused=true;}
  clearTimeout(state.botTimer);state.botTimer=null;
  const transition=learning.transition;
  if(transition?.timer!=null){
    transition.remaining=Math.max(0,transition.dueAt-gameTime());
    clearTimeout(transition.timer);transition.timer=null;
  }
}
function resumeLearning(){
  const learning=state.learning;
  if(!learning||learning.complete||document.querySelector('.learn-coach-dialog[open]'))return;
  if(learning.paused){
    const elapsed=Math.max(0,gameTime()-(learning.pausedAt??gameTime())),room=state.room;
    if(room?.resolutionEndsAt)room.resolutionEndsAt+=elapsed;
    if(room?.pendingNextHand?.endsAt)room.pendingNextHand.endsAt+=elapsed;
    if(room?.endReveal?.endsAt)room.endReveal.endsAt+=elapsed;
    learning.paused=false;learning.pausedAt=null;
    if(learning.transition)armLearningTransition(learning.transition);
  }
  renderGame();
  if(!learning.paused&&!document.querySelector('.learn-coach-dialog[open]')&&learning.afterScoreMessage){
    const callback=learning.afterScoreMessage;learning.afterScoreMessage=null;callback();
  }
}
function openLearningHelp(){
  if(!state.learning)return;
  pauseLearning();state.learning.acknowledgedMessage=learningMessageKey();
  const stage=state.learning.stage,lesson=LEARNING_STAGES[stage],complete=state.learning.complete;
  $('learn-coach-step').textContent='Etapa '+(stage+1)+' de 3';
  $('learn-coach-title').textContent=complete?'Partida terminada':lesson.title;
  $('learn-coach-body').replaceChildren();
  (complete?learningGuidance():stage===1?['Primero vamos a practicar cómo sumar los puntos. Cuando estés listo, podés cerrar la práctica y seguimos jugando con envido.']:stage===0?lesson.intro.split('\n'):['Sumamos la flor. Se juega con envido y flor. Si algún jugador tiene flor, se cancelan las opciones del envido.','Tenés flor cuando tenés 3 cartas del mismo palo. Las piezas son comodines.']).forEach(text=>{const p=document.createElement('p');p.textContent=text;$('learn-coach-body').append(p);});
  $('learn-coach-continue').textContent=complete?'Seguir jugando así - Etapa '+(stage+1)+'/3':stage===1?'Practicar envido':stage===2?'Practicar la flor':'Entendido, a jugar';
  $('learn-coach-next').classList.toggle('hidden',!complete);
  $('learn-coach-next').textContent=stage===0?'Sumar el envido - Etapa 2/3':stage===1?'Sumar la flor - Etapa 3/3':'Quitar la flor - Etapa 2/3';
  $('learn-coach-previous').classList.toggle('hidden',!complete||stage===0);
  $('learn-coach-previous').textContent='Volver a la Etapa 1 sin envido';
  const actions=$('learn-coach-continue').parentElement;
  const stageButtons=stage===2?['learn-coach-previous','learn-coach-next','learn-coach-continue']:['learn-coach-previous','learn-coach-continue','learn-coach-next'];
  stageButtons.forEach(id=>actions.insertBefore($(id),$('learn-coach-menu')));

  if(!$('learn-coach-dialog').open)$('learn-coach-dialog').showModal();
}
function finishLearningHand(){
  if(!state.learning||Math.max(...Object.values(state.room?.scores||{}))<10)return false;
  if(state.learning.complete)return true;
  state.learning.complete=true;pauseLearning();
  Object.assign(state.room,{status:'complete',pendingBet:null,turn:null,turnClock:null,endReveal:{done:true}});
  renderGame();openLearningHelp();return true;
}
function cardStudyName(card){return String(card.rank)+' de '+({'♦':'oro','♥':'copa','♠':'espada','♣':'basto'}[card.suit]||card.suit);}
function explainEnvido(hand,muestra){
  const pieces=hand.filter(card=>pieceOrder(card,muestra)),value=handEnvido(hand,muestra);
  const zeroNote=hand.some(card=>[10,11,12].includes(Number(card.rank))&&!pieceOrder(card,muestra))?' El 10, 11 y 12 comunes valen 0.':'';
  if(pieces.length===1){
    const piece=pieces[0],other=hand.filter(card=>card.id!==piece.id).sort((a,b)=>envidoValue(b,muestra)-envidoValue(a,muestra))[0];
    return {value,explanation:cardStudyName(piece)+' es pieza: vale '+envidoValue(piece,muestra)+' pts. Sumás '+envidoValue(other,muestra)+' pts del '+cardStudyName(other)+': '+envidoValue(piece,muestra)+' + '+envidoValue(other,muestra)+' = '+value+'.'+zeroNote};
  }
  let pair=null,best=-1;
  for(let a=0;a<hand.length;a++)for(let b=a+1;b<hand.length;b++)if(hand[a].suit===hand[b].suit){const sum=envidoValue(hand[a],muestra)+envidoValue(hand[b],muestra);if(sum>best){best=sum;pair=[hand[a],hand[b]];}}
  if(pair)return {value,explanation:'Elegís las dos mejores cartas del mismo palo: '+cardStudyName(pair[0])+' y '+cardStudyName(pair[1])+'. Sumás 20 + '+envidoValue(pair[0],muestra)+' + '+envidoValue(pair[1],muestra)+' = '+value+'.'+zeroNote};
  return {value,explanation:'No hay piezas ni dos cartas del mismo palo. Tus cartas valen '+hand.map(card=>envidoValue(card,muestra)).join(', ')+': elegís el mayor, '+value+'.'+zeroNote};
}
function explainFlor(hand,muestra){
  const pieces=hand.filter(card=>pieceOrder(card,muestra)),common=hand.filter(card=>!pieceOrder(card,muestra));
  const value=hasFlor(hand,muestra),replacement=pieces.find(card=>Number(card.rank)===12);
  const pieceNote=replacement?' El '+cardStudyName(replacement)+' es una pieza porque toma el valor del '+cardStudyName(muestra)+' que está en la muestra.':'';
  let explanation;
  if(pieces.length>=2)explanation='Es flor porque tenés '+pieces.length+' piezas: '+pieces.map(cardStudyName).join(', ')+'. La muestra es '+cardStudyName(muestra)+'.';
  else if(hand.every(card=>card.suit===hand[0].suit))explanation='Es flor porque las 3 cartas son del mismo palo.';
  else if(pieces.length===1&&common[0].suit===common[1].suit)explanation='Es flor: '+cardStudyName(pieces[0])+' es pieza y las otras 2 cartas son del mismo palo.';
  else explanation=pieces.length===1?'No es flor: tenés una pieza, pero las otras 2 cartas son de palos diferentes.':'No es flor: las 3 cartas no son del mismo palo y no tenés piezas para formar otra combinación.';
  return {value,explanation:explanation+pieceNote};
}
function explainFlorPoints(hand,muestra){
  const pieces=hand.filter(card=>pieceOrder(card,muestra)).sort((a,b)=>envidoValue(b,muestra)-envidoValue(a,muestra));
  const common=hand.filter(card=>!pieceOrder(card,muestra)),value=florValue(hand,muestra);
  const parts=pieces.length?[envidoValue(pieces[0],muestra),...pieces.slice(1).map(card=>envidoValue(card,muestra)%10),...common.map(card=>envidoValue(card,muestra))]:[20,...common.map(card=>envidoValue(card,muestra))];
  let explanation=pieces.length?'Contás el valor completo de la pieza más alta: '+cardStudyName(pieces[0])+' vale '+envidoValue(pieces[0],muestra)+' pts.':'Las 3 cartas son del mismo palo. Sumás 20 más el valor de las 3 cartas.';
  if(pieces.length>1)explanation+=' De las otras piezas sumás solo la última cifra: '+pieces.slice(1).map(card=>cardStudyName(card)+' aporta '+(envidoValue(card,muestra)%10)+' pts').join('; ')+'.';
  if(pieces.length&&common.length)explanation+=' Sumás las cartas comunes: '+common.map(card=>cardStudyName(card)+' vale '+envidoValue(card,muestra)+' pts').join('; ')+'.';
  if(common.some(card=>[10,11,12].includes(Number(card.rank))))explanation+=' El 10, 11 y 12 comunes valen 0.';
  const replacement=pieces.find(card=>Number(card.rank)===12);
  if(replacement)explanation+=' El '+cardStudyName(replacement)+' es una pieza porque toma el valor del '+cardStudyName(muestra)+' que está en la muestra.';
  return {value,explanation:explanation+' Total: '+parts.join(' + ')+' = '+value+' pts.'};
}
let studyExercise=null;
function makeStudyExercise(kind){
  // Envido exercises exclude flor hands, which belong to the flor practice.
  let pool,hand,muestra;const wantFlor=kind==='flor-points'||(kind==='flor'&&Math.random()<0.5);
  do{pool=shuffleDeck();hand=pool.slice(0,3);muestra=pool[3];}while(kind==='envido'?hasFlor(hand,muestra):hasFlor(hand,muestra)!==wantFlor);
  return {kind,hand,muestra,answered:false};
}
function openStudy(kind){pauseLearning();nextStudy(kind);if(!$('learn-study-dialog').open)$('learn-study-dialog').showModal();}
function nextStudy(kind=studyExercise?.kind||'envido'){
  studyExercise=makeStudyExercise(kind);
  $('learn-study-title').textContent=kind==='envido'?'¿Cuántos tantos tenés?':kind==='flor-points'?'¿Cuántos puntos tiene tu flor?':'¿Tenés flor?';
  $('learn-study-count-help').textContent=kind==='flor'?'Cómo saber si tenés flor':kind==='flor-points'?'Cómo sumar los puntos de la flor':'Cómo contar el envido';
  const cards=$('learn-study-cards');cards.replaceChildren();
  const add=(card,label)=>{const wrap=document.createElement('div'),caption=document.createElement('span'),image=document.createElement('div');wrap.className='study-card';caption.textContent=label;image.className='sprite-card';image.style.cssText=cardImageStyle(card);image.setAttribute('role','img');image.setAttribute('aria-label',cardAccessibleName(card));wrap.append(caption,image);cards.append(wrap);};
  studyExercise.hand.forEach((card,index)=>add(card,'Carta '+(index+1)));add(studyExercise.muestra,'Muestra');
  $('learn-study-envido').classList.toggle('hidden',kind==='flor');$('learn-study-flor').classList.toggle('hidden',kind!=='flor');
  $('learn-study-value').value='';$('learn-study-check').disabled=false;
  $('learn-study-feedback').textContent='';$('learn-study-feedback').className='study-feedback';
  $('learn-study-next').classList.add('hidden');
  $('learn-study-flor').querySelectorAll('button').forEach(button=>button.disabled=false);
}
function checkStudy(answer){
  if(!studyExercise||studyExercise.answered)return;
  const exercise=studyExercise,result=exercise.kind==='envido'?explainEnvido(exercise.hand,exercise.muestra):exercise.kind==='flor-points'?explainFlorPoints(exercise.hand,exercise.muestra):explainFlor(exercise.hand,exercise.muestra);
  if(exercise.kind!=='flor'&&(!Number.isInteger(answer)||answer<0||answer>50)){ $('learn-study-feedback').textContent='Escribí un número entero entre 0 y 50.';return;}
  const correct=answer===result.value;exercise.answered=true;
  const feedback=(correct?'¡Correcto! ':exercise.kind!=='flor'?'Tu respuesta fue '+answer+'. '+(exercise.kind==='flor-points'?'Tu flor suma '+result.value+' pts. ':'Tenés '+result.value+' tantos. '):result.value?'Esta mano sí tiene flor. ':'Esta mano no tiene flor. ')+result.explanation;
  $('learn-study-feedback').textContent=feedback.replace(/\.\s*/g,'.\n').trim();
  $('learn-study-feedback').className='study-feedback '+(correct?'study-correct':'study-incorrect');
  $('learn-study-check').disabled=true;$('learn-study-flor').querySelectorAll('button').forEach(button=>button.disabled=true);
  $('learn-study-next').classList.remove('hidden');
}
function openFlorPointsHelp(){pauseLearning();if(!$('learn-flor-points-help-dialog').open)$('learn-flor-points-help-dialog').showModal();}
function openFlorCountHelp(){pauseLearning();if(!$('learn-flor-help-dialog').open)$('learn-flor-help-dialog').showModal();}
function openEnvidoCountHelp(){pauseLearning();if(!$('learn-envido-help-dialog').open)$('learn-envido-help-dialog').showModal();}
function markPracticeGuideCards(){
  const hand=state.learning&&state.localGame&&$('game-view').classList.contains('active')?localHand('player1'):[];
  for(const row of $('learn-sheet-dialog').querySelectorAll('[data-guide-strength]')){
    row.querySelector('.guide-owned-cards')?.remove();
    const cards=hand.filter(card=>cardStrength(card,state.room?.muestra)===Number(row.dataset.guideStrength));
    row.classList.toggle('guide-owned',cards.length>0);
    if(!cards.length)continue;
    const label=document.createElement('span');label.className='guide-owned-cards';
    label.textContent='Tenés: '+cards.map(cardStudyName).join(' · ');
    (row.tagName==='TR'?row.cells[0]:row).append(label);
  }
}
function openStudySheet(){pauseLearning();markPracticeGuideCards();if(!$('learn-sheet-dialog').open)$('learn-sheet-dialog').showModal();}
function continueLearningStage(){
  const stage=state.learning?.stage||0,complete=state.learning?.complete;
  if(!complete&&stage>=1)openStudy(stage===2?'flor':'envido');
  $('learn-coach-dialog').close();
  if(complete)startLearning(stage);
}
$('learn-game').addEventListener('click',openLearning);
$('learn-back').addEventListener('click',()=>{stopBot();showView('welcome-view');openLobby();});
$('learn-free').addEventListener('click',()=>startLearning(0));
window.addEventListener('resize',()=>{positionLearningScoreArrow();positionLearningControls();});
function indicateLearningMessageClose(event){
  const dialog=event.currentTarget;
  if(!dialog.open)return;
  const box=dialog.getBoundingClientRect();
  if(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)return;
  const button=dialog.querySelector('.learn-close');
  if(!button)return;
  button.getAnimations?.().forEach(animation=>animation.cancel());
  clearTimeout(button._closeHintTimer);
  button.classList.add('close-required');
  button.animate?.([{translate:'0 0'},{translate:'-4px 0'},{translate:'4px 0'},{translate:'-3px 0'},{translate:'3px 0'},{translate:'0 0'}],{duration:450,easing:'ease-out'});
  button._closeHintTimer=setTimeout(()=>button.classList.remove('close-required'),450);
}
for(const dialog of document.querySelectorAll('.learning-message')){
  dialog.addEventListener('pointerdown',indicateLearningMessageClose);
}
$('learning-message-close').addEventListener('click',()=>$('learning-hint').close());
$('learning-message-study').addEventListener('click',event=>{const kind=event.currentTarget.dataset.studyKind;if(kind==='envido'||kind==='flor')openStudy(kind);});
$('learning-hint').addEventListener('close',()=>{if(state.learning){state.learning.acknowledgedMessage=state.learning.activeMessage;state.learning.activeMessage=null;state.learning.activeScoreMessage=false;state.learning.activeTutorial=null;}positionLearningScoreArrow();resumeLearning();});
$('learn-menu').addEventListener('click',openLearning);
$('game-sheet').addEventListener('click',openStudySheet);
$('learn-sheet-menu').addEventListener('click',openStudySheet);
$('learn-sheet-close').addEventListener('click',()=>$('learn-sheet-dialog').close());
$('learn-envido-study').addEventListener('click',()=>openStudy('envido'));
$('learn-flor-study').addEventListener('click',()=>openStudy('flor'));
$('learn-flor-points-study').addEventListener('click',()=>openStudy('flor-points'));
$('learn-flor-points-help-close').addEventListener('click',()=>$('learn-flor-points-help-dialog').close());
$('learn-study-close').addEventListener('click',()=>$('learn-study-dialog').close());
$('learn-study-sheet').addEventListener('click',openStudySheet);
$('learn-study-count-help').addEventListener('click',()=>studyExercise?.kind==='flor-points'?openFlorPointsHelp():studyExercise?.kind==='flor'?openFlorCountHelp():openEnvidoCountHelp());
$('learn-flor-help-close').addEventListener('click',()=>$('learn-flor-help-dialog').close());
$('learn-envido-help-close').addEventListener('click',()=>$('learn-envido-help-dialog').close());
$('learn-study-next').addEventListener('click',()=>nextStudy());
$('learn-study-envido').addEventListener('submit',event=>{event.preventDefault();const raw=$('learn-study-value').value.trim();if(raw===''){$('learn-study-feedback').textContent='Escribí tus tantos antes de comprobar.';return;}checkStudy(Number(raw));});
$('learn-study-yes').addEventListener('click',()=>checkStudy(true));
$('learn-study-no').addEventListener('click',()=>checkStudy(false));
$('learn-hints').addEventListener('change',event=>{if(state.learning){state.learning.hints=event.target.checked;renderLearning();}});
$('learn-points-info').addEventListener('change',event=>{
  if(!state.learning)return;
  state.learning.pointsInfo=event.target.checked;
  if(!event.target.checked){
    state.learning.scoreMessages=[];
    if($('learning-hint').open)$('learning-hint').close();
    pauseLearning();
    $('learning-points-tip').showModal();
    requestAnimationFrame(positionLearningScoreArrow);
    return;
  }
  renderLearning();
});
$('learning-points-tip-close').addEventListener('click',()=>$('learning-points-tip').close());
$('learning-points-tip').addEventListener('close',()=>{positionLearningScoreArrow();resumeLearning();});
for(const id of ['learn-coach-dialog','learn-study-dialog','learn-sheet-dialog','learn-envido-help-dialog','learn-flor-help-dialog','learn-flor-points-help-dialog'])$(id).addEventListener('close',resumeLearning);
$('learn-coach-continue').addEventListener('click',continueLearningStage);
$('learn-coach-next').addEventListener('click',()=>{const stage=state.learning.stage;$('learn-coach-dialog').close();startLearning(stage===2?1:stage+1);});
$('learn-coach-previous').addEventListener('click',()=>{$('learn-coach-dialog').close();startLearning(0);});
$('learn-coach-menu').addEventListener('click',openLearning);

async function initializePage(){
  try{
    await Promise.all([
      (async()=>{
        try{
          const bundled=await import('./firebase-config.js');
          if(firebaseConfigValid(bundled.firebaseConfig))state.config=bundled.firebaseConfig;
        }catch{ /* Optional during initial setup. */ }
      })(),
      preloadCardImages().catch(error=>console.error('[truco:startup-cards]',error))
    ]);
    // Restore the authenticated seat before treating a room URL as an invitation.
    // Keep slow connections from blocking offline practice indefinitely.
    let startupTimer;
    try{
      await Promise.race([
        openInitialRoom(),
        new Promise(resolve=>{startupTimer=setTimeout(resolve,12000);})
      ]);
    }finally{clearTimeout(startupTimer);}

  }catch(error){console.error('[truco:startup]',error);}
  finally{
    $('app').inert=false;
    $('startup-loading').hidden=true;
    document.documentElement.classList.remove('page-loading');
  }
}
await initializePage();

