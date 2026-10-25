import './chat-moderation.js?v=20261013-moderation1';
import { visitPlatform,takeVisit,markTestDevice } from './visit.js?v=20261024-visits5';
import { installFriends } from './friends.js?v=20261025-claim1';
import { installPlayerPanel } from './player-panel.js?v=20261013-blocklist1';
import { installScorer,renderCompactTally } from './scorer.js?v=20261023-seo1';
import { installActivity } from './activity.js?v=20261010-adminstats32';
import { installCredits } from './credits.js?v=20261025-claim1';
import { installAccount } from './account.js?v=20261022-ios-redirect';
import { initializeGameAuth } from './auth-init.js?v=20261016-android-google';
import {installTeamTable,TEAM_SEATS,playerTeam,positionDealerDeck,renderTeamLobbySeats,renderWaitingSeats} from './team-table-ui.js?v=20261024-ui6';
import {createLiveTables,LiveError} from './live-tables.js?v=20261025-close1';
import {installMatchPhoto} from './share-photo.js?v=20261025-photo2';
const FIREBASE_VERSION = '12.4.0';
const $ = (id) => document.getElementById(id);
const views = ['welcome-view', 'invite-view', 'setup-view', 'waiting-view', 'game-view', 'config-view', 'learn-view', 'scorer-view', 'friends-view'];
const storageKey = 'truco-firebase-config';
let state = { joining: false, config: null, firebase: null, roomCode: null, selectedRoom: null, uid: null, playerId: null, unsubscribe: null, privateUnsubscribe: null, lobbyUnsubscribe: null, room: null, hand: [], handOrder: [], handOrderKey: null, localGame: false, localHands: {}, nextAction: null, resolutionTimer: null, resolutionTimerKey: null, playActionInFlight: false, legacyRepairKey: null, emptyHandRepairKey: null };
const teamTable=installTeamTable({$,getState:()=>state,command:creditCommand,runAction:runLiveAction,renderPlayerHand,orderedHand,cardImageStyle,cardAccessibleName,escapeHtml,renderTally:renderCompactTally,syncHeader:syncMobileGameHeader,setTurnBadge,syncControls:syncLiveControls,gameTime,hasFlor:roomHasFlor,florPoints:florValue,speakCall});
function roomSeats(room=state.room){return room?.mode==='2v2'?TEAM_SEATS:['player1','player2'];}

const opponentFlights=new Map();
let opponentPlaySnapshot={scope:null,keys:new Set()};

let mobileTallyPosition=readMobileTallyPosition();
let mobileTallyDrag=null,tallyIgnoreClickUntil=0;
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
// Card images are warmed after authentication so slow connections prioritize sign-in.

const CHAT_LIMIT=40,CHAT_NOTICE_MS=4000;
const chatModeration=globalThis.TrucoChatModeration;
let chatMuted=false;
let chatPlayerBlocked=false;

