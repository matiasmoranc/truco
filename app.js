const FIREBASE_VERSION = '12.4.0';
const $ = (id) => document.getElementById(id);
const views = ['welcome-view', 'setup-view', 'waiting-view', 'game-view', 'config-view'];
const storageKey = 'truco-firebase-config';
let state = { role: 'table', joining: false, config: null, firebase: null, roomCode: null, selectedRoom: null, uid: null, playerId: null, unsubscribe: null, privateUnsubscribe: null, lobbyUnsubscribe: null, room: null, hand: [], demo: false, demoHands: {}, nextAction: null, resolutionTimer: null, resolutionTimerKey: null, playActionInFlight: false, legacyRepairKey: null, emptyHandRepairKey: null };

function showView(id) { views.forEach((name) => $(name).classList.toggle('active', name === id)); }
function toast(message, global = false) {
  const el = $(global ? 'global-toast' : 'toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}
function makeCode() { return Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join(''); }
const callSeen=new Map();
let soundEnabled=localStorage.getItem('truco-call-sound')==='on';
let voiceUnlocked=false;
function spokenCall(text=''){
  const points=text.match(/\bcanta (\d+) tantos\b/i);
  if(points)return `${points[1]} tantos`;
  if(/: son buenas\./i.test(text))return 'Son buenas';
  if(!/\b(canta|responde|quiere)\b/i.test(text))return null;
  if(/no quiere/i.test(text))return 'No quiero';
  if(/quiere/i.test(text))return 'Quiero';
  return ['contra flor al resto','con flor envido','falta envido','real envido','envido','vale cuatro','retruco','truco','flor'].find(call=>text.toLowerCase().includes(call))||null;
}
function makeCallNotice(text){
  const spoken=spokenCall(text);
  if(!spoken||!['player1','player2'].includes(state.playerId))return null;
  return {id:crypto.randomUUID(),from:state.playerId,to:state.playerId==='player1'?'player2':'player1',text,spoken,time:Date.now()};
}
function speakCall(text){
  if(!soundEnabled||!voiceUnlocked||!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(text);
  utterance.lang='es-UY';utterance.rate=.88;utterance.pitch=.55;
  const voices=window.speechSynthesis.getVoices();
  utterance.voice=voices.find(v=>v.lang==='es-UY')||voices.find(v=>/^es[-_]/i.test(v.lang))||null;
  window.speechSynthesis.speak(utterance);
}
function renderCallNotice(){
  const notice=state.room?.callNotice,role=state.playerId;
  const button=$('player-sound-toggle');
  button.classList.toggle('hidden',role==='table'||state.room?.status==='drawing');
  button.textContent=soundEnabled?'Voz activada':'Voz silenciada';
  button.setAttribute('aria-pressed',String(soundEnabled));
  const el=$('call-notice');
  const visible=notice?.to===role;
  el.classList.toggle('hidden',!visible);
  el.textContent=visible?notice.text:'';
  if(!visible)return;
  const key=`${state.roomCode}:${role}`;
  if(callSeen.get(key)!==notice.id){
    callSeen.set(key,notice.id);
    if(Date.now()-notice.time<60000)speakCall(notice.spoken);
  }
}
function cleanName(value, fallback) { return value.trim().slice(0,18) || fallback; }
function pickRole(role) {
  state.role = role;
  document.querySelectorAll('.role-card').forEach((card) => card.classList.toggle('selected', card.dataset.role === role));
  const label = role === 'table' ? 'la mesa' : role === 'player1' ? 'Jugador 1' : 'Jugador 2';
  $('enter-room').innerHTML = `Crear mesa como ${label} <span class="arrow">↗</span>`;
}
function isCoordinator() { return state.playerId === 'table' || (state.room?.deviceMode === 'two' && state.room.table?.uid === state.uid); }
function configureSetup() {
  state.joining = false;
  $('role-options').classList.remove('single');
  $('role-options').querySelectorAll('.role-card').forEach((card) => card.classList.remove('hidden'));
  $('device-mode').value = 'three';
  pickRole('table');
  showView('setup-view');
}
function firebaseConfigValid(config) { return !!(config && config.apiKey && config.databaseURL && config.projectId && config.appId); }
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
}
async function firebaseServices() {
  if (state.firebase) return state.firebase;
  const [appSdk, dbSdk, authSdk] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
  ]);
  const app = appSdk.initializeApp(state.config);
  const auth = authSdk.getAuth(app);
  if (!auth.currentUser) await authSdk.signInAnonymously(auth);
  state.uid = auth.currentUser.uid;
  state.firebase = { db: dbSdk.getDatabase(app, state.config.databaseURL), ...dbSdk };
  return state.firebase;
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
async function enterRoom() {
  const name = cleanName($('player-name').value, state.role === 'table' ? 'La mesa' : 'Jugador');
  if (!firebaseConfigValid(state.config)) { state.nextAction = 'enter'; showConfig(); return; }
  try {
    const fb = await firebaseServices();
    if (state.joining) {
      const code = state.selectedRoom;
      const roomRef = fb.ref(fb.db, `rooms/${code}/public`);
      const snap = await fb.get(roomRef);
      if (!snap.exists()) { toast('No encontramos esa mesa. Revisá el código.'); return; }
      const room = snap.val();
      if (room.status !== 'waiting') { toast('Esa mesa ya empezó. Elegí otra.'); openLobby(); return; }
      const seat = state.role;
      if (room.deviceMode === 'two' && seat === 'table') { toast('Esta partida es para dos celulares. Elegí un jugador.'); return; }
      const seatPath = seat === 'table' ? `rooms/${code}/public/table` : `rooms/${code}/public/players/${seat}`;
      const seatRef = fb.ref(fb.db, seatPath);
      const claim = await fb.runTransaction(seatRef, (current) => current == null ? { uid: state.uid, name, online: true } : current);
      if (!claim.committed || claim.snapshot.val()?.uid !== state.uid) { toast('Ese lugar ya está ocupado. Elegí otro puesto.'); openLobby(); return; }
      state.roomCode = code; state.playerId = seat;
    } else {
      const code = makeCode(); state.roomCode = code; state.playerId = state.role;
      const person = { uid: state.uid, name, online: true };
      const targetPoints = normalizeTargetPoints($('target-points').value);
      const deviceMode = $('device-mode').value;
      const initial = { deviceMode, status: 'waiting', createdAt: Date.now(), targetPoints, table: deviceMode === 'two' || state.role === 'table' ? person : null, players: { player1: state.role === 'player1' ? person : null, player2: state.role === 'player2' ? person : null }, scores: { player1: 0, player2: 0 }, handNumber: 1, deckCount: 40, trickCards: [], feed: [{ text: `${name} abrió una mesa a ${targetPoints}. Faltan los demás.`, time: Date.now() }] };
      await fb.set(fb.ref(fb.db, `rooms/${code}/public`), initial);
    }
    localStorage.setItem('truco-last-seat', JSON.stringify({ code: state.roomCode, role: state.playerId }));
    if (state.lobbyUnsubscribe) { state.lobbyUnsubscribe(); state.lobbyUnsubscribe = null; }
    watchRoom(); renderWaiting(); showView('waiting-view');
  } catch (error) {
    console.error(error); toast(firebaseError(error));
  }
}
async function openLobby() {
  if (!firebaseConfigValid(state.config)) { state.nextAction = 'lobby'; showConfig(); return; }
  try {
    const fb = await firebaseServices();
    showView('welcome-view');
    $('open-room-list').innerHTML = '<p class="muted">Buscando mesas abiertas…</p>';
    if (state.lobbyUnsubscribe) state.lobbyUnsubscribe();
    state.lobbyUnsubscribe = fb.onValue(fb.ref(fb.db, 'rooms'), (snapshot) => renderLobby(snapshot.val() || {}), (error) => {
      console.error(error); $('open-room-list').innerHTML = '<p class="muted">No pudimos cargar las mesas. Revisá las reglas de Firebase.</p>';
    });
  } catch (error) {
    console.error(error);
    $('open-room-list').innerHTML = '<p class="muted">No pudimos cargar las mesas. Revisá la conexión y las reglas de Firebase.</p>';
    toast(firebaseError(error));
  }
}
function renderLobby(rooms) {
  const open = Object.entries(rooms).filter(([, value]) => value?.public?.status === 'waiting' && (!value.public.table || !value.public.players?.player1 || !value.public.players?.player2)).sort((a,b) => (b[1].public.createdAt || 0) - (a[1].public.createdAt || 0));
  if (!open.length) { $('open-room-list').innerHTML = '<div class="empty-lobby"><span>♣</span><strong>No hay mesas abiertas todavía</strong><p>Creá una mesa y elegí si vas a jugar o a llevar el tanteador.</p></div>'; return; }
  $('open-room-list').innerHTML = open.map(([code, value]) => {
    const room = value.public, players = room.players || {}, seats = (room.deviceMode === 'two' ? [] : [['table','La mesa',room.table]]).concat([['player1','Jugador 1',players.player1],['player2','Jugador 2',players.player2]]);
    const title = room.table?.name || players.player1?.name || players.player2?.name || 'Mesa abierta';
    const available = seats.filter(([, , person]) => !person);
    return `<article class="lobby-card"><div class="lobby-card-top"><div><p class="eyebrow">${room.deviceMode === 'two' ? '2 CELULARES' : '3 DISPOSITIVOS'} · A ${targetPoints(room)} TANTOS</p><h3>${escapeHtml(title)}</h3></div><span class="lobby-count">${seats.length-available.length}/${seats.length}</span></div><div class="lobby-seats">${seats.map(([key,label,person]) => `<span class="lobby-seat ${person?'taken':''}">${person ? `${escapeHtml(label)}: ${escapeHtml(person.name || 'Ocupado')}` : `${escapeHtml(label)} · libre`}</span>`).join('')}</div><div class="lobby-join-options">${available.map(([key,label]) => `<button class="button ${key==='table'?'lobby-table-button':'lobby-player-button'}" data-room="${code}" data-seat="${key}">Unirme como ${label}<span>↗</span></button>`).join('')}</div></article>`;
  }).join('');
}
function joinOpenRoom(code, seat) {
  state.joining = true; state.selectedRoom = code; state.role = seat;
  const name = cleanName($('lobby-name').value, seat === 'table' ? 'La mesa' : 'Jugador');
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
  const fb = state.firebase;
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = fb.onValue(fb.ref(fb.db, `rooms/${state.roomCode}/public`), (snapshot) => {
    if (!snapshot.exists()) { toast('La mesa ya no está disponible.'); showView('welcome-view'); openLobby(); return; }
    state.room = snapshot.val();
    if(isCoordinator()&&state.room.status==='started'&&!state.room.resolvingTrick&&state.room.trickCards?.length===2&&(state.room.tricks||[]).length>0)recoverLegacyTrick(state.room);
    if(isCoordinator())repairIncompleteHand(state.room);
    if (isCoordinator()) scheduleTableResolution();
    if (['drawing','started','complete'].includes(state.room.status)) { showView('game-view'); if(state.room.status!=='drawing')watchPrivateHand(); renderGame(); }
    if(isCoordinator()&&state.room.status==='drawing')finishOpeningDraw().catch(error=>toast(firebaseError(error)));
    else if (state.room.status === 'waiting') { renderWaiting(); if (!$('waiting-view').classList.contains('active')) showView('waiting-view'); }
  });
}
function watchPrivateHand() {
  if (state.playerId === 'table') return;
  if (state.privateUnsubscribe) state.privateUnsubscribe();
  const fb = state.firebase;
  state.privateUnsubscribe = fb.onValue(fb.ref(fb.db, `hands/${state.roomCode}/${state.uid}/hand`), (snapshot) => {
    state.hand = snapshot.val() || [];
    if(state.room?.status==='started')fb.update(fb.ref(fb.db),{[`rooms/${state.roomCode}/public/handClaims/${state.playerId}`]:state.hand.length}).catch(()=>{});
    renderGame();
  });
}
function renderWaiting() {
  if (!state.room) return;
  const players = state.room.players || {};
  $('room-status').textContent = state.room.table && players.player1 && players.player2 ? 'MESA COMPLETA' : 'ESPERANDO LUGARES';
  const seatData = (state.room.deviceMode === 'two' ? [] : [['table','LA MESA',state.room.table]]).concat([['player1','JUGADOR 1',players.player1],['player2','JUGADOR 2',players.player2]]);
  $('seats').innerHTML = seatData.map(([key,label,value]) => `<div class="seat"><span class="seat-icon">${key==='table'?'♣':key==='player1'?'♠':'♥'}</span><span class="seat-name"><strong>${escapeHtml(value?.name || (key==='table'?'La mesa':'Esperando jugador…'))}</strong><small>${label}</small></span><span class="seat-state ${value?'ready':''}">${value?'LISTO':'ESPERANDO'}</span></div>`).join('');
  const ready = !!(state.room.table && players.player1 && players.player2);
  $('start-game').disabled = !(ready && isCoordinator());
  $('waiting-hint').textContent = isCoordinator() ? (ready ? 'Ya están todos. ¡A jugar!' : 'Esperando que se unan los dos jugadores') : 'Esperá a que quien creó la partida la inicie';
  $('game-room-code').textContent = 'MESA ABIERTA';
  $('start-game').textContent = `Repartir · a ${targetPoints(state.room)} tantos`;
}
function shuffleDeck() {
  const suits = [{name:'oro',symbol:'♦',red:true},{name:'copa',symbol:'♥',red:true},{name:'espada',symbol:'♠',red:false},{name:'basto',symbol:'♣',red:false}];
  const deck = [];
  for (const suit of suits) for (const rank of [1,2,3,4,5,6,7,10,11,12]) deck.push({id:`${suit.name}-${rank}`, rank, suit:suit.symbol, red:suit.red, label:rank===10?'Sota':rank===11?'Caballo':rank===12?'Rey':String(rank)});
  for (let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
async function startGame() {
  if(state.room?.status!=='waiting'||!isCoordinator()||!state.room.players?.player1||!state.room.players?.player2)return;
  await writeRoom({status:'drawing',openingDraw:{pool:shuffleDeck(),cards:{}},feed:topFeed(state.room,'Cada jugador toca el mazo para sortear quién reparte.')});
}
let finishingDraw=false;
let drawInFlight=false;
function otherPlayer(player){return player==='player1'?'player2':'player1';}
async function drawOpeningCard(){
  const player=state.playerId;
  if(drawInFlight||state.room?.status!=='drawing'||!['player1','player2'].includes(player)||state.room.openingDraw?.cards?.[player])return;
  drawInFlight=true;
  try{
    if(state.demo){
      const opening=state.room.openingDraw||{pool:shuffleDeck(),cards:{}};
      if(!opening.pool?.length)return;
      opening.cards={...(opening.cards||{}),[player]:opening.pool[0]};
      opening.pool=opening.pool.slice(1);
      state.room.openingDraw=opening;renderGame();
      if(opening.cards.player1&&opening.cards.player2)finishOpeningDraw();
      return;
    }
    const fb=state.firebase;
    await fb.runTransaction(fb.ref(fb.db,`rooms/${state.roomCode}/public/openingDraw`),current=>{
      if(!current||current.cards?.[player]||!current.pool?.length)return;
      return {...current,cards:{...(current.cards||{}),[player]:current.pool[0]},pool:current.pool.slice(1)};
    });
  }finally{drawInFlight=false;renderGame();}
}
async function finishOpeningDraw(){
  const draw=state.room?.openingDraw?.cards;
  if(state.room?.status!=='drawing'||!draw?.player1||!draw?.player2||finishingDraw)return;
  finishingDraw=true;
  try{
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(Number(draw.player1.rank)===Number(draw.player2.rank)){
      if(state.demo){state.room.openingDraw={pool:shuffleDeck(),cards:{}};demoFeed('Empate en el saque. Vuelvan a tocar el mazo.');renderGame();}
      else await writeRoom({openingDraw:{pool:shuffleDeck(),cards:{}},feed:topFeed(state.room,'Empate en el saque. Vuelvan a tocar el mazo.')});
      return;
    }
    const dealer=Number(draw.player1.rank)>Number(draw.player2.rank)?'player1':'player2';
    if(state.demo){state.room.dealer=dealer;state.room.mano=otherPlayer(dealer);state.room.turn=state.room.mano;state.room.status='started';state.hand=state.playerId==='table'?[]:[...state.demoHands[state.playerId]];demoFeed(`${state.room.players[dealer].name} reparte. Empieza ${state.room.players[state.room.mano].name}.`);}
    else await dealOpeningHand(dealer);
  }finally{finishingDraw=false;}
}
async function dealOpeningHand(dealer) {
  const fb = state.firebase; const deck = shuffleDeck(); const players = state.room.players;
  const hand1 = deck.slice(0,3); const hand2 = deck.slice(3,6);
  const muestra = deck[6];
  const patches = {};
  patches[`hands/${state.roomCode}/${players.player1.uid}/hand`] = hand1;
  patches[`hands/${state.roomCode}/${players.player2.uid}/hand`] = hand2;
  patches[`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`] = {player1:handEnvido(hand1,muestra),player2:handEnvido(hand2,muestra)};
  patches[`rooms/${state.roomCode}/public/status`] = 'started';
  patches[`rooms/${state.roomCode}/public/deckCount`] = 33;
  patches[`rooms/${state.roomCode}/public/muestra`] = muestra;
  patches[`rooms/${state.roomCode}/public/handCounts`] = {player1:3,player2:3};
  patches[`rooms/${state.roomCode}/public/handClaims`] = {player1:3,player2:3};
  patches[`rooms/${state.roomCode}/public/dealer`] = dealer;
  patches[`rooms/${state.roomCode}/public/turn`] = otherPlayer(dealer);
  patches[`rooms/${state.roomCode}/public/mano`] = otherPlayer(dealer);
  patches[`rooms/${state.roomCode}/public/trickCards`] = [];
  patches[`rooms/${state.roomCode}/public/trickNo`] = 1;
  patches[`rooms/${state.roomCode}/public/tricks`] = [];
  patches[`rooms/${state.roomCode}/public/trucoLevel`] = 1;
  patches[`rooms/${state.roomCode}/public/lastTrucoCaller`] = null;
  patches[`rooms/${state.roomCode}/public/pendingBet`] = null;
  patches[`rooms/${state.roomCode}/public/florSettled`] = false;
  patches[`rooms/${state.roomCode}/public/flors`] = {};
  patches[`rooms/${state.roomCode}/public/envidoClosed`] = false;
  patches[`rooms/${state.roomCode}/public/playedCount`] = 0;
  patches[`rooms/${state.roomCode}/public/feed`] = [{text:`${players[dealer].name} reparte. Empieza ${players[otherPlayer(dealer)].name}.`,time:Date.now()}];
  await fb.update(fb.ref(fb.db), patches);
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
function florValue(hand,muestra) { return 20+hand.reduce((n,card)=>n+(pieceOrder(card,muestra)?envidoValue(card,muestra)-20:envidoValue(card,muestra)),0); }
function topFeed(room,text) { return [{text,time:Date.now()},...(room.feed||[]).slice(0,7)]; }
const VALID_TARGET_POINTS=[10,20,30,40,50,60];
function normalizeTargetPoints(value) {
  const parsed=Number(value);
  return VALID_TARGET_POINTS.includes(parsed)?parsed:30;
}
function targetPoints(room) { return normalizeTargetPoints(room?.targetPoints); }
function faltanParaGanar(room) { return Math.max(1,targetPoints(room)-Math.max(Number(room.scores?.player1)||0,Number(room.scores?.player2)||0)); }
async function writeRoom(changes) {
  const fb=state.firebase; const updates={};
  const notice=makeCallNotice(changes.feed?.[0]?.text);
  if(notice)changes={...changes,callNotice:notice};
  for(const [key,value] of Object.entries(changes)) updates[`rooms/${state.roomCode}/public/${key}`]=value;
  await fb.update(fb.ref(fb.db),updates);
}
async function addPoints(playerId,points,description) {
  const scores={...state.room.scores}; scores[playerId]=(scores[playerId]||0)+Math.max(0,Number(points)||0);
  const won=scores[playerId]>=targetPoints(state.room);
  await writeRoom({scores,status:won?'complete':'started',feed:topFeed(state.room,`${state.room.players[playerId].name} ${description} (+${points}).`)});
}
async function callBet(kind) {
  if(state.demo){toast('Las apuestas se prueban en una mesa en vivo.');return;}
  const room=state.room, caller=state.playerId, other=caller==='player1'?'player2':'player1', pending=room.pendingBet;
  const overTruco=pending?.type==='truco'&&pending.responder===caller;
  if(!room||caller==='table'||(!overTruco&&room.turn!==caller)||(pending&&!overTruco)||room.status!=='started')return;
  const played=Number(room.playedCount)||0;
  if(kind==='envido'||kind==='real'||kind==='falta'){
    if(room.envidoClosed||played>0){toast('El envido se canta antes de tirar la primera carta.');return;}
    if(hasFlor(state.hand,room.muestra)){toast('Con flor no se juega el envido. Cantá flor.');return;}
    if(room.flors?.[other]){toast('El otro jugador cantó flor: el envido queda anulado.');return;}
    const amount=kind==='envido'?2:kind==='real'?3:faltanParaGanar(room);
    const base=pending?.type==='envido'?(pending.stake||0):0;
    const stake=kind==='falta'?faltanParaGanar(room):base+amount;
    await writeRoom({pendingBet:{type:'envido',caller,responder:other,stake,accepted:base,first:!pending,called:kind,reveals:{},suspendedBet:overTruco?pending:null},feed:topFeed(room,`${room.players[caller].name} canta ${kind==='real'?'real envido':kind==='falta'?'falta envido':'envido'}.`)});
    return;
  }
  if(kind==='truco'||kind==='retruco'||kind==='vale4'){
    const current=Number(room.trucoLevel)||1;
    const wanted={truco:2,retruco:3,vale4:4}[kind];
    if(pending||wanted!==current+1||current>=4||(current>1&&room.lastTrucoCaller===caller)){toast('Ese canto no está habilitado ahora.');return;}
    await writeRoom({pendingBet:{type:'truco',caller,responder:other,stake:wanted},lastTrucoCaller:caller,feed:topFeed(room,`${room.players[caller].name} canta ${kind==='vale4'?'vale cuatro':kind}.`)});
  }
}
async function answerBet(answer) {
  const bet=state.room?.pendingBet;if(!bet||bet.responder!==state.playerId)return;
  if(bet.type==='flor' && bet.single && answer==='yes'){ await callFlor(); return; }
  if(answer==='raise'){
    if(bet.type==='truco'){
      const raised=Number(bet.stake)===2?'retruco':'vale4',value=raised==='retruco'?3:4;
      await writeRoom({pendingBet:{...bet,caller:state.playerId,responder:bet.caller,stake:value},lastTrucoCaller:state.playerId,feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${raised==='vale4'?'vale cuatro':raised}.`)});return;
    }
  }
  if(answer.startsWith('raise-')&&bet.type==='envido'){
    const kind=answer.slice(6),stake=kind==='falta'?faltanParaGanar(state.room):bet.stake+(kind==='real'?3:2);
    await writeRoom({pendingBet:{...bet,caller:state.playerId,responder:bet.caller,accepted:bet.stake,stake,called:kind,reveals:{}},feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${kind==='falta'?'falta envido':kind==='real'?'real envido':'envido'}.`)});return;
  }
  if(bet.type==='flor'&&(answer==='raise-conflor'||answer==='raise-faltaflor')){
    const kind=answer==='raise-faltaflor'?'falta':'conflor',stake=kind==='falta'?faltanParaGanar(state.room):5;
    await writeRoom({pendingBet:{...bet,caller:state.playerId,responder:bet.caller,accepted:bet.stake,stake,called:kind},feed:topFeed(state.room,`${state.room.players[state.playerId].name} canta ${kind==='falta'?'contra flor al resto':'con flor envido'}.`)});return;
  }
  if(answer==='no'){
    const points=bet.type==='truco'?Math.max(1,(bet.stake||2)-1):bet.type==='flor'?(bet.accepted||3):(bet.accepted||((bet.stake>1)?1:0)||1);
    const scores={...state.room.scores};scores[bet.caller]=(scores[bet.caller]||0)+points;
    const status=scores[bet.caller]>=targetPoints(state.room)&&!state.room.envidoAudit?'complete':'started';
    const msg=`${state.room.players[bet.responder].name} ${bet.type==='flor'&&bet.single?'no tiene flor':'no quiere'}. ${state.room.players[bet.caller].name} suma ${points}.`;
    await writeRoom({scores,status,...(bet.type==='flor'?{florSettled:true}:{}),pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,pendingNextHand:bet.type==='truco'&&status!=='complete'?{id:`declined:${Date.now()}`,winner:bet.caller,message:msg}:null,feed:topFeed(state.room,msg)});
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
  await writeRoom({trucoLevel:bet.stake,pendingBet:null,feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere. El truco queda en ${bet.stake}.`) });
}
async function revealEnvido(good=false) {
  const room=state.room,bet=room?.pendingBet,player=state.playerId;
  if(bet?.type!=='envido'||!bet.revealMode||bet.revealTurn!==player)return;
  const first=room.mano,second=otherPlayer(first),number=Number($('envido-picker').dataset.value||0);
  if(good&&player!==second)return;
  if(!good&&(!Number.isInteger(number)||number<0||number>50||(player===second&&number<=bet.reveals?.[first]))){toast('Elegí un número mayor que los tantos del rival.');return;}
  const reveals={...(bet.reveals||{})};if(!good)reveals[player]=number;
  let changes;
  if(player===first){changes={pendingBet:{...bet,reveals,revealTurn:second},feed:topFeed(room,`${room.players[player].name} canta ${number} tantos.`)};}
  else{
    const winner=good?first:second;
    changes={pendingBet:bet.suspendedBet||null,envidoClosed:true,envidoAudit:{reveals,winner,stake:bet.stake,handNumber:room.handNumber},feed:topFeed(room,good?`${room.players[player].name}: son buenas. Los ${bet.stake} puntos se verifican al terminar la mano.`:`${room.players[player].name} canta ${number} tantos. Los ${bet.stake} puntos se verifican al terminar la mano.`)};
  }
  if(state.demo){const notice=makeCallNotice(changes.feed?.[0]?.text);if(notice)changes.callNotice=notice;Object.assign(room,changes);renderGame();}else await writeRoom(changes);
}
function settleSingleFlor(room,scores) {
  const flowers=Object.keys(room.flors||{});
  if(flowers.length!==1||room.florSettled)return scores;
  const player=flowers[0];return {...scores,[player]:(Number(scores[player])||0)+3};
}
function auditEnvidoScores(room,scores,truth){
  const audit=room.envidoAudit;if(!audit)return scores;
  const liars=Object.entries(audit.reveals||{}).filter(([player,value])=>Number(value)!==Number(truth[player])).map(([player])=>player);
  const winner=liars.length===2?null:liars.length===1?otherPlayer(liars[0]):audit.winner;
  const result={...scores};if(winner)result[winner]=(result[winner]||0)+Number(audit.stake);
  return result;
}
async function verifyEnvido(scores){
  if(!state.room.envidoAudit)return scores;
  const fb=state.firebase,snapshot=await fb.get(fb.ref(fb.db,`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`));
  if(!snapshot.exists())throw new Error('Faltan las cartas originales para verificar el envido.');
  const truth=snapshot.val(),result=auditEnvidoScores(state.room,scores,truth);
  return result;
}
async function callFlor() {
  const room=state.room,player=state.playerId;if(!room||player==='table'||(room.playedCount||0)>0||room.flors?.[player]!=null||!hasFlor(state.hand,room.muestra)){toast('No tenés flor para cantar.');return;}
  const flors={...(room.flors||{}),[player]:florValue(state.hand,room.muestra)};
  const other=player==='player1'?'player2':'player1';
  const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
  if(flors[other]){
    await writeRoom({flors,envidoClosed:true,pendingBet:{type:'flor',caller:player,responder:other,stake:3,accepted:0,called:'flor',suspendedBet},feed:topFeed(room,`${room.players[player].name} también canta flor. ¿La mía?`)});
  }else{
    await writeRoom({flors,envidoClosed:true,pendingBet:{type:'flor',single:true,caller:player,responder:other,stake:3,accepted:0,called:'flor',suspendedBet},feed:topFeed(room,`${room.players[player].name} canta flor. El rival debe responder si tiene flor.`)});
  }
}
async function settleHand(tricks, room) {
  const wins={player1:0,player2:0};let firstWinner=null,tieNeedsNextWinner=false;
  for(const trick of tricks){
    if(!trick.winner){tieNeedsNextWinner=true;continue;}
    if(tieNeedsNextWinner)return trick.winner;
    wins[trick.winner]++;if(!firstWinner)firstWinner=trick.winner;
    if(wins.player1===2)return'player1';if(wins.player2===2)return'player2';
  }
  if(tricks.length<3)return null;
  let winner=null;
  if(wins.player1!==wins.player2)winner=wins.player1>wins.player2?'player1':'player2';
  else if(firstWinner)winner=firstWinner;
  else winner=room.mano||'player1';
  return winner;
}
async function nextHand(winner, scores, handNumber, message, envidoVerified=false) {
  if(!envidoVerified){scores=await verifyEnvido(scores);scores=settleSingleFlor(state.room,scores);}
  const deck=shuffleDeck(),p1=state.room.players.player1,p2=state.room.players.player2,muestra=deck[6];
  const mano=otherPlayer(state.room.mano||'player1'),dealer=otherPlayer(mano);
  const patches={};patches[`hands/${state.roomCode}/${p1.uid}/hand`]=deck.slice(0,3);patches[`hands/${state.roomCode}/${p2.uid}/hand`]=deck.slice(3,6);
  patches[`hands/${state.roomCode}/${state.room.table.uid}/envidoTruth`]={player1:handEnvido(deck.slice(0,3),muestra),player2:handEnvido(deck.slice(3,6),muestra)};
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
  patches[`rooms/${state.roomCode}/public/resolvingTrick`]=false;patches[`rooms/${state.roomCode}/public/resolutionId`]=null;patches[`rooms/${state.roomCode}/public/resolvedWinner`]=null;patches[`rooms/${state.roomCode}/public/resolvedTrickWinner`]=null;patches[`rooms/${state.roomCode}/public/handComplete`]=false;patches[`rooms/${state.roomCode}/public/pendingNextHand`]=null;
  patches[`rooms/${state.roomCode}/public/feed`]=[{text:`${message} Se reparte la siguiente mano.`,time:Date.now()},...(state.room.feed||[]).slice(0,6)];
  await state.firebase.update(state.firebase.ref(state.firebase.db),patches);
}
function repairIncompleteHand(room){
  if(!room||room.status!=='started'||room.resolvingTrick||room.pendingNextHand||(room.trickCards||[]).length) return;
  const claims=room.handClaims||{},p1=Number(claims.player1),p2=Number(claims.player2);
  if(!Number.isFinite(p1)||!Number.isFinite(p2)||p1===p2||!((p1===0&&p2>0)||(p2===0&&p1>0))) return;
  const key=`${room.handNumber||1}:${p1}:${p2}`;
  if(state.emptyHandRepairKey===key)return;
  state.emptyHandRepairKey=key;
  writeRoom({pendingNextHand:{id:`empty-hand:${key}`,winner:room.mano||'player1',message:'Se detectó una mano incompleta. Se reparten nuevas cartas.'}}).catch(()=>{state.emptyHandRepairKey=null;});
}
function scheduleTableResolution() {
  const room=state.room;
  if(!room||!isCoordinator())return;
  const isTrick=room.resolvingTrick&&room.trickCards?.length===2;
  const isRedeal=!!room.pendingNextHand;
  if(!isTrick&&!isRedeal){state.resolutionTimerKey=null;clearTimeout(state.resolutionTimer);state.resolutionTimer=null;return;}
  const key=isTrick?`trick:${room.resolutionId}`:`redeal:${room.pendingNextHand.id}`;
  if(state.resolutionTimerKey===key)return;
  clearTimeout(state.resolutionTimer);state.resolutionTimerKey=key;
  state.resolutionTimer=setTimeout(async()=>{
    try{
      const current=state.room;
      if(isTrick&&current?.resolvingTrick&&current.resolutionId===room.resolutionId){
        const winner=current.resolvedWinner, trickWinner=current.resolvedTrickWinner;
        if(current.handComplete&&winner){
          let scores={...current.scores};const points=Number(current.trucoLevel)||1;
          scores[winner]=(scores[winner]||0)+points;
          const florists=Object.keys(current.flors||{});
          scores=settleSingleFlor(current,scores);
          scores=await verifyEnvido(scores);
          const msg=`${current.players[winner].name} gana la mano y suma ${points} ${points===1?'tanto':'tantos'}.${florists.length===1&&!current.florSettled?' Además cobra 3 por la flor.':''}`;
          if(Math.max(...Object.values(scores))>=targetPoints(current)){
            await writeRoom({scores,envidoAudit:null,status:'complete',trickCards:[],resolvingTrick:false,resolutionId:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,feed:topFeed(current,msg)});
          }else await nextHand(winner,scores,current.handNumber||1,msg,true);
        }else{
          await writeRoom({trickCards:[],resolvingTrick:false,resolutionId:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,trickNo:(Number(current.trickNo)||1)+1,turn:trickWinner||current.mano||'player1',feed:topFeed(current,trickWinner?`${current.players[trickWinner].name} gana la baza.`:'Baza parda. Sigue la mano.')});
        }
      }else if(isRedeal&&state.room?.pendingNextHand?.id===room.pendingNextHand.id){
        const pending=state.room.pendingNextHand;
        if(state.room.status!=='complete')await nextHand(pending.winner,state.room.scores||{},state.room.handNumber||1,pending.message||'La mano terminó.');
        else await writeRoom({pendingNextHand:null});
      }
    }catch(error){console.error(error);toast(firebaseError(error));}
    finally{state.resolutionTimer=null;state.resolutionTimerKey=null;}
  },3000);
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
async function playCard(card) {
  if (state.demo) { demoPlay(card); return; }
  if (!state.room || state.playerId==='table' || !state.hand.some((item)=>item.id===card.id)) return;
  const players=state.room.players||{};
  const other=state.playerId==='player1'?'player2':'player1';
  if (!players[state.playerId] || !players[other]) { toast('La mesa necesita a los dos jugadores para continuar.'); return; }
  if (state.room.turn !== state.playerId || state.room.pendingBet || state.room.resolvingTrick) {
    toast('Todavía no es tu turno. Esperá la jugada del otro jugador.');
    return;
  }
  if (state.playActionInFlight) return;
  state.playActionInFlight=true;
  const fb = state.firebase; const newHand = state.hand.filter((item) => item.id !== card.id);
  const previousTrick = state.room.trickCards || [];
  const played = [...previousTrick.slice(-1), { playerId:state.playerId, name:players[state.playerId].name, card }];
  const patches = {};
  patches[`hands/${state.roomCode}/${state.uid}/hand`] = newHand;
  const handCounts={...(state.room.handCounts||{}),[state.playerId]:newHand.length};
  patches[`rooms/${state.roomCode}/public/handCounts`]=handCounts;
  patches[`rooms/${state.roomCode}/public/handClaims/${state.playerId}`]=newHand.length;
  if (played.length < 2) {
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/turn`] = other;
    patches[`rooms/${state.roomCode}/public/playedCount`] = (state.room.playedCount||0)+1;
    patches[`rooms/${state.roomCode}/public/envidoClosed`] = true;
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
    patches[`rooms/${state.roomCode}/public/resolutionId`] = resolutionId;
    patches[`rooms/${state.roomCode}/public/resolvedTrickWinner`] = winner;
    patches[`rooms/${state.roomCode}/public/resolvedWinner`] = handWinner;
    patches[`rooms/${state.roomCode}/public/handComplete`] = ended;
    patches[`rooms/${state.roomCode}/public/playedCount`] = (state.room.playedCount||0)+1;
    patches[`rooms/${state.roomCode}/public/feed`] = topFeed(state.room,winner?`${state.room.players[winner].name} gana la baza.`:'Baza parda.');
  }
  try{await fb.update(fb.ref(fb.db), patches);}catch(error){console.error(error);toast(firebaseError(error));}finally{state.playActionInFlight=false;}
}
function cardSpritePosition(card) {
  const rank=Number(card.rank), column=rank<=7?rank-1:rank-3;
  const rows={'♠':0,'♥':1,'♦':2,'♣':3};
  const row=rows[card.suit]??0;
  return `${(column/9*100).toFixed(4)}% ${(row/3*100).toFixed(4)}%`;
}
function cardAccessibleName(card) {
  const suits={'♠':'espadas','♥':'copas','♦':'oros','♣':'bastos'};
  return `${card.label} de ${suits[card.suit]||card.suit}`;
}

function renderGame() {
  if (!state.room) return;
  renderCallNotice();
  const room = state.room, players=room.players||{}, isTable=state.playerId==='table', mine=players[state.playerId], opponent=players[state.playerId==='player1'?'player2':'player1'];
  document.documentElement.style.setProperty('--tally-board-height',`${50+(targetPoints(room)/10*42+12)*2}px`);
  $('game-view').classList.toggle('table-mode', isTable);
  $('game-view').classList.toggle('player-mode', !isTable);
  const sharedTable = isTable || room.deviceMode === 'two';
  $('game-view').classList.toggle('two-device-mode', !isTable && room.deviceMode === 'two');
  $('demo-device-switcher').classList.toggle('hidden',!state.demo);
  $('demo-device-switcher').querySelectorAll('[data-demo-role]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.demoRole===state.playerId)));
  const drawing=room.status==='drawing';
  $('opening-draw').classList.toggle('hidden',!drawing);
  if(drawing){
    const cards=room.openingDraw?.cards||{},canDraw=!isTable&&!cards[state.playerId];
    const dealer=cards.player1&&cards.player2&&Number(cards.player1.rank)!==Number(cards.player2.rank)
      ?(Number(cards.player1.rank)>Number(cards.player2.rank)?'player1':'player2'):null;
    const mano=dealer?otherPlayer(dealer):null;
    const prompt=isTable?'ESPERANDO QUE LOS JUGADORES TOQUEN SU MAZO':cards[state.playerId]?'CARTA ELEGIDA · ESPERÁ AL OTRO JUGADOR':'TOCÁ EL MAZO PARA SACAR UNA CARTA';
    $('opening-draw').innerHTML=`<p>${prompt}</p><button class="draw-deck" id="draw-deck" ${canDraw?'':'disabled'} aria-label="Sacar carta para sortear repartidor"></button><div class="draw-results">${['player1','player2'].map(player=>`<div class="draw-result ${dealer===player?'draw-winner':''}"><span>${escapeHtml(players[player]?.name||player)}${dealer===player?' · REPARTE':mano===player?' · EMPIEZA':''}</span>${cards[player]?`<div class="draw-card sprite-card" style="--sprite-position:${cardSpritePosition(cards[player])}" aria-label="${cardAccessibleName(cards[player])}"></div><b>${escapeHtml(cardAccessibleName(cards[player]))}</b>`:`<p>${isTable?'Esperando que toque el mazo':'Esperando carta'}</p>`}</div>`).join('')}</div><small>${escapeHtml(dealer?`${players[dealer]?.name} gana el saque y reparte. ${players[mano]?.name} empieza a jugar.`:room.feed?.[0]?.text||'')}</small>`;
    if(canDraw)$('draw-deck').addEventListener('click',()=>drawOpeningCard().catch(error=>{drawInFlight=false;toast(firebaseError(error));renderGame();}));
    $('hand').innerHTML='';$('player-actions').innerHTML='';$('trick-cards').innerHTML='';$('deck-stack').classList.add('hidden');$('muestra-card').classList.add('hidden');$('envido-picker').classList.add('hidden');return;
  }
  const tableName=room.table?.name||'La mesa';
  $('tally-1').innerHTML=renderTally(room.scores?.player1||0,targetPoints(room));$('tally-2').innerHTML=renderTally(room.scores?.player2||0,targetPoints(room));
  const twoPhones=room.deviceMode==='two'&&!isTable;
  const tallyRenderer=twoPhones?renderCompactTally:renderTally;
  const leftPlayer=twoPhones?state.playerId:'player1',rightPlayer=otherPlayer(leftPlayer);
  $('mobile-tally-1').innerHTML=tallyRenderer(room.scores?.[leftPlayer]||0,targetPoints(room));$('mobile-tally-2').innerHTML=tallyRenderer(room.scores?.[rightPlayer]||0,targetPoints(room));
  $('deck-count').textContent=room.deckCount??40;
  $('game-room-code').textContent='MESA ABIERTA';
  $('my-name').textContent=isTable?tableName:(mine?.name||'Vos'); $('my-avatar').textContent=(isTable?tableName:(mine?.name||'V')).slice(0,1).toUpperCase();
  $('opponent-name').textContent=isTable?'Los jugadores':(opponent?.name||'Esperando rival'); $('opponent-avatar').textContent=(isTable?'♠':(opponent?.name||'J').slice(0,1)).toUpperCase();
  const myTurn=!isTable&&room.turn===state.playerId&&room.status==='started'&&!room.resolvingTrick&&state.hand.length>0;
  $('turn-badge').textContent=isTable?'MESA':myTurn?'TU TURNO':'ESPERÁ'; $('turn-badge').classList.toggle('waiting-turn',!myTurn);
  $('hand').innerHTML=isTable?'':state.hand.map((card) => `<button class="hand-card sprite-card ${card.red?'card-red':''}" style="--sprite-position:${cardSpritePosition(card)}" aria-label="${cardAccessibleName(card)}" aria-disabled="${!myTurn}" data-card="${card.id}"><span class="sr-only">${cardAccessibleName(card)}</span></button>`).join('');
  document.querySelectorAll('.hand-card').forEach((button) => button.addEventListener('click', () => {const card=state.hand.find((item)=>item.id===button.dataset.card); if(card) playCard(card);}));
  $('trick-cards').innerHTML=sharedTable?(room.trickCards||[]).map(({card,playerId})=>`<div class="played-card played-card-${playerId||'player1'} sprite-card ${card.red?'card-red':''}" style="--sprite-position:${cardSpritePosition(card)}" role="img" aria-label="${cardAccessibleName(card)}"><span class="sr-only">${cardAccessibleName(card)}</span></div>`).join(''):'';
  const sample=room.muestra;
  $('muestra-card').classList.toggle('hidden',!sharedTable||!sample);
  $('muestra-card').classList.toggle('sprite-card',!!(sharedTable&&sample));
  if (sample && $('muestra-card').dataset.cardId !== sample.id) {
    $('muestra-card').dataset.cardId = sample.id;
    $('muestra-card').style.setProperty('--muestra-dx','0px');
    $('muestra-card').style.setProperty('--muestra-dy','0px');
  }
  $('muestra-card').style.setProperty('--sprite-position',sample?cardSpritePosition(sample):'0% 0%');
  $('muestra-card').setAttribute('aria-label',sample?`${cardAccessibleName(sample)}, muestra`:'Muestra');
  $('muestra-card').innerHTML=sharedTable&&sample?`<span class="sr-only">${cardAccessibleName(sample)}, muestra</span>`:'';
  $('deck-stack').classList.toggle('hidden',!sharedTable);
  $('table-hint').classList.toggle('hidden',!isTable||(room.trickCards||[]).length>0);
  const visibleFeed=(room.feed||[]).filter(({text=''})=>isTable||!/\bjug[oó]/i.test(text));
  $('round-feed').innerHTML=visibleFeed.slice(0,7).map(({text})=>`<div class="feed-item"><i></i><span>${escapeHtml(text)}</span></div>`).join('');
  const actions=$('player-actions');actions.classList.toggle('hidden',isTable||room.status==='complete');
  const pending=room.pendingBet, other=state.playerId==='player1'?'player2':'player1';
  const canEnvido=!room.envidoClosed&&(room.playedCount||0)===0&&!room.flors?.[state.playerId]&&!room.flors?.[other]&&!hasFlor(state.hand,room.muestra);
  let buttons=[];
  if(pending?.revealMode){buttons.push('<span class="action-wait">'+(pending.revealTurn===state.playerId?'Deslizá para elegir tus tantos':'Esperando los tantos del rival…')+'</span>');}
  else if(pending){if(pending.responder===state.playerId){if(['envido','truco'].includes(pending.type)&&(room.playedCount||0)===0&&hasFlor(state.hand,room.muestra)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor">FLOR</button>');if(pending.type==='truco'&&canEnvido)buttons.push('<button class="pass-button" data-action="envido">ENVIDO</button><button class="pass-button" data-action="real">REAL</button><button class="pass-button" data-action="falta">FALTA</button>');buttons.push(`${pending.type==='flor'&&pending.single&&!hasFlor(state.hand,room.muestra)?'':`<button class="call-button" data-action="yes">${pending.type==='flor'?(pending.single?'FLOR':'LA MÍA'):'QUIERO'}</button>`}<button class="pass-button" data-action="no">${pending.type==='flor'&&pending.single?'NO TENGO FLOR':'NO QUIERO'}</button>`);if(pending.type==='truco'&&pending.stake<4)buttons.push(`<button class="pass-button" data-action="raise">${pending.stake===2?'RETRUCO':'VALE 4'}</button>`);if(pending.type==='envido'){buttons.push('<button class="pass-button" data-action="raise-envido">ENVIDO</button><button class="pass-button" data-action="raise-real">REAL</button><button class="pass-button" data-action="raise-falta">FALTA</button>');}if(pending.type==='flor'&&!pending.single){buttons.push('<button class="pass-button" data-action="raise-conflor">CON FLOR ENVIDO</button><button class="pass-button" data-action="raise-faltaflor">CONTRA FLOR AL RESTO</button>');}}else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else {
    if((room.playedCount||0)===0&&state.hand.length&&hasFlor(state.hand,room.muestra)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor">FLOR</button>');
    if(myTurn){
    if(canEnvido)buttons.push('<button class="pass-button" data-action="envido">ENVIDO</button><button class="pass-button" data-action="real">REAL</button><button class="pass-button" data-action="falta">FALTA</button>');
    const level=Number(room.trucoLevel)||1;if(level<4&&(level===1||room.lastTrucoCaller!==state.playerId))buttons.push(`<button class="call-button" data-action="${level===1?'truco':level===2?'retruco':'vale4'}">${level===1?'TRUCO':level===2?'RETRUCO':'VALE 4'}</button>`);
    }else if(!buttons.length)buttons.push('<span class="action-wait">ESPERÁ TU TURNO</span>');
  }
  actions.innerHTML=state.hand.length?buttons.join(''):'<span class="action-wait">ESPERANDO EL REPARTO…</span>';
  renderEnvidoPicker(room);
  actions.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>{const act=button.dataset.action;if(state.demo){demoAction(act);return;}if(['yes','no','raise'].includes(act)||act.startsWith('raise-'))answerBet(act);else if(act==='reveal')revealEnvido();else if(act==='flor')callFlor();else callBet(act);}));
  $('turn-badge').textContent=isTable?'MESA':pending?(pending.responder===state.playerId?'RESPONDÉ':'ESPERANDO'):myTurn?'TU TURNO':'ESPERÁ';$('turn-badge').classList.toggle('waiting-turn',!myTurn||!!pending);
  if(room.status==='complete') toast('¡Partida terminada!');
}
function renderCompactTally(points,target){
  const limit=normalizeTargetPoints(target),n=Math.min(Math.max(0,Math.floor(Number(points)||0)),limit),columns=limit/10;
  const width=Math.max(96,columns*28+8),lines=[];
  for(let group=0;group<Math.ceil(n/5);group++){
    const x=5+(group%columns)*28,y=5+Math.floor(group/columns)*32,size=Math.min(5,n-group*5),d=20;
    const sides=[[x,y,x,y+d],[x,y+d,x+d,y+d],[x+d,y+d,x+d,y],[x+d,y,x,y],[x,y+d,x+d,y]];
    lines.push(...sides.slice(0,size).map(([a,b,c,d])=>`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`));
  }
  return `<svg class="compact-score-sticks" viewBox="0 0 ${width} 64" role="img" aria-label="${n} puntos de ${limit}"><line x1="0" y1="31" x2="${width}" y2="31" stroke="#efebd7" stroke-opacity=".3"/><g fill="none" stroke="#f0eee2" stroke-width="2.5" stroke-linecap="round">${lines.join('')}</g></svg>`;
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
function renderEnvidoPicker(room){
  const el=$('envido-picker'),bet=room.pendingBet,active=bet?.revealMode&&bet.revealTurn===state.playerId;
  el.classList.toggle('hidden',!active);
  if(!active){el.dataset.key='';return;}
  const first=room.mano,opponentPoints=bet.reveals?.[first],second=state.playerId!==first,min=second?Number(opponentPoints)+1:0;
  const key=`${room.handNumber}:${state.playerId}:${opponentPoints??'first'}`;
  if(el.dataset.key===key)return;el.dataset.key=key;el.dataset.value=String(Math.min(50,min));
  el.innerHTML=`<p>${second?`Tu rival declaró ${opponentPoints} tantos`:'Sos mano: declarás primero'}</p><div class="number-wheel" role="listbox" aria-label="Tantos del 0 al 50">${Array.from({length:51},(_,number)=>`<button role="option" aria-selected="${number===min}" ${number<min?'disabled':''} data-number="${number}">${number}</button>`).join('')}</div><div class="declaration-buttons">${min<=50?'<button id="declare-points" class="call-button">DECLARAR <span id="selected-points">'+min+'</span></button>':''}${second?'<button id="good-points" class="pass-button">SON BUENAS</button>':''}</div>`;
  const wheel=el.querySelector('.number-wheel');
  const select=number=>{el.dataset.value=String(number);el.querySelectorAll('[data-number]').forEach(button=>button.setAttribute('aria-selected',String(Number(button.dataset.number)===number)));const label=$('selected-points');if(label)label.textContent=number;};
  wheel.addEventListener('scroll',()=>{const number=Math.max(Math.min(50,min),Math.min(50,Math.round(wheel.scrollLeft/56)));select(number);},{passive:true});
  wheel.querySelectorAll('[data-number]').forEach(button=>button.addEventListener('click',()=>{select(Number(button.dataset.number));wheel.scrollTo({left:Number(button.dataset.number)*56,behavior:'smooth'});}));
  wheel.scrollLeft=Math.min(50,min)*56;
  $('declare-points')?.addEventListener('click',()=>revealEnvido().catch(error=>toast(firebaseError(error))));
  $('good-points')?.addEventListener('click',()=>revealEnvido(true).catch(error=>toast(firebaseError(error))));
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function demoStart(role) {
  state.demo=true;state.roomCode='DEMO1';state.playerId=role;const deck=shuffleDeck();
  state.demoHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};state.hand=role==='table'?[]:[...state.demoHands[role]];
  state.room={status:'started',targetPoints:30,muestra:deck[6],table:{name:'La mesa'},players:{player1:{name:'Matias'},player2:{name:'Nico'}},scores:{player1:0,player2:0},handNumber:1,deckCount:34,turn:'player1',mano:'player1',trickNo:1,trickCards:[],tricks:[],feed:[],playedCount:0,trucoLevel:1,lastTrucoCaller:null,pendingBet:null,flors:{},envidoClosed:false};
  state.room.status='drawing';state.hand=[];
  state.demoTruth={player1:handEnvido(state.demoHands.player1,deck[6]),player2:handEnvido(state.demoHands.player2,deck[6])};
  $('game-room-code').textContent='MESA · DEMO1';renderGame();showView('game-view');
}
function switchDemoRole(role) {
  if(!state.demo||!['table','player1','player2'].includes(role))return;
  state.playerId=role;state.hand=role==='table'?[]:[...(state.demoHands[role]||[])];renderGame();
}
function demoOther(player){return player==='player1'?'player2':'player1';}
function demoHand(player){return state.demoHands?.[player]||[];}
function demoFeed(text){state.room.feed=[{text,time:Date.now()},...(state.room.feed||[])].slice(0,8);const notice=makeCallNotice(text);if(notice)state.room.callNotice=notice;}
function demoScore(player,points,description){
  const amount=Math.max(0,Number(points)||0);if(!amount)return;
  state.room.scores[player]=(state.room.scores[player]||0)+amount;
  demoFeed(`${state.room.players[player].name} ${description} (+${amount}).`);
  if(state.room.scores[player]>=targetPoints(state.room))state.room.status='complete';
}
function demoResolveFlor(bet){
  const values=state.room.flors||{};if(values.player1==null||values.player2==null)return;
  const winner=values.player1===values.player2?(state.room.mano||'player1'):(values.player1>values.player2?'player1':'player2');
  demoScore(winner,bet.stake||3,`gana las flores (${values.player1} a ${values.player2})`);
  state.room.pendingBet=bet.suspendedBet||null;state.room.envidoClosed=true;state.room.florSettled=true;
}
function demoCallAction(kind){
  const room=state.room,caller=state.playerId;if(!room||caller==='table'||room.status!=='started')return;
  const other=demoOther(caller),pending=room.pendingBet;
  const overTruco=pending?.type==='truco'&&pending.responder===caller;
  if(!overTruco&&room.turn!==caller){toast('Todavía no es tu turno.');return;}
  if(pending&&!overTruco){toast('Primero respondé el canto pendiente.');return;}
  if(['envido','real','falta'].includes(kind)){
    if(room.envidoClosed||room.playedCount>0||hasFlor(demoHand(caller),room.muestra)||room.flors?.[other]){toast('El envido está cerrado o hay flor.');return;}
    const amount=kind==='envido'?2:kind==='real'?3:faltanParaGanar(room),base=pending?.type==='envido'?(pending.stake||0):0;
    room.pendingBet={type:'envido',caller,responder:other,stake:kind==='falta'?amount:base+amount,accepted:base,called:kind,reveals:{},suspendedBet:overTruco?pending:null};
    demoFeed(`${room.players[caller].name} canta ${kind==='real'?'real envido':kind==='falta'?'falta envido':'envido'}.`);renderGame();return;
  }
  if(['truco','retruco','vale4'].includes(kind)){
    const wanted={truco:2,retruco:3,vale4:4}[kind],level=Number(room.trucoLevel)||1;
    if(pending||wanted!==level+1||level>=4||(level>1&&room.lastTrucoCaller===caller)){toast('Ese canto no está habilitado ahora.');return;}
    room.pendingBet={type:'truco',caller,responder:other,stake:wanted};room.lastTrucoCaller=caller;
    demoFeed(`${room.players[caller].name} canta ${kind==='vale4'?'vale cuatro':kind}.`);renderGame();
  }
}
function demoAnswerAction(answer){
  const room=state.room,bet=room?.pendingBet,player=state.playerId;if(!bet)return;
  if(bet.type==='envido'&&bet.revealMode&&answer==='yes'){
    revealEnvido();return;
  }
  if(bet.responder!==player)return;
  if(bet.type==='flor'&&bet.single&&answer==='yes'){demoAction('flor');return;}
  if(answer==='raise'&&bet.type==='truco'){
    const value=bet.stake===2?3:4;room.pendingBet={...bet,caller:player,responder:bet.caller,stake:value};room.lastTrucoCaller=player;demoFeed(`${room.players[player].name} canta ${value===3?'retruco':'vale cuatro'}.`);renderGame();return;
  }
  if(answer.startsWith('raise-')&&bet.type==='envido'){
    const kind=answer.slice(6),value=kind==='falta'?faltanParaGanar(room):bet.stake+(kind==='real'?3:2);
    room.pendingBet={...bet,caller:player,responder:bet.caller,accepted:bet.stake,stake:value,called:kind,reveals:{}};demoFeed(`${room.players[player].name} canta ${kind==='falta'?'falta envido':kind==='real'?'real envido':'envido'}.`);renderGame();return;
  }
  if(bet.type==='flor'&&(answer==='raise-conflor'||answer==='raise-faltaflor')){
    const value=answer==='raise-faltaflor'?faltanParaGanar(room):5;room.pendingBet={...bet,caller:player,responder:bet.caller,accepted:bet.stake,stake:value};demoFeed(`${room.players[player].name} responde ${value===5?'con flor envido':'contra flor al resto'}.`);renderGame();return;
  }
  if(answer==='no'){
    demoFeed(`${room.players[player].name} no quiere.`);
    const points=bet.type==='truco'?Math.max(1,(bet.stake||2)-1):bet.type==='flor'?(bet.accepted||3):(bet.accepted||1);
    if(bet.type==='truco'){demoFinishHand(bet.caller,points);return;}
    if(bet.type==='flor')room.florSettled=true;
    demoScore(bet.caller,points,'suma por canto no querido');room.pendingBet=bet.suspendedBet||null;room.envidoClosed=true;renderGame();return;
  }
  if(bet.type==='envido'){
    room.pendingBet={...bet,reveals:{},revealMode:true,revealTurn:room.mano};demoFeed(`${room.players[player].name} quiere. Declara primero ${room.players[room.mano].name}.`);renderGame();return;
  }
  if(bet.type==='flor'){demoFeed(`${room.players[player].name} quiere.`);demoResolveFlor(bet);renderGame();return;}
  room.trucoLevel=bet.stake;room.pendingBet=null;demoFeed(`${room.players[player].name} quiere. El truco queda en ${bet.stake}.`);renderGame();
}
function demoAction(action){
  if(action==='reveal')demoAnswerAction('yes');
  else if(action==='flor'){
    const room=state.room,player=state.playerId;if(player==='table'||room.playedCount>0||room.flors?.[player]!=null||!hasFlor(demoHand(player),room.muestra)){toast('No tenés flor para cantar.');return;}
    const other=demoOther(player);room.flors={...(room.flors||{}),[player]:florValue(demoHand(player),room.muestra)};room.envidoClosed=true;
    const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
    room.pendingBet={type:'flor',single:!room.flors[other],caller:player,responder:other,stake:3,accepted:0,suspendedBet};
    demoFeed(`${room.players[player].name} canta flor.`);renderGame();
  } else if(['yes','no','raise'].includes(action)||action.startsWith('raise-'))demoAnswerAction(action);
  else demoCallAction(action);
}
function demoPlay(card) {
  const player=state.playerId;if(player==='table')return;
  if(state.room.status!=='started'||state.room.resolvingTrick)return;
  if(state.room.pendingBet){toast('Primero respondé el canto pendiente.');return;}
  if(state.room.turn!==player){toast('Todavía no es tu turno. Esperá la jugada del otro jugador.');return;}
  state.demoHands[player]=(state.demoHands[player]||[]).filter((item)=>item.id!==card.id);state.hand=[...state.demoHands[player]];state.room.playedCount=(state.room.playedCount||0)+1;
  state.room.trickCards=[...(state.room.trickCards||[]),{playerId:player,name:state.room.players[player].name,card}];state.room.deckCount--;
  if(state.room.trickCards.length===2){
    const first=state.room.trickCards[0],second=state.room.trickCards[1],winner=cardStrength(first.card,state.room.muestra)===cardStrength(second.card,state.room.muestra)?null:(cardStrength(first.card,state.room.muestra)>cardStrength(second.card,state.room.muestra)?first.playerId:second.playerId);
    state.room.tricks=[...(state.room.tricks||[]),{winner}];
    const wins={player1:state.room.tricks.filter((trick)=>trick.winner==='player1').length,player2:state.room.tricks.filter((trick)=>trick.winner==='player2').length};
    const handWinner=wins.player1>=2?'player1':wins.player2>=2?'player2':state.room.tricks.length>=3?(wins.player1===wins.player2?(state.room.tricks.find((trick)=>trick.winner)?.winner||state.room.mano):wins.player1>wins.player2?'player1':'player2'):null;
    if(winner)state.room.feed.unshift({text:`${state.room.players[winner].name} se lleva la baza.`,time:Date.now()});
    state.room.resolvingTrick=true;
    setTimeout(()=>{state.room.resolvingTrick=false;state.room.trickCards=[];if(handWinner){demoFinishHand(handWinner,state.room.trucoLevel||1);return;}else{state.room.turn=winner||state.room.mano;state.room.trickNo++;}state.hand=state.playerId==='table'?[]:[...(state.demoHands[state.playerId]||[])];renderGame();},3000);
  }else state.room.turn=player==='player1'?'player2':'player1';
  renderGame();toast('Jugada de demostración.');
}
function demoFinishHand(winner,points){
  const room=state.room;
  room.scores=auditEnvidoScores(room,room.scores,state.demoTruth||{});room.envidoAudit=null;
  room.scores[winner]=(room.scores[winner]||0)+points;
  room.scores=settleSingleFlor(room,room.scores);
  if(Math.max(...Object.values(room.scores))>=targetPoints(room)){room.status='complete';room.pendingBet=null;renderGame();return;}
  const deck=shuffleDeck(),mano=otherPlayer(room.mano);
  state.demoHands={player1:deck.slice(0,3),player2:deck.slice(3,6)};
  state.demoTruth={player1:handEnvido(state.demoHands.player1,deck[6]),player2:handEnvido(state.demoHands.player2,deck[6])};
  Object.assign(room,{mano,dealer:otherPlayer(mano),turn:mano,handNumber:room.handNumber+1,tricks:[],trickCards:[],trickNo:1,muestra:deck[6],deckCount:33,playedCount:0,trucoLevel:1,pendingBet:null,lastTrucoCaller:null,flors:{},florSettled:false,envidoClosed:false,callNotice:null});
  state.hand=state.playerId==='table'?[]:[...state.demoHands[state.playerId]];
  demoFeed(`${room.players[room.dealer].name} reparte. Empieza ${room.players[mano].name}.`);renderGame();
}

$('device-mode').addEventListener('change', () => {
  const two = $('device-mode').value === 'two';
  $('role-options').querySelector('[data-role=table]').classList.toggle('hidden', two);
  if(two && state.role === 'table')pickRole('player1');
});
$('create-room').addEventListener('click',()=>configureSetup());
$('open-room-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-room][data-seat]');if(button)joinOpenRoom(button.dataset.room,button.dataset.seat);});
$('role-options').querySelectorAll('.role-card').forEach((card)=>{
  card.addEventListener('click',()=>{
    if(!card.classList.contains('hidden')) pickRole(card.dataset.role);
  });
});
$('back-home').addEventListener('click',()=>{showView('welcome-view');openLobby();});
$('enter-room').addEventListener('click',enterRoom);
$('demo-button').addEventListener('click',()=>demoStart('player1'));
$('start-game').addEventListener('click',async()=>{try{await startGame();}catch(error){console.error(error);toast(firebaseError(error));}});
$('leave-room').addEventListener('click',()=>{if(state.unsubscribe)state.unsubscribe();if(state.privateUnsubscribe)state.privateUnsubscribe();state.room=null;state.demo=false;showView('welcome-view');openLobby();});
$('game-home').addEventListener('click',()=>{if(state.demo){state.demo=false;showView('welcome-view');openLobby();return;}showView('waiting-view');});
$('demo-device-switcher').addEventListener('click',(event)=>{const button=event.target.closest('[data-demo-role]');if(button)switchDemoRole(button.dataset.demoRole);});
$('muestra-card').addEventListener('pointerdown',(event)=>{
  if (!state.demo && state.playerId !== 'table' && state.room?.deviceMode !== 'two') return;
  const card=$('muestra-card'); if(card.classList.contains('hidden')) return;
  card.setPointerCapture?.(event.pointerId); card.classList.add('dragging');
  card._drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,baseX:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dx'))||0,baseY:parseFloat(getComputedStyle(card).getPropertyValue('--muestra-dy'))||0};
});
$('muestra-card').addEventListener('pointermove',(event)=>{
  const card=$('muestra-card'),drag=card._drag; if(!drag||drag.pointerId!==event.pointerId)return;
  card.style.setProperty('--muestra-dx',`${drag.baseX+event.clientX-drag.startX}px`);
  card.style.setProperty('--muestra-dy',`${drag.baseY+event.clientY-drag.startY}px`);
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
  soundEnabled=!soundEnabled;voiceUnlocked=true;
  localStorage.setItem('truco-call-sound',soundEnabled?'on':'off');
  if(soundEnabled)speakCall('Sonido activado');else window.speechSynthesis?.cancel();
  renderCallNotice();
});
document.addEventListener('click',()=>{if(soundEnabled&&!voiceUnlocked){voiceUnlocked=true;speakCall('Sonido activado');}},{capture:true});
$('sound-toggle').addEventListener('click',()=>$('player-sound-toggle').click());
$('close-config').addEventListener('click',()=>showView('setup-view'));
$('save-config').addEventListener('click',()=>{try{const cfg=JSON.parse($('firebase-config').value);if(!firebaseConfigValid(cfg))throw new Error('missing');state.config=cfg;localStorage.setItem(storageKey,JSON.stringify(cfg));toast('Configuración guardada.',true);runPendingAction();}catch{toast('Pegá una configuración Firebase válida.',true);}});
state.config=loadConfig();
try {
  const bundled = await import('./firebase-config.js');
  if (firebaseConfigValid(bundled.firebaseConfig)) state.config = bundled.firebaseConfig;
} catch { /* Optional during initial setup. */ }
if(location.search.includes('demo=mesa'))demoStart('table');
else if (firebaseConfigValid(state.config)) openLobby();
