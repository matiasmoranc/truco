const FIREBASE_VERSION = '12.4.0';
const $ = (id) => document.getElementById(id);
const views = ['welcome-view', 'setup-view', 'waiting-view', 'game-view', 'config-view'];
const storageKey = 'truco-firebase-config';
let state = { role: 'mesa', joining: false, config: null, firebase: null, roomCode: null, uid: null, playerId: null, unsubscribe: null, privateUnsubscribe: null, room: null, hand: [], demo: false, nextAction: null };

function showView(id) { views.forEach((name) => $(name).classList.toggle('active', name === id)); }
function toast(message, global = false) {
  const el = $(global ? 'global-toast' : 'toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}
function makeCode() { return Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join(''); }
function cleanName(value, fallback) { return value.trim().slice(0,18) || fallback; }
function pickRole(role) {
  state.role = role;
  document.querySelectorAll('.role-card').forEach((card) => card.classList.toggle('selected', card.dataset.role === role));
  $('enter-room').innerHTML = `${state.joining ? 'Unirme a la mesa' : (role === 'mesa' ? 'Crear mesa' : 'Crear mesa como jugador')} <span class="arrow">↗</span>`;
}
function configureSetup(joining) {
  state.joining = joining;
  $('room-code-wrap').classList.toggle('hidden', !joining);
  $('role-options').classList.toggle('single', !joining);
  $('role-options').querySelectorAll('.role-card').forEach((card) => {
    card.classList.toggle('hidden', joining ? card.dataset.role === 'mesa' : card.dataset.role !== 'mesa');
  });
  if (joining && state.role === 'mesa') pickRole('player1');
  if (!joining) pickRole('mesa');
  $('enter-room').innerHTML = `${joining ? 'Unirme a la mesa' : 'Crear mesa'} <span class="arrow">↗</span>`;
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
}
function showConfig() {
  $('firebase-config').value = state.config ? JSON.stringify(state.config, null, 2) : '';
  showView('config-view');
}
async function enterRoom() {
  const name = cleanName($('player-name').value, state.role === 'mesa' ? 'La mesa' : 'Jugador');
  if (state.joining && $('room-code').value.trim().length < 5) { toast('Ingresá el código de 5 letras.'); return; }
  if (!firebaseConfigValid(state.config)) { state.nextAction = 'enter'; showConfig(); return; }
  try {
    const fb = await firebaseServices();
    if (state.joining) {
      const code = $('room-code').value.trim().toUpperCase();
      const roomRef = fb.ref(fb.db, `rooms/${code}/public`);
      const snap = await fb.get(roomRef);
      if (!snap.exists()) { toast('No encontramos esa mesa. Revisá el código.'); return; }
      const seat = state.role;
      const seatRef = fb.ref(fb.db, `rooms/${code}/public/players/${seat}`);
      const claim = await fb.runTransaction(seatRef, (current) => current == null ? { uid: state.uid, name, online: true } : current);
      if (!claim.committed || claim.snapshot.val()?.uid !== state.uid) { toast('Ese lugar ya está ocupado.'); return; }
      state.roomCode = code; state.playerId = seat;
    } else {
      if (state.role !== 'mesa') { toast('Para crear una mesa, elegí el lugar de la mesa.'); return; }
      const code = makeCode(); state.roomCode = code; state.playerId = 'table';
      const initial = { public: { status: 'waiting', createdAt: Date.now(), table: { uid: state.uid, name }, players: { player1: null, player2: null }, scores: { player1: 0, player2: 0 }, handNumber: 1, deckCount: 40, trickCards: [], feed: [{ text: 'Mesa creada. Que se sienten los jugadores.', time: Date.now() }] } };
      await fb.set(fb.ref(fb.db, `rooms/${code}/public`), initial.public);
    }
    localStorage.setItem('truco-last-seat', JSON.stringify({ code: state.roomCode, role: state.playerId }));
    watchRoom(); renderWaiting(); showView('waiting-view');
  } catch (error) {
    console.error(error); toast(firebaseError(error));
  }
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
    if (!snapshot.exists()) { toast('La mesa ya no está disponible.'); showView('welcome-view'); return; }
    state.room = snapshot.val();
    if (state.room.status === 'started' || state.room.status === 'complete') { showView('game-view'); watchPrivateHand(); renderGame(); }
    else if (state.room.status === 'waiting') { renderWaiting(); if (!$('waiting-view').classList.contains('active')) showView('waiting-view'); }
  });
}
function watchPrivateHand() {
  if (state.playerId === 'table') return;
  if (state.privateUnsubscribe) state.privateUnsubscribe();
  const fb = state.firebase;
  state.privateUnsubscribe = fb.onValue(fb.ref(fb.db, `hands/${state.roomCode}/${state.uid}/hand`), (snapshot) => {
    state.hand = snapshot.val() || []; renderGame();
  });
}
function renderWaiting() {
  if (!state.room) return;
  const players = state.room.players || {};
  $('room-code-display').textContent = state.roomCode.split('').join(' ');
  $('room-status').textContent = players.player1 && players.player2 ? 'MESA COMPLETA' : 'ESPERANDO JUGADORES';
  const seatData = [['table','LA MESA',state.room.table],['player1','JUGADOR 1',players.player1],['player2','JUGADOR 2',players.player2]];
  $('seats').innerHTML = seatData.map(([key,label,value]) => `<div class="seat"><span class="seat-icon">${key==='table'?'♣':key==='player1'?'♠':'♥'}</span><span class="seat-name"><strong>${escapeHtml(value?.name || (key==='table'?'La mesa':'Esperando jugador…'))}</strong><small>${label}</small></span><span class="seat-state ${value?'ready':''}">${value?'LISTO':'ESPERANDO'}</span></div>`).join('');
  const ready = !!(players.player1 && players.player2);
  $('start-game').disabled = !(ready && state.playerId === 'table');
  $('waiting-hint').textContent = state.playerId === 'table' ? (ready ? 'Ya están todos. ¡A jugar!' : 'Esperando que se unan los dos jugadores') : 'Compartí el código y esperá a que la mesa reparta';
  $('game-room-code').textContent = `MESA · ${state.roomCode}`;
}
function shuffleDeck() {
  const suits = [{name:'oro',symbol:'♦',red:true},{name:'copa',symbol:'♥',red:true},{name:'espada',symbol:'♠',red:false},{name:'basto',symbol:'♣',red:false}];
  const deck = [];
  for (const suit of suits) for (const rank of [1,2,3,4,5,6,7,10,11,12]) deck.push({id:`${suit.name}-${rank}`, rank, suit:suit.symbol, red:suit.red, label:rank===10?'Sota':rank===11?'Caballo':rank===12?'Rey':String(rank)});
  for (let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
async function startGame() {
  const fb = state.firebase; const deck = shuffleDeck(); const players = state.room.players;
  const hand1 = deck.slice(0,3); const hand2 = deck.slice(3,6);
  const patches = {};
  patches[`hands/${state.roomCode}/${players.player1.uid}/hand`] = hand1;
  patches[`hands/${state.roomCode}/${players.player2.uid}/hand`] = hand2;
  patches[`rooms/${state.roomCode}/public/status`] = 'started';
  patches[`rooms/${state.roomCode}/public/deckCount`] = 34;
  patches[`rooms/${state.roomCode}/public/turn`] = 'player1';
  patches[`rooms/${state.roomCode}/public/trickCards`] = [];
  patches[`rooms/${state.roomCode}/public/trickNo`] = 1;
  patches[`rooms/${state.roomCode}/public/feed`] = [{text:'Se repartieron las cartas. Juega primero Jugador 1.',time:Date.now()}];
  await fb.update(fb.ref(fb.db), patches);
}
function cardStrength(card) { const order = {3:10,2:9,1:8,12:7,11:6,10:5,7:4,6:3,5:2,4:1}; return order[card.rank] || 0; }
async function playCard(card) {
  if (state.demo) { demoPlay(card); return; }
  if (!state.room || state.playerId==='table' || state.room.turn !== state.playerId) return;
  const fb = state.firebase; const newHand = state.hand.filter((item) => item.id !== card.id);
  const previousTrick = state.room.trickCards || [];
  const played = previousTrick.length >= 2 ? [{ playerId:state.playerId, name:state.room.players[state.playerId].name, card }] : [...previousTrick, { playerId:state.playerId, name:state.room.players[state.playerId].name, card }];
  const other = state.playerId === 'player1' ? 'player2' : 'player1';
  const patches = {};
  patches[`hands/${state.roomCode}/${state.uid}/hand`] = newHand;
  if (played.length < 2) {
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/turn`] = other;
    patches[`rooms/${state.roomCode}/public/feed`] = [{text:`${state.room.players[state.playerId].name} jugó ${card.label} ${card.suit}.`,time:Date.now()},...(state.room.feed || []).slice(0,7)];
  } else {
    const a = played[0], b = played[1], winner = cardStrength(a.card) === cardStrength(b.card) ? null : cardStrength(a.card)>cardStrength(b.card) ? a.playerId : b.playerId;
    const scores = {...state.room.scores}; if (winner) scores[winner] = (scores[winner] || 0)+1;
    const handOver = (state.room.trickNo || 1) >= 3;
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/scores`] = scores;
    patches[`rooms/${state.roomCode}/public/turn`] = winner || 'player1';
    patches[`rooms/${state.roomCode}/public/trickNo`] = (state.room.trickNo || 1)+1;
    patches[`rooms/${state.roomCode}/public/feed`] = [{text:winner?`${state.room.players[winner].name} se lleva la baza.`:'Baza parda: nadie suma.',time:Date.now()},...(state.room.feed || []).slice(0,7)];
    if (handOver) {
      const nextDeck = shuffleDeck(); const p1=state.room.players.player1,p2=state.room.players.player2;
      patches[`hands/${state.roomCode}/${p1.uid}/hand`] = nextDeck.slice(0,3);
      patches[`hands/${state.roomCode}/${p2.uid}/hand`] = nextDeck.slice(3,6);
      patches[`rooms/${state.roomCode}/public/status`] = Math.max(...Object.values(scores))>=15?'complete':'started';
      patches[`rooms/${state.roomCode}/public/handNumber`] = (state.room.handNumber||1)+1;
      patches[`rooms/${state.roomCode}/public/trickNo`] = 1;
      patches[`rooms/${state.roomCode}/public/trickCards`] = [];
      patches[`rooms/${state.roomCode}/public/deckCount`] = 34;
      patches[`rooms/${state.roomCode}/public/turn`] = winner;
      patches[`rooms/${state.roomCode}/public/feed`] = [{text:`${state.room.players[winner].name} gana la mano y suma 1 punto.`,time:Date.now()},...(state.room.feed||[]).slice(0,6)];
    }
  }
  await fb.update(fb.ref(fb.db), patches);
}
function renderGame() {
  if (!state.room) return;
  const room = state.room, players=room.players||{}, isTable=state.playerId==='table', mine=players[state.playerId], opponent=players[state.playerId==='player1'?'player2':'player1'];
  const tableName=room.table?.name||'La mesa';
  $('score-name-1').textContent=players.player1?.name||'Jugador 1'; $('score-name-2').textContent=players.player2?.name||'Jugador 2';
  $('score-1').textContent=room.scores?.player1||0; $('score-2').textContent=room.scores?.player2||0; $('mobile-score-1').textContent=room.scores?.player1||0; $('mobile-score-2').textContent=room.scores?.player2||0;
  $('score-progress-1').style.flex=(room.scores?.player1||0)+1; $('score-progress-2').style.flex=(room.scores?.player2||0)+1;
  $('hand-number').textContent=String(room.handNumber||1).padStart(2,'0'); $('mobile-hand').textContent=String(room.handNumber||1).padStart(2,'0'); $('deck-count').textContent=room.deckCount??40;
  $('game-room-code').textContent=`MESA · ${state.roomCode}`;
  $('my-name').textContent=isTable?tableName:(mine?.name||'Vos'); $('my-avatar').textContent=(isTable?tableName:(mine?.name||'V')).slice(0,1).toUpperCase();
  $('opponent-name').textContent=isTable?'Los jugadores':(opponent?.name||'Esperando rival'); $('opponent-avatar').textContent=(isTable?'♠':(opponent?.name||'J').slice(0,1)).toUpperCase();
  const myTurn=state.demo||(!isTable&&room.turn===state.playerId);
  $('turn-badge').textContent=isTable?'MESA':myTurn?'TU TURNO':'ESPERÁ'; $('turn-badge').classList.toggle('waiting-turn',!myTurn);
  $('hand').innerHTML=isTable?'<p class="table-hint">VISTA DE MESA<br>LAS MANOS SON PRIVADAS</p>':state.hand.map((card) => `<button class="hand-card ${card.red?'card-red':''}" data-card="${card.id}" ${!myTurn?'disabled':''}><span class="card-rank">${card.label}</span><span class="card-suit">${card.suit}</span><span class="card-value">${card.suit.toUpperCase()}</span></button>`).join('');
  document.querySelectorAll('.hand-card').forEach((button) => button.addEventListener('click', () => {const card=state.hand.find((item)=>item.id===button.dataset.card); if(card) playCard(card);}));
  $('trick-cards').innerHTML=(room.trickCards||[]).map(({name,card})=>`<div class="played-card ${card.red?'card-red':''}"><span class="card-rank">${card.label}</span><span class="card-suit">${card.suit}</span><span class="card-who">${escapeHtml(name)}</span></div>`).join('');
  $('table-hint').classList.toggle('hidden',(room.trickCards||[]).length>0);
  $('round-feed').innerHTML=(room.feed||[]).slice(0,7).map(({text})=>`<div class="feed-item"><i></i><span>${escapeHtml(text)}</span></div>`).join('');
  $('player-actions').classList.toggle('hidden',isTable);
  $('player-actions').querySelectorAll('button').forEach((button)=>button.disabled=!myTurn);
  if(room.status==='complete') toast('¡Partida terminada!');
}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function demoStart(role) {
  state.demo=true; state.roomCode='DEMO1'; state.playerId=role; const deck=shuffleDeck();
  state.hand=role==='table'?[]:deck.slice(role==='player1'?0:3,role==='player1'?3:6);
  state.room={status:'started',table:{name:'La mesa'},players:{player1:{name:'Matias'},player2:{name:'Nico'}},scores:{player1:4,player2:3},handNumber:7,deckCount:28,turn:'player1',trickNo:2,trickCards:[{playerId:'player2',name:'Nico',card:deck[13]}],feed:[{text:'Nico jugó 7 de copa.',time:Date.now()},{text:'Matias se llevó la baza anterior.',time:Date.now()}]};
  $('game-room-code').textContent='MESA · DEMO1'; renderGame(); showView('game-view');
}
function demoPlay(card) {
  state.hand=state.hand.filter((c)=>c.id!==card.id); state.room.trickCards=[...(state.room.trickCards||[]),{playerId:state.playerId,name:state.room.players[state.playerId].name,card}]; state.room.deckCount--;
  if(state.room.trickCards.length===2){const winner=cardStrength(state.room.trickCards[0].card)>=cardStrength(state.room.trickCards[1].card)?state.room.trickCards[0].playerId:state.room.trickCards[1].playerId;state.room.scores[winner]++;state.room.feed.unshift({text:`${state.room.players[winner].name} se lleva la baza.`,time:Date.now()});setTimeout(()=>{state.room.trickCards=[];state.room.turn='player1';if(!state.hand.length){state.hand=shuffleDeck().slice(0,3);state.room.handNumber++;}renderGame();},700);} else state.room.turn=state.playerId==='player1'?'player2':'player1'; renderGame(); toast('Jugada de demostración.');
}

$('create-room').addEventListener('click',()=>configureSetup(false));
$('show-join').addEventListener('click',()=>configureSetup(true));
$('back-home').addEventListener('click',()=>showView('welcome-view'));
$('enter-room').addEventListener('click',enterRoom);
$('demo-button').addEventListener('click',()=>demoStart('player1'));
$('start-game').addEventListener('click',async()=>{try{await startGame();}catch(error){console.error(error);toast(firebaseError(error));}});
$('copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.roomCode);toast('Código copiado.');}catch{toast(`Código: ${state.roomCode}`);}});
$('leave-room').addEventListener('click',()=>{if(state.unsubscribe)state.unsubscribe();if(state.privateUnsubscribe)state.privateUnsubscribe();state.room=null;state.demo=false;showView('welcome-view');});
$('game-home').addEventListener('click',()=>{if(state.demo){state.demo=false;showView('welcome-view');return;}showView('waiting-view');});
$('mobile-history').addEventListener('click',()=>toast('La partida queda a la vista en la pantalla de mesa.'));
$('sound-toggle').addEventListener('click',()=>toast('El sonido se agrega en una próxima versión.'));
$('show-join').addEventListener('click',()=>{$('room-code').value='';});
$('player-actions').querySelector('.call-button').addEventListener('click',()=>toast('Los cantos se habilitan al definir la variante de reglas.'));
$('player-actions').querySelector('.pass-button').addEventListener('click',()=>toast('Los cantos se habilitan al definir la variante de reglas.'));
$('close-config').addEventListener('click',()=>showView('setup-view'));
$('save-config').addEventListener('click',()=>{try{const cfg=JSON.parse($('firebase-config').value);if(!firebaseConfigValid(cfg))throw new Error('missing');state.config=cfg;localStorage.setItem(storageKey,JSON.stringify(cfg));toast('Configuración guardada.',true);runPendingAction();}catch{toast('Pegá una configuración Firebase válida.',true);}});
state.config=loadConfig();
if(location.search.includes('demo=mesa'))demoStart('table');