const matchChat={key:null,messages:[],pendingOwn:[],seen:new Set(),reported:new Set(),reporting:false,open:false,unread:0,sending:false,noticeTimers:new Map(),signature:''};
function chatAvailable(){return !!(state.room&&!state.localGame&&roomSeats().includes(state.playerId)&&roomSeats().every(p=>state.room.players?.[p]?.uid)&&!['waiting','closed'].includes(state.room.status));}
function chatPeerId(){return state.room?.mode==='2v2'?($('chat-block-target')?.value||roomSeats().find(p=>p!==state.playerId)):otherPlayer(state.playerId);}
function peerChatMuted(room=state.room){
  if(room?.mode==='2v2')return false;
  const peer=otherPlayer(state.playerId),preference=room?.chatPreferences?.[peer];
  return !!(preference?.muted&&preference.uid===room?.players?.[peer]?.uid);
}
function renderChatComposer(){
  const blocked=chatMuted||peerChatMuted(),input=$('chat-input');
  $('chat-muted').disabled=liveActionsBlocked()||chatPlayerBlocked;
  if($('chat-player-blocked')){$('chat-player-blocked').checked=chatPlayerBlocked;$('chat-player-blocked').disabled=liveActionsBlocked();}
  input.disabled=blocked||liveActionsBlocked()||matchChat.sending;input.classList.toggle('hidden',blocked);
  $('chat-send').disabled=blocked||matchChat.sending||liveActionsBlocked();$('chat-send').classList.toggle('hidden',blocked);
  $('chat-count').classList.toggle('hidden',blocked);
  $('chat-blocked').classList.toggle('hidden',!blocked);
  $('chat-blocked').textContent=blocked?(chatPlayerBlocked?'Bloqueaste a este jugador. El chat está cerrado y no podrán entrar juntos a futuras mesas.':chatMuted?'Silenciaste los mensajes. El chat está cerrado para ambos en esta partida.':`${state.room.players[otherPlayer(state.playerId)].name||'El rival'} silenció los mensajes. El chat está cerrado en esta partida.`):'';
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
    if(state.room?.managedCredits)await creditCommand({kind:'mute',value:desired});
    else{
      const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${state.roomCode}/public`),room=>{
        if(!room||room.status==='closed'||Number(room.matchNumber||1)!==matchNumber||room.players?.[player]?.uid!==uid)return;
        return {...room,chatPreferences:{...(room.chatPreferences||{}),[player]:{uid,muted:desired}}};
      },{applyLocally:false});
      if(!result.committed)throw new Error('chat-unavailable');
    }
    if(key!==chatContextKey())return;
  }catch(error){
    console.error('[truco:chat-mute]',error);
    if(key===chatContextKey()&&chatMuted===desired){
      const current=state.room?.chatPreferences?.[player];chatMuted=!!(current?.muted&&current.uid===uid);
      $('chat-muted').checked=chatMuted;updateChatUnread();
      $('chat-error').textContent='No se pudo actualizar el silencio. Volvé a intentar.';$('chat-error').classList.remove('hidden');
    }
  }finally{
    publishingChatMute=false;
    if(key!==chatContextKey()||chatMuted!==desired)publishChatMute();
  }
}
async function loadPersistentChatBlock(key){
  const uid=state.uid,targetUid=state.room?.players?.[chatPeerId()]?.uid;
  if(!uid||!targetUid)return;
  try{
    const snapshot=await state.firebase.get(state.firebase.ref(state.firebase.db,`userBlocks/${uid}/${targetUid}`));
    if(key!==chatContextKey())return;
    const storedBlock=snapshot.val(),blocked=storedBlock===true||storedBlock?.blocked===true,preference=state.room.chatPreferences?.[state.playerId];
    chatPlayerBlocked=blocked;
    if(blocked)chatMuted=true;
    $('chat-muted').checked=chatMuted;updateChatUnread();renderChatComposer();
    if(blocked&&(!preference?.muted||preference.uid!==uid))publishChatMute();
  }catch(error){console.error('[truco:chat-block-read]',error);}
}
function chatContextKey(){return `${state.roomCode}:${state.room?.createdAt||''}:${state.room?.matchNumber||1}:${state.playerId}`;}
function setChatReporting(enabled){
  matchChat.reporting=enabled;
  $('chat-report-mode')?.setAttribute('aria-pressed',String(enabled));
  if($('chat-report-mode'))$('chat-report-mode').textContent=enabled?'Cancelar reporte':'Reportar un mensaje';
  $('chat-report-hint')?.classList.toggle('hidden',!enabled);
  renderChatHistory();
}
let publishingChatBlock=false;
async function changeChatPlayerBlock(){
  if(publishingChatBlock||!chatAvailable()||liveActionsBlocked())return;
  const key=chatContextKey(),uid=state.uid,peer=state.room.players?.[chatPeerId()],desired=$('chat-player-blocked').checked;
  if(!uid||!peer?.uid)return;
  publishingChatBlock=true;$('chat-player-blocked').disabled=true;
  try{
    await state.firebase.set(state.firebase.ref(state.firebase.db,`userBlocks/${uid}/${peer.uid}`),desired?{blocked:true,name:peer.name||'Jugador',blockedAt:Date.now()}:null);
    if(key!==chatContextKey())return;
    chatPlayerBlocked=desired;
    if(desired){chatMuted=true;$('chat-muted').checked=true;clearChatNotices();}
    updateChatUnread();renderChatComposer();
    if(desired)await publishChatMute();
  }catch(error){
    if(key!==chatContextKey())return;
    $('chat-error').textContent='No se pudo actualizar el bloqueo. Volvé a intentar.';$('chat-error').classList.remove('hidden');
  }finally{
    publishingChatBlock=false;
    if(key===chatContextKey()){$('chat-player-blocked').checked=chatPlayerBlocked;$('chat-player-blocked').disabled=liveActionsBlocked();}
  }
}
function clearChatNotices(){
  for(const timer of matchChat.noticeTimers.values())clearTimeout(timer);
  matchChat.noticeTimers.clear();$('chat-notices')?.replaceChildren();
}
function closeMatchChat(clearNotices=false){
  const options=$('chat-options');if(options)options.open=false;
  matchChat.open=false;$('chat-backdrop')?.classList.add('hidden');$('match-chat')?.classList.add('hidden');$('chat-toggle')?.setAttribute('aria-expanded','false');
  if(clearNotices)clearChatNotices();
}
function chatMessageList(room){
  return Object.entries(room?.chatMessages||{}).filter(([,message])=>message&&roomSeats(room).includes(message.sender)&&typeof message.text==='string'&&message.text.trim()&&message.text.length<=CHAT_LIMIT&&Number.isFinite(message.at)).map(([id,message])=>({id,...message})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
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
    item.append(name,text);
    if(message.sender!==state.playerId&&matchChat.reporting){
      const report=document.createElement('button');report.type='button';report.className='chat-report-message';report.textContent=matchChat.reported.has(message.id)?'Reporte enviado':'Reportar mensaje';report.disabled=matchChat.reported.has(message.id);report.setAttribute('aria-label','Reportar este mensaje de '+name.textContent);
      report.addEventListener('click',()=>reportChatMessage(message,report));item.append(report);
    }
    history.append(item);
  }
  history.scrollTop=nearBottom||!matchChat.open?history.scrollHeight:previousScroll;
}
async function reportChatMessage(message,button){
  if(matchChat.reported.has(message.id)||!chatAvailable())return;
  button.disabled=true;button.textContent='Enviando…';
  try{
    const player=state.room.players?.[message.sender],playerName=player?.name||'Rival';
    const reportText=`Reporte de chat. Usuario: ${playerName} (${player?.uid||'sin ID'}). Mensaje: «${message.text}»`;
    const report={action:'report',message:reportText,requestId:crypto.randomUUID(),localId:state.roomCode,mode:'online'};
    if(state.room.creditMatch?.id)report.matchId=state.room.creditMatch.id;
    await creditApi('playerConsole',report);
    matchChat.reported.add(message.id);setChatReporting(false);toast('Reporte enviado.');
  }catch(error){
    button.disabled=false;button.textContent='No se pudo reportar';
    $('chat-error').textContent=error.message||'No se pudo enviar el reporte. Volvé a intentar.';$('chat-error').classList.remove('hidden');
  }
}
function updateChatUnread(){
  $('chat-toggle').setAttribute('aria-label',(chatMuted?'Abrir chat, mensajes silenciados':'Abrir chat')+(matchChat.unread?`, ${matchChat.unread} mensajes nuevos`:''));
  $('chat-toggle').classList.toggle('chat-is-muted',chatMuted);
}
function showChatNotice(message){
  const notice=document.createElement('div');notice.className='chat-notice';
  const content=document.createElement('div'),name=document.createElement('strong'),text=document.createElement('p'),close=document.createElement('button');
  name.textContent=message.sender===state.playerId?'Vos':state.room.players?.[message.sender]?.name||'Rival';text.textContent=message.text;
  close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar mensaje');
  const dismiss=()=>{clearTimeout(matchChat.noticeTimers.get(message.id));matchChat.noticeTimers.delete(message.id);notice.remove();};
  close.addEventListener('click',dismiss);content.append(name,text);notice.append(content,close);$('chat-notices').append(notice);
  matchChat.noticeTimers.set(message.id,setTimeout(dismiss,CHAT_NOTICE_MS));
  return dismiss;
}
function syncMatchChat(){
  const available=chatAvailable();$('chat-toggle').classList.toggle('hidden',!available);
  if(!available){closeMatchChat(true);return;}
  const key=chatContextKey(),messages=chatMessageList(state.room),fresh=matchChat.key!==key;
  if(fresh){
    if(state.room.mode==='2v2'){
      let select=$('chat-block-target');
      if(!select){select=document.createElement('select');select.id='chat-block-target';select.className='table-mode-select';select.setAttribute('aria-label','Jugador para bloquear');document.querySelector('.chat-options-panel').prepend(select);select.addEventListener('change',()=>loadPersistentChatBlock(chatContextKey()));}
      select.innerHTML=roomSeats().filter(p=>p!==state.playerId&&state.room.players?.[p]&&!state.room.players[p].bot).map(p=>'<option value="'+p+'">'+escapeHtml(state.room.players[p].name||'Jugador')+'</option>').join('');
    }
    if($('chat-block-target'))$('chat-block-target').hidden=state.room.mode!=='2v2';
    chatPlayerBlocked=false;matchChat.reporting=false;
    $('chat-report-mode')?.setAttribute('aria-pressed','false');
    if($('chat-report-mode'))$('chat-report-mode').textContent='Reportar un mensaje';
    $('chat-report-hint')?.classList.add('hidden');
    const ownPreference=state.room.chatPreferences?.[state.playerId];chatMuted=!!(ownPreference?.muted&&ownPreference.uid===state.uid);
    closeMatchChat(true);matchChat.key=key;matchChat.seen=new Set(messages.map(message=>message.id));matchChat.reported=new Set();matchChat.unread=0;matchChat.signature='';matchChat.sending=false;matchChat.pendingOwn=[];
    $('chat-input').value='';$('chat-count').textContent='0/40';$('chat-send').disabled=false;$('chat-error').classList.add('hidden');
  }
  if(!fresh)for(const message of messages){
    if(matchChat.seen.has(message.id))continue;
    matchChat.seen.add(message.id);
    if(message.sender===state.playerId){
      // Already shown when it was sent.
      const pending=matchChat.pendingOwn.findIndex(item=>item.text===message.text);
      if(pending>=0){matchChat.pendingOwn.splice(pending,1);continue;}
      if(!chatMuted&&!matchChat.open&&$('game-view').classList.contains('active'))showChatNotice(message);
      continue;
    }
    if(!matchChat.open&&!chatMuted)matchChat.unread++;
    if(!chatMuted&&!matchChat.open&&$('game-view').classList.contains('active'))showChatNotice(message);
  }
  matchChat.messages=messages;
  const signature=JSON.stringify(messages);
  if(signature!==matchChat.signature){matchChat.signature=signature;renderChatHistory();}
  $('chat-muted').checked=chatMuted;updateChatUnread();renderChatComposer();
  if(fresh)loadPersistentChatBlock(key);
}
function openMatchChat(){
  syncMatchChat();if(!chatAvailable())return;
  matchChat.open=true;matchChat.unread=0;clearChatNotices();updateChatUnread();
  $('chat-backdrop').classList.remove('hidden');$('match-chat').classList.remove('hidden');$('chat-toggle').setAttribute('aria-expanded','true');
  $('chat-history').scrollTop=$('chat-history').scrollHeight;$('chat-close').focus();
}
// preset: a quick message sent without touching the typed draft.
async function sendMatchChat(event,preset){
  event?.preventDefault();if(liveActionsBlocked()||!chatAvailable()||matchChat.sending||chatMuted||peerChatMuted()){renderChatComposer();return;}
  const input=$('chat-input'),draft=preset??input.value,text=draft.trim();
  if(!text||text.length>CHAT_LIMIT)return;
  const moderationReason=chatModeration?.blockedChatReason(text);
  if(moderationReason){$('chat-error').textContent=moderationReason==='threat'?'No se puede enviar una amenaza. Mantené el respeto en la mesa.':'No se pudo enviar el mensaje porque contiene lenguaje ofensivo. Mantené el respeto en la mesa.';$('chat-error').classList.remove('hidden');return;}
  const code=state.roomCode,key=chatContextKey(),sender=state.playerId,uid=state.uid,matchNumber=Number(state.room.matchNumber||1);
  matchChat.sending=true;$('chat-send').disabled=true;$('chat-error').classList.add('hidden');
  // Close at once and show the message the way the rival sees it; the server copy is then skipped.
  const own={id:`local-${Date.now()}`,sender,text};matchChat.pendingOwn.push(own);
  closeMatchChat();const dismissOwn=showChatNotice(own);
  if(preset==null){input.value='';$('chat-count').textContent='0/40';}
  try{
    if(state.room?.managedCredits){await creditCommand({kind:'chat',text});return;}
    const fb=state.firebase,messageRef=fb.push(fb.ref(fb.db,`rooms/${code}/public/chatMessages`));
    const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
      if(!room||room.status==='closed'||Number(room.matchNumber||1)!==matchNumber||room.players?.[sender]?.uid!==uid||!room.players?.[otherPlayer(sender)]||peerChatMuted(room))return;
      return {...room,chatMessages:{...(room.chatMessages||{}),[messageRef.key]:{sender,text,at:gameTime()}}};
    },{applyLocally:false});
    if(!result.committed){
      if(key===chatContextKey()&&peerChatMuted(result.snapshot?.val())){matchChat.pendingOwn=matchChat.pendingOwn.filter(item=>item!==own);dismissOwn();state.room=result.snapshot.val();renderChatComposer();return;}
      throw new Error('chat-unavailable');
    }
  }catch(error){
    console.error('[truco:chat]',error);
    if(key===chatContextKey()){
      matchChat.pendingOwn=matchChat.pendingOwn.filter(item=>item!==own);dismissOwn();
      if(preset==null&&!input.value){input.value=draft;$('chat-count').textContent=`${draft.length}/${CHAT_LIMIT}`;}
      openMatchChat();$('chat-error').textContent='No se pudo enviar. Volvé a intentar.';$('chat-error').classList.remove('hidden');
    }
  }finally{if(key===chatContextKey()){matchChat.sending=false;renderChatComposer();}}
}
function showView(id) { if(!$(id).classList.contains('active'))clearToast(); if(id!=='game-view'){state.preparingRoom=null;$('game-view').classList.remove('table-preparing');}document.documentElement.classList.remove('opening-invitation'); views.forEach((name) => $(name).classList.toggle('active', name === id)); if(id!=='game-view')closeMatchChat(true); if(id==='welcome-view')requestAnimationFrame(showLobbyOnboarding); }
function liveActionsBlocked(){
  return !!(state.room&&!state.localGame&&(navigator.onLine===false||!roomTransportConnected()||state.connectionReady!==true));
}
// Credit tables live on the table server socket; the old RTDB rooms used Firebase.
function roomTransportConnected(){
  return state.room?.managedCredits?state.liveConnected===true:state.firebaseConnected===true;
}
let liveTablesClient=null;
function liveTables(){
  return liveTablesClient??=createLiveTables({token:async()=>{
    const user=state.firebase?.auth?.currentUser;
    if(!user)throw new Error('Iniciá sesión con tu cuenta.');
    return user.getIdToken();
  }});
}
// The table server says where credits live; with the bank, the balance comes from its socket.
async function creditWalletSource(){
  await firebaseServices();
  const live=liveTables();
  return (await live.creditsBackend())==='bank'?live.wallet:null;
}
function liveSnapshot(value){return {exists:()=>value!=null,val:()=>value??null};}
const TABLE_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newTableCode(){
  return Array.from(crypto.getRandomValues(new Uint32Array(5)),n=>TABLE_CODE_ALPHABET[n%TABLE_CODE_ALPHABET.length]).join('');
}
// Same shape as the server's waiting table, shown until the server confirms it.
function provisionalTable({stake,targetPoints,mode,visibility},name){
  const person={uid:state.uid,name,online:true};
  return {managedCredits:true,mode,creditMatch:{id:null,stake,pot:stake*(mode==='2v2'?4:2),hasPassword:visibility==='password'},revision:0,status:'waiting',deviceMode:'two',createdAt:Date.now(),targetPoints,table:person,players:{player1:person},scores:{player1:0,player2:0},handNumber:1,trickCards:[],feed:[]};
}
async function confirmCreatedTable(code,data){
  try{
    // Apply the confirmed table at once: until then it has no match id and commands are ignored.
    applyActionReceipt(await liveTables().call(code,'create',data),code);
    void credits.sync().catch(error=>console.error('[truco:wallet-sync]',error));
    if(state.pendingCreate===code)state.pendingCreate=null;
    // The player left while the reservation was being confirmed.
    if(state.cancelAfterCreate===code&&state.roomCode===code){state.cancelAfterCreate=null;await creditCommand({kind:'cancel'});returnToLobby();}
  }catch(error){
    console.error('[truco:create] failed',error);
    if(state.pendingCreate===code)state.pendingCreate=null;
    if(state.roomCode===code)returnToLobby();else liveTables().closeTable(code);
    if(error?.code!=='closed')toast(error.code==='code-taken'?'No pudimos crear la mesa. Volvé a intentar.':firebaseError(error),true);
  }
}
async function liveTableApi(name,data){
  await firebaseServices();
  const live=liveTables();
  if(name==='creditCreateTable'){
    // The table server owns one object per code; a taken code is retried with a new one.
    for(let attempt=0;attempt<5;attempt++){
      const code=newTableCode();
      try{return await live.call(code,'create',data);}
      catch(error){live.closeTable(code);if(error.code!=='code-taken')throw error;}
    }
    throw new Error('No pudimos crear la mesa. Volvé a intentar.');
  }
  const {code,...rest}=data;
  return live.call(code,name==='creditJoinTable'?'join':'act',rest);
}
// Socket state of the current table drives the reconnection banner and resync.
let liveConnectionWatch=null;
function watchLiveConnection(code){
  if(liveConnectionWatch?.code===code)return;
  liveConnectionWatch?.stop();
  const live=liveTables();
  state.liveConnected=live.tableConnected(code);
  const stop=live.onTableConnection(code,connected=>{
    if(state.roomCode!==code)return;
    state.liveConnected=connected;
    state.connectionEpoch=(state.connectionEpoch||0)+1;state.connectionReady=false;
    if(connected)refreshLiveConnection();
    if(state.room){renderTurnTimer();syncLiveControls();}
  });
  liveConnectionWatch={code,stop};
}
function stopLiveTable(){
  liveConnectionWatch?.stop();liveConnectionWatch=null;state.liveConnected=false;
  liveTablesClient?.closeAllTables();
}
function syncLiveControls(){
  const blocked=liveActionsBlocked(),busy=!!(state.liveAction||state.playActionInFlight||state.foldInFlight);
  $('game-view').classList.toggle('connection-recovering',blocked);
  $('game-view').classList.toggle('action-sending',busy);
  for(const button of document.querySelectorAll('#player-actions button,#envido-picker button,#draw-deck,#request-rematch,#accept-rematch,#decline-rematch'))button.disabled=blocked||busy||rematchInFlight;
  syncRematchCreditControls();
  $('fold-hand').disabled=blocked||busy||!canFoldHand(state.room,state.playerId);
  for(const card of $('hand').querySelectorAll('.hand-card'))card.disabled=blocked||busy;
}
async function refreshLiveConnection(){
  if(!state.room||state.localGame||!roomTransportConnected())return;
  const code=state.roomCode,epoch=state.connectionEpoch||0,key=code+':'+epoch;
  if(state.connectionSyncKey===key)return;
  state.connectionSyncKey=key;state.connectionReady=false;
  try{
    const fb=state.firebase,player=state.playerId;
    const [publicSnap,privateSnap]=state.room.managedCredits
      ?await liveTables().readTable(code).then(({room,hand})=>[liveSnapshot(room),liveSnapshot(hand)])
      :await Promise.all([
        fb.get(fb.ref(fb.db,'rooms/'+code+'/public')),
        fb.get(fb.ref(fb.db,'hands/'+code+'/'+state.uid))
      ]);
    if(state.localGame||state.roomCode!==code||(state.connectionEpoch||0)!==epoch||!roomTransportConnected())return;
    const room=publicSnap.val();
    if(!room&&state.pendingCreate===code)throw new Error('create-pending');
    if(!room||room.status==='closed'){returnToLobby('La mesa ya no está disponible.');return;}
    if(roomSeatForUid(room,state.uid)!==player){returnToLobby('Tu lugar ya no está disponible.');return;}
    const deal=privateSnap?.val();
    if(['started','timed-out'].includes(room.status)&&!privateHandMatchesRoom(deal,room))throw new Error('hand-sync-pending');
    state.room=room;state.privateDeal=deal||null;syncPrivateHand();
    await syncRoomPresence();
    if(state.roomCode!==code||state.localGame||(state.connectionEpoch||0)!==epoch||!roomTransportConnected())return;
    if(['started','timed-out'].includes(state.room.status)&&!privateHandMatchesRoom(state.privateDeal,state.room))throw new Error('hand-sync-pending');
    state.connectionReady=true;
    if(state.room.status==='waiting')renderWaiting();else{renderGame();publishChatMute();}
  }catch(error){
    console.warn('[truco:resync]',error);
    if(state.roomCode===code&&(state.connectionEpoch||0)===epoch&&roomTransportConnected()){
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
    oro:'<path d="M24 3 42 24 24 45 6 24 24 3Z"/><path d="m24 11 11 13-11 13-11-13 11-13Z" class="suit-cutout"/>',
    copa:'<path d="M5 8h38v5c0 12-7 20-16 22v5h9v5H12v-5h9v-5C12 33 5 25 5 13V8Z"/><path d="M10 13c0 9 5 15 14 18 9-3 14-9 14-18H10Z" class="suit-cutout"/>',
    espada:'<path d="M24 3C19 12 6 20 6 31c0 8 6 12 13 10l-5 5h20l-5-5c7 2 13-2 13-10C42 20 29 12 24 3Z"/><path d="M24 12 12 29c-2 4 0 8 4 8 3 0 5-2 8-6 3 4 5 6 8 6 4 0 6-4 4-8L24 12Z" class="suit-cutout"/>',
    basto:'<path d="M19 5c-8-6-17 2-12 10-9 4-5 17 5 16 3 0 5-1 7-4l2 7-7 7v4h20v-4l-7-7 2-7c2 3 4 4 7 4 10 1 14-12 5-16 5-8-4-16-12-10l-5 5-5-5Z"/><path d="M14 12c-3-3-6 0-4 3-4 1-3 6 1 6 2 0 3-1 4-3l5 11 2 1 2-1 5-11c1 2 2 3 4 3 4 0 5-5 1-6 2-3-1-6-4-3l-6 6-6-6Z" class="suit-cutout"/>'
  };
  return `<svg class="suit-icon suit-${suit}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${paths[suit]||paths.basto}</svg>`;
}
function setupSuitIcons(root=document){root.querySelectorAll('[data-suit-icon]').forEach(el=>{el.innerHTML=suitSvg(el.dataset.suitIcon);});}

function renderPointsPicker(){
  const menu=$('points-picker-menu'),select=$('target-points');
  menu.innerHTML=[10,20,30,40].map(points=>`<button type="button" class="points-option ${Number(select.value)===points?'selected':''}" aria-pressed="${Number(select.value)===points}" data-points="${points}">${points}<span>puntos</span></button>`).join('');
  $('points-picker-trigger').querySelector('span').textContent=`${select.value} puntos`;
  menu.querySelectorAll('[data-points]').forEach(option=>option.addEventListener('click',()=>{
    select.value=option.dataset.points;renderPointsPicker();$('points-picker-trigger').setAttribute('aria-expanded','false');
  }));
}
function toast(message, global = false, duration = 2400) {
  const el = $(global ? 'global-toast' : 'toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(el._timer); el._timer = setTimeout(() => {el.classList.remove('show');el.textContent='';}, duration);
}
function clearToast(){const el=$('toast');clearTimeout(el._timer);el.classList.remove('show');el.textContent='';}
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
  if(/\bla m[ií]a es flor\b/i.test(text))return 'La mía es flor';
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
function ownCallVerb(main,bet){
  const call=main.toLocaleLowerCase('es-UY');
  if(call==='truco')return 'Gritaste';
  if(call==='flor')return 'Cantaste';
  if(call==='envido'&&!(bet?.calls?.length>1)&&!(bet?.accepted>0))return 'Tocaste';
  return 'Dijiste';
}
function callNoticeHtml(notice,room=state.room,compact=false){
  const main=notice.spoken||spokenCall(notice.text||'');
  if(!main)return escapeHtml(callNoticeText(notice.text||''));
  if(compact)return `<strong>${escapeHtml(main.toLocaleUpperCase('es-UY'))}</strong>`;
  if(notice.from===state.playerId){
    return `${escapeHtml(notice.selfVerb||'Dijiste')} <strong>${escapeHtml(main.toLocaleUpperCase('es-UY'))}</strong>`;
  }
  const name=room?.players?.[notice.from]?.name||'Tu rival';
  const verb=main.toLowerCase()==='flor'?'canta':'dice';
  return `${escapeHtml(name)} ${verb} <strong>${escapeHtml(main.toLocaleUpperCase('es-UY'))}</strong>`;
}
function makeCallNotice(text,bet=state.room?.pendingBet){
  text=callNoticeText(text);
  const spoken=spokenCall(text);
  if(!spoken||!['player1','player2'].includes(state.playerId))return null;
  return {...(spoken==='Me voy al mazo'?{kind:'fold'}:{}),id:crypto.randomUUID(),from:state.playerId,to:state.playerId==='player1'?'player2':'player1',text:spoken==='Tiene'||spoken==='Me voy al mazo'?text.split('.')[0]+'.':/\bcanta \d+ (tantos|son mejores|son iguales)\b/i.test(text)?spoken:text,spoken,selfVerb:ownCallVerb(spoken,bet),time:Date.now(),handNumber:state.room?.handNumber||1};
}

// Practice gives a little more time to read each result.
const PRACTICE_PAUSE_MS=5000;
let roundPauseTimer=null;
const roundPauseArrivals=new Map();
// Live tables set their deadlines with the table server clock; count down with that clock.
function gameTime(){
  if(state.localGame)return Date.now();
  const live=state.room?.managedCredits?liveTablesClient?.clockOffset(state.roomCode):null;
  return Date.now()+(live??(Number(state.serverTimeOffset)||0));
}
function roundPauseInfo(room=state.room){
  if(!room)return null;
  let key,endsAt,duration,label;
  if(room.resolvingTrick){
    key='trick:'+room.resolutionId;endsAt=room.resolutionEndsAt;duration=state.learning?PRACTICE_PAUSE_MS:3000;
    const next=room.resolvedTrickWinner||room.mano;
    label=room.handComplete?'Siguiente mano':next===state.playerId?'Jugás en':'Pausa';
  }else if(room.status==='revealing'&&room.endReveal){
    key='reveal:'+room.endReveal.id;endsAt=room.endReveal.endsAt;duration=state.learning?PRACTICE_PAUSE_MS:5000;label='Siguiente mano';
  }else if(room.pendingNextHand){
    key='redeal:'+room.pendingNextHand.id;endsAt=room.pendingNextHand.endsAt;duration=state.learning?PRACTICE_PAUSE_MS:3000;label='Siguiente mano';
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
  const visible=!!pause&&$('game-view').classList.contains('active');
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
  if(state.botActing)return;
  const role=state.playerId,key=`${state.roomCode}:${role}`;
  const liveNotice=state.room?.callNotice;
  const cached=receivedCallNotices.get(key)?.notice;
  const notice=liveNotice||cached;
  const button=$('player-sound-toggle');
  button.classList.remove('hidden');
  button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/>${soundEnabled?'<path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>':'<path d="m3 3 18 18"/>'}</svg>`;
  button.setAttribute('aria-label',soundEnabled?'Silenciar voz':'Activar voz');
  button.title=soundEnabled?'Silenciar voz':'Activar voz';
  button.setAttribute('aria-pressed',String(soundEnabled));
  if(state.room?.mode==='2v2'){$('call-notice').classList.add('hidden');return;}
  const el=$('call-notice');
  clearTimeout(callNoticeTimer);callNoticeTimer=null;
  const incoming=notice?.to===role;
  const own=notice?.from===role;
  const addressed=(incoming||own)&&(notice.kind==='fold'||!notice.handNumber||notice.handNumber===state.room?.handNumber);
  let received=receivedCallNotices.get(key);
  if(addressed&&received?.id!==notice.id){
    received={id:notice.id,at:Date.now(),pinned:false,notice};
    receivedCallNotices.set(key,received);
  }
  const remaining=received&&notice&&received.id===notice.id?(Number(notice.duration)||CALL_NOTICE_DURATION)-(Date.now()-received.at):0;
  const pending=state.room?.pendingBet;
  const awaitingResponse=incoming&&addressed&&notice?.kind!=='fold'&&pending&&notice.from===pending.caller&&
    (pending.revealMode?pending.revealTurn===role:pending.responder===role);
  if(awaitingResponse&&received)received.pinned=true;
  const foldVisible=notice?.kind==='fold'&&remaining>0;
  const visible=addressed&&(foldVisible||(notice?.kind!=='fold'&&(awaitingResponse||(!received?.pinned&&remaining>0))));
  const helpOpen=!!state.learning&&!!document.querySelector('.learn-coach-dialog[open]');
  const helpNotice=$('learning-call-notice');
  helpNotice.classList.add('hidden');helpNotice.innerHTML='';
  const evidenceOpen=state.room?.status==='revealing'&&!!state.room.endReveal;
  el.classList.toggle('hidden',!visible||helpOpen||evidenceOpen);
  el.setAttribute('data-speaker',own?'self':'opponent');
  el.innerHTML=visible&&!helpOpen&&!evidenceOpen?callNoticeHtml(notice,state.room,true):'';
  requestAnimationFrame(positionMobileCallNotice);
  if(!visible)return;
  if(!awaitingResponse&&!helpOpen)callNoticeTimer=setTimeout(()=>{callNoticeTimer=null;renderCallNotice();},Math.max(0,remaining));
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

function isCoordinator() { return !state.room?.managedCredits && state.room?.table?.uid === state.uid; }
function configureSetup() {
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  state.invitationEntry=false;
  $('table-visibility').value='public';$('table-password-row').hidden=true;
  document.querySelectorAll('[data-visibility]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.visibility==='public')));
  $('target-points').value='20';renderPointsPicker();
  $('play-bot').checked=false;updateBotSetup();
  state.joining = false;
  showView('setup-view');
}
function firebaseConfigValid(config) { return !!(config && config.apiKey && config.databaseURL && config.projectId && config.appId); }
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
}
let firebaseReadyPromise=null;
let creditFunctionsPromise=null,creditTickPending=false;
// In the apps: register this phone for push notifications after signing in. A tap on a
// friend request opens Amigos; a table invitation is shown by the live listener.
async function registerPush(){
  const native=globalThis.trucoNative;if(!native?.registerPush||!state.uid)return;
  const token=await native.registerPush(data=>{if(data?.type==='friend-request')friends.open();});
  if(token)await creditApi('playerSocial',{action:'register-push',token,platform:native.platform});
}
// Friends and table invitations (friends.js).
const friends=installFriends({$,api:creditApi,services:firebaseServices,getState:()=>state,document,showView,isPlaying:()=>!!state.room&&!state.learning&&$("game-view").classList.contains("active")&&!["waiting","complete"].includes(state.room.status),balance:()=>credits.wallet()?.balance,canClaim:()=>credits.canClaim(),claimCredits:()=>credits.claim(),openLobby:()=>openLobby(),
  toast:(message,error=false,duration=2600)=>toast(message,true,duration),
  tableToInvite:()=>{const room=state.room;if(!state.roomCode||state.localGame||room?.status!=='waiting')return null;
    return {code:state.roomCode,mode:room.mode==='2v2'?'2v2':'1v1',targetPoints:Number(room.targetPoints)||null,stake:Number(room.creditMatch?.stake)||null,password:state.hostTablePassword?.code===state.roomCode?state.hostTablePassword.password:''};},
  joinInvite:async(code,password)=>{
    if(state.roomCode){toast('Salí de tu mesa actual para entrar a la invitación.',true);return;}
    state.invitePassword=password?{code,password}:null;
    await openInvitation(code);$('invite-form').requestSubmit();
  }});
// Share the final score on a photo (share-photo.js), read from the result panel.
installMatchPhoto({$,document,toast:message=>toast(message,true,2600),score:()=>({target:normalizeTargetPoints(state.room?.targetPoints),sides:[...$('match-end-score').querySelectorAll(':scope>div')].map(d=>({name:d.querySelector('span')?.textContent||'',points:Number(d.querySelector('strong')?.textContent)||0,winner:d.classList.contains('match-score-winner')}))})});
// In the apps: when Google Play or the App Store has a newer version, offer it once per start.
async function offerAppUpdate(){
  const native=globalThis.trucoNative;if(!native?.checkForUpdate)return;
  const update=await native.checkForUpdate();if(!update)return;
  const dialog=$('update-dialog');if(dialog.open)return;
  $('update-now').onclick=async()=>{dialog.close();try{await native.installUpdate();}catch(error){console.error('[truco:update]',error);}};
  $('update-later').onclick=()=>dialog.close();
  dialog.showModal();
}
setTimeout(()=>{offerAppUpdate().catch(()=>{});},3000);
const activity=installActivity({send:async data=>{const result=await creditApi('playerActivity',{...data,platform:visitPlatform(),...(data.visible?takeVisit():null)});if(typeof result?.testDevice==='boolean')markTestDevice(result.testDevice);return result;},getUid:()=>state.uid,document});
const account=installAccount({api:creditApi,services:firebaseServices,getState:()=>state,rememberName:rememberPlayerName,document,onReady:async()=>{
  const initialCredits=credits.start().then(()=>credits.whenReady());
  loadCreditFunctions().catch(()=>{});activity.start();friends?.start().catch(()=>{});registerPush().catch(()=>{});
  await Promise.all([openInitialRoom(),initialCredits]);showLobbyOnboarding();
},onIdentityChange:(...args)=>{friends?.stop();return resetAccountRoom(...args);},onNameChanged:()=>showView('welcome-view'),onRegistered:uid=>{state.lobbyOnboardingUid=uid;requestAnimationFrame(showLobbyOnboarding);},inRoom:()=>!!state.room&&!$('welcome-view').classList.contains('active')});
const credits=installCredits({services:firebaseServices,walletSource:creditWalletSource,api:creditApi,getState:()=>state,document,notify:message=>toast(message,true,2000),onChange:()=>{showLobbyOnboarding();if(state.lobbyRooms)renderLobby(state.lobbyRooms);
  if(state.room)renderMatchEnd();$('table-stake-available').textContent=String(credits.wallet()?.balance??'—');updateStakeControl();}});
let lobbyWelcomeDialog=null,lobbyWelcomeStep=0,lobbyWelcomeTarget=null;
const lobbyWelcomeSteps=[
 {target:'credits-open',title:'Tus créditos',text:'Tenés 5 créditos disponibles por día. Los créditos se utilizan para apostar contra otras personas. Podés jugar contra un bot sin créditos.'},
 {target:'open-scorer',title:'Anotador',text:'Si vas a jugar con cartas reales y necesitás un anotador, acá tenés uno. Mientras lo tengas abierto, tu pantalla no se bloqueará.'},
 {target:'learn-game',title:'Aprendé a jugar',text:'¿No sabés jugar al truco? Acá te enseñamos de una manera divertida.'}
];
function positionLobbyWelcomeArrow(){
 if(!lobbyWelcomeDialog?.open||!lobbyWelcomeTarget)return;
 const target=lobbyWelcomeTarget.getBoundingClientRect();
 if(lobbyWelcomeStep>0){
  const height=lobbyWelcomeDialog.getBoundingClientRect().height;
  const top=Math.min(innerHeight-height-16,target.bottom+64);
  lobbyWelcomeDialog.style.top=Math.max(16,top)+'px';
  lobbyWelcomeDialog.style.bottom='auto';lobbyWelcomeDialog.style.margin='0 auto';
 }else{
  lobbyWelcomeDialog.style.removeProperty('top');lobbyWelcomeDialog.style.removeProperty('bottom');lobbyWelcomeDialog.style.removeProperty('margin');
 }
 const box=lobbyWelcomeDialog.getBoundingClientRect();
 const up=target.top+target.height/2<box.top+box.height/2,x1=box.left+box.width/2,y1=up?box.top-2:box.bottom+2;
 const x2=target.left+target.width/2,y2=up?target.bottom+8:target.top-8,bend=Math.max(24,Math.min(80,Math.abs(y2-y1)*.35));
 const svg=lobbyWelcomeDialog.querySelector('svg');svg.setAttribute('viewBox','0 0 '+innerWidth+' '+innerHeight);
 // Keep a straight terminal segment so the arrowhead aligns with the shaft.
 const neckY=y2+(up?20:-20);
 svg.querySelector('.lobby-welcome-path').setAttribute('d','M '+x1+' '+y1+' C '+x1+' '+(y1+(up?-bend:bend))+' '+x2+' '+(neckY+(up?bend:-bend))+' '+x2+' '+neckY+' L '+x2+' '+y2);
}
function showLobbyOnboarding(){
 if(!state.lobbyOnboardingUid||state.lobbyOnboardingUid!==state.uid||!account.isReady()||!$('welcome-view').classList.contains('active')||state.room||typeof credits.wallet()?.balance!=='number')return;
 if(lobbyWelcomeDialog?.open)return;
 if(!lobbyWelcomeDialog){
  lobbyWelcomeDialog=document.createElement('dialog');lobbyWelcomeDialog.className='lobby-welcome-dialog';lobbyWelcomeDialog.setAttribute('aria-labelledby','lobby-welcome-title');
  lobbyWelcomeDialog.innerHTML='<svg class="lobby-welcome-arrow" aria-hidden="true"><defs><marker id="lobby-welcome-tip" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#ead39b"/></marker></defs><path class="lobby-welcome-path" fill="none" stroke="#ead39b" stroke-width="3" marker-end="url(#lobby-welcome-tip)"/></svg><button type="button" class="learn-close" aria-label="Cerrar aviso">×</button><h2 id="lobby-welcome-title"></h2><div class="lobby-welcome-copy"></div><p class="lobby-welcome-step"></p>';
  document.body.append(lobbyWelcomeDialog);
  lobbyWelcomeDialog.querySelector('button').onclick=advanceLobbyWelcome;
  lobbyWelcomeDialog.addEventListener('cancel',event=>{event.preventDefault();advanceLobbyWelcome();});
  window.addEventListener('resize',positionLobbyWelcomeArrow);window.addEventListener('scroll',positionLobbyWelcomeArrow,true);
 }
 lobbyWelcomeStep=0;renderLobbyWelcomeStep();lobbyWelcomeDialog.showModal();requestAnimationFrame(positionLobbyWelcomeArrow);
}
function renderLobbyWelcomeStep(){
 lobbyWelcomeTarget?.classList.remove('lobby-welcome-highlight');
 const step=lobbyWelcomeSteps[lobbyWelcomeStep];lobbyWelcomeTarget=step.target==='credits-open'?document.querySelector('.home-wallet-summary'):$(step.target);
 lobbyWelcomeTarget.classList.add('lobby-welcome-highlight');
 lobbyWelcomeDialog.querySelector('h2').textContent=step.title;
 const copy=lobbyWelcomeDialog.querySelector('.lobby-welcome-copy');copy.replaceChildren();
 step.text.split(/(?<=\.)\s+/).forEach(text=>{const p=document.createElement('p');p.textContent=text;copy.append(p);});
 lobbyWelcomeDialog.querySelector('.lobby-welcome-step').textContent=(lobbyWelcomeStep+1)+' / 3';requestAnimationFrame(positionLobbyWelcomeArrow);
}
function advanceLobbyWelcome(){
 if(++lobbyWelcomeStep<lobbyWelcomeSteps.length){renderLobbyWelcomeStep();return;}
 lobbyWelcomeTarget?.classList.remove('lobby-welcome-highlight');lobbyWelcomeTarget=null;state.lobbyOnboardingUid=null;lobbyWelcomeDialog.close();
}
function resetAccountRoom(){
  activity.stop();
  credits.stop();
  stopRoomPresence();stopLiveTable();stopBot();forgetRoomSeat();
  state.roomWatchVersion=(state.roomWatchVersion||0)+1;
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  if(state.unsubscribe)state.unsubscribe();
  if(state.privateUnsubscribe)state.privateUnsubscribe();
  if(state.lobbyUnsubscribe)state.lobbyUnsubscribe();
  state.unsubscribe=null;state.privateUnsubscribe=null;state.lobbyUnsubscribe=null;
  state.room=null;state.hand=[];state.localGame=false;state.restorePending=null;
  state.privateHandKey=null;state.connectionReady=false;
  showView('welcome-view');
}
async function firebaseServices() {
  if(state.firebase)return state.firebase;
  if(firebaseReadyPromise)return firebaseReadyPromise;
  firebaseReadyPromise=(async()=>{
    state.authLoadingStage='modules';
    const [appSdk,dbSdk,authSdk]=await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]);
    const app=appSdk.getApps().length?appSdk.getApp():appSdk.initializeApp(state.config);
    const auth=await initializeGameAuth(authSdk,app,{onStage:stage=>{state.authLoadingStage=stage;}});
    state.uid=auth.currentUser?.uid||null;
    state.firebase={db:dbSdk.getDatabase(app,state.config.databaseURL),...dbSdk,auth,authSdk};
    authSdk.onAuthStateChanged(auth,user=>{
      account.observe(state.firebase,user);
    });
    dbSdk.onValue(dbSdk.ref(state.firebase.db,'.info/serverTimeOffset'),snapshot=>{state.serverTimeOffset=Number(snapshot.val())||0;},error=>console.error('[truco:clock]',error));
    dbSdk.onValue(dbSdk.ref(state.firebase.db,'.info/connected'),snapshot=>{
      state.firebaseConnected=snapshot.val()===true;
      credits.refresh();
      state.connectionEpoch=(state.connectionEpoch||0)+1;state.connectionReady=false;
      if(state.firebaseConnected){warmGameConnection();roomPresenceContext=null;presenceWriteSerial++;syncRoomPresence();retryRoomRestore();refreshLiveConnection();}
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
  return (room.mode==='2v2'?['player1','player2','player3','player4']:['player1','player2']).find(key=>room.players?.[key]?.uid===uid);
}
function claimRoomSeat(current,person){
  // An uncached null must be retried against the server, not treated as a full table.
  if(current===null)return null;
  if(current.status==='closed'||roomExpired(current))return;
  if(roomSeatForUid(current,person.uid))return current;
  if(current.status!=='waiting')return;
  const players=current.players||{};

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
  if(state.room?.status==='complete'){forgetRoomSeat(state.roomCode);return;}
  setRoomUrl(state.roomCode);
  try{localStorage.setItem('truco-last-seat',JSON.stringify({code:state.roomCode,role:state.playerId,uid:state.uid,createdAt:state.room?.createdAt}));}catch{}
}
function attachLiveRoom(code,seat,room,privateHand=null){
  state.privateUnsubscribe?.();state.privateUnsubscribe=null;state.privateHandKey=null;state.privateDeal=privateHand;
  state.preparingRoom=code;$('game-view').classList.add('table-preparing');
  state.roomCode=code;state.playerId=seat;state.joining=false;state.invitationEntry=false;
  state.localGame=false;state.hand=[];state.room=room;state.restorePending=null;state.connectionReady=false;
  state.lobbyUnsubscribe?.();state.lobbyUnsubscribe=null;
  rememberRoomSeat();
  showView(['drawing','started','revealing','complete','timed-out'].includes(room.status)?'game-view':'waiting-view');
  if(room.managedCredits)watchLiveConnection(code);
  const confirmed=room.players?.[seat]?.uid===state.uid&&(room.status==='waiting'||privateHandMatchesRoom(privateHand,room));
  state.connectionReady=confirmed&&roomTransportConnected();
  watchRoom();watchPrivateHand();
  if(room.status==='waiting'){renderWaiting();state.preparingRoom=null;state.joinIntent=null;}
  else {renderGame();}
  if(confirmed){void syncRoomPresence();}else void refreshLiveConnection();
}
async function restoreRoom(code){
  if(!/^[A-Z2-9]{5}$/.test(code||'')||!firebaseConfigValid(state.config))return false;
  const epoch=state.navigationEpoch||0;
  try{
    const fb=await firebaseServices();
    if(epoch!==(state.navigationEpoch||0))return false;
    const snapshot=liveSnapshot((await liveTables().readTable(code)).room);
    if(epoch!==(state.navigationEpoch||0))return false;
    const room=snapshot.val(),saved=savedRoomSeat();
    const seat=roomSeatForUid(room,state.uid);
    if(!room||room.status==='closed'||room.status==='complete'||roomExpired(room)){
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
  if(!account.isReady())return;
  const pending=state.restorePending;
  if(!pending||state.room||pending.epoch!==(state.navigationEpoch||0))return;
  state.restorePending=null;
  await restoreRoom(pending.code);
}
async function openInitialRoom(){
  if(!account.isReady())return;
  const epoch=state.navigationEpoch||0;
  const invitedRoom=new URLSearchParams(location.search).get('mesa');
  const code=invitedRoom||savedRoomSeat()?.code;
  if(code&&await restoreRoom(code))return;
  if(epoch!==(state.navigationEpoch||0)||state.room)return;
  if(invitedRoom&&new URLSearchParams(location.search).get('mesa')===invitedRoom)await openInvitation(invitedRoom);
  else if(firebaseConfigValid(state.config))await openLobby();
}

async function enterRoom() {
  if(!account.isReady())return;
  if(state.enteringRoom)return;
  if(!state.joining&&!$('play-bot').checked){
    // The wallet subscription is already live; the server checks the reservation atomically.
    const wallet=credits.wallet(),stake=Number($('table-stake').value);
    if(!wallet){toast('Esperá a que carguen tus créditos.',true);return;}
    if(wallet.locked>0){toast('Ya tenés una apuesta reservada. Volvé a tu mesa.',true);return;}
    if(!Number.isSafeInteger(stake)||stake<1||stake>wallet.balance){toast('Elegí una apuesta entera dentro de tus créditos disponibles.',true);return;}
  }
  const entryEpoch=state.navigationEpoch;
  state.enteringRoom=true;$('enter-room').disabled=true;
  // Do not serialize the entry request behind all thirteen image decodes.
  void prepareCardImages();
  if(state.navigationEpoch!==entryEpoch){state.enteringRoom=false;$('enter-room').disabled=false;return;}
  if(state.invitationEntry&&!$('player-name').value.trim()){showInvitationForm();$('invite-name').focus();return;}
  const name=cleanName($('player-name').value,'Jugador');
  if(!state.joining&&$('play-bot').checked){await startBotGame(name);return;}
  if(!firebaseConfigValid(state.config)){state.nextAction='enter';showConfig();return;}
  state.enteringRoom=true;
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  const request={joining:state.joining,code:state.selectedRoom};
  $('enter-room').disabled=true;
  console.info('[truco:join] begin',{joining:request.joining,code:request.code||null});
  try{
    const fb=await firebaseServices();
    let joinedRoom,joinedHand=null;
    if(request.joining){
      const code=request.code,roomRef=fb.ref(fb.db,`rooms/${code}/public`);
      // The lobby already holds open tables; invitations ask the table itself.
      const snap=liveSnapshot(liveTables().lobbyRoom(code)||(await liveTables().readTable(code)).room);
      if(!snap.exists()){if($('join-credit-dialog').open)throw new Error('La invitación ya no está disponible.');toast('La invitación ya no está disponible.',true);await openLobby();return;}
      let room=snap.val(),seat=roomSeatForUid(room,state.uid);
      if(room.status==='closed'||roomExpired(room)){if($('join-credit-dialog').open)throw new Error('La mesa ya está cerrada.');toast('La mesa ya está cerrada.',true);await openLobby();return;}
      // Several friends may be invited at once: whoever arrives after the last seat is taken hears it plainly.
      if(!seat&&!roomSeats(room).some(p=>!room.players?.[p])){if($('join-credit-dialog').open)throw new Error('La mesa ya se llenó.');toast('La mesa ya se llenó.',true);await openLobby();return;}
      if(room.managedCredits){
        // Entering a table spends credits: always confirm with its details first.
        if(!seat&&!state.joinConfirmed){openCreditJoin(code,room);return;}
        const result=await creditApi('creditJoinTable',{code,password:state.joinPassword||'',...(room.mode==='2v2'?{team:state.joinConfirmed?$('join-credit-team').value:state.joinTeam}:{})});
        room=result.room;joinedHand=result.privateHand||null;seat=roomSeatForUid(room,state.uid);state.joinPassword='';state.joinConfirmed=false;
        if(!seat)throw new Error('La mesa ya no tiene lugares disponibles.');
      }
      // Existing players may reconnect even after the automatic start.
      if(!seat){
        if(room.status!=='waiting'){toast('La partida ya empezó y no tenés un lugar en esta mesa.',true);await openLobby();return;}
        const person={uid:state.uid,name,online:true};
        const claim=await fb.runTransaction(roomRef,current=>claimRoomSeat(current,person),{applyLocally:false});
        room=claim.snapshot.val();
        seat=roomSeatForUid(room,state.uid);
        if(!seat||room?.status==='closed'||roomExpired(room)){
          toast('La mesa se cerró o ya no hay lugares disponibles.',true);await openLobby();return;
        }
      }
      state.roomCode=code;state.playerId=seat;joinedRoom=room;
    }else{
      const stake=Number($('table-stake').value),visibility=$('table-visibility').value;
      const data={stake,targetPoints:normalizeTargetPoints($('target-points').value),mode:$('table-mode').value,visibility,password:visibility==='password'?$('table-password').value:''};
      // The table appears at once; the server confirms the credit reservation behind it.
      const code=newTableCode();
      state.pendingCreate=code;state.cancelAfterCreate=null;
      // Kept so the host can hand a private table's password to an invited friend.
      state.hostTablePassword=data.password?{code,password:data.password}:null;
      rememberPlayerName(name);
      attachLiveRoom(code,'player1',provisionalTable(data,name),null);
      void confirmCreatedTable(code,data);
      return;
    }
    if($('join-credit-dialog').open)$('join-credit-dialog').close();
    rememberPlayerName(name);
    attachLiveRoom(state.roomCode,state.playerId,joinedRoom,joinedHand);
    console.info('[truco:join] seated',{code:state.roomCode,role:state.playerId,status:joinedRoom.status});
  }catch(error){
    console.error('[truco:join] failed',error);
    if(/deadline-exceeded|unavailable|internal/.test(error.code||'')){
      const recoveredCode=request.joining?request.code:Object.entries(state.lobbyRooms||{}).find(([,item])=>item.public&&['waiting','started','revealing'].includes(item.public.status)&&roomSeatForUid(item.public,state.uid))?.[0];
      if(recoveredCode&&await restoreRoom(recoveredCode))return;
    }
    state.joinPassword='';state.joinConfirmed=false;
    if($('join-credit-dialog').open){
      const message=firebaseError(error);
      $('join-credit-error').textContent=/clave.*correcta/i.test(message)?'Clave incorrecta':message;
    }else{
      toast(firebaseError(error),true);
      if(state.invitationEntry)showInvitationForm();
    }
  }finally{
    state.enteringRoom=false;$('enter-room').disabled=false;
  }
}
function invitationLink(code){
  const url=new URL(globalThis.trucoNative?.isNative ? globalThis.trucoNative.publicUrl : location.href);url.search='';url.hash='';url.searchParams.set('mesa',code);return url.href;
}
function updateInvitation(){
  const link=$('invite-whatsapp');
  link.classList.toggle('hidden',!state.roomCode||state.localGame||state.room?.status!=='waiting');
  $('invite-friend').classList.toggle('hidden',!state.roomCode||state.localGame||state.room?.status!=='waiting'||!state.uid);
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
  state.joining=true;state.invitationEntry=true;state.selectedRoom=code;state.joinTeam=null;
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
  if(!account.isReady())return;
  if (!firebaseConfigValid(state.config)) { state.nextAction = 'lobby'; showConfig(); return; }
  try {
    const navigationEpoch=state.navigationEpoch||0;
    const fb = await firebaseServices();
    if(navigationEpoch!==(state.navigationEpoch||0))return;
    showView('welcome-view');
    warmGameConnection();
    $('open-room-list').innerHTML = '<p class="muted">Buscando mesas abiertas…</p>';
    if (state.lobbyUnsubscribe) state.lobbyUnsubscribe();
    state.lobbyUnsubscribe = liveTables().watchLobby((rooms) => {state.lobbyRooms=rooms||{};renderLobby(state.lobbyRooms);});
  } catch (error) {
    console.error(error);
    $('open-room-list').innerHTML = '<p class="muted">No pudimos cargar las mesas. Revisá la conexión y las reglas de Firebase.</p>';
    toast(firebaseError(error));
  }
}
const ROOM_WAIT_LIMIT=10*60*1000;
function roomExpired(room,now=Date.now()){
  return room?.status==='waiting' && !(room.mode==='2v2'?['player1','player2','player3','player4']:['player1','player2']).every(p=>room.players?.[p]) && Number.isFinite(room.createdAt) && now-room.createdAt>=ROOM_WAIT_LIMIT;
}
const closingRooms=new Set();
async function closeExpiredRoom(code){
  if(state.lobbyRooms?.[code]?.public?.managedCredits||state.room?.managedCredits&&state.roomCode===code)return;
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
  const open = Object.entries(rooms).filter(([, value]) => value?.public?.status === 'waiting' && !roomExpired(value.public) && (value.public.mode==='2v2'?Object.keys(value.public.players||{}).length<4:(!value.public.players?.player1 || !value.public.players?.player2))).sort((a,b) => (b[1].public.createdAt || 0) - (a[1].public.createdAt || 0));
  if (!open.length) { $('open-room-list').innerHTML = '<div class="empty-lobby"><svg class="empty-table-icon" viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="29" rx="18" ry="12"/><path d="M32 41v14M23 55h18M25 15V9c0-7 14-7 14 0v6M9 25v16q0 7 9 7l-2 9M55 25v16q0 7-9 7l2 9"/></svg><strong>No hay mesas abiertas todavía</strong></div>'; setupSuitIcons($('open-room-list')); return; }
  $('open-room-list').innerHTML = open.map(([code, value]) => {
    const room = value.public, players = room.players || {}, seats = [['player1','Jugador 1',players.player1],['player2','Jugador 2',players.player2]];
    const title = room.table?.name || players.player1?.name || players.player2?.name || 'Mesa abierta';
    const available = seats.filter(([, , person]) => !person);
    const actions=[];
    if(room.mode!=='2v2'&&roomSeats(room).some(p=>!players[p]))actions.push(['player','Entrar']);
    const joinDisabled=!!(room.managedCredits&&!roomSeatForUid(room,state.uid)&&((credits.wallet()?.balance??0)<room.creditMatch.stake||(credits.wallet()?.locked??0)>0));
    const teamSeats=room.mode==='2v2'?renderTeamLobbySeats(code,room,escapeHtml,joinDisabled):`<div class="lobby-team-row"><div class="lobby-team"><span class="lobby-team-name">${escapeHtml(title)}</span></div><span class="lobby-team-versus">vs</span><div class="lobby-team">${actions.map(([key,label])=>`<button class="lobby-team-join" data-room="${code}" data-seat="${key}" ${joinDisabled?'disabled':''}>${label}</button>`).join('')}</div></div>`;
    const privateTable=!!(room.managedCredits&&room.creditMatch.hasPassword);
    const coins='<svg class="credit-coin-icon" viewBox="-2 -2 52 54" aria-hidden="true"><g transform="rotate(-9 21 35)"><path d="M6 35v7a15 6 0 0 0 30 0v-7"/><ellipse cx="21" cy="35" rx="15" ry="6"/></g><g transform="rotate(9 27 23)"><path d="M12 23v7a15 6 0 0 0 30 0v-7"/><ellipse cx="27" cy="23" rx="15" ry="6"/></g><g transform="rotate(-12 20 12)"><path d="M5 12v7a15 6 0 0 0 30 0v-7"/><ellipse cx="20" cy="12" rx="15" ry="6"/></g></svg>';
    const lock='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="'+(privateTable?'M8 10V6a4 4 0 0 1 8 0v4':'M8 10V6a4 4 0 0 1 8 0')+'"/><path d="M12 14v3"/></svg>';
    return `<article class="lobby-card compact-room has-team-seats"><div class="compact-room-owner"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><h3>${escapeHtml(title)}</h3></div><div class="compact-room-stat"><strong>${targetPoints(room)}</strong><span>puntos</span></div><div class="compact-room-stat">${coins}<strong>${room.managedCredits?escapeHtml(String(room.creditMatch.stake)):'0'}</strong></div><div class="compact-room-privacy ${privateTable?'is-private':'is-public'}" role="img" aria-label="${privateTable?'Mesa privada':'Mesa pública'}" title="${privateTable?'Mesa privada':'Mesa pública'}">${lock}</div><div class="lobby-join-options">${actions.map(([key,label])=>`<button class="button lobby-player-button" data-room="${code}" data-seat="${key}" ${room.managedCredits&&!roomSeatForUid(room,state.uid)&&((credits.wallet()?.balance??0)<room.creditMatch.stake||(credits.wallet()?.locked??0)>0)?'disabled':''}>${label}</button>`).join('')}</div>${teamSeats}</article>`;
  }).join('');
  syncLobbyJoinFeedback();
}
function syncLobbyJoinFeedback(){
  const intent=state.joinIntent;
  for(const button of document.querySelectorAll('#open-room-list [data-room]')){
    if(intent){
      if(button.dataset.joinWasDisabled==null)button.dataset.joinWasDisabled=String(button.disabled);
      button.disabled=true;
      if(button.dataset.room===intent.code&&button.dataset.seat===intent.seat&&(!intent.team||button.dataset.team===intent.team)){
        if(button.dataset.joinLabel==null)button.dataset.joinLabel=button.textContent;
        button.textContent='Entrando…';button.setAttribute('aria-busy','true');
      }
    }else if(button.dataset.joinWasDisabled!=null){
      button.disabled=button.dataset.joinWasDisabled==='true';delete button.dataset.joinWasDisabled;
      if(button.dataset.joinLabel!=null){button.textContent=button.dataset.joinLabel;delete button.dataset.joinLabel;}
      button.removeAttribute('aria-busy');
    }
  }
}
function joinOpenRoom(code, seat, team=null) {
  if(state.enteringRoom||state.joinSubmitting||state.joinIntent)return;
  state.joinIntent={code,seat,team};
  state.joinTeam=['player1','player2'].includes(team)?team:null;
  state.joining = true; state.selectedRoom = code;
  const name = cleanName($('player-name').value||savedPlayerName(), 'Jugador');
  $('player-name').value = name;
  syncLobbyJoinFeedback();
  void enterRoom().finally(()=>{if(state.roomCode!==code||!state.room){state.joinIntent=null;syncLobbyJoinFeedback();}});
}
function firebaseError(error) {
  if (error instanceof LiveError) return error.message;
  if (error?.code === 'auth/operation-not-allowed') return 'Activá el inicio de sesión anónimo en Firebase y volvé a intentar.';
  if (error?.code?.includes('permission-denied')) return 'Firebase rechazó el acceso. Revisá las reglas de la base.';
  if (error?.message?.includes('Failed to fetch')) return 'No se pudo conectar con Firebase. Revisá la configuración y la conexión.';
  if(error?.code?.startsWith('functions/'))return error.code==='functions/not-found'?'Falta habilitar el servidor de las mesas con créditos.':error.message||'No pudimos conectar con el servidor.';
  return 'No pudimos conectar la mesa. Revisá la configuración de Firebase.';
}
function watchRoom() {
  const fb = state.firebase,code=state.roomCode;
  const version=(state.roomWatchVersion||0)+1;state.roomWatchVersion=version;
  if (state.unsubscribe) state.unsubscribe();
  const onRoom = (snapshot) => {
    if(code!==state.roomCode||version!==state.roomWatchVersion)return;
    if (!snapshot.exists()) { if(state.unsubscribe){state.unsubscribe();state.unsubscribe=null;}console.warn('[truco:room] unavailable',{code});returnToLobby('La mesa ya no está disponible.');return; }
    const incoming=snapshot.val();
    if(isOlderRoom(incoming,state.room))return;
    if(Number(incoming.matchNumber||1)!==Number(state.room?.matchNumber||1)){
      state.privateUnsubscribe?.();state.privateUnsubscribe=null;state.privateHandKey=null;state.privateDeal=null;
      state.hand=[];state.handOrder=[];state.renderedHandNumber=null;state.finalEvidenceKey=null;state.verifiedEnvido=null;
      clearTimeout(state.resolutionTimer);state.resolutionTimer=null;state.resolutionTimerKey=null;
    }
    state.room = incoming;
    if(incoming.status==='complete'||state.persistedRoomCreatedAt!==incoming.createdAt)rememberRoomSeat();
    syncRoomPresence();
    if(state.room.status==='closed'||roomExpired(state.room)){if(roomExpired(state.room))closeExpiredRoom(state.roomCode);if(state.unsubscribe){state.unsubscribe();state.unsubscribe=null;}const reason=state.room.closeReason;returnToLobby(state.cancelingWaitingRoom===state.roomCode||reason==='waiting-canceled'?'':reason==='match-left'?'La mesa terminó. Volviste al lobby.':reason==='draw-timeout'?'Se acabó el tiempo para elegir carta. La partida no comenzó.':['draw-left','draw-cancel'].includes(reason)?'Un participante salió del sorteo. La partida no comenzó.':'La mesa cerró por inactividad.');return;}
    if(isCoordinator()&&state.room.status==='started'&&!state.room.resolvingTrick&&state.room.trickCards?.length===2&&(state.room.tricks||[]).length>0)recoverLegacyTrick(state.room);
    if(isCoordinator()&&state.room.status==='complete'&&!state.room.endReveal&&(Object.keys(state.room.flors||{}).length||state.room.envidoAudit)){
      const key=`${state.roomCode}:${state.room.handNumber}`;
      if(state.finalEvidenceKey!==key){
        state.finalEvidenceKey=key;
        finishLiveHand(state.room.mano,state.room.scores||{},state.room.feed?.[0]?.text||'Partida terminada.').catch(error=>{state.finalEvidenceKey=null;toast(firebaseError(error));});
      }
    }
    if (isCoordinator()) scheduleTableResolution();
    if (['drawing','started','revealing','complete','timed-out'].includes(state.room.status)) { if(!$('game-view').classList.contains('active')){state.preparingRoom=code;$('game-view').classList.add('table-preparing');}showView('game-view'); if(state.room.status!=='drawing')watchPrivateHand(); renderGame(); }
    if(isCoordinator()&&state.room.status==='drawing')finishOpeningDraw().catch(error=>toast(firebaseError(error)));
    else if (state.room.status === 'waiting') { renderWaiting(); if (!$('waiting-view').classList.contains('active')) showView('waiting-view'); }
  };
  if(state.room?.managedCredits){
    watchLiveConnection(code);
    // Room and private hand arrive together; apply the hand first so one render sees both.
    state.unsubscribe=liveTables().watchTable(code,({room,hand})=>{
      if(code!==state.roomCode||version!==state.roomWatchVersion)return;
      // Until the server confirms a new table it reports none; keep the provisional one.
      if(!room&&state.pendingCreate===code)return;
      if(state.privateUnsubscribe&&state.privateHandKey===`${code}:${state.uid}`&&Number(room?.matchNumber||1)===Number(state.room?.matchNumber||1)){state.privateDeal=hand||null;state.privateDealJson=JSON.stringify(hand??null);}
      onRoom(liveSnapshot(room));
    });
    return;
  }
  state.unsubscribe = fb.onValue(fb.ref(fb.db, `rooms/${code}/public`), onRoom, error=>{if(code!==state.roomCode||version!==state.roomWatchVersion)return;console.error('[truco:room] subscription failed',{code,error});toast(firebaseError(error),true);});
}
function privateHandMatchesRoom(deal,room){
  if(room?.managedCredits&&deal?.creditMatchId!==room.creditMatch?.id)return false;
  if(!deal||!room||(deal.handNumber!=null&&Number(deal.handNumber)!==Number(room.handNumber||1)))return false;
  const expected=room.handCounts?.[state.playerId];
  return expected==null||(deal.hand||[]).length===Number(expected);
}
function syncPrivateHand(){
  if(state.localGame)return;
  const handNumber=state.room?.handNumber||1;
  const sameHand=state.renderedHandNumber===handNumber;
  if(state.renderedHandNumber!==handNumber){
    state.renderedHandNumber=handNumber;state.handGestureActive=false;handGesture=null;
    state.cardLaunchOrigin=null;state.launchingCardId=null;
  }
  const matches=privateHandMatchesRoom(state.privateDeal,state.room);
  const deal=state.privateDeal,room=state.room;
  const sameDeal=!!deal&&Number(deal.handNumber||1)===Number(room?.handNumber||1)&&(!room?.managedCredits||deal.creditMatchId===room.creditMatch?.id);
  const played=new Set((room?.trickCards||[]).filter(item=>item.playerId===state.playerId).map(item=>item.card.id));
  state.hand=(matches||(sameDeal&&Number(deal.revision)>=Number(room.revision))?deal.hand||[]:sameHand?state.hand:[]).filter(card=>!played.has(card.id));
  state.partnerHand=(matches||sameDeal)&&state.room.mode==='2v2'?(state.privateDeal.partnerHand||[]):[];
  reconcilePendingPlay();
}
function watchPrivateHand() {
  const subscriptionKey=`${state.roomCode}:${state.uid}`;
  if(state.privateUnsubscribe&&state.privateHandKey===subscriptionKey)return;
  if(state.privateUnsubscribe)state.privateUnsubscribe();
  state.privateHandKey=subscriptionKey;
  const fb = state.firebase;
  if(state.room?.managedCredits){
    state.privateDealJson=null;
    const apply=({hand})=>{
      if(state.privateHandKey!==subscriptionKey)return;
      // Already applied by the room listener for this same message.
      const key=JSON.stringify(hand??null);if(key===state.privateDealJson)return;state.privateDealJson=key;
      state.privateDeal=hand||null;syncPrivateHand();renderGame();
    };
    state.privateUnsubscribe=liveTables().watchTable(state.roomCode,apply);
    return;
  }
  state.privateUnsubscribe = fb.onValue(fb.ref(fb.db, `hands/${state.roomCode}/${state.uid}`), (snapshot) => {
    if(state.privateHandKey!==subscriptionKey)return;
    const deal=snapshot.val();
    if(deal?.creditMatchId===state.privateDeal?.creditMatchId&&Number(deal?.revision)<Number(state.privateDeal?.revision))return;
    state.privateDeal=deal;
    syncPrivateHand();if(state.room?.status!=='waiting')renderGame();
  },error=>{if(state.privateHandKey!==subscriptionKey)return;console.error('[truco:hand] subscription failed',error);toast(firebaseError(error),true);});
}
function renderWaiting() {
  if (!state.room) return;
  updateInvitation();
  const players = state.room.players || {};
  const ready = !!(state.room.table && roomSeats().every(p=>players[p]));
  $('room-status').textContent = ready?'Todo listo':'Esperando rival';
  $('seats').className='seats waiting-table'+(state.room.mode==='2v2'?' waiting-table-teams':'');
  // Redraw only when the seats change, so an identical update never swaps a button under the finger.
  const seatsHtml=renderWaitingSeats(state.room,state.playerId,escapeHtml);
  if($('seats').dataset.html!==seatsHtml){$('seats').innerHTML=seatsHtml;$('seats').dataset.html=seatsHtml;}
  if(ready&&isCoordinator()&&!state.room.managedCredits)startGame().catch(error=>toast(firebaseError(error),true));
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
  for(const key of opponentFlights.keys())clearOpponentFlight(key);
  opponentPlaySnapshot={scope:null,keys:new Set()};
  state.cancelingWaitingRoom=null;
  removeCardFlight();
  stopRoomPresence();stopLiveTable();
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
    if(state.room?.managedCredits){await creditCommand(reason==='draw-timeout'?{kind:'tick'}:{kind:'cancel',reason:'draw-cancel'});return;}
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
    if(state.room?.managedCredits){await creditCommand({kind:'draw'});return;}
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
async function finishOpeningDraw() {
  if(state.room?.status!=='drawing'||finishingDraw||state.room.managedCredits)return;
  finishingDraw=true;
  try{await dealOpeningHand('player2');}finally{finishingDraw=false;}
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
  patches[`rooms/${code}/public/florCompared`] = false;
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
    if(room.status!=='drawing'||room.openingDraw?.endsAt!==drawDeadline)return;
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
  const calculation=sum===points||kinds.includes('falta')?'son '+points+' puntos.':'son '+points+' puntos porque el canto supera lo que falta para ganar.';
  return calls.join(' + ')+' querido: '+calculation;
}

function scoringEntries(room,scores,reason,truth=null){
  const entries=[...(room.handScoreEntries||[])];
  const remaining={player1:Number(scores.player1||0)-Number(room.scores?.player1||0),player2:Number(scores.player2||0)-Number(room.scores?.player2||0)};
  const add=(player,points,detail)=>{if(points>0){entries.push({player,points,detail});remaining[player]-=points;}};
  if(room.envidoAudit&&truth){
    const audit=room.envidoAudit,award=auditEnvidoScores(room,{player1:0,player2:0},truth);
    const names=p=>room.players?.[p]?.name||'Jugador';
    const liars=Object.keys(audit.reveals||{}).filter(p=>Number(audit.reveals[p])!==Number(truth[p]));
    const details=liars.map(p=>`${names(p)} declaró ${audit.reveals[p]} y tenía ${truth[p]}.`);
    const result=liars.length===2?`${names(envidoAuditResult(room,truth).liars[0])} declaró mal primero; el rival gana el envido y la mano.`:liars.length===1?`${names(liars[0])} declaró tantos incorrectos; el rival gana el envido y la mano.`:audit.reveals?.player1===audit.reveals?.player2&&audit.reveals?.player1!=null?'Empate: gana quien es mano.':'Gana el envido.';
    const detail=acceptedEnvidoExplanation(audit)+(liars.length?' '+details.join(' ')+' '+result:'');
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
  if(flowers.length===2&&room.florDeferred&&!room.florSettled){
    const winner=Number(room.flors.player1)===Number(room.flors.player2)?room.mano:Number(room.flors.player1)>Number(room.flors.player2)?'player1':'player2';
    if(remaining[winner]>=Number(room.florDeferred))add(winner,Number(room.florDeferred),`La mía es flor · gana la flor más alta (${room.flors.player1} a ${room.flors.player2}).`);
  }
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
  const notice=makeCallNotice(callLabel?`${state.room.players[state.playerId].name} dice ${callLabel}.`:changes.feed?.[0]?.text,newBet);
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
  if(state.room?.managedCredits)return creditCommand({kind:'call',value:kind});
  if(liveActionsBlocked())return;
  if(state.localGame){localCallAction(kind);return;}
  const room=state.room, caller=state.playerId, other=caller==='player1'?'player2':'player1', pending=room.pendingBet;
  const overTruco=pending?.type==='truco'&&pending.responder===caller;
  const isEnvido=['envido','real','falta'].includes(kind);
  if(!room||(pending&&!overTruco)||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||!state.hand.length)return;
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
  if(state.learning)pending.endsAt=gameTime()+PRACTICE_PAUSE_MS;
  state.resolutionTimer=scheduleLocalTransition(room,()=>{
    if(!state.localGame||state.room!==room||room.pendingNextHand?.id!==pending.id)return;
    room.pendingNextHand=null;state.resolutionTimer=null;state.resolutionTimerKey=null;
    localFinishHand(pending.winner,pending.foldPoints,pending.id.startsWith('fold:')?'fold':'declined');
  },Math.max(0,pending.endsAt-gameTime()));
}

function canRaiseEnvido(bet){
  return bet?.type==='envido'&&!bet.revealMode&&bet.called!=='falta'&&!(bet.calls||[]).includes('falta');
}

async function answerBet(answer) {
  if(state.room?.managedCredits)return creditCommand({kind:'call',value:answer});
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
    if(!canRaiseEnvido(bet))return;
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
    await writeRoom({scores,florCompared:bet.called==='conflor'||bet.called==='falta',florSettled:true,pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere. Flores: ${flowers.player1} a ${flowers.player2}. ${state.room.players[winner].name} suma ${bet.stake}.`),status});return;
  }
  await writeRoom({trucoLevel:bet.stake,pendingBet:null,feed:topFeed(state.room,`${state.room.players[state.playerId].name} dice QUIERO`) });
}
async function revealEnvido(good=false,declaredNumber=null) {
  if(state.room?.managedCredits)return creditCommand({kind:'declare',good,value:Number(declaredNumber??$('envido-picker').dataset.value)});
  if(liveActionsBlocked())return;
  if(state.learning?.paused)return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const room=state.room,bet=room?.pendingBet,player=state.playerId;
  if(bet?.type==='flor'&&bet.revealMode&&bet.revealTurn===player&&state.localGame){
    // Flower points are the real ones: only the order and son buenas are the player's choice.
    const first=room.mano,second=otherPlayer(first),own=Number(room.flors?.[player]),number=Number(declaredNumber??($('envido-picker').dataset.value||0));
    if(good&&player!==second){toast('El mano declara primero los puntos de su flor.');return;}
    if(!good&&number!==own){toast('Declará los puntos de tu flor: '+own+'.');return;}
    if(!good&&player===second&&number<=Number(bet.reveals?.[first])){toast('No superás la flor del rival: decí son buenas.');return;}
    const reveals={...(bet.reveals||{})};if(!good)reveals[player]=number;
    const text=good?`${room.players[player].name}: son buenas.`:`${room.players[player].name} canta ${number} de flor.`;
    queueLearningAction(good?'good':'declare',bet);localFeed(text);const notice=makeCallNotice(text);if(notice)room.callNotice=notice;
    if(player===first){room.pendingBet={...bet,reveals,revealTurn:second};renderGame();return;}
    room.pendingBet={...bet,reveals};localResolveFlor(room.pendingBet,good||number<=Number(reveals[first])?first:second);renderGame();return;
  }
  if(bet?.type!=='envido'||!bet.revealMode||bet.revealTurn!==player)return;
  const first=room.mano,second=otherPlayer(first),number=Number(declaredNumber??($('envido-picker').dataset.value||0));
  if(good&&player!==second)return;
  if(!good&&(!Number.isInteger(number)||number<0||number>37||(player===second&&number<bet.reveals?.[first]))){toast('Igualá o superá los tantos.');return;}
  const reveals={...(bet.reveals||{})};if(!good)reveals[player]=number;
  let changes;
  if(player===first){changes={pendingBet:{...bet,reveals,revealTurn:second},feed:topFeed(room,`${room.players[player].name} canta ${number} tantos.`)};}
  else{
    const winner=good||number===Number(bet.reveals?.[first])?first:second;
    changes={pendingBet:bet.suspendedBet||null,envidoClosed:true,envidoAudit:{reveals,declarationOrder:[first,second].filter(p=>reveals[p]!=null),winner,stake:bet.stake,called:bet.called||'envido',calls:bet.calls||[bet.called||'envido'],handNumber:room.handNumber},feed:topFeed(room,good?`${room.players[player].name}: son buenas.`:`${room.players[player].name} canta ${number} ${number===Number(bet.reveals?.[first])?'son iguales':'son mejores'}.`)};
  }
  const finishFalta=player===second&&bet.called==='falta';
  if(finishFalta){changes={...changes,pendingBet:null,turn:null,turnClock:null,pendingNextHand:{id:'falta:'+crypto.randomUUID(),winner:changes.envidoAudit.winner,foldPoints:0,endsAt:gameTime(),message:'Falta envido: se verifican los tantos y se asignan '+bet.stake+' puntos.'}};}
  if(state.localGame){queueLearningAction(good?'good':'declare',bet);const notice=makeCallNotice(changes.feed?.[0]?.text);if(notice)changes.callNotice=notice;Object.assign(room,changes);if(finishFalta){room.pendingNextHand=null;localFinishHand(changes.envidoAudit.winner,0,'falta');return;}renderGame();}else await writeRoom(changes);
}
function settleSingleFlor(room,scores) {
  const flowers=Object.keys(room.flors||{});
  if(room.florSettled)return scores;
  if(flowers.length===2&&room.florDeferred){
    const player=Number(room.flors.player1)===Number(room.flors.player2)?room.mano:Number(room.flors.player1)>Number(room.flors.player2)?'player1':'player2';
    return {...scores,[player]:(Number(scores[player])||0)+Number(room.florDeferred)};
  }
  if(flowers.length!==1)return scores;
  const player=flowers[0];return {...scores,[player]:(Number(scores[player])||0)+3};
}
function envidoAuditResult(room,truth){
  const audit=room.envidoAudit;
  if(!audit)return {liars:[],winner:null};
  const order=audit.declarationOrder||[room.mano||'player1',otherPlayer(room.mano||'player1')];
  const liars=order.filter(player=>audit.reveals?.[player]!=null&&Number(audit.reveals[player])!==Number(truth[player]));
  const declaredWinner=audit.reveals?.player1!=null&&audit.reveals.player1===audit.reveals.player2?room.mano:audit.winner;
  return {liars,winner:liars.length?otherPlayer(liars[0]):declaredWinner};
}
function auditEnvidoScores(room,scores,truth){
  if(!room.envidoAudit)return scores;
  const {winner}=envidoAuditResult(room,truth),result={...scores};
  if(winner)result[winner]=(result[winner]||0)+Number(room.envidoAudit.stake);
  return result;
}
function settleAuditedHand(room,scores,truth,winner,points){
  const result=auditEnvidoScores(room,scores,truth),audit=envidoAuditResult(room,truth);
  const handWinner=audit.liars.length?audit.winner:winner;
  const handPoints=audit.liars.length?(Number(points)||Number(room.trucoLevel)||1):Number(points)||0;
  if(handWinner&&handPoints)result[handWinner]=(Number(result[handWinner])||0)+handPoints;
  return result;
}
async function verifyEnvido(scores,winner=null,points=0){
  if(!state.room.envidoAudit)return settleAuditedHand(state.room,scores,{},winner,points);
  const fb=state.firebase,snapshot=await fb.get(fb.ref(fb.db,`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`));
  if(!snapshot.exists())throw new Error('Faltan las cartas originales para verificar el envido.');
  const truth=snapshot.val(),result=settleAuditedHand(state.room,scores,truth,winner,points);
  state.verifiedEnvido={code:state.roomCode,handNumber:state.room.handNumber,truth};
  return result;
}
async function callFlor() {
  if(state.room?.managedCredits)return creditCommand({kind:'call',value:'flor'});
  if(liveActionsBlocked())return;
  const room=state.room,player=state.playerId;if(!room||state.hand.length!==3||room.flors?.[player]!=null||!roomHasFlor(room,state.hand)){toast('No tenés flor.');return;}
  const flors={...(room.flors||{}),[player]:florValue(state.hand,room.muestra)};
  const other=player==='player1'?'player2':'player1';
  const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
  if(room.pendingBet?.type==='envido'&&room.pendingBet.responder===player&&!flors[other]){
    await writeRoom({flors,envidoClosed:true,florSettled:true,pendingBet:(Number(room.scores?.[player])||0)+3>=targetPoints(room)?null:suspendedBet,
      status:(Number(room.scores?.[player])||0)+3>=targetPoints(room)?'complete':'started',
      scores:capScores(room,{...room.scores,[player]:(Number(room.scores?.[player])||0)+3}),
      feed:topFeed(room,`${room.players[player].name} canta flor. Suma 3 puntos; se cancela el envido.`)});
    return;
  }
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
  patches[`rooms/${state.roomCode}/public/florCompared`]=false;patches[`rooms/${state.roomCode}/public/florSettled`]=false;patches[`rooms/${state.roomCode}/public/flors`]={};patches[`rooms/${state.roomCode}/public/envidoClosed`]=false;patches[`rooms/${state.roomCode}/public/playedCount`]=0;
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
  const flowers=Object.keys(room.flors||{});
  const florWinner=flowers.length===1?flowers[0]:flowers.length>1?(Number(room.flors.player1)===Number(room.flors.player2)?room.mano:Number(room.flors.player1)>Number(room.flors.player2)?'player1':'player2'):null;
  if(florWinner){
    const cards=originals[florWinner]||[];
    if(cards.length===3)groups.push({player:florWinner,label:room.florCompared||room.florDeferred?'Flor · '+florValue(cards,room.muestra)+' tantos':'Flor',cards});
  }
  const audit=room.envidoAudit;
  if(audit){
    const truth={player1:handEnvido(originals.player1||[],room.muestra),player2:handEnvido(originals.player2||[],room.muestra)};
    const {liars,winner}=envidoAuditResult(room,truth);
    for(const player of liars.length?liars:[winner]){
      if(originals[player]?.length!==3)continue;
      const declared=audit.reveals?.[player];
      const label=liars.includes(player)?`Mintió: dijo ${declared}, tenía ${truth[player]} tantos`:`Envido · ${truth[player]} tantos`;
      groups.push({player,label,cards:envidoEvidenceCards(originals[player],room.muestra),envidoAward:{player:winner,points:Math.min(Number(audit.stake),Math.max(0,targetPoints(room)-Number(room.scores?.[winner]||0))),liars,penalty:liars.length?((room.players?.[liars[0]]?.name||'El jugador')+' mintió'+(liars.length>1?' primero':'')+'.\n'+(room.players?.[winner]?.name||'El rival')+' gana el envido y los puntos de la mano.'):''}});
    }
  }
  return groups;
}
async function finishLiveHand(winner,scores,message){
  scores=capScores(state.room,scores);
  const current=state.room;
  const snapshot=await state.firebase.get(state.firebase.ref(state.firebase.db,`hands/${state.roomCode}/${current.table.uid}/originalHands`));
  const auditResult=envidoAuditResult(current,verifiedHandTruth(current)||{});
  if(auditResult.liars.length)message=`${current.players[auditResult.liars[0]].name} declaró mal${auditResult.liars.length>1?' primero':''}. ${current.players[auditResult.winner].name} gana el envido y la mano.`;
  const groups=buildEndEvidence(current,snapshot.val()||{});
  const summary=current.lastHandScore?.handNumber===current.handNumber&&current.status==='complete'?current.lastHandScore:buildHandSummary(current,scores,message);
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
  const award=room.endReveal.groups.find(group=>group.envidoAward)?.envidoAward;
  const incorrect=!!award?.liars?.length;
  const heading=award&&!incorrect?`<h2 class="end-envido-award">${award.points} ${award.points===1?'punto':'puntos'} para ${escapeHtml(room.players[award.player]?.name||'Jugador')}</h2>`:'';
  const penalty=award?.penalty&&!incorrect?`<div class="end-evidence-penalty">${award.penalty.split(/\n|\. (?=[^ ]+ gana)/).map(text=>`<p>${escapeHtml(text)}</p>`).join('')}</div>`:'';
  el.classList.toggle('multiple-evidence',room.endReveal.groups.length>1);
  el.innerHTML=heading+penalty+room.endReveal.groups.map(group=>`<section class="end-reveal-group"><h3>${escapeHtml((room.players[group.player]?.name||'Jugador')+(award?.liars?.includes(group.player)?' MINTIÓ':''))}<span>${escapeHtml(award?.liars?.includes(group.player)?group.label.replace(/^Mintió: dijo /,'Dijo ').replace(/ tantos$/,''):group.label)}</span></h3><div class="end-reveal-cards">${group.cards.map(card=>`<div class="end-reveal-card sprite-card" style="${cardImageStyle(card)}" role="img" aria-label="${cardAccessibleName(card)}"></div>`).join('')}</div></section>`).join('');
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
          const florists=Object.keys(current.flors||{});
          scores=settleSingleFlor(current,scores);
          scores=await verifyEnvido(scores,winner,points);
          const msg=`${current.players[winner].name} gana la mano y suma ${points} ${points===1?'tanto':'tantos'}.${florists.length===1&&!current.florSettled?' Además cobra 3 por la flor.':''}`;
          await finishLiveHand(winner,scores,msg);
        }else{
          await writeRoom({trickCards:[],resolvingTrick:false,resolutionId:null,resolutionEndsAt:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,trickNo:(Number(current.trickNo)||1)+1,turn:trickWinner||current.mano||'player1',feed:topFeed(current,trickWinner?`${current.players[trickWinner].name} gana la ronda.`:'Ronda parda. Sigue la mano.')});
        }
      }else if(isRedeal&&state.room?.pendingNextHand?.id===room.pendingNextHand.id){
        const pending=state.room.pendingNextHand;
        if(state.room.status!=='complete'){
          let scores=await verifyEnvido(state.room.scores||{},pending.winner,pending.foldPoints||0);
          scores=settleSingleFlor(state.room,scores);
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
  if(room?.mode==='2v2')return room.status==='started'&&!!room.players?.[player]&&!room.folded?.[player]&&!room.resolvingTrick&&!room.pendingNextHand;
  return !!room&&['player1','player2'].includes(player)&&room.status==='started'&&!room.resolvingTrick&&!room.pendingNextHand;
}
function foldHandChanges(room,loser){
  const winner=otherPlayer(loser);
  const unopened=Number(room.playedCount||0)===0&&Number(room.trucoLevel||1)===1&&!room.pendingBet&&!room.envidoClosed&&!room.envidoAudit&&!Object.keys(room.flors||{}).length;
  const winnerCards=state.localOriginalHands?.[winner]||[];
  const earlyFlor=unopened&&room.practiceRules?.flor!==false&&hasFlor(winnerCards,room.muestra);
  const points=unopened?(earlyFlor?4:2):Number(room.trucoLevel)||1;
  const message=(room.players?.[loser]?.name||'El jugador')+' se fue al mazo. '+(room.players?.[winner]?.name||'El rival')+(earlyFlor?' canta FLOR y suma 4 puntos (3 de flor y 1 de la mano).':unopened?' suma 2 puntos por irse al mazo antes de jugar o cantar.':' gana la mano y suma '+points+' '+(points===1?'tanto.':'tantos.'));
  const bet=room.pendingBet,sideChanges=earlyFlor?{flors:{[winner]:florValue(winnerCards,room.muestra)},florSettled:true,envidoClosed:true}:{};
  if(bet&&['envido','flor'].includes(bet.type)){
    const sidePoints=bet.revealMode?Number(bet.stake)||0:bet.type==='flor'?declinedFlorPoints(bet):Number(bet.accepted)||1;
    const scores={...room.scores};
    scores[winner]=(Number(scores[winner])||0)+sidePoints;
    sideChanges.scores=capScores(room,scores);
    sideChanges.envidoClosed=true;
    if(bet.type==='flor')sideChanges.florSettled=true;
  }
  const notice={kind:'fold',id:crypto.randomUUID(),from:loser,to:winner,text:(room.players?.[loser]?.name||'El rival')+' se fue al mazo.',spoken:'Me voy al mazo',time:Date.now(),handNumber:room.handNumber||1};
  if(earlyFlor)Object.assign(notice,{kind:'flor',from:winner,to:loser,text:(room.players?.[winner]?.name||'El rival')+' canta FLOR.',spoken:'Flor',selfVerb:'Cantaste'});
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
    const width=source.offsetWidth||rect.width,height=source.offsetHeight||rect.height;
    flight.classList.remove('dragging','launching-card');flight.classList.add('card-flight','fold-card-flight');
    flight.removeAttribute('data-card');flight.setAttribute('aria-hidden','true');flight.tabIndex=-1;
    Object.assign(flight.style,{left:(rect.left+rect.width/2-width/2)+'px',top:(rect.top+rect.height/2-height/2)+'px',width:width+'px',height:height+'px'});
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
    if(state.room?.managedCredits){await creditCommand({kind:'fold'});return;}
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
function reconcilePendingPlay(){
  const token=state.playActionToken,room=state.room;
  if(!token||token.code!==state.roomCode||!room)return;
  const dealt=room.handNumber!==token.hand;
  const played=room.trickCards?.some(item=>item.playerId===state.playerId&&item.card.id===token.cardId);
  if(dealt||(played&&!state.hand.some(card=>card.id===token.cardId))||room.status==='complete'){
    state.playActionToken=null;state.playActionInFlight=false;state.pendingCardId=null;
  }
}
async function playManagedCard(card){
  if(liveActionsBlocked()||state.liveAction||state.playActionInFlight||state.room.status!=='started'||!state.hand.some(c=>c.id===card.id))return;
  if(state.room.resolvingTrick||state.room.pendingNextHand||state.room.turn!==state.playerId||state.room.pendingBet){shakeTurnBadge();return;}
  const token={code:state.roomCode,hand:state.room.handNumber,cardId:card.id};
  state.playActionToken=token;state.playActionInFlight=true;state.pendingCardId=card.id;syncLiveControls();
  const origin=state.cardLaunchOrigin;state.cardLaunchOrigin=null;
  // Team tables animate the card once, into its own slot, from where it left the hand.
  if(state.room.mode==='2v2'){const source=$('hand').querySelector('[data-card="'+CSS.escape(card.id)+'"]');state.teamPlayOrigin=source?{cardId:card.id,rect:origin?.cardId===card.id?origin.rect:source.getBoundingClientRect()}:null;}
  else animatePlayedHandCard(card,origin);
  try{await creditCommand({kind:'play',cardId:card.id});}
  catch(error){console.error('[truco:play]',error);if(state.roomCode===token.code){removeCardFlight();void refreshLiveConnection();}}
  finally{if(state.playActionToken===token){state.playActionToken=null;state.playActionInFlight=false;state.pendingCardId=null;}if(state.roomCode===token.code){renderGame();syncLiveControls();}}
}
async function playCard(card) {
  if(state.room?.managedCredits){await playManagedCard(card);return;}
  if(liveActionsBlocked())return;
  syncPrivateHand();
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const launchOrigin=state.cardLaunchOrigin;
  state.cardLaunchOrigin=null;
  if (state.localGame) { localPlay(card,launchOrigin); return; }
  if (!state.room || state.room.status!=='started' || !state.hand.some((item)=>item.id===card.id)) return;
  const players=state.room.players||{};
  const other=state.playerId==='player1'?'player2':'player1';
  if (!players[state.playerId] || !players[other]) { toast('Esperando al otro jugador.'); return; }
  const pause=pauseMessage();
  if(pause){renderRoundPauseTimer();shakeTurnBadge();return;}
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
  try{
    if(state.room?.managedCredits){await creditCommand({kind:'play',cardId:card.id});return;}await fb.update(fb.ref(fb.db), patches);}catch(error){removeCardFlight();console.error(error);toast(firebaseError(error));}finally{state.playActionInFlight=false;state.pendingCardId=null;renderGame();syncLiveControls();}
}
function cardImage(card){
  const rank=Number(card.rank);
  const suitGroups={'♦':0,'♥':3,'♠':6,'♣':9};
  const index=rank-1,group=Math.floor(index/4),column=index%4;
  const file=(suitGroups[card.suit]??6)+group+1;
  const imageUrl=new URL(`./assets/cards/${file}.jpg`,document.baseURI).href;
  return {image:`url('${imageUrl}')`,position:`${column/3*100}% 0%`};
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
  if(room?.mode==='2v2')return room.turnClock?.key||null;
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
    let scores=await verifyEnvido({...room.scores},winner,points);
    scores=settleSingleFlor(room,scores);
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
  if(state.room?.managedCredits)return creditCommand({kind:'tick'});
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
  badge.animate?.([{translate:'0 0'},{translate:'-6px 0'},{translate:'6px 0'},{translate:'-5px 0'},{translate:'5px 0'},{translate:'-3px 0'},{translate:'3px 0'},{translate:'0 0'}],{duration:600,easing:'ease-out'});
  badge._shakeTimer=setTimeout(()=>badge.classList.remove('turn-rejected'),600);
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
  for(const player of (room.mode==='2v2'?['player1','player2','player3','player4']:['player1','player2'])){
    const presence=room.connectionPresence?.[player];
    if(presence?.uid!==room.players?.[player]?.uid||Number(presence?.matchNumber)!==Number(room.matchNumber||1)||presence.online!==false||!Number.isFinite(presence.disconnectedAt))continue;
    return {player,presence,seconds:Math.max(0,Math.ceil((presence.disconnectedAt+RECONNECT_GRACE_MS-now)/1000))};
  }
  return null;
}
function stopRoomPresence({offline=true}={}){
  const previous=roomPresenceContext;roomPresenceContext=null;presenceWriteSerial++;
  if(previous){
    const canceled=Promise.resolve(previous.ready).then(()=>previous.disconnect.cancel()).catch(console.error);
    const tasks=[canceled];
    const room=state.room,same=state.roomCode===previous.code&&Number(room?.matchNumber||1)===previous.matchNumber&&room?.createdAt===previous.createdAt;
    if(offline&&same&&['drawing','started','revealing','timed-out'].includes(room.status))tasks.push(canceled.then(()=>{
      if(state.roomCode!==previous.code||Number(state.room?.matchNumber||1)!==previous.matchNumber)return;
      return state.firebase.set(previous.ref,{uid:previous.uid,matchNumber:previous.matchNumber,session:previous.session,online:false,disconnectedAt:state.firebase.serverTimestamp()});
    }).catch(console.error));
    return Promise.all(tasks);
  }
  return Promise.resolve();
}
async function syncRoomPresence(){
  // The table server tracks presence from the open socket itself.
  if(state.room?.managedCredits)return;
  if(state.localGame||!state.firebase||!state.room||!roomSeats().includes(state.playerId)||state.firebaseConnected!==true)return;
  const room=state.room,code=state.roomCode,player=state.playerId,uid=state.uid,matchNumber=Number(room.matchNumber||1);
  if(!['drawing','started','revealing','timed-out'].includes(room.status)){if(roomPresenceContext)await stopRoomPresence({offline:false});return;}
  if(room.players?.[player]?.uid!==uid)return;
  const key=[code,room.createdAt,matchNumber,player,uid].join(':');
  if(roomPresenceContext?.key===key)return;
  const stopped=stopRoomPresence({offline:false});
  const fb=state.firebase,ref=fb.ref(fb.db,'rooms/'+code+'/public/connectionPresence/'+player),disconnect=fb.onDisconnect(ref);
  const serial=++presenceWriteSerial,session=crypto.randomUUID(),context={key,ref,disconnect,uid,matchNumber,session,code,createdAt:room.createdAt};
  roomPresenceContext=context;
  context.ready=(async()=>{try{
    await stopped;
    if(serial!==presenceWriteSerial||state.firebaseConnected!==true||state.roomCode!==code)return;
    await disconnect.set({uid,matchNumber,session,online:false,disconnectedAt:fb.serverTimestamp()});
    if(serial!==presenceWriteSerial||state.firebaseConnected!==true||state.roomCode!==code)return;
    await fb.set(ref,{uid,matchNumber,session,online:true});
  }catch(error){
    if(serial===presenceWriteSerial&&state.roomCode===code)console.error('[truco:presence]',error);
    if(roomPresenceContext===context)roomPresenceContext=null;
  }})();await context.ready;
}
function disconnectMatchChanges(room,loser){
  const winner=otherPlayer(loser),message=(room.players?.[loser]?.name||'El rival')+' no volvió a conectarse y pierde la partida.';
  return {status:'complete',scores:capScores(room,{...room.scores,[winner]:targetPoints(room)}),
    matchResult:{winner,loser,reason:'disconnect',message},turn:null,turnClock:null,turnTimeout:null,
    pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionId:null,resolutionEndsAt:null,
    handComplete:false,trickCards:[],envidoAudit:null,endReveal:{done:true},feed:topFeed(room,message)};
}
async function expireDisconnectedPlayer(info){
  if(state.room?.managedCredits)return creditCommand({kind:'tick'});
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
  el.classList.toggle('hidden',!visible||!key);
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
      if(!room.managedCredits&&(isCoordinator()||['player1','player2'].includes(state.playerId))){
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

function finishRoomPreparation(){
  if(!state.preparingRoom||state.preparingRoom!==state.roomCode||state.room?.status==='waiting')return;
  if(state.room?.status==='started'&&!privateHandMatchesRoom(state.privateDeal,state.room))return;
  const code=state.roomCode;
  requestAnimationFrame(()=>{
    if(state.roomCode!==code||state.preparingRoom!==code)return;
    positionMobileTable();
    positionDealerDeck($,state.room.dealer||(state.room.mode==='2v2'?'player4':otherPlayer(state.room.mano||'player1')),state.playerId,state.room.mode==='2v2',[state.roomCode,state.room.matchNumber,state.room.handNumber].join(':'));
    requestAnimationFrame(()=>{if(state.roomCode!==code||state.preparingRoom!==code)return;state.preparingRoom=null;state.joinIntent=null;$('game-view').classList.remove('table-preparing');});
  });
}
function renderGame() {
  if (!state.room||state.botActing) return;
  $('game-view').classList.toggle('team-mode',state.room.mode==='2v2');
  // Team tables count down their pauses (tricks, shown flowers and envidos) like 1v1.
  if(state.room.mode==='2v2'){syncPrivateHand();syncMatchChat();renderCallNotice();teamTable.render();renderTurnTimer();renderRoundPauseTimer();placeMyFlor();finishRoomPreparation();return;}
  $('opponent-hand').classList.remove('hidden');
  $('team-seats')?.remove();
  syncMatchChat();
  renderLearning();
  scheduleBot();
  renderMatchEnd();
  syncPrivateHand();
  if(state.localGame&&state.room.status==='complete'&&!state.room.endReveal){
    const groups=buildEndEvidence(state.room,state.localOriginalHands||{});
    if(groups.length)localShowEvidence(groups);
  }
  $('game-sheet').classList.toggle('hidden',!state.learning);
  syncMobileGameHeader();
  renderCallNotice();
  renderTurnTimer();
  const room = state.room, players=room.players||{}, mine=players[state.playerId], opponent=players[state.playerId==='player1'?'player2':'player1'];
  document.documentElement.style.setProperty('--tally-board-height',`${50+(targetPoints(room)/10*42+12)*2}px`);
  const compactTallyHeight=Math.max(76,20+(targetPoints(room)/10)*56);
  document.documentElement.style.setProperty('--compact-tally-height',compactTallyHeight+'px');
  $('game-view').classList.toggle('reveal-mode',room.status==='revealing');
  $('game-view').classList.toggle('player-mode', true);
  const sharedTable = true;
  renderEndEvidence(room,sharedTable);
  renderRoundPauseTimer();
  placeMyFlor();
  $('game-view').classList.toggle('two-device-mode', true);
  const mobileMarker=document.querySelector('.mobile-score'),felt=$('felt-area');
  if(mobileMarker.parentElement!==felt)felt.append(mobileMarker);
  const drawing=room.status==='drawing';
  $('game-view').classList.toggle('drawing-mode',drawing);
  $('game-home').setAttribute('aria-label','Abandonar la partida');
  mobileMarker.classList.toggle('hidden',drawing);
  $('opening-draw').classList.toggle('hidden',!drawing);
  if(drawing){
    $('opening-draw').classList.add('hidden');
    if(isCoordinator())finishOpeningDraw().catch(error=>toast(firebaseError(error)));
    return;
  }
  clearTimeout(openingTimerHandle);openingTimerHandle=null;
  $('tally-1').innerHTML=renderTally(room.scores?.player1||0,targetPoints(room));$('tally-2').innerHTML=renderTally(room.scores?.player2||0,targetPoints(room));
  const tallyRenderer=renderCompactTally;
  const leftPlayer=state.playerId,rightPlayer=otherPlayer(leftPlayer);
  $('mobile-tally-1').innerHTML=tallyRenderer(room.scores?.[leftPlayer]||0,targetPoints(room));$('mobile-tally-2').innerHTML=tallyRenderer(room.scores?.[rightPlayer]||0,targetPoints(room));
  $('deck-count').textContent=room.deckCount??40;
  $('game-room-code').textContent=state.learning?'PRÁCTICA':state.bot?'CONTRA BOT · '+botLevelLabel(state.botDifficulty).toUpperCase():'MESA ABIERTA';
  $('my-name').textContent=(mine?.name||'Vos'); $('my-avatar').textContent=((mine?.name||'V')).slice(0,1).toUpperCase();
  $('opponent-name').textContent=(opponent?.name||'Esperando rival'); $('opponent-avatar').textContent=((opponent?.name||'J').slice(0,1)).toUpperCase();
  const myTurn=room.turn===state.playerId&&room.status==='started'&&!room.resolvingTrick&&state.hand.length>0&&!room.pendingBet&&!room.pendingNextHand;
  setTurnBadge(myTurn?'TU TURNO':'ESPERÁ'); $('turn-badge').classList.toggle('waiting-turn',!myTurn);
  const visibleHand=orderedHand();
  if(!state.handGestureActive)renderPlayerHand(visibleHand,myTurn);
  animateFoldedHand();

  $('game-view').dataset.deckSide=(room.dealer||otherPlayer(room.mano||'player1'))===state.playerId?'right':'left';
  renderPlayedCards(room);
  renderOpponentHand(room);
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
  positionDealerDeck($,room.dealer||otherPlayer(room.mano||'player1'),state.playerId);
  const visibleFeed=(room.feed||[]).filter(({text=''})=>!/\bjug[oó]/i.test(text));
  $('round-feed').innerHTML=visibleFeed.slice(0,7).map(({text})=>`<div class="feed-item"><i></i><span>${escapeHtml(text)}</span></div>`).join('');
  $('fold-hand').classList.remove('hidden');
  $('fold-hand').disabled=state.foldInFlight||state.playActionInFlight||!canFoldHand(room,state.playerId);
  const actions=$('player-actions');actions.classList.toggle('hidden',room.status==='complete');
  const pending=room.pendingBet, other=state.playerId==='player1'?'player2':'player1';
  const canEnvido=canCallFirstRoundEnvido(room,state.playerId,state.hand);
  const mustDeclareFlor=pending?.type==='envido'&&pending.responder===state.playerId&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId];
  let buttons=[];
  if(mustDeclareFlor){buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');}
  else if(pending?.revealMode){buttons.push('<span class="action-wait">'+(pending.revealTurn===state.playerId?'Deslizá para elegir tus tantos':'Esperando los tantos del rival…')+'</span>');}
  else if(pending?.type==='flor'){if(pending.responder===state.playerId)buttons.push(...florAnswers(pending,roomHasFlor(room,state.hand)).map(([action,label])=>`<button class="${action==='yes'?'call-button':'pass-button'}" data-action="${action}">${label}</button>`));else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else if(pending){if(pending.responder===state.playerId){if(['envido','truco'].includes(pending.type)&&state.hand.length===3&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');if(pending.type==='truco'&&canEnvido)buttons.push('<button class="pass-button" data-action="envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="real"><strong>REAL ENVIDO</strong></button><button class="pass-button" data-action="falta"><strong>FALTA ENVIDO</strong></button>');if(canRaiseEnvido(pending)&&!Object.keys(room.flors||{}).length){buttons.push('<div class="envido-action-grid"><div class="envido-action-row envido-raises"><button class="pass-button" data-action="raise-envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="raise-real"><strong>REAL ENVIDO</strong></button><button class="pass-button" data-action="raise-falta"><strong>FALTA ENVIDO</strong></button></div><div class="envido-action-row envido-answer"><button class="call-button" data-action="yes">QUIERO</button><button class="pass-button" data-action="no">NO QUIERO</button></div></div>');}else{buttons.push(`${pending.type==='flor'?florAnswers(pending,roomHasFlor(room,state.hand)).map(([action,label])=>`<button class="${action==='yes'?'call-button':'pass-button'}" data-action="${action}">${label}</button>`).join(''):'<button class="call-button" data-action="yes">QUIERO</button><button class="pass-button" data-action="no">NO QUIERO</button>'}`);}if(pending.type==='truco'&&pending.stake<4)buttons.push(`<button class="pass-button" data-action="raise">${pending.stake===2?'RETRUCO':'VALE 4'}</button>`);}else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else {
    if(state.hand.length===3&&roomHasFlor(room,state.hand)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor"><strong>FLOR</strong></button>');
    if(canEnvido)buttons.push('<button class="pass-button" data-action="envido"><strong>ENVIDO</strong></button><button class="pass-button" data-action="real"><strong>REAL</strong></button><button class="pass-button" data-action="falta"><strong>FALTA</strong></button>');
    if(room.status==='started'&&state.hand.length&&!room.resolvingTrick&&!room.pendingNextHand){
    const level=Number(room.trucoLevel)||1;if(level<4&&(level===1||room.lastTrucoCaller!==state.playerId))buttons.push(`<button class="call-button" data-action="${level===1?'truco':level===2?'retruco':'vale4'}"><strong>${level===1?'TRUCO':level===2?'RETRUCO':'VALE 4'}</strong></button>`);
    }else if(!buttons.length)buttons.push('<span class="action-wait">ESPERÁ TU TURNO</span>');
  }
  const foldButton=$('fold-hand');
  if(foldButton.parentElement===actions)actions.parentElement.append(foldButton);
  const canAct=room.status==='started'&&!room.resolvingTrick&&!room.pendingNextHand;
  const myActionTurn=pending?(pending.revealMode?pending.revealTurn===state.playerId:pending.responder===state.playerId):room.turn===state.playerId;
  const availableButtons=canAct&&myActionTurn?buttons.filter(button=>button.includes('data-action=')):[];
  actions.innerHTML=availableButtons.length?'<div class="action-buttons compact-actions">'+availableButtons.join('')+'</div>':'';
  const actionContainer=actions.querySelector('.compact-actions');
  if(actionContainer&&pending?.responder===state.playerId){
    const actionButtons=[...actionContainer.querySelectorAll('[data-action]')];
    const answers=actionButtons.filter(button=>['yes','no'].includes(button.dataset.action));
    if(answers.length){
      const options=document.createElement('div');options.className='bet-options-row';
      const response=document.createElement('div');response.className='bet-answers-row';
      for(const button of actionButtons)(answers.includes(button)?response:options).append(button);
      actionContainer.replaceChildren(...(options.children.length?[options]:[]),response);
    }
  }
  foldButton.classList.toggle('hidden',!!state.learning?.complete);
  renderEnvidoPicker(room);
  alignHandWithControls();
  actions.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>runLiveAction(button,()=>{const act=button.dataset.action;if(state.localGame)return localAction(act);if(['yes','no','raise'].includes(act)||act.startsWith('raise-'))return answerBet(act);if(act==='reveal')return revealEnvido();if(act==='flor')return callFlor();return callBet(act);})));
  setTurnBadge(roundPauseInfo(room)?'ESPERÁ':pending?(pending.responder===state.playerId?'RESPONDÉ':'ESPERANDO'):myTurn?'TU TURNO':'ESPERÁ');$('turn-badge').classList.toggle('waiting-turn',!myTurn||!!pending);
  renderMatchEnd();syncLiveControls();finishRoomPreparation();
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
    scores:{player1:0,player2:0},handNumber:1,deckCount:40,trickNo:1,playedCount:0,trucoLevel:1,lastTrucoCaller:null,pendingBet:null,flors:{},florCompared:false,florSettled:false,envidoClosed:false,timeoutCounts:{},turnClock:null,trickCards:[],tricks:[],
    openingDraw:newOpeningDraw(),feed:topFeed({feed:[]},'Revancha. Elegí una carta para sortear quién reparte.')
  };
}
function rematchChanges(room,player,action,id){
  if(!matchFinished(room)||!room.players?.[player]||room.matchResult?.reason==='abandon')return null;
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
  if(state.room?.mode==='2v2'){await creditCommand({kind:'rematch',value:action});return;}
  if(state.room?.matchResult?.reason==='abandon')return;
  if(liveActionsBlocked())return;
  if(rematchInFlight||!['player1','player2'].includes(state.playerId))return;
  rematchInFlight=true;
  const code=state.roomCode,player=state.playerId,matchNumber=Number(state.room?.matchNumber||1);
  const id=action==='request'?crypto.randomUUID():state.room?.rematch?.id;
  try{
    if(state.room?.managedCredits){await creditCommand({kind:'rematch',value:action});return;}
    if(state.localGame){
      const changes=rematchChanges(state.room,player,action,id);
      if(changes){
        if(changes.status==='drawing'){
          clearTimeout(state.botTimer);state.botTimer=null;state.botTimerKey=null;state.botTimerRoom=null;state.botMemory=null;
          clearTimeout(state.resolutionTimer);state.resolutionTimer=null;state.resolutionTimerKey=null;
          state.playActionInFlight=false;state.foldInFlight=false;state.pendingCardId=null;state.launchingCardId=null;
          state.dismissedMatchEnd=null;state.focusedMatchEnd=null;state.handGestureActive=false;state.handOrder=[];
          state.room=changes;state.hand=[];
          const deck=shuffleDeck();state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};
          state.localOriginalHands=structuredClone(state.localHands);
          state.localTruth={player1:handEnvido(state.localHands.player1,deck[6]),player2:handEnvido(state.localHands.player2,deck[6])};
          state.room.muestra=deck[6];state.room.status='started';state.room.dealer='player2';state.room.mano='player1';state.room.turn='player1';state.room.deckCount=33;state.room.openingDraw=null;state.hand=[...state.localHands[player]];state.finalEvidenceKey=null;state.verifiedEnvido=null;
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
function syncRematchCreditControls(){
  const insufficient=!!state.room?.managedCredits&&((credits.wallet()?.balance??0)<state.room.creditMatch.stake||(credits.wallet()?.locked??0)>0);
  for(const [id,label] of [['request-rematch','Revancha'],['accept-rematch','Aceptar']]){
    $(id).textContent=insufficient?'Créditos insuficientes':label;
    if(insufficient)$(id).disabled=true;
  }
}
function renderMatchEnd(){
  if(state.room?.mode==='2v2'){teamTable.renderEnd();return;}
  const panel=$('match-end'),room=state.room,winner=room&&matchWinner(room);
  const visible=!state.learning&&matchFinished(room)&&!!winner&&state.dismissedMatchEnd!==matchEndKey(room);
  panel.classList.toggle('hidden',!visible);
  if(!visible)return;
  const name=room.players?.[winner]?.name||'Jugador';
  $('match-end-title').textContent='Ganó '+name;
  const wins=sessionWins(room),totalMatches=wins.player1+wins.player2;
  const sessionScore=$('match-session-score');
  sessionScore.textContent=totalMatches>=2?'Ganadas: '+(room.players?.player1?.name||'Jugador 1')+' '+wins.player1+' – '+wins.player2+' '+(room.players?.player2?.name||'Jugador 2'):'';
  sessionScore.classList.toggle('hidden',totalMatches<2);
  $('match-end-score').innerHTML=['player1','player2'].map(player=>`<div class="${player===winner?'match-score-winner':''}"><strong>${capScores(room,room.scores)[player]||0}</strong><span>${escapeHtml(room.players?.[player]?.name||'Jugador')}</span></div>`).join('<b aria-hidden="true">–</b>');
  const request=room.rematch,player=state.playerId,isPlayer=['player1','player2'].includes(player);
  const canRematch=room.matchResult?.reason!=='abandon';
  const pending=canRematch&&request?.status==='pending',incoming=pending&&request.requester!==player;
  $('match-end-message').textContent=pending?(incoming?(room.players?.[request.requester]?.name||'Tu rival')+' quiere jugar la revancha.':'Revancha enviada. Esperando al rival…'):request?.status==='declined'?'La revancha no fue aceptada.':room.matchResult?.reason==='inactivity'?'Victoria por inactividad.':room.matchResult?.reason==='disconnect'?'Victoria por desconexión.':room.matchResult?.reason==='abandon'?'El rival abandonó la partida.':'Partida terminada';

  $('request-rematch').classList.toggle('hidden',!isPlayer||!canRematch||pending);
  $('accept-rematch').classList.toggle('hidden',!isPlayer||!canRematch||!incoming);
  $('decline-rematch').classList.toggle('hidden',!isPlayer||!canRematch);
  for(const id of ['request-rematch','accept-rematch','decline-rematch'])$(id).disabled=rematchInFlight||liveActionsBlocked();
  syncRematchCreditControls();
  if(state.focusedMatchEnd!==matchEndKey(room)){
    state.focusedMatchEnd=matchEndKey(room);
    (isPlayer&&canRematch?(incoming?$('accept-rematch'):pending?$('close-match-end'):$('request-rematch')):$('close-match-end')).focus({preventScroll:true});
  }
}
function closeFinishedRoomChanges(room,player,uid,matchNumber){
  if(!room||!matchFinished(room)||!['player1','player2'].includes(player)||room.players?.[player]?.uid!==uid||Number(room.matchNumber||1)!==matchNumber)return null;
  return {...room,status:'closed',closedAt:gameTime(),closeReason:'match-left',turn:null,turnClock:null,pendingBet:null,rematch:null};
}
async function closeFinishedRoom(){
  if(rematchInFlight)return;
  const room=state.room,code=state.roomCode,player=state.playerId,uid=state.uid,matchNumber=Number(room?.matchNumber||1);
  if(!matchFinished(room))return;
  if(!roomSeats(room).includes(player)){returnToLobby();return;}
  if(liveActionsBlocked()){toast('Esperá a recuperar la conexión para salir de la mesa.');return;}
  rematchInFlight=true;$('close-match-end').disabled=true;
  try{
    if(state.room?.managedCredits){await creditCommand({kind:'cancel'});return;}
    if(state.localGame){returnToLobby();return;}
    const fb=state.firebase;
    const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),current=>{
      if(current===null)return null;
      const changes=closeFinishedRoomChanges(current,player,uid,matchNumber);
      return changes||undefined;
    },{applyLocally:false});
    if(result.committed&&state.roomCode===code)returnToLobby();
  }catch(error){console.error('[truco:close-finished]',error);toast(firebaseError(error));}
  finally{rematchInFlight=false;$('close-match-end').disabled=false;}
}
$('close-match-end').addEventListener('click',()=>closeFinishedRoom());
$('request-rematch').addEventListener('click',event=>runLiveAction(event.currentTarget,()=>respondRematch('request')));
$('accept-rematch').addEventListener('click',event=>runLiveAction(event.currentTarget,()=>respondRematch('accept')));
$('decline-rematch').addEventListener('click',()=>closeFinishedRoom());
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
    if($('game-view').classList.contains('two-device-mode')){positionMobileTable();positionMobileCallNotice();return;}
    if(state.handGestureActive)return;
    const hand=$('hand'),controls=document.querySelector('.player-controls');
    const cards=hand?.querySelectorAll('.hand-card:not(.launching-card)');
    if(!controls||!cards?.length||!$('game-view').classList.contains('player-mode'))return;
    const left=Math.min(...Array.from(cards,card=>card.getBoundingClientRect().left));
    const offset=Number.parseFloat(hand.style.getPropertyValue('--hand-edge-offset'))||0;
    hand.style.setProperty('--hand-edge-offset',(offset+controls.getBoundingClientRect().left-left)+'px');
  });
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
function envidoPickerMinimum(room,player){
  const opponent=otherPlayer(player),points=room.pendingBet?.reveals?.[opponent];
  return points==null?0:Number(points)+(room.mano===player?0:1);
}
function renderEnvidoPicker(room){
  const el=$('envido-picker'),bet=room.pendingBet,active=bet?.revealMode&&bet.revealTurn===state.playerId;
  el.classList.toggle('hidden',!active);
  $('game-view').classList.toggle('declaring-envido',!!active);
  if(!active){el.stopWheelHint?.();el.dataset.key='';return;}
  const opponentPoints=bet.reveals?.[otherPlayer(state.playerId)],second=opponentPoints!=null,min=envidoPickerMinimum(room,state.playerId);
  const max=bet.type==='flor'?47:37;
  const key=`${max}:${room.handNumber}:${state.playerId}:${opponentPoints??'first'}`;
  if(el.dataset.key===key)return;el.stopWheelHint?.();el.dataset.key=key;const own=bet.type==='flor'?Number(room.flors?.[state.playerId]):NaN;const initial=Number.isFinite(own)&&own>=min?own:Math.min(max,Math.max(20,min));el.dataset.value=String(initial);
  el.innerHTML=`<p>Arrastra los números para seleccionar</p><div class="number-wheel" role="listbox" aria-label="Tantos del 0 al ${max}">${Array.from({length:Math.max(0,max+1-min)},(_,index)=>{const number=min+index;return `<button role="option" aria-selected="${number===min}" ${number<min?'disabled':''} data-number="${number}">${number}</button>`;}).join('')}</div><div class="declaration-buttons">${min<=max?'<button id="declare-points" class="call-button">DECLARAR <span id="selected-points">'+min+'</span></button>':''}${second?'<button id="good-points" class="pass-button">SON BUENAS</button>':''}</div>`;
  // Nothing left to declare: the rival said the maximum, or this flower cannot beat theirs. Only SON BUENAS.
  const cannotBeatFlower=bet.type==='flor'&&second&&Number.isFinite(own)&&own<min;
  el.classList.toggle('only-good',min>max||cannotBeatFlower);
  if(min>max||cannotBeatFlower){el.querySelector('.number-wheel').classList.add('hidden');$('declare-points')?.remove();el.querySelector('p').textContent=min>max?(bet.type==='flor'?'El rival declaró la flor más alta.':'El rival declaró el máximo de tantos.'):'Tu flor no supera la del rival.';$('good-points')?.addEventListener('click',()=>runLiveAction($('good-points'),()=>revealEnvido(true)));return;}
  const wheel=el.querySelector('.number-wheel');
  const step=()=>wheel.querySelector('[data-number]').getBoundingClientRect().width;
  let hintRunning=false,hintFrame=null;
  const select=number=>{el.dataset.value=String(number);el.querySelectorAll('[data-number]').forEach(button=>{const distance=Math.abs(Number(button.dataset.number)-number);button.setAttribute('aria-selected',String(distance===0));button.dataset.distance=String(Math.min(distance,4));});const label=$('selected-points');if(label)label.textContent=number;};
  const syncWheel=()=>{const buttons=[...wheel.querySelectorAll('[data-number]')],center=wheel.getBoundingClientRect().left+wheel.clientWidth/2;let nearest=null,best=Infinity;buttons.forEach(button=>{const rect=button.getBoundingClientRect(),distance=Math.abs((rect.left+rect.width/2)-center);if(distance<best){best=distance;nearest=button;}const steps=distance/step();button.style.opacity=String(steps<.65?1:steps<1.65?.78:steps<2.65?.48:steps<3.65?.25:.1);});if(nearest&&!hintRunning)select(Math.max(Math.min(max,min),Number(nearest.dataset.number)));};
  const stopHint=()=>{
    if(!hintRunning)return;
    hintRunning=false;cancelAnimationFrame(hintFrame);
    wheel.style.scrollSnapType='';wheel.scrollLeft=(initial-min)*step();select(initial);syncWheel();
  };
  el.stopWheelHint=stopHint;
  wheel.addEventListener('pointerdown',stopHint,{once:true,passive:true});
  wheel.addEventListener('touchstart',stopHint,{once:true,passive:true});
  wheel.addEventListener('keydown',stopHint,{once:true});
  enableMouseWheelDrag(wheel,stopHint,syncWheel);
  wheel.addEventListener('scroll',syncWheel,{passive:true});
  wheel.querySelectorAll('[data-number]').forEach(button=>button.addEventListener('click',()=>{stopHint();select(Number(button.dataset.number));wheel.scrollTo({left:(Number(button.dataset.number)-min)*step(),behavior:'smooth'});}));
  wheel.scrollLeft=(initial-min)*step();select(initial);requestAnimationFrame(syncWheel);
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    hintRunning=true;wheel.style.scrollSnapType='none';
    let started=null;
    const animate=now=>{
      if(!hintRunning)return;
      if(!active||el.dataset.key!==key){stopHint();return;}
      started??=now;
      const progress=Math.min(1,(now-started)/2400);
      wheel.scrollLeft=Math.max(0,initial-min+2*Math.sin(progress*2*Math.PI))*step();syncWheel();
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
  document.querySelectorAll('[data-table-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tableMode===(enabled?'bot':$('table-mode').value))));
  $('bot-levels').classList.toggle('hidden',!enabled);
  $('credit-table-settings').classList.toggle('hidden',enabled);
  $('enter-room').textContent=enabled?'Jugar contra Bot':'Crear mesa';
  $('table-stake-available').textContent=String(credits.wallet()?.balance??'—');
  updateStakeControl();
}
function stopBot(){clearTimeout(state.learning?.transition?.timer);$('learning-hint')?.close();state.learning=null;$('learning-toolbar')?.classList.add('hidden');$('game-view').classList.remove('learning-mode');clearTimeout(state.botTimer);state.botTimer=null;state.bot=false;state.botMemory=null;}
async function startBotGame(name){
  if(!await startLocalBotGame())return;
  state.bot=true;state.botDifficulty=$('bot-level').value;
  state.roomCode='BOT1';state.room.targetPoints=Number($('target-points').value);
  state.room.players={player1:{name},player2:{name:'Bot'}};
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
// The rival's unplayed cards that fit what the table showed: the cards it played, the envido it
// declared (or its son buenas), and a flor it sang or declared. A rival that played without singing
// flor most likely has none. Only public information is used, never the rival's hidden cards.
function botRivalHands(room,count,unseen){
  const muestra=room.muestra,shown=[...(room.tricks||[]).flatMap(trick=>trick.played||[]),...(room.trickCards||[])].filter(item=>item.playerId==='player1').map(item=>item.card);
  if(!muestra||!count||shown.length+count!==3)return null;
  const bet=room.pendingBet,audit=room.envidoAudit,reveals=audit?.reveals||(bet?.type==='envido'?bet.reveals:null)||{};
  const said=Number.isInteger(reveals.player1)?reveals.player1:null;
  const passed=said==null&&!!audit&&Number.isInteger(reveals.player2)?reveals.player2:null;
  const sangFlor=room.flors?.player1!=null;
  const florSaid=bet?.type==='flor'&&Number.isInteger(bet.reveals?.player1)?bet.reveals.player1:sangFlor&&room.florCompared?Number(room.flors.player1):null;
  const quietFlor=room.practiceRules?.flor!==false&&!sangFlor&&shown.length>0;
  if(said==null&&passed==null&&!sangFlor&&!quietFlor)return null;
  const fits=[],weights=[];
  const visit=(start,combo)=>{
    if(combo.length===count){
      const full=[...shown,...combo],flower=hasFlor(full,muestra);
      if(said!=null&&(flower||handEnvido(full,muestra)!==said))return;
      if(passed!=null&&handEnvido(full,muestra)>passed)return;
      if(sangFlor&&!flower)return;
      if(florSaid!=null&&florValue(full,muestra)!==florSaid)return;
      fits.push(combo);weights.push(quietFlor&&flower?0.15:1);return;
    }
    for(let i=start;i<unseen.length;i++)visit(i+1,[...combo,unseen[i]]);
  };
  visit(0,[]);
  if(!fits.length)return null;
  const total=weights.reduce((sum,weight)=>sum+weight,0);
  return random=>{let pick=random()*total;for(let i=0;i<fits.length;i++){pick-=weights[i];if(pick<0)return fits[i];}return fits.at(-1);};
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
  // The hard bot reasons from what the rival declared and played; the others guess blindly.
  const rivalHand=level==='hard'?botRivalHands(room,count,unseen):null;
  let wins=0;
  for(let sample=0;sample<samples;sample++){
    const pool=[...unseen],rival=rivalHand?[...rivalHand(random)]:[];
    if(!rivalHand)for(let i=0;i<count&&pool.length;i++)rival.push(pool.splice(Math.min(pool.length-1,Math.floor(random()*pool.length)),1)[0]);
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
    // Flower declarations use the flower's points; the bot only says son buenas when it does not beat the mano.
    if(bet.type==='flor'){const value=Number(room.flors?.[me])||0;return {kind:'reveal',value,good:room.mano!==me&&value<=Number(bet.reveals?.[room.mano])};}
    return {kind:'reveal',value:tantos,good:room.mano!==me&&tantos<Number(bet.reveals?.[room.mano])};
  }
  if(bet&&bet.responder!==me)return null;
  // Flor is sung on the bot's own turn before its first card, or as it answers a call; never during the rival's turn.
  if((bet||room.turn===me)&&hand.length===3&&flower&&room.flors?.[me]==null)return {kind:'action',value:'flor'};
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
    room.status==='started'&&(room.pendingBet?(room.pendingBet.revealMode?room.pendingBet.revealTurn==='player2':room.pendingBet.responder==='player2'):room.turn==='player2');
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
  state.localHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};state.localOriginalHands=structuredClone(state.localHands);state.hand=[...state.localHands[role]];
  state.room={deviceMode,status:'started',targetPoints:30,muestra:deck[6],table:{name:'La mesa'},players:{player1:{name:cleanName($('player-name').value,'Jugador')},player2:{name:'Bot'}},scores:{player1:0,player2:0},handNumber:1,deckCount:34,turn:'player1',mano:'player1',trickNo:1,trickCards:[],tricks:[],feed:[],playedCount:0,trucoLevel:1,lastTrucoCaller:null,pendingBet:null,flors:{},envidoClosed:false};
  state.room.dealer='player2';state.room.openingDraw=null;
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
// declared: the winner of the declarations, when the players already declared their flowers.
function localResolveFlor(bet,declared=null){
  const values=state.room.flors||{};if(values.player1==null||values.player2==null)return;
  const winner=declared||(values.player1===values.player2?(state.room.mano||'player1'):(values.player1>values.player2?'player1':'player2'));
  localScore(winner,bet.stake||3,`gana las flores (${values.player1} a ${values.player2})`);
  state.room.florCompared=bet.called==='conflor'||bet.called==='falta';state.room.pendingBet=bet.suspendedBet||null;state.room.envidoClosed=true;state.room.florSettled=true;
}
function localCallAction(kind){
  if(state.learning?.paused)return;
  const room=state.room,caller=state.playerId;if(!room||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||!localHand(caller).length)return;
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
    if(!canRaiseEnvido(bet))return;
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
  if(bet.type==='flor'){
    // Two flowers in play: the mano declares first, then the other one beats it or says son buenas.
    // "La mía es flor": play goes on and the higher flower takes the stake when the hand ends.
    if(room.flors?.player1!=null&&room.flors?.player2!=null&&bet.called==='flor'){room.florDeferred=bet.stake||3;room.pendingBet=bet.suspendedBet||null;room.envidoClosed=true;localFeed(`${room.players[player].name} responde: la mía es flor.`);renderGame();return;}
    if(room.flors?.player1!=null&&room.flors?.player2!=null){room.pendingBet={...bet,reveals:{},revealMode:true,revealTurn:room.mano};localFeed(`${room.players[player].name} quiere. Declara primero ${room.players[room.mano].name}.`);renderGame();return;}
    localFeed(`${room.players[player].name} quiere.`);localResolveFlor(bet);renderGame();return;
  }
  room.trucoLevel=bet.stake;room.pendingBet=null;localFeed(`${room.players[player].name} dice QUIERO`);renderGame();
}
function localAction(action){
  if(state.learning?.paused)return;
  if(action==='reveal')localAnswerAction('yes');
  else if(action==='flor'){
    const room=state.room,player=state.playerId;if(localHand(player).length!==3||room.flors?.[player]!=null||!roomHasFlor(room,localHand(player))){toast('No tenés flor.');return;}
    const overEnvido=room.pendingBet?.type==='envido'&&room.pendingBet.responder===player;
    const other=otherPlayer(player);room.flors={...(room.flors||{}),[player]:florValue(localHand(player),room.muestra)};room.envidoClosed=true;
    const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
    room.pendingBet={type:'flor',called:'flor',single:!room.flors[other],caller:player,responder:other,stake:3,accepted:0,suspendedBet};
    queueLearningAction('flor');localFeed(`${room.players[player].name} canta flor.`);
    // A rival without a flower has nothing to answer: the flower scores now, the call shows for 3 s and play goes on.
    if(room.flors[other]==null&&!roomHasFlor(room,localHand(other))){
      room.florSettled=true;room.pendingBet=suspendedBet;
      if(room.callNotice)room.callNotice={...room.callNotice,duration:3000};
      localScore(player,3,overEnvido?'gana la flor; se cancela el envido':'gana la flor');
    }
    renderGame();
  } else if(['yes','no','raise'].includes(action)||action.startsWith('raise-'))localAnswerAction(action);
  else localCallAction(action);
}
function localPlay(card,launchOrigin=null) {
  if(state.learning?.paused)return;
  if(state.room?.turnClock?.key===turnClockKey()&&turnClockRemaining(state.room.turnClock).expired){renderTurnTimer();return;}
  const player=state.playerId;
  const pause=pauseMessage();if(pause){renderRoundPauseTimer();shakeTurnBadge();return;}
  if(state.room.status!=='started')return;
  if(state.room.pendingBet){shakeTurnBadge();return;}
  if(state.room.turn!==player){shakeTurnBadge();return;}
  if(state.learning){state.room.callNotice=null;receivedCallNotices.delete(`${state.roomCode}:player1`);receivedCallNotices.delete(`${state.roomCode}:player2`);}
  animatePlayedHandCard(card,launchOrigin);
  state.localHands[player]=(state.localHands[player]||[]).filter((item)=>item.id!==card.id);state.hand=[...state.localHands[player]];state.room.playedCount=(state.room.playedCount||0)+1;
  state.room.trickCards=[...(state.room.trickCards||[]),{playerId:player,name:state.room.players[player].name,card}];state.room.deckCount--;
  if(state.room.trickCards.length===2){
    const first=state.room.trickCards[0],second=state.room.trickCards[1],winner=cardStrength(first.card,state.room.muestra)===cardStrength(second.card,state.room.muestra)?null:(cardStrength(first.card,state.room.muestra)>cardStrength(second.card,state.room.muestra)?first.playerId:second.playerId);
    state.room.tricks=[...(state.room.tricks||[]),{winner,played:[...state.room.trickCards]}];
    const handWinner=settleHand(state.room.tricks,state.room);
    if(winner)state.room.feed.unshift({text:`${state.room.players[winner].name} se lleva la ronda.`,time:Date.now()});
    state.room.resolvingTrick=true;state.room.resolutionId=crypto.randomUUID();state.room.resolutionEndsAt=gameTime()+(state.learning?PRACTICE_PAUSE_MS:3000);state.room.resolvedTrickWinner=winner;state.room.handComplete=!!handWinner;
    const resolvingRoom=state.room;
    scheduleLocalTransition(resolvingRoom,()=>{if(!state.localGame||state.room!==resolvingRoom)return;state.room.resolvingTrick=false;state.room.resolutionEndsAt=null;state.room.handComplete=false;state.room.trickCards=[];if(handWinner){localFinishHand(handWinner,state.room.trucoLevel||1);return;}else{state.room.turn=winner||state.room.mano;state.room.trickNo++;}state.hand=[...(state.localHands[state.playerId]||[])];renderGame();},state.learning?PRACTICE_PAUSE_MS:3000);
  }else state.room.turn=player==='player1'?'player2':'player1';
  renderGame();
}
function localFinishHand(winner,points,ending='rounds'){
  const room=state.room,before={...room,scores:{...room.scores}},groups=buildEndEvidence(room,state.localOriginalHands||{}),auditResult=envidoAuditResult(room,state.localTruth||{});
  room.scores=settleAuditedHand(room,room.scores,state.localTruth||{},winner,points);room.envidoAudit=null;
  room.scores=capScores(room,settleSingleFlor(room,room.scores));
  const reason=auditResult.liars.length?`${room.players[auditResult.liars[0]].name} declaró mal${auditResult.liars.length>1?' primero':''}. ${room.players[auditResult.winner].name} gana el envido y la mano.`:ending==='falta'?'Falta envido: se verifican los tantos y se asignan los puntos en juego.':ending==='fold'?'Cuando te vas al mazo, el rival gana los puntos que estaban en juego hasta ese momento.':ending==='declined'?`${({1:'Truco',2:'Retruco',3:'Vale cuatro'}[points]||'Truco')} no querido. Se vuelve a repartir.`:`${room.players[winner].name} gana la mano (${points} puntos).`;
  room.lastHandScore=buildHandSummary(before,room.scores,reason,state.localTruth||{});room.handScoreEntries=[];
  room.handScoreHistory=handScoreHistory(room,room.lastHandScore);
  queueLearningPoints(before,room.scores,room.lastHandScore.entries);
  if(state.learning?.stage===0){state.learning.completedHands=(state.learning.completedHands||0)+1;if(state.learning.completedHands>=3&&!state.learning.hasCalledTruco){state.learning.trucoReminderPending=true;state.learning.trucoReminderAfterHand=room.handNumber;}}
  if(groups.length){localShowEvidence(groups);renderGame();return;}
  localDealAfterHand();
}
function localShowEvidence(groups){
  const room=state.room,delay=state.learning?PRACTICE_PAUSE_MS:5000;
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
  Object.assign(room,{status:'started',resolutionEndsAt:null,resolvingTrick:false,endReveal:null,mano,dealer:otherPlayer(mano),turn:mano,handNumber:room.handNumber+1,tricks:[],trickCards:[],trickNo:1,muestra:deck[6],deckCount:33,playedCount:0,trucoLevel:1,pendingBet:null,lastTrucoCaller:null,flors:{},florCompared:false,florSettled:false,florDeferred:null,envidoClosed:false,callNotice:null});
  state.hand=[...state.localHands[state.playerId]];
  localFeed(`${room.players[room.dealer].name} reparte. Empieza ${room.players[mano].name}.`);renderGame();
}


function opponentCardCount(room,playerId=otherPlayer(state.playerId)){
  if(!room||room.status!=='started')return 0;
  const count=room.handCounts?.[playerId];
  if(Number.isInteger(count)&&count>=0&&count<=3)return count;
  // Only public plays are counted; an opponent's private hand is never read.
  const played=new Set();
  for(const item of [...(room.tricks||[]).flatMap(trick=>trick.played||[]),...(room.trickCards||[])]){
    if(item.playerId===playerId&&item.card?.id)played.add(item.card.id);
  }
  return Math.max(0,3-played.size);
}
// Your sung flor sits just right of your cards, in 1v1 and 2v2 alike.
function placeMyFlor(){
  const flor=$('my-flor'),room=state.room;if(!flor)return;
  const cards=[...$('hand').querySelectorAll('.hand-card')];
  const show=!!room&&room.status==='started'&&room.flors?.[state.playerId]!=null&&cards.length>0&&$('game-view').classList.contains('active');
  flor.classList.toggle('hidden',!show);if(!show)return;
  if(!flor.innerHTML)flor.innerHTML=$('opponent-flor').innerHTML;
  requestAnimationFrame(()=>{
    const rects=[...$('hand').querySelectorAll('.hand-card')].map(card=>card.getBoundingClientRect()).filter(rect=>rect.width);if(!rects.length)return;
    const base=(flor.offsetParent||document.body).getBoundingClientRect();
    flor.style.left=(Math.max(...rects.map(rect=>rect.right))-base.left+4)+'px';
    flor.style.top=((Math.min(...rects.map(rect=>rect.top))+Math.max(...rects.map(rect=>rect.bottom)))/2-base.top)+'px';
  });
}
globalThis.addEventListener?.('resize',()=>placeMyFlor());
function renderOpponentHand(room){
  const hand=$('opponent-hand');if(!hand)return;
  const count=opponentCardCount(room),name=room.players?.[otherPlayer(state.playerId)]?.name||'Tu rival';
  hand.setAttribute('aria-label',`${name}: ${count} ${count===1?'carta':'cartas'} boca abajo`);
  while(hand.children.length>count)hand.lastElementChild.remove();
  while(hand.children.length<count){const card=document.createElement('i');card.className='opponent-card-back';card.setAttribute('aria-hidden','true');hand.append(card);}
  [...hand.children].forEach((card,index)=>{
    card.style.setProperty('--fan-index',index-(count-1)/2);
  });
  // The rival sang flor this hand.
  const flor=$('opponent-flor'),sang=room.flors?.[otherPlayer(state.playerId)]!=null&&room.status==='started';
  flor.classList.toggle('hidden',!sang);flor.setAttribute('aria-label',sang?`${name} cantó flor`:'');
}
function syncMobileGameHeader(){
  const badge=$('turn-badge'),parent=document.querySelector('.game-topbar');
  if(parent&&badge.parentElement!==parent)parent.append(badge);
}
function readMobileTallyPosition(){
  try{const p=JSON.parse(localStorage.getItem('truco-mobile-tally-position'));if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))return {x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};}catch{}
  return null;
}
function mobileTallyCoordinates(position,width,height,markerWidth,markerHeight){
  return {x:6+Math.max(0,Math.min(1,position.x))*Math.max(0,width-markerWidth-12),y:6+Math.max(0,Math.min(1,position.y))*Math.max(0,height-markerHeight-12)};
}
function applyMobileTallyPosition(){
  const marker=document.querySelector('.mobile-score'),felt=$('felt-area');if(!marker||!felt)return;
  marker.classList.toggle('tally-moved',!!mobileTallyPosition);
  if(!mobileTallyPosition)return;
  const bounds=felt.getBoundingClientRect(),rect=marker.getBoundingClientRect();
  const p=mobileTallyCoordinates(mobileTallyPosition,bounds.width,bounds.height,rect.width,rect.height);
  marker.style.setProperty('--tally-user-x',p.x+'px');marker.style.setProperty('--tally-user-y',p.y+'px');
}
function installMobileTallyDrag(marker){
  marker.title='Arrastrá para mover. Tocá para ver el historial de puntos.';
  marker.addEventListener('pointerdown',event=>{
    if(event.button!==0||!event.isPrimary)return;
    const bounds=$('felt-area').getBoundingClientRect(),rect=marker.getBoundingClientRect();
    mobileTallyDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left-bounds.left,top:rect.top-bounds.top,width:rect.width,height:rect.height,prior:mobileTallyPosition,moved:false};
    marker.setPointerCapture(event.pointerId);
  });
  marker.addEventListener('pointermove',event=>{
    const drag=mobileTallyDrag;if(!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)<6)return;
    event.preventDefault();drag.moved=true;marker.classList.add('tally-dragging');
    const bounds=$('felt-area').getBoundingClientRect();
    mobileTallyPosition={x:Math.max(0,Math.min(1,(drag.left+dx-6)/Math.max(1,bounds.width-drag.width-12))),y:Math.max(0,Math.min(1,(drag.top+dy-6)/Math.max(1,bounds.height-drag.height-12)))};
    applyMobileTallyPosition();
  });
  const end=event=>{
    const drag=mobileTallyDrag;if(!drag||drag.id!==event.pointerId)return;
    mobileTallyDrag=null;marker.classList.remove('tally-dragging');
    if(marker.hasPointerCapture(event.pointerId))marker.releasePointerCapture(event.pointerId);
    if(!drag.moved)return;
    tallyIgnoreClickUntil=Date.now()+500;
    if(event.type==='pointercancel')mobileTallyPosition=drag.prior;
    else try{localStorage.setItem('truco-mobile-tally-position',JSON.stringify(mobileTallyPosition));}catch{}
    applyMobileTallyPosition();
  };
  marker.addEventListener('pointerup',end);marker.addEventListener('pointercancel',end);
  marker.addEventListener('lostpointercapture',event=>end({pointerId:event.pointerId,type:'pointercancel'}));
}

function mobileBoardGeometry(width,height){
  const deckHeight=Math.max(60,Math.min(84,height*.13))*1.05;
  const handHeight=Math.max(82,Math.min(166,(height-300)*.4))*1.05;
  const rivalCenter=Math.max(42,Math.min(50,height*.085));
  const playedHeight=deckHeight;
  const handCenter=height-114-handHeight*.56,noticeHeight=height<560?42:50;
  const ownNoticeBottom=handCenter-handHeight*.58-8,rivalNoticeTop=rivalCenter+deckHeight*.6+10;
  // Reserve BOTH message slots permanently, even when no message is visible.
  const minimum=rivalNoticeTop+noticeHeight+5+playedHeight/2;
  const maximum=ownNoticeBottom-noticeHeight-5-playedHeight/2;
  const tableCenter=minimum<=maximum?Math.max(minimum,Math.min(height*.395,maximum)):(minimum+maximum)/2;
  return {deckHeight,deckWidth:deckHeight*58/84,handHeight,handWidth:handHeight*280/435,
    rivalCenter,tableCenter,playedHeight,markerTop:tableCenter+playedHeight/2+28,
    handCenter,noticeHeight,ownNoticeX:width/2,ownNoticeBottom,rivalNoticeTop};
}
function desktopBoardGeometry(width,height){
  const scale=Math.min(1,height/700),deckHeight=Math.min(160,height*.17);
  const handHeight=Math.min(210,height*.25),rivalCenter=deckHeight*.55+12*scale;
  const handCenter=height-100*scale-handHeight*.56,noticeHeight=42*scale;
  const ownNoticeBottom=handCenter-handHeight*.58-8*scale,rivalNoticeTop=rivalCenter+deckHeight*.6+10*scale;
  const minimum=rivalNoticeTop+noticeHeight+5*scale+deckHeight/2;
  const maximum=ownNoticeBottom-noticeHeight-5*scale-deckHeight/2;
  const tableCenter=minimum<=maximum?Math.max(minimum,Math.min(height*.43,maximum)):(minimum+maximum)/2;
  return {deckHeight,deckWidth:deckHeight*58/84,playedHeight:deckHeight,handHeight,handWidth:handHeight*280/435,
    rivalCenter,tableCenter,markerTop:12,handCenter,noticeHeight,ownNoticeX:width/2,ownNoticeBottom,rivalNoticeTop};
}
function positionMobileCallNotice(){
  if(!state.room)return;
  const felt=$('felt-area'),frame=$('game-view').getBoundingClientRect(),bounds=felt.getBoundingClientRect();
  const layout=(matchMedia('(max-width:700px)').matches?mobileBoardGeometry:desktopBoardGeometry)(bounds.width,bounds.height),notice=$('call-notice');
  const own=notice.getAttribute('data-speaker')==='self';
  // The message reads the board's slots; it never moves cards or measures buttons.
  notice.style.setProperty('--call-anchor-x',(own?layout.ownNoticeX:bounds.width/2)+bounds.left-frame.left+'px');
  notice.style.setProperty('--call-anchor-top',(own?layout.ownNoticeBottom:layout.rivalNoticeTop)+bounds.top-frame.top+'px');
  notice.style.setProperty('--call-max-height',layout.noticeHeight+'px');
}
function positionMobileTable(){
  if(!state.room)return;
  const felt=$('felt-area'),bounds=felt.getBoundingClientRect();
  const layout=(matchMedia('(max-width:700px)').matches?mobileBoardGeometry:desktopBoardGeometry)(bounds.width,bounds.height);
  for(const [name,value] of Object.entries(layout))felt.style.setProperty('--board-'+name,value+'px');
  applyMobileTallyPosition();
}
function clearOpponentFlight(key){
  const flight=opponentFlights.get(key);if(!flight)return;
  opponentFlights.delete(key);flight.animation?.cancel();flight.node.remove();flight.target.style.visibility='';
}
function animateOpponentCard(card,playerId,target,key){
  const source=$('opponent-hand')?.lastElementChild;
  if(!source||!source.getBoundingClientRect().width)return;
  const rect=source.getBoundingClientRect(),destination=target.getBoundingClientRect();
  const width=source.offsetWidth,height=source.offsetHeight;
  const transform=getComputedStyle(source).transform,matrix=transform==='none'?null:new DOMMatrixReadOnly(transform);
  const angle=matrix?Math.atan2(matrix.b,matrix.a)*180/Math.PI:0;
  const flight=document.createElement('div');flight.className='opponent-launch-flight';flight.setAttribute('aria-hidden','true');
  Object.assign(flight.style,{left:(rect.left+rect.width/2-width/2)+'px',top:(rect.top+rect.height/2-height/2)+'px',width:width+'px',height:height+'px'});
  const front=createPlayedCard(card,playerId);front.className='sprite-card opponent-flight-face';
  const back=document.createElement('div');back.className='opponent-card-back opponent-flight-face';
  flight.append(front,back);document.body.append(flight);target.style.visibility='hidden';
  const dx=destination.left+destination.width/2-(rect.left+rect.width/2),dy=destination.top+destination.height/2-(rect.top+rect.height/2);
  const landingTransform=getComputedStyle(target).transform,landingMatrix=landingTransform==='none'?null:new DOMMatrixReadOnly(landingTransform);
  const landingAngle=landingMatrix?Math.atan2(landingMatrix.b,landingMatrix.a)*180/Math.PI:0;
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?100:260;
  const animation=flight.animate([{transform:`translate3d(0,0,0) rotate(${angle}deg) scale(1)`},{transform:`translate3d(${dx}px,${dy}px,0) rotate(${landingAngle}deg) scale(${target.offsetWidth/width},${target.offsetHeight/height})`}],{duration,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
  front.animate([{opacity:0},{opacity:1,offset:.3},{opacity:1}],{duration,fill:'forwards'});
  back.animate([{opacity:1},{opacity:0,offset:.3},{opacity:0}],{duration,fill:'forwards'});
  opponentFlights.set(key,{node:flight,target,animation});
  animation.finished.then(()=>{if(opponentFlights.get(key)?.node===flight)clearOpponentFlight(key);}).catch(()=>{});
}

function handFanPose(count,index){
  const middle=(count-1)/2;
  return {angle:(index-middle)*(count===2?15:12),y:count===3?(index===1?-2:7):0};
}
function renderPlayerHand(cards,myTurn){
  const container=$('hand'),visible=cards.filter(card=>card.id!==state.launchingCardId);
  const oldNodes=[...container.children],oldKeys=oldNodes.map(node=>node.dataset.card),keys=visible.map(card=>card.id);
  const changed=oldKeys.join('|')!==keys.join('|')||!!state.handDropPositions;
  const before=state.handDropPositions||new Map();
  state.handDropPositions=null;
  if(changed)for(const node of oldNodes){
    if(!before.has(node.dataset.card))before.set(node.dataset.card,{rect:node.getBoundingClientRect(),transform:getComputedStyle(node).transform});
    node._centerAnimation?.cancel();
  }
  const existing=new Map(oldNodes.map(node=>[node.dataset.card,node]));
  visible.forEach((card,index)=>{
    let node=existing.get(card.id);
    if(!node){node=document.createElement('button');node.type='button';node.dataset.card=card.id;}
    existing.delete(card.id);
    node.className=`hand-card sprite-card ${card.red?'card-red':''} ${state.pendingCardId===card.id?'card-pending':''}`;
    node.setAttribute('aria-label',cardAccessibleName(card));node.setAttribute('aria-disabled',String(!myTurn));
    // Preserve nodes, so repeated snapshots cannot restart the centering animation.
    const image=cardImageStyle(card);if(node._cardImage!==image){node.style.cssText=image;node._cardImage=image;}
    const pose=handFanPose(visible.length,index);
    node.style.setProperty('--hand-fan-angle',pose.angle+'deg');node.style.setProperty('--hand-fan-y',pose.y+'px');
    if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);
  });
  for(const node of existing.values()){node._centerAnimation?.cancel();node.remove();}
  if(!changed||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const node of container.children){
    const prior=before.get(node.dataset.card);if(!prior)continue;
    const finalTransform=getComputedStyle(node).transform;
    node.style.transform=prior.transform;
    const placed=node.getBoundingClientRect();node.style.removeProperty('transform');
    const dx=prior.rect.left-placed.left,dy=prior.rect.top-placed.top;
    node._centerAnimation=node.animate([{transform:`translate(${dx}px,${dy}px) ${prior.transform==='none'?'':prior.transform}`},{transform:finalTransform}],{duration:180,easing:'ease-out'});
    node._centerAnimation.finished.catch(()=>{});
  }
}

let activeCardFlight=null;
function removeCardFlight(){
  const flight=activeCardFlight;
  if(!flight)return;
  activeCardFlight=null;state.launchingCardId=null;
  flight.animation?.cancel();flight.node.remove();
  $('hand').querySelector('[data-card="'+CSS.escape(flight.cardId)+'"]')?.classList.remove('launching-card');
}
function createPlayedCard(card,playerId){
  const node=document.createElement('div');
  node.className=`played-card played-card-${playerId||'player1'} ${playerId===state.playerId?'is-own-play':'is-opponent-play'} sprite-card ${card.red?'card-red':''}`;
  node.style.cssText=cardImageStyle(card);
  node.setAttribute('role','img');node.setAttribute('aria-label',cardAccessibleName(card));
  node.dataset.playedKey=playerId+':'+card.id;
  return node;
}
// Practice: while a round result shows, the winning card is framed and labelled (a tie frames both).
function trickWinnerMark(room,playerId){
  const learning=state.learning;
  if(!learning||learning.whoWins===false||!room?.resolvingTrick||(room.trickCards||[]).length!==2)return {framed:false,label:''};
  const winner=room.resolvedTrickWinner;
  if(!winner)return {framed:true,label:playerId===state.playerId?'Empate':''};
  if(playerId!==winner)return {framed:false,label:''};
  return {framed:true,label:winner===state.playerId?'Ganás vos':'Gana el rival'};
}
function markTrickWinner(room,container){
  if(state.botActing||!state.learning)return;
  for(const node of container.children){
    const {framed,label}=trickWinnerMark(room,node.dataset.playedKey?.split(':')[0]);
    node.classList.toggle('trick-winner',framed);
    let tag=node.querySelector('.trick-winner-label');
    if(!label){tag?.remove();continue;}
    if(tag?.dataset.round!==room.resolutionId){
      tag?.remove();
      // Text, a link to the card guide with both cards, and a bar that runs out with the pause.
      tag=document.createElement('span');tag.className='trick-winner-label';tag.dataset.round=room.resolutionId;
      const text=document.createElement('span'),why=document.createElement('button'),bar=document.createElement('span');
      text.className='trick-winner-text';why.type='button';why.className='trick-winner-why';why.textContent='¿Por qué?';bar.className='trick-winner-timer';
      why.addEventListener('click',event=>{event.stopPropagation();openTrickGuide(room);});
      const left=Math.max(0,(roundPauseInfo(room)?.endsAt??gameTime())-gameTime());
      bar.style.setProperty('--trick-left',left+'ms');
      tag.append(text,why,bar);node.append(tag);
    }
    tag.querySelector('.trick-winner-text').textContent=label;
    tag.classList.toggle('is-paused',!!state.learning.paused);
  }
}
function openTrickGuide(room){
  if(!state.learning||!room.trickCards?.length)return;
  state.learning.activeTutorial={roundCards:structuredClone(room.trickCards),trickGuide:true};
  openStudySheet();
}
function renderPlayedCards(room){
  const container=$('trick-cards'),cards=room.trickCards||[];
  const scope=[state.roomCode,state.playerId,room.matchNumber||1,room.handNumber].join(':');
  const sameHand=opponentPlaySnapshot.scope===scope;
  const publicKeys=new Set(cards.map(({card,playerId})=>playerId+':'+card.id));
  for(const key of opponentFlights.keys())if(!sameHand||room.status!=='started'||!publicKeys.has(key))clearOpponentFlight(key);
  if(activeCardFlight&&(activeCardFlight.room!==state.roomCode||activeCardFlight.hand!==room.handNumber||!['started'].includes(room.status)))removeCardFlight();
  const existing=new Map([...container.children].map(node=>[node.dataset.playedKey,node]));
  for(const {card,playerId} of cards){
    const key=playerId+':'+card.id;
    let node=existing.get(key);
    if(!node){
      node=createPlayedCard(card,playerId);container.append(node);
      if(sameHand&&room.status==='started'&&playerId!==state.playerId&&!opponentPlaySnapshot.keys.has(key))animateOpponentCard(card,playerId,node,key);
    }
    existing.delete(key);
    const flying=activeCardFlight?.cardId===card.id&&activeCardFlight.playerId===playerId;
    if(flying&&activeCardFlight.finished)removeCardFlight();
    node.style.visibility=(flying&&activeCardFlight)||opponentFlights.has(key)?'hidden':'';
  }
  for(const node of existing.values())node.remove();
  markTrickWinner(room,container);
  opponentPlaySnapshot={scope,keys:publicKeys};
}
function animatePlayedHandCard(card,origin=null){
  const source=$('hand').querySelector('[data-card="'+CSS.escape(card.id)+'"]');
  if(!source)return;
  removeCardFlight();
  const rect=origin?.cardId===card.id?origin.rect:source.getBoundingClientRect();
  const width=source.offsetWidth,height=source.offsetHeight;
  const transform=getComputedStyle(source).transform;
  const matrix=transform==='none'?null:new DOMMatrixReadOnly(transform);
  const startAngle=matrix?Math.atan2(matrix.b,matrix.a)*180/Math.PI:0;
  const target=createPlayedCard(card,state.playerId);
  target.style.visibility='hidden';$('trick-cards').append(target);
  const targetRect=target.getBoundingClientRect(),targetWidth=target.offsetWidth,targetHeight=target.offsetHeight;
  const landingTransform=getComputedStyle(target).transform,landingMatrix=landingTransform==='none'?null:new DOMMatrixReadOnly(landingTransform);
  const endAngle=landingMatrix?Math.atan2(landingMatrix.b,landingMatrix.a)*180/Math.PI:0;
  target.remove();
  const flight=createPlayedCard(card,state.playerId);
  flight.className='sprite-card played-card launch-flight';
  Object.assign(flight.style,{left:(rect.left+rect.width/2-width/2)+'px',top:(rect.top+rect.height/2-height/2)+'px',width:width+'px',height:height+'px'});
  flight.setAttribute('aria-hidden','true');
  const dx=targetRect.left+targetRect.width/2-(rect.left+rect.width/2);
  const dy=targetRect.top+targetRect.height/2-(rect.top+rect.height/2);
  state.launchingCardId=card.id;source.classList.add('launching-card');
  document.body.append(flight);
  const context={node:flight,cardId:card.id,playerId:state.playerId,room:state.roomCode,hand:state.room?.handNumber,finished:false};
  activeCardFlight=context;
  context.animation=flight.animate([
    {transform:`translate3d(0,0,0) rotate(${startAngle}deg) scale(1)`},
    {transform:`translate3d(${dx}px,${dy}px,0) rotate(${endAngle}deg) scale(${targetWidth/width},${targetHeight/height})`}
  ],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?100:420,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
  context.animation.finished.then(()=>{
    if(activeCardFlight!==context)return;
    context.finished=true;
    if(state.room)renderPlayedCards(state.room);else removeCardFlight();
  }).catch(()=>{});
  renderPlayerHand(orderedHand(),false);
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
    state.handDropPositions=new Map(handCards().map(node=>[node.dataset.card,{rect:node.getBoundingClientRect(),transform:getComputedStyle(node).transform}]));
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
  if(liveActionsBlocked()||state.liveAction||handGesture||state.playActionInFlight||!card||!state.hand.some(item=>item.id===card.dataset.card))return;
  if(event.button!=null&&event.button!==0)return;
  for(const el of handCards())el._centerAnimation?.cancel();
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
  marker.addEventListener('click',event=>{if(Date.now()<tallyIgnoreClickUntil){event.preventDefault();return;}openScoreDetails();});
  if(marker.classList.contains('mobile-score'))installMobileTallyDrag(marker);
  marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openScoreDetails();}});
});
$('close-score-details').addEventListener('click',()=>$('score-details').close());
$('dismiss-score-details').addEventListener('click',()=>$('score-details').close());
$('score-details').addEventListener('click',event=>{if(event.target===$('score-details'))$('score-details').close();});
$('play-bot').addEventListener('change',updateBotSetup);
$('points-picker-trigger').addEventListener('click',()=>{const menu=$('points-picker-menu'),opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);$('points-picker-trigger').setAttribute('aria-expanded',String(opening));});
$('create-room').addEventListener('click',()=>{warmGameConnection();configureSetup();});
$('open-room-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-room][data-seat]');if(button)joinOpenRoom(button.dataset.room,button.dataset.seat,button.dataset.team);});

$('back-home').addEventListener('click',()=>{showView('welcome-view');openLobby();});
$('fold-hand').addEventListener('click',event=>runLiveAction(event.currentTarget,foldHand));
$('enter-room').addEventListener('click',enterRoom);
$('leave-room').addEventListener('click',async()=>{if(state.pendingCreate&&state.pendingCreate===state.roomCode){state.cancelAfterCreate=state.roomCode;return;}if(state.room?.managedCredits){const waiting=state.room.status==='waiting';if(waiting)state.cancelingWaitingRoom=state.roomCode;try{await creditCommand({kind:'cancel'});if(waiting&&state.cancelingWaitingRoom)returnToLobby();}catch{state.cancelingWaitingRoom=null;return;}return;}stopRoomPresence();stopBot();state.roomWatchVersion=(state.roomWatchVersion||0)+1;state.navigationEpoch=(state.navigationEpoch||0)+1;forgetRoomSeat();if(state.unsubscribe)state.unsubscribe();if(state.privateUnsubscribe)state.privateUnsubscribe();state.privateUnsubscribe=null;state.privateHandKey=null;state.room=null;state.localGame=false;showView('welcome-view');openLobby();});
$('game-home').addEventListener('click',()=>{
  if(!state.room){returnToLobby();return;}
  if(matchFinished(state.room)){closeFinishedRoom();return;}
  pauseLearning();$('abandon-error').textContent='';$('abandon-dialog').showModal();
});
let abandoningMatch=false;
$('abandon-cancel').addEventListener('click',()=>{if(!abandoningMatch)$('abandon-dialog').close();});
$('abandon-dialog').addEventListener('cancel',event=>{if(abandoningMatch)event.preventDefault();});
$('abandon-dialog').addEventListener('close',resumeLearning);
$('abandon-accept').addEventListener('click',async()=>{
  if(abandoningMatch||!state.room)return;
  abandoningMatch=true;$('abandon-accept').disabled=true;$('abandon-cancel').disabled=true;$('abandon-accept').textContent='Saliendo…';
  const code=state.roomCode,player=state.playerId,uid=state.uid,matchNumber=Number(state.room.matchNumber||1);
  try{
    if(state.room.managedCredits)await creditCommand({kind:'abandon'});
    else if(!state.localGame){
      const fb=state.firebase;
      const result=await fb.runTransaction(fb.ref(fb.db,`rooms/${code}/public`),room=>{
        if(room===null)return null;
        if(room.players?.[player]?.uid!==uid||Number(room.matchNumber||1)!==matchNumber||room.status==='closed'||matchFinished(room))return;
        if(room.status==='drawing')return {...room,status:'closed',closedAt:gameTime(),closeReason:'draw-left'};
        const winner=otherPlayer(player),message=(room.players[player].name||'El jugador')+' abandonó la partida.';
        return {...room,status:'complete',scores:{...room.scores,[winner]:targetPoints(room)},matchResult:{winner,loser:player,reason:'abandon',message},endReveal:{done:true},turn:null,turnClock:null,pendingBet:null,pendingNextHand:null,resolvingTrick:false,resolutionEndsAt:null,rematch:null,feed:topFeed(room,message)};
      },{applyLocally:false});
      if(!result.committed)throw new Error('La partida cambió. Volvé a intentarlo.');
    }
    $('abandon-dialog').close();if(state.roomCode===code)returnToLobby();
  }catch(error){
    // The room listener can confirm departure before a delayed callable fails.
    // Do not leave an obsolete error dialog over the already confirmed lobby.
    if(state.roomCode!==code||!state.room||matchFinished(state.room)){
      $('abandon-dialog').close();if(!state.room||state.roomCode===code)returnToLobby();
    }else $('abandon-error').textContent=firebaseError(error);
  }
  finally{abandoningMatch=false;$('abandon-accept').disabled=false;$('abandon-cancel').disabled=false;$('abandon-accept').textContent='Aceptar';}
});
function limitMuestraOffset(x,y){
  const distance=Math.hypot(x,y),scale=distance>10?10/distance:1;
  return {x:x*scale,y:y*scale};
}
function beginMuestraDrag(event){
  const card=$('muestra-card'); if(card.classList.contains('hidden')) return;
  if(event.button!=null&&event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  try{card.setPointerCapture?.(event.pointerId);}catch{}card.classList.add('dragging');
  card._drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,baseX:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dx'))||0,baseY:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dy'))||0};
}
$('muestra-card').addEventListener('pointerdown',beginMuestraDrag);
$('deck-stack').addEventListener('pointerdown',beginMuestraDrag);
$('muestra-card').addEventListener('pointermove',(event)=>{
  const card=$('muestra-card'),drag=card._drag; if(!drag||drag.pointerId!==event.pointerId)return;
  const offset=limitMuestraOffset(drag.baseX+event.clientX-drag.startX,drag.baseY+event.clientY-drag.startY);
  card.style.setProperty('--muestra-dx',`${offset.x}px`);
  card.style.setProperty('--muestra-dy',`${offset.y}px`);
});
const endMuestraDrag=(event)=>{const card=$('muestra-card');if(card._drag?.pointerId===event.pointerId){try{card.releasePointerCapture?.(event.pointerId);}catch{}card._drag=null;card.classList.remove('dragging');}};
$('muestra-card').addEventListener('pointerup',endMuestraDrag);
$('muestra-card').addEventListener('pointercancel',endMuestraDrag);
// Prevent browser zoom without discarding rapid button taps.
for(const type of ['gesturestart','gesturechange','gestureend']){
  document.addEventListener(type,event=>event.preventDefault(),{passive:false});
}
document.addEventListener('dblclick',event=>event.preventDefault());
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
$('chat-quick').addEventListener('click',event=>{const button=event.target.closest('[data-quick-message]');if(!button||button.disabled||chatMuted||peerChatMuted()||liveActionsBlocked())return;touchFeedback(button);sendMatchChat(event,button.dataset.quickMessage);});
// Holding the chat button opens quick messages under it; the one under the finger on release is sent.
const CHAT_HOLD_MS=380,chatHold={timer:null,open:false,pointer:null,suppressClick:false};
document.body.append($('chat-hold-menu'));
function chatHoldTarget(event){return document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-hold-message]')||null;}
function openChatHoldMenu(){
  if(!chatAvailable()||chatMuted||peerChatMuted()||liveActionsBlocked()||matchChat.sending)return;
  const rect=$('chat-toggle').getBoundingClientRect(),menu=$('chat-hold-menu');
  menu.style.top=`${rect.bottom+8}px`;menu.style.right=`${Math.max(8,innerWidth-rect.right)}px`;
  closeMatchChat();menu.classList.remove('hidden');chatHold.open=true;chatHold.suppressClick=true;navigator.vibrate?.(12);
}
function closeChatHoldMenu(){
  clearTimeout(chatHold.timer);chatHold.timer=null;chatHold.open=false;chatHold.pointer=null;
  $('chat-hold-menu').classList.add('hidden');for(const button of $('chat-hold-menu').querySelectorAll('button'))button.classList.remove('active');
}
$('chat-toggle').addEventListener('pointerdown',event=>{
  if(event.button>0)return;
  chatHold.pointer=event.pointerId;chatHold.suppressClick=false;clearTimeout(chatHold.timer);chatHold.timer=setTimeout(openChatHoldMenu,CHAT_HOLD_MS);
});
document.addEventListener('pointermove',event=>{
  if(!chatHold.open||event.pointerId!==chatHold.pointer)return;
  const target=chatHoldTarget(event);for(const button of $('chat-hold-menu').querySelectorAll('button'))button.classList.toggle('active',button===target);
});
document.addEventListener('pointerup',event=>{
  if(event.pointerId!==chatHold.pointer)return;
  const target=chatHold.open&&chatHoldTarget(event);closeChatHoldMenu();
  if(target){touchFeedback(target);sendMatchChat(null,target.dataset.holdMessage);}
});
document.addEventListener('pointercancel',event=>{if(event.pointerId===chatHold.pointer)closeChatHoldMenu();});
$('chat-toggle').addEventListener('contextmenu',event=>event.preventDefault());
$('chat-toggle').addEventListener('click',()=>{if(chatHold.suppressClick){chatHold.suppressClick=false;return;}matchChat.open?closeMatchChat():openMatchChat();});
$('chat-close').addEventListener('click',()=>{closeMatchChat();$('chat-toggle').focus();});
$('chat-backdrop').addEventListener('click',()=>{closeMatchChat();$('chat-toggle').focus();});
$('chat-form').addEventListener('submit',sendMatchChat);
$('chat-input').addEventListener('input',()=>{$('chat-input').value=$('chat-input').value.slice(0,CHAT_LIMIT);$('chat-count').textContent=`${$('chat-input').value.length}/${CHAT_LIMIT}`;});
$('chat-muted').addEventListener('change',()=>{chatMuted=$('chat-muted').checked;if(chatMuted)clearChatNotices();updateChatUnread();renderChatComposer();publishChatMute();});
$('chat-player-blocked')?.addEventListener('change',changeChatPlayerBlock);
$('chat-report-mode')?.addEventListener('click',()=>{setChatReporting(!matchChat.reporting);$('chat-options').open=false;});
$('match-chat').addEventListener('click',event=>{const options=$('chat-options');if(options.open&&!options.contains(event.target))options.open=false;});
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
function hasStartedLearningPractice(){
  if(state.learningPracticeStarted)return true;
  try{return localStorage.getItem('truco-learning-started-v1')==='true';}catch{return false;}
}
function rememberLearningPractice(){
  state.learningPracticeStarted=true;
  try{localStorage.setItem('truco-learning-started-v1','true');}catch{}
}
function renderLearningMenu(){
  const started=hasStartedLearningPractice();
  $('learn-free').classList.toggle('hidden',started);
  $('learn-path-note').classList.toggle('hidden',started);
  $('learn-game-modes').classList.toggle('hidden',!started);
}
function openLearning(){
  state.navigationEpoch=(state.navigationEpoch||0)+1;
  $('learn-coach-dialog').close();
  if(state.learning){stopBot();clearTimeout(state.resolutionTimer);state.room=null;state.localGame=false;}
  renderLearningMenu();showView('learn-view');
  if(!learnVideosSeen())openLearnVideos();
}
const LEARN_VIDEOS=[
  {src:'assets/tutorial/1-baraja.mp4',title:'La baraja'},
  {src:'assets/tutorial/2-reparto.mp4',title:'El reparto'},
  {src:'assets/tutorial/3-puntos.mp4',title:'¿Cómo ganar puntos?'},
  {src:'assets/tutorial/4-ganar-mano.mp4',title:'Ganar una mano'},
  {src:'assets/tutorial/5-valor-cartas.mp4',title:'El valor de las cartas'},
  {src:'assets/tutorial/6-a-practicar.mp4',title:'¡Vamos a practicar!'},
];
let learnVideoIndex=0;
function learnVideosSeen(){try{return localStorage.getItem('truco-learn-videos-seen-v1')==='true';}catch{return true;}}
function showLearnVideo(index){
  learnVideoIndex=Math.max(0,Math.min(LEARN_VIDEOS.length-1,index));
  const video=$('learn-videos-player'),item=LEARN_VIDEOS[learnVideoIndex],last=learnVideoIndex===LEARN_VIDEOS.length-1;
  video.src=item.src;video.setAttribute('aria-label',item.title);video.play?.()?.catch?.(()=>{});
  $('learn-videos-step').textContent=`${learnVideoIndex+1} de ${LEARN_VIDEOS.length} · ${item.title}`;
  $('learn-videos-prev').disabled=learnVideoIndex===0;
  $('learn-videos-next').textContent=last?'Listo':'Siguiente';
}
function openLearnVideos(index=0){
  try{localStorage.setItem('truco-learn-videos-seen-v1','true');}catch{}
  if(!$('learn-videos-dialog').open)$('learn-videos-dialog').showModal();
  showLearnVideo(index);
}
async function startLearning(stage=0){
  if(state.learningStarting)return;state.learningStarting=true;
  try{
    $('learn-coach-dialog').close();
    if(!await startLocalBotGame())return;
    rememberLearningPractice();
    state.learning={stage,hints:true,pointsInfo:true,whoWins:true,roundMessages:[],paused:true,pausedAt:gameTime(),complete:false,scoreMessages:[],tutorialMessages:[{title:'Guía de cartas',pointAtGuide:true,text:'Podés tocar este ícono cuando quieras para abrir la guía. Te ayuda a reconocer tus cartas y saber cuáles son más poderosas.'},{title:'Ayudas',pointAtOptions:true,text:'Aquí podés deshabilitar las ayudas cuando vayas entendiendo.'},{title:'Elegí una carta para empezar',introLast:true,text:'Seleccioná cualquier carta de tu mano para empezar a jugar.'}]};
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
    renderGame();showView('game-view');if(stage>=1)openLearningHelp();else resumeLearning();
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
  if(roomHasFlor(room,original)&&!room.florSettled&&!room.flors?.player1)return ['Tenés FLOR de '+florValue(original,muestra)+' tantos. Si querés cantarla, hacelo antes de tirar. Podés jugar sin declararla; después de tu primera carta ya no podés reclamarla. Con flor declarada no se juega envido.',explainFlor(original,muestra).explanation];
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
    const terminal=Math.max(...Object.values(after))>=targetPoints(before);
    const explanation=terminal?reason.replace(/Se vuelve a repartir\.?/gi,'').trim():reason;
    state.learning.scoreMessages.push(subject+' '+points+' '+(points===1?'punto':'puntos')+'.\n'+(explanation||'Por los puntos de esta mano.')+(after[player]>=targetPoints(before)?'\n'+(player==='player1'?'Ganaste la partida.':(before.players?.[player]?.name||'El bot')+' ganó la partida.'):''));
  }
}
function positionLearningScoreArrow(){
  positionLearningControls();
  const header=document.querySelector('#game-view .game-topbar');
  const top=(header?.getBoundingClientRect().bottom||80)+10;
  // Both coaching dialogs share the rival zone; neither participates in board layout.
  for(const hint of [$('learning-hint'),$('learning-points-tip')]){
    if(!hint.open)continue;
    const marker=document.querySelector('.mobile-score').getBoundingClientRect();
    const points=hint.id==='learning-points-tip'||state.learning?.activeScoreMessage;
    const guide=state.learning?.activeTutorial?.pointAtGuide;
    const left=Math.max(16,marker.right+56),available=window.innerWidth-left-16;
    const beside=points&&available>=240;
    hint.style.width=Math.min(380,beside?available:window.innerWidth-32)+'px';
    hint.style.left=(beside?left:(window.innerWidth-parseFloat(hint.style.width))/2)+'px';
    hint.style.right='auto';
    hint.style.top=(points?(beside?top+48:Math.max(top+100,marker.bottom+56)):guide?top+90:top+24)+'px';
  }
  const tipActive=$('learning-points-tip').open;
  $('learning-points-arrow').classList.toggle('hidden',!tipActive);
  if(tipActive)$('learning-score-arrow').classList.add('hidden');
  const dialog=tipActive?$('learning-points-tip'):$('learning-hint'),arrow=$(tipActive?'learning-points-arrow':'learning-score-arrow'),path=$(tipActive?'learning-points-arrow-path':'learning-score-arrow-path');
  const scoreActive=dialog.open&&state.learning?.activeScoreMessage,trucoActive=dialog.open&&state.learning?.activeTutorial?.pointAtTruco;
  const guideActive=dialog.open&&state.learning?.activeTutorial?.pointAtGuide,optionsActive=dialog.open&&state.learning?.activeTutorial?.pointAtOptions;
  const active=tipActive||scoreActive||trucoActive||guideActive||optionsActive;
  arrow.classList.toggle('hidden',!active);
  document.querySelectorAll('.scoreboard,.mobile-score').forEach(marker=>marker.classList.toggle('learning-score-highlight',!!scoreActive));
  if(!active)return;
  {
    const targetElement=guideActive?$('game-sheet'):optionsActive?$('learn-hints').closest('label'):trucoActive?$('player-actions').querySelector('[data-action="truco"]'):[...document.querySelectorAll('.mobile-score,.scoreboard')].find(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height);
    if(!targetElement){arrow.classList.add('hidden');return;}
    const target=targetElement.getBoundingClientRect();
    if(!target.width||!target.height){arrow.classList.add('hidden');return;}
    arrow.setAttribute('viewBox','0 0 '+window.innerWidth+' '+window.innerHeight);
    path.removeAttribute('marker-end');
    path.setAttribute('d',learningArrowPath(dialog.getBoundingClientRect(),target));
    return;
  }
}
function learningArrowPath(box,target){
  // Join the nearest visible edges. Control points stay between the endpoints,
  // including when the tally sits against the left edge of a narrow screen.
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const cx=target.left+target.width/2,cy=target.top+target.height/2;
  let x1,y1,x2,y2;
  if(target.bottom<box.top||target.top>box.bottom){
    const below=target.top>box.bottom;
    x1=clamp(cx,box.left+16,box.right-16);y1=below?box.bottom:box.top;
    x2=clamp(x1,target.left+4,target.right-4);y2=below?target.top-7:target.bottom+7;
    const mid=(y1+y2)/2;
    const direction=below?1:-1;
    return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2} M ${x2-6} ${y2-direction*10} L ${x2} ${y2} L ${x2+6} ${y2-direction*10}`;
  }
  const right=cx>box.left+box.width/2;
  x1=right?box.right:box.left;y1=clamp(cy,box.top+16,box.bottom-16);
  x2=right?target.left-7:target.right+7;y2=clamp(y1,target.top+4,target.bottom-4);
  const mid=(x1+x2)/2;
  const direction=right?1:-1;
  return `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2} M ${x2-direction*10} ${y2-6} L ${x2} ${y2} L ${x2-direction*10} ${y2+6}`;
}
const learningSeen=new Set((()=>{try{return JSON.parse(localStorage.getItem('truco-learning-seen-v1')||'[]');}catch{return [];}})());
function learningHelpTopic(bet=state.room?.pendingBet){
  return ['response',bet?.type,bet?.called,bet?.stake,!!bet?.single,!!bet?.revealMode,!!bet?.suspendedBet].join(':');
}
function enqueueLearningHelp(message,topic,repeat=false){
  const learning=state.learning;
  if(!learning?.hints||(!repeat&&learningSeen.has(topic)))return;
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
  // The score popup already explains a declined bet or folding.
  if(learning.pointsInfo!==false&&(action==='no'||action==='fold'||(action==='yes'&&bet?.type==='flor')))return;
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
  enqueueLearningHelp({title:'Dijiste '+name,text:'Si el rival acepta, juegan por '+stake+' puntos. Si el rival no acepta, ganás '+declined+' '+(declined===1?'punto':'puntos')+' y se vuelve a repartir.'},'truco-call:'+stake,true);
}
function queueLearningTrucoReminder(){
  const learning=state.learning,room=state.room;
  if(!learning||learning.stage!==0||!learning.hints||!learning.trucoReminderPending||Number(room.handNumber)<=Number(learning.trucoReminderAfterHand)||learning.hasCalledTruco||learning.trucoReminderShown||room.status!=='started'||room.pendingBet||room.resolvingTrick||room.pendingNextHand||room.endReveal&&!room.endReveal.done)return;
  learning.trucoReminderPending=false;learning.trucoReminderShown=true;
  learning.tutorialMessages??=[];
  learning.tutorialMessages.push({title:'Podés gritar TRUCO',pointAtTruco:true,text:'Si tocás TRUCO, podés aumentar los puntos en juego. Sin truco se juega por 1 punto. Con truco se juega por 2 puntos. El rival tiene que aceptar; si no acepta, ganás 1 punto.'});
}
function setLearningWhoWins(enabled){
  if(!state.learning)return;
  state.learning.whoWins=enabled;
  $('learn-who-wins').checked=enabled;
  if(!enabled){
    state.learning.roundMessages=[];
    if(state.learning.activeTutorial?.roundCards&&$('learning-hint').open)$('learning-hint').close();
  }
  renderLearning();
}
// Practice: each answer button with one short line on what it does, in the order shown below.
function learningAnswerOptions(room,bet){
  const pts=n=>n+' '+(Number(n)===1?'punto':'puntos');
  if(bet.type==='truco'){
    const stake=Number(bet.stake)||2,options=[['QUIERO','Juegan esta mano por '+pts(stake)+'.'],['NO QUIERO','El bot gana '+pts(stake-1)+' y se reparte de nuevo.']];
    if(stake<4)options.push([stake===2?'RETRUCO':'VALE 4','Subís a '+pts(stake+1)+'. Si el bot no quiere, ganás '+pts(stake)+'.']);
    return options;
  }
  if(bet.type==='envido'){
    const options=[['QUIERO','Gana quien tenga más tantos: '+pts(Number(bet.stake)||2)+'.'],['NO QUIERO','El bot gana '+pts(Number(bet.accepted)||1)+'.']];
    if(canRaiseEnvido(bet)&&!Object.keys(room.flors||{}).length)options.push(['ENVIDO · REAL · FALTA','Subís los puntos en juego.']);
    return options;
  }
  if(bet.type==='flor'){
    const hand=state.localOriginalHands?.player1||state.hand,stake=Number(bet.stake)||3;
    const texts={yes:bet.single?'Cantás tu flor y compiten las dos.':bet.called==='flor'?'Siguen jugando. Al final, la flor más alta gana '+pts(stake)+'.':'La flor más alta gana '+pts(stake)+'.',
      no:bet.single?'No tenés flor: el bot gana 3 puntos.':'El bot gana '+pts(declinedFlorPoints(bet))+'.',
      'raise-conflor':'Apostás '+pts(florBetPoints(room,'conflor'))+' a la flor más alta.','raise-faltaflor':'Apostás la partida a la flor más alta.'};
    return florAnswers(bet,roomHasFlor(room,hand)).map(([action,label])=>[label,texts[action]||'']);
  }
  return [];
}
function learningResponseTitle(room,bet){
 if(!bet)return 'Antes de responder';
 if(bet.revealMode&&bet.caller===state.playerId)return 'Declarar tus tantos de envido';
 if(bet.revealMode&&bet.caller==null)return 'Declarar tus tantos de envido';
 const name=state.localGame&&bet.caller==='player2'?'El bot':room.players?.[bet.caller]?.name||'El rival';
 if(bet.type==='truco')return name+(Number(bet.stake)===2?' gritó ':' dice ')+({2:'TRUCO',3:'RETRUCO',4:'VALE 4'}[bet.stake]||'TRUCO');
 if(bet.type==='flor')return name+' cantó '+betCallNames(bet).join(' + ').toUpperCase();
 if(bet.type==='envido')return name+' dijo '+betCallNames(bet).join(' + ').toUpperCase();
 return 'Antes de responder';
}
function showLearningMessage(){
  if(!state.learning||state.learning.paused||state.learning.complete||document.querySelector('.learn-coach-dialog[open]'))return;
  if(state.learning.pointsInfo===false)state.learning.scoreMessages=[];
  if(!state.learning.hints)state.learning.tutorialMessages=[];
  queueLearningTrucoReminder();
  const roundMessage=state.learning.whoWins!==false?state.learning.roundMessages?.shift():null;
  const tutorial=roundMessage||state.learning.tutorialMessages?.shift();
  const room=state.room,bet=room.pendingBet,scoreMessage=tutorial?null:state.learning.scoreMessages?.shift();
  if(!tutorial&&!scoreMessage&&!state.learning.hints)return;
  // Explain actual scoring and new calls; ordinary turns and round pauses need no popup.
  if(!tutorial&&!scoreMessage&&(!bet||(bet.revealMode?bet.revealTurn!=='player1':bet.responder!=='player1')))return;
  const key=tutorial?'tutorial:'+crypto.randomUUID():scoreMessage?'score:'+crypto.randomUUID():learningMessageKey();
  if(!tutorial&&!scoreMessage&&(state.learning.acknowledgedMessage===key||(bet?.type!=='truco'&&learningSeen.has(learningHelpTopic(bet)))))return;
  if(!scoreMessage&&!roundMessage){const topic=tutorial?.topic||learningHelpTopic(bet);rememberLearningHelp(topic);}
  pauseLearning();state.learning.activeMessage=key;state.learning.activeScoreMessage=!!scoreMessage;state.learning.activeTutorial=tutorial||null;
  $('learning-message-title').textContent=scoreMessage?'':tutorial?.title||learningResponseTitle(room,bet);
  $('learning-message-title').classList.toggle('hidden',!!scoreMessage);
  $('learning-hint').classList.toggle('score-message',!!scoreMessage);
  if(scoreMessage){$('learning-hint').removeAttribute('aria-labelledby');$('learning-hint').setAttribute('aria-label','Puntos de la mano');}
  else{$('learning-hint').removeAttribute('aria-label');$('learning-hint').setAttribute('aria-labelledby','learning-message-title');}
  const body=$('learning-message-body');body.replaceChildren();
  const answers=!tutorial&&!scoreMessage&&bet&&!bet.revealMode&&bet.responder==='player1'?learningAnswerOptions(room,bet):[];
  $('learning-hint').classList.toggle('answer-message',answers.length>0);
  if(answers.length){
    const ask=document.createElement('p'),list=document.createElement('ul');
    ask.className='learning-answer-ask';ask.textContent='¿Qué respondés?';list.className='learning-answers';
    for(const [label,text] of answers){const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('span');name.textContent=label;detail.textContent=text;item.append(name,detail);list.append(item);}
    body.append(ask,list);
  }else (tutorial?[tutorial.text]:scoreMessage?[scoreMessage]:learningGuidance()).flatMap(text=>text.replace(/\.\s*/g,'.\n').split('\n')).filter(text=>text.trim()).forEach(text=>{const p=document.createElement('p');p.textContent=text;body.append(p);});
  const studyButton=$('learning-message-study'),kind=!tutorial&&!scoreMessage&&['envido','flor'].includes(bet?.type)?bet.type:null;
  studyButton.classList.toggle('hidden',!kind);
  studyButton.dataset.studyKind=kind||'';
  studyButton.textContent=kind==='flor'?'Cómo sumar mis puntos de flor':'Cómo sumar mis puntos de envido';
  $('learning-round-guide').classList.toggle('hidden',!roundMessage);
  $('learning-round-disable').classList.toggle('hidden',!roundMessage);
  $('learning-hint').showModal();
  renderCallNotice();
  requestAnimationFrame(positionLearningScoreArrow);
}
function positionLearningControls(){
  if(!state.learning||!state.localGame)return;
  const game=$('game-view'),box=game.getBoundingClientRect(),header=game.querySelector('.game-topbar'),hand=$('hand').getBoundingClientRect();
  if(header)game.style.setProperty('--learning-exit-top',(header.getBoundingClientRect().bottom-box.top+10)+'px');
  const exit=$('learn-menu').getBoundingClientRect(),feltBox=$('felt-area').getBoundingClientRect();
  game.style.setProperty('--learning-marker-top',Math.max(12,exit.bottom-feltBox.top+12)+'px');
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
  $('learn-who-wins').checked=state.learning.whoWins!==false;
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
  for(const tag of document.querySelectorAll('.trick-winner-label'))tag.classList.add('is-paused');
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
  $('learn-study-value').max=kind==='flor-points'?'47':'37';$('learn-study-value').value='';$('learn-study-check').disabled=false;
  $('learn-study-feedback').textContent='';$('learn-study-feedback').className='study-feedback';
  $('learn-study-next').classList.add('hidden');
  $('learn-study-flor').querySelectorAll('button').forEach(button=>button.disabled=false);
}
function checkStudy(answer){
  if(!studyExercise||studyExercise.answered)return;
  const exercise=studyExercise,result=exercise.kind==='envido'?explainEnvido(exercise.hand,exercise.muestra):exercise.kind==='flor-points'?explainFlorPoints(exercise.hand,exercise.muestra):explainFlor(exercise.hand,exercise.muestra);
  const max=exercise.kind==='flor-points'?47:37;
  if(exercise.kind!=='flor'&&(!Number.isInteger(answer)||answer<0||answer>max)){ $('learn-study-feedback').textContent=`Escribí un número entero entre 0 y ${max}.`;return;}
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
  const roundGuide=!!state.learning?.activeTutorial?.roundCards;
  const hand=!roundGuide&&state.learning&&state.localGame&&$('game-view').classList.contains('active')?localHand('player1'):[];
  for(const row of $('learn-sheet-dialog').querySelectorAll('[data-guide-strength]')){
    row.querySelector('.guide-owned-cards')?.remove();
    row.querySelector('.guide-played-cards')?.remove();
    const played=state.learning?.activeTutorial?.roundCards||[];
    const matches=played.filter(item=>cardStrength(item.card,state.room?.muestra)===Number(row.dataset.guideStrength));
    row.classList.toggle('guide-played',matches.length>0);
    if(matches.length){
      const label=document.createElement('span');label.className='guide-played-cards';
      label.textContent=matches.map(item=>(item.playerId==='player1'?'Vos jugaste: ':'El rival jugó: ')+cardStudyName(item.card)).join(' · ');
      (row.tagName==='TR'?row.cells[0]:row).append(label);
    }
    const cards=hand.filter(card=>cardStrength(card,state.room?.muestra)===Number(row.dataset.guideStrength));
    row.classList.toggle('guide-owned',cards.length>0);
    if(!cards.length)continue;
    const label=document.createElement('span');label.className='guide-owned-cards';
    label.textContent='Tenés: '+cards.map(cardStudyName).join(' · ');
    (row.tagName==='TR'?row.cells[0]:row).append(label);
  }
}
function renderGuidePlayedCards(){
  const el=$('guide-played-round');el.replaceChildren();
  const played=state.learning?.activeTutorial?.roundCards||[];
  el.classList.toggle('hidden',!played.length);
  if(!played.length)return;
  const heading=document.createElement('p');heading.textContent='Cartas jugadas en esta ronda';el.append(heading);
  const cards=document.createElement('div');cards.className='guide-round-cards';
  for(const item of played){
    const wrap=document.createElement('div'),label=document.createElement('span'),card=document.createElement('div');
    label.textContent=item.playerId==='player1'?'Tu carta':'Carta del rival';
    card.className='sprite-card';card.style.cssText=cardImageStyle(item.card);card.setAttribute('role','img');card.setAttribute('aria-label',cardAccessibleName(item.card));
    wrap.append(label,card);cards.append(wrap);
  }
  el.append(cards);
}
function openStudySheet(){pauseLearning();renderGuidePlayedCards();markPracticeGuideCards();if(!$('learn-sheet-dialog').open)$('learn-sheet-dialog').showModal();}
function continueLearningStage(){
  const stage=state.learning?.stage||0,complete=state.learning?.complete;
  if(!complete&&stage>=1)openStudy(stage===2?'flor':'envido');
  $('learn-coach-dialog').close();
  if(complete)startLearning(stage);
}
$('learn-game').addEventListener('click',openLearning);
$('seats').addEventListener('click',async event=>{
  const button=event.target.closest('[data-add-bot]');if(!button||button.disabled)return;
  button.disabled=true;
  // A successful add redraws the seats; otherwise the button must work again.
  try{
    // A table created a moment ago gets its match id when the server confirms it; until then the command would be dropped.
    for(let i=0;i<50&&!state.room?.creditMatch?.id;i++)await new Promise(resolve=>setTimeout(resolve,100));
    await creditCommand({kind:'add-bot',seat:button.dataset.addBot});
  }catch{}finally{if(button.isConnected)button.disabled=false;}
});
$('learn-videos').addEventListener('click',()=>openLearnVideos(0));
$('learn-videos-close').addEventListener('click',()=>$('learn-videos-dialog').close());
$('learn-videos-prev').addEventListener('click',()=>showLearnVideo(learnVideoIndex-1));
$('learn-videos-next').addEventListener('click',()=>{if(learnVideoIndex===LEARN_VIDEOS.length-1)$('learn-videos-dialog').close();else showLearnVideo(learnVideoIndex+1);});
// Tapping the video pauses it, resumes it, or replays it once it ended.
$('learn-videos-player').addEventListener('click',event=>{const video=event.currentTarget;if(video.paused||video.ended)video.play?.()?.catch?.(()=>{});else video.pause();});
$('learn-videos-dialog').addEventListener('close',()=>{const video=$('learn-videos-player');video.pause();video.removeAttribute('src');video.load();});
$('learn-back').addEventListener('click',()=>{stopBot();showView('welcome-view');openLobby();});
$('learn-free').addEventListener('click',()=>startLearning(0));
$('learn-game-modes').addEventListener('click',event=>{const button=event.target.closest('[data-learning-stage]');if(button)startLearning(Number(button.dataset.learningStage));});
window.addEventListener('resize',()=>{syncMobileGameHeader();positionLearningScoreArrow();positionLearningControls();alignHandWithControls();positionMobileCallNotice();if(state.room)positionDealerDeck($,state.room.dealer||(state.room.mode==='2v2'?'player4':otherPlayer(state.room.mano||'player1')),state.playerId,state.room.mode==='2v2',[state.roomCode,state.room.matchNumber,state.room.handNumber].join(':'));});
function indicateLearningMessageClose(event){
  const dialog=event.currentTarget;
  if(!dialog.open)return;
  const box=dialog.getBoundingClientRect();
  if(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)return;
  const button=dialog.querySelector('.learn-close');
  if(!button)return;
  dialog._closeShake?.cancel();
  dialog._closeShake=dialog.animate?.([{translate:'0 0'},{translate:'-5px 0'},{translate:'5px 0'},{translate:'-4px 0'},{translate:'4px 0'},{translate:'0 0'}],{duration:450,easing:'ease-out'});
  button.getAnimations?.().forEach(animation=>animation.cancel());
  clearTimeout(button._closeHintTimer);
  button.classList.add('close-required');
  button.animate?.([{translate:'0 0'},{translate:'-4px 0'},{translate:'4px 0'},{translate:'-3px 0'},{translate:'3px 0'},{translate:'0 0'}],{duration:450,easing:'ease-out'});
  button._closeHintTimer=setTimeout(()=>button.classList.remove('close-required'),450);
}
for(const dialog of document.querySelectorAll('.learning-message')){
  dialog.addEventListener('pointerdown',indicateLearningMessageClose);
  dialog.addEventListener('close',()=>dialog._closeShake?.cancel());
}
$('learning-message-close').addEventListener('click',()=>$('learning-hint').close());
$('learning-message-study').addEventListener('click',event=>{const kind=event.currentTarget.dataset.studyKind;if(kind==='envido'||kind==='flor')openStudy(kind);});
$('learning-hint').addEventListener('close',()=>{if(state.learning){state.learning.acknowledgedMessage=state.learning.activeMessage;state.learning.activeMessage=null;state.learning.activeScoreMessage=false;state.learning.activeTutorial=null;}positionLearningScoreArrow();resumeLearning();});
$('learn-menu').addEventListener('click',openLearning);
$('game-sheet').addEventListener('click',()=>{if(state.learning)openStudySheet();});
$('learn-sheet-menu').addEventListener('click',openStudySheet);
$('learn-sheet-close').addEventListener('click',()=>$('learn-sheet-dialog').close());
$('learn-sheet-dialog').addEventListener('close',()=>{if(state.learning?.activeTutorial?.trickGuide)state.learning.activeTutorial=null;});
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
$('learning-round-guide').addEventListener('click',openStudySheet);
$('learning-round-disable').addEventListener('click',()=>setLearningWhoWins(false));
$('learn-who-wins').addEventListener('change',event=>setLearningWhoWins(event.target.checked));
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
  const releaseLoading=()=>{
    $('app').inert=!account.isReady();
    $('startup-loading').hidden=true;
    document.documentElement.classList.remove('page-loading');
  };
  const slowTimer=setTimeout(()=>{account.loadingSlow(state.authLoadingStage||'config');releaseLoading();},12000);
  try{
    try{
      const bundled=await import('./firebase-config.js?v=20261016-auth-domain');
      if(firebaseConfigValid(bundled.firebaseConfig))state.config=bundled.firebaseConfig;
    }catch{ /* Optional during initial setup. */ }
    const fb=await firebaseServices();
    // Artwork and a cached profile's refresh need not delay the first wallet.
    preloadCardImages().catch(error=>console.error('[truco:startup-cards]',error));
    const profileLoad=account.observe(fb,fb.auth.currentUser);
    if(!account.isReady())await profileLoad;
    else profileLoad.catch(error=>console.warn('[truco:profile-refresh]',error));
    await account.whenReady();
    await account.startRequestedAppleLogin();
  }catch(error){console.error('[truco:startup]',error);account.failed(error);}
  finally{clearTimeout(slowTimer);releaseLoading();}
}

await initializePage();




function loadCreditFunctions(){
  return creditFunctionsPromise??=import('https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js').catch(error=>{creditFunctionsPromise=null;throw error;});
}
function warmGameConnection(){
 if(!state.uid||state.firebaseConnected!==true||Date.now()-(state.gameWarmAt||0)<60000)return;
 state.gameWarmAt=Date.now();void creditApi('creditGame',{operation:'warm'}).catch(error=>{state.gameWarmAt=0;console.warn('[truco:warmup]',error.code||error.message);});
}
async function creditApi(name,data){
  if(['creditCreateTable','creditJoinTable','creditTableAction'].includes(name)){
    const result=await liveTableApi(name,data);
    if(name!=='creditTableAction')void credits.sync().catch(error=>console.error('[truco:wallet-sync]',error));
    return result;
  }
  const started=performance.now();
  const fb=await firebaseServices();
  const {getFunctions,httpsCallable}=await loadCreditFunctions();
  const gameOperation=['creditCreateTable','creditJoinTable','creditTableAction'].includes(name);
  const result=(await httpsCallable(getFunctions(fb.auth.app,'us-central1'),gameOperation?'creditGame':name,{timeout:20000})(gameOperation?{operation:name,payload:data}:data)).data;
  if(data?.command?.kind!=='tick')console.info('[truco:request]',JSON.stringify({operation:data?.command?.kind||name,elapsedMs:Math.round(performance.now()-started),server:result?.timing}));
  // The wallet subscription supplies balance changes. A refresh must never
  // hold a played card/call (or every background tick) behind another request.
  if(['creditCreateTable','creditJoinTable'].includes(name))void credits.sync().catch(error=>console.error('[truco:wallet-sync]',error));
  return result;
}
function isOlderRoom(incoming,current){
  return !!(incoming?.managedCredits&&current?.managedCredits&&(Number(incoming.matchNumber||1)<Number(current.matchNumber||1)||(incoming.creditMatch?.id===current.creditMatch?.id&&Number(incoming.revision)<Number(current.revision))));
}
function applyActionReceipt(result,code){
  if(state.roomCode!==code||!result?.room||isOlderRoom(result.room,state.room))return;
  state.room={...result.room,...(state.room?.connectionPresence?{connectionPresence:state.room.connectionPresence}:{})};
  if(result.privateHand&&Number(result.privateHand.revision)>=Number(state.privateDeal?.revision||0))state.privateDeal=result.privateHand;
  // A waiting room (e.g. after "Usar bot") redraws its seats instead of the game table.
  if(state.room.status==='waiting'){renderWaiting();return;}
  syncPrivateHand();renderGame();
}
// A table just created shows before the server confirms it; wait for its match id.
async function confirmedMatchId(code){
  for(let waited=0;waited<15000;waited+=100){
    if(state.roomCode!==code)return null;
    const id=state.room?.creditMatch?.id;if(id)return id;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return null;
}
async function creditCommand(command){
  const code=state.roomCode;let matchId=state.room?.creditMatch?.id;
  if(code&&!matchId&&command.kind!=='tick'&&state.room?.managedCredits)matchId=await confirmedMatchId(code);
  if(!code||!matchId)return;
  if(liveActionsBlocked()&&command.kind!=='tick')throw new Error('Esperá a recuperar la conexión.');
  if(command.kind==='tick'&&(creditTickPending||state.liveAction||state.playActionInFlight||state.foldInFlight))return;
  if(command.kind==='tick')creditTickPending=true;
  try{const result=await creditApi('creditTableAction',{code,command,expectedMatchId:matchId,requestId:crypto.randomUUID()});applyActionReceipt(result,code);return result;}
  catch(error){if(command.kind!=='tick'&&error?.code!=='closed')toast(firebaseError(error),true);throw error;}
  finally{if(command.kind==='tick')creditTickPending=false;}
}
function openCreditJoin(code,room){
  state.joining=true;state.selectedRoom=code;state.joinConfirmed=false;state.joinPassword='';
  $('join-credit-submit').textContent='Entrar';
  // What the table is and what entering costs, before any credit moves.
  let cost=$('join-credit-cost');if(!cost){cost=document.createElement('dl');cost.id='join-credit-cost';cost.className='join-summary';$('join-credit-form').insertBefore(cost,$('join-credit-password-row'));}
  const stake=Number(room.creditMatch.stake)||0,balance=credits.wallet()?.balance,plural=n=>n+' crédito'+(n===1?'':'s');
  const rows=[['Mesa',(room.mode==='2v2'?'2 vs 2':'1 vs 1')+(room.creditMatch.hasPassword?' · privada':' · pública')],['Se juega a',(Number(room.targetPoints)||30)+' puntos'],['Apuesta',plural(stake)+' por jugador'],['Pozo',plural(Number(room.creditMatch.pot)||stake*(room.mode==='2v2'?4:2))],['Tus créditos',Number.isFinite(balance)?plural(balance)+(balance>=stake?' · te quedan '+(balance-stake)+' al entrar':''):'—']];
  cost.replaceChildren(...rows.flatMap(([k,v])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;return [dt,dd];}));
  let teams=$('join-credit-team-row');
  if(!teams){teams=document.createElement('label');teams.id='join-credit-team-row';teams.textContent='Elegí tu equipo';const select=document.createElement('select');select.id='join-credit-team';select.className='table-mode-select';teams.append(select);$('join-credit-form').insertBefore(teams,$('join-credit-password-row'));}
  teams.hidden=room.mode!=='2v2';
  if(room.mode==='2v2')$('join-credit-team').innerHTML=['player1','player2'].map((t,i)=>{const names=TEAM_SEATS.filter(p=>playerTeam(p)===t&&room.players?.[p]).map(p=>room.players[p].name);return '<option value="'+t+'" '+(names.length===2?'disabled':'')+'>Equipo '+(i+1)+' · '+escapeHtml(names.join(' + ')||'Disponible')+'</option>';}).join('');
  if(room.mode==='2v2'){const select=$('join-credit-team'),choice=[...select.options].find(option=>!option.disabled&&option.value===state.joinTeam)||[...select.options].find(option=>!option.disabled);if(choice)select.value=choice.value;}
  $('join-credit-password-row').hidden=!room.creditMatch.hasPassword;
  $('join-credit-password').value='';setPasswordVisible('join-credit-password',false);$('join-credit-error').textContent='';
  // A friend's invitation brings the password of a private table.
  if(state.invitePassword?.code===code){$('join-credit-password').value=state.invitePassword.password;state.invitePassword=null;}
  const wallet=credits.wallet();$('join-credit-submit').disabled=!wallet||(wallet.balance<room.creditMatch.stake)||wallet.locked>0;
  if($('join-credit-submit').disabled)$('join-credit-error').textContent='No tenés créditos disponibles para esta apuesta.';
  $('join-credit-dialog').showModal();
}
$('join-credit-form').addEventListener('submit',async event=>{
  event.preventDefault();if(state.joinSubmitting||state.enteringRoom||$('join-credit-submit').disabled)return;
  state.joinSubmitting=true;state.joinPassword=$('join-credit-password').value;state.joinConfirmed=true;
  $('join-credit-error').textContent='';$('join-credit-submit').disabled=true;$('join-credit-submit').textContent='Entrando…';
  $('join-credit-close').disabled=true;$('join-credit-password').disabled=true;$('join-credit-form').setAttribute('aria-busy','true');
  try{await enterRoom();}
  finally{
    state.joinSubmitting=false;state.joinPassword='';state.joinConfirmed=false;
    $('join-credit-submit').disabled=false;$('join-credit-submit').textContent='Entrar';
    $('join-credit-close').disabled=false;$('join-credit-password').disabled=false;$('join-credit-form').removeAttribute('aria-busy');
    if($('join-credit-dialog').open)$('join-credit-password').focus();
  }
});
$('join-credit-close').addEventListener('click',()=>{if(!state.joinSubmitting)$('join-credit-dialog').close();});
$('join-credit-dialog').addEventListener('cancel',event=>{if(state.joinSubmitting)event.preventDefault();});
$('join-credit-dialog').addEventListener('close',()=>{state.joinPassword='';state.joinConfirmed=false;});
$('join-credit-password').addEventListener('input',()=>{$('join-credit-error').textContent='';});
$('table-visibility').addEventListener('change',()=>{$('table-password-row').hidden=$('table-visibility').value!=='password';});
function managedTickDue(room,now=gameTime()){
  if(!room?.managedCredits||room.status==='closed')return false;
  if(room.status==='waiting')return now-Number(room.createdAt)>=600000;
  if(room.status==='drawing'||room.status==='timed-out')return true;
  if(room.resolvingTrick&&now>=Number(room.resolutionEndsAt))return true;
  if(room.pendingNextHand&&now>=Number(room.pendingNextHand.endsAt))return true;
  if(['revealing','complete'].includes(room.status)&&room.endReveal&&!room.endReveal.done&&now>=Number(room.endReveal.endsAt))return true;
  if(room.status==='complete'&&!room.endReveal)return true;
  if(room.status==='started'&&room.turnClock&&now-Number(room.turnClock.startedAt)>=45000)return true;
  return Object.entries(room.connectionPresence||{}).some(([seat,p])=>p?.online===false&&p.uid===room.players?.[seat]?.uid&&Number(p.matchNumber)===Number(room.matchNumber||1)&&Number.isFinite(p.disconnectedAt)&&now-p.disconnectedAt>=45000);
}
setInterval(()=>{if(state.firebaseConnected===true&&navigator.onLine!==false&&document.visibilityState==='visible'&&managedTickDue(state.room))creditCommand({kind:'tick'}).catch(()=>{});},2000);

function updateStakeControl(){
  const wallet=credits.wallet(),maximum=Math.max(0,Math.floor(wallet?.balance||0));
  const value=Math.max(1,Math.min(Math.max(1,maximum),Number($('table-stake').value)||1));
  $('table-stake').value=String(value);$('table-stake').max=String(maximum);$('table-stake').style.width=Math.max(2,String(value).length)+'ch';
  const unavailable=!wallet||wallet.locked>0;
  $('stake-minus').disabled=unavailable||value<=1;
  $('stake-plus').disabled=unavailable||value>=maximum;
}
function installStakeStepper(){
  let timer=null,started=0,holding=null;
  const stop=()=>{clearTimeout(timer);timer=null;holding=null;};
  const step=(direction)=>{
    updateStakeControl();
    if($(direction>0?'stake-plus':'stake-minus').disabled)return false;
    $('table-stake').value=String(Number($('table-stake').value)+direction);
    updateStakeControl();return true;
  };
  for(const [id,direction] of [['stake-minus',-1],['stake-plus',1]]){
    const button=$(id);
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0||holding!==null)return;
      event.preventDefault();stop();holding=event.pointerId;started=performance.now();
      button.setPointerCapture(event.pointerId);step(direction);
      const repeat=()=>{
        if(holding===null||document.hidden||!$('setup-view').classList.contains('active')||!step(direction)){stop();return;}
        const elapsed=performance.now()-started;
        timer=setTimeout(repeat,elapsed<1200?250:elapsed<2500?130:elapsed<4000?80:45);
      };
      timer=setTimeout(repeat,450);
    });
    button.addEventListener('click',event=>{if(event.detail===0)step(direction);});
    button.addEventListener('contextmenu',event=>event.preventDefault());
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,stop);
  }
  window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  updateStakeControl();
}
installStakeStepper();

function setPasswordVisible(id,visible){
  const input=$(id),button=document.querySelector('[data-password-toggle="'+id+'"]');
  input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Ocultar clave':'Mostrar clave');
}
for(const button of document.querySelectorAll('[data-password-toggle]')){
  button.addEventListener('pointerdown',event=>event.preventDefault());
  button.addEventListener('click',event=>{
    event.preventDefault();const id=button.dataset.passwordToggle;if($(id).disabled)return;
    setPasswordVisible(id,$(id).type==='password');
  });
}

installScorer({document,showView,renderTally:renderCompactTally});

installPlayerPanel({document,api:creditApi,getState:()=>state});

// Visible choices keep the underlying values used by online and bot games.
document.querySelectorAll('[data-table-mode]').forEach(button=>button.addEventListener('click',()=>{
  $('play-bot').checked=button.dataset.tableMode==='bot';
  if(!$('play-bot').checked)$('table-mode').value=button.dataset.tableMode;
  $('table-mode').dispatchEvent(new Event('change'));
  updateBotSetup();
}));
$('table-mode').addEventListener('change',()=>{
  document.querySelectorAll('[data-table-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tableMode===($('play-bot').checked?'bot':$('table-mode').value))));
});
document.querySelectorAll('[data-visibility]').forEach(button=>button.addEventListener('click',()=>{
  $('table-visibility').value=button.dataset.visibility;
  $('table-visibility').dispatchEvent(new Event('change'));
  document.querySelectorAll('[data-visibility]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
}));


