const FIREBASE_VERSION = '12.4.0';
const $ = (id) => document.getElementById(id);
const views = ['welcome-view', 'setup-view', 'waiting-view', 'game-view', 'config-view'];
const storageKey = 'truco-firebase-config';
let state = { role: 'table', joining: false, config: null, firebase: null, roomCode: null, selectedRoom: null, uid: null, playerId: null, unsubscribe: null, privateUnsubscribe: null, lobbyUnsubscribe: null, room: null, hand: [], demo: false, nextAction: null, resolutionTimer: null, resolutionTimerKey: null, playActionInFlight: false, legacyRepairKey: null };

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
  const label = role === 'table' ? 'la mesa' : role === 'player1' ? 'Jugador 1' : 'Jugador 2';
  $('enter-room').innerHTML = `Crear mesa como ${label} <span class="arrow">↗</span>`;
}
function configureSetup() {
  state.joining = false;
  $('role-options').classList.remove('single');
  $('role-options').querySelectorAll('.role-card').forEach((card) => card.classList.remove('hidden'));
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
      const seatPath = seat === 'table' ? `rooms/${code}/public/table` : `rooms/${code}/public/players/${seat}`;
      const seatRef = fb.ref(fb.db, seatPath);
      const claim = await fb.runTransaction(seatRef, (current) => current == null ? { uid: state.uid, name, online: true } : current);
      if (!claim.committed || claim.snapshot.val()?.uid !== state.uid) { toast('Ese lugar ya está ocupado. Elegí otro puesto.'); openLobby(); return; }
      state.roomCode = code; state.playerId = seat;
    } else {
      const code = makeCode(); state.roomCode = code; state.playerId = state.role;
      const person = { uid: state.uid, name, online: true };
      const targetPoints = Number($('target-points').value || 30);
      const initial = { status: 'waiting', createdAt: Date.now(), targetPoints, table: state.role === 'table' ? person : null, players: { player1: state.role === 'player1' ? person : null, player2: state.role === 'player2' ? person : null }, scores: { player1: 0, player2: 0 }, handNumber: 1, deckCount: 40, trickCards: [], feed: [{ text: `${name} abrió una mesa a ${targetPoints}. Faltan los demás.`, time: Date.now() }] };
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
    const room = value.public, players = room.players || {}, seats = [['table','La mesa',room.table],['player1','Jugador 1',players.player1],['player2','Jugador 2',players.player2]];
    const title = room.table?.name || players.player1?.name || players.player2?.name || 'Mesa abierta';
    const available = seats.filter(([, , person]) => !person);
    return `<article class="lobby-card"><div class="lobby-card-top"><div><p class="eyebrow">MESA ABIERTA · A ${Number(room.targetPoints)||30} TANTOS</p><h3>${escapeHtml(title)}</h3></div><span class="lobby-count">${3-available.length}/3</span></div><div class="lobby-seats">${seats.map(([key,label,person]) => `<span class="lobby-seat ${person?'taken':''}">${person ? `${escapeHtml(label)}: ${escapeHtml(person.name || 'Ocupado')}` : `${escapeHtml(label)} · libre`}</span>`).join('')}</div><div class="lobby-join-options">${available.map(([key,label]) => `<button class="button ${key==='table'?'lobby-table-button':'lobby-player-button'}" data-room="${code}" data-seat="${key}">Unirme como ${label}<span>↗</span></button>`).join('')}</div></article>`;
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
    if(state.playerId==='table'&&state.room.status==='started'&&!state.room.resolvingTrick&&state.room.trickCards?.length===2&&(state.room.tricks||[]).length>0)recoverLegacyTrick(state.room);
    if (state.playerId === 'table') scheduleTableResolution();
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
  $('room-status').textContent = state.room.table && players.player1 && players.player2 ? 'MESA COMPLETA' : 'ESPERANDO LUGARES';
  const seatData = [['table','LA MESA',state.room.table],['player1','JUGADOR 1',players.player1],['player2','JUGADOR 2',players.player2]];
  $('seats').innerHTML = seatData.map(([key,label,value]) => `<div class="seat"><span class="seat-icon">${key==='table'?'♣':key==='player1'?'♠':'♥'}</span><span class="seat-name"><strong>${escapeHtml(value?.name || (key==='table'?'La mesa':'Esperando jugador…'))}</strong><small>${label}</small></span><span class="seat-state ${value?'ready':''}">${value?'LISTO':'ESPERANDO'}</span></div>`).join('');
  const ready = !!(state.room.table && players.player1 && players.player2);
  $('start-game').disabled = !(ready && state.playerId === 'table');
  $('waiting-hint').textContent = state.playerId === 'table' ? (ready ? 'Ya están todos. ¡A jugar!' : 'Esperando que se unan los dos jugadores') : 'Esperá a que la mesa reparta';
  $('game-room-code').textContent = 'MESA ABIERTA';
  $('start-game').textContent = `Repartir · a ${Number(state.room.targetPoints)||30} tantos`;
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
  const muestra = deck[6];
  const patches = {};
  patches[`hands/${state.roomCode}/${players.player1.uid}/hand`] = hand1;
  patches[`hands/${state.roomCode}/${players.player2.uid}/hand`] = hand2;
  patches[`rooms/${state.roomCode}/public/status`] = 'started';
  patches[`rooms/${state.roomCode}/public/deckCount`] = 33;
  patches[`rooms/${state.roomCode}/public/muestra`] = muestra;
  patches[`rooms/${state.roomCode}/public/turn`] = 'player1';
  patches[`rooms/${state.roomCode}/public/mano`] = 'player1';
  patches[`rooms/${state.roomCode}/public/trickCards`] = [];
  patches[`rooms/${state.roomCode}/public/trickNo`] = 1;
  patches[`rooms/${state.roomCode}/public/tricks`] = [];
  patches[`rooms/${state.roomCode}/public/trucoLevel`] = 1;
  patches[`rooms/${state.roomCode}/public/lastTrucoCaller`] = null;
  patches[`rooms/${state.roomCode}/public/pendingBet`] = null;
  patches[`rooms/${state.roomCode}/public/flors`] = {};
  patches[`rooms/${state.roomCode}/public/envidoClosed`] = false;
  patches[`rooms/${state.roomCode}/public/playedCount`] = 0;
  patches[`rooms/${state.roomCode}/public/feed`] = [{text:'Se repartieron tres cartas. Juega primero Jugador 1.',time:Date.now()}];
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
  const pieces = hand.filter((card)=>pieceOrder(card,muestra)>0);
  const suits = hand.reduce((all,card)=>{all[card.suit]=(all[card.suit]||0)+1;return all;},{});
  const nonPieces=hand.filter((card)=>!pieceOrder(card,muestra));
  const twoSameSuit=nonPieces.length===2&&nonPieces[0].suit===nonPieces[1].suit;
  return pieces.length>=2 || Object.values(suits).some((n)=>n===3) || (pieces.length===1&&twoSameSuit);
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
function targetPoints(room) { return Number(room.targetPoints)||30; }
function faltanParaGanar(room) { return Math.max(1,targetPoints(room)-Math.max(Number(room.scores?.player1)||0,Number(room.scores?.player2)||0)); }
async function writeRoom(changes) {
  const fb=state.firebase; const updates={};
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
    const status=scores[bet.caller]>=targetPoints(state.room)?'complete':'started';
    const msg=`${state.room.players[bet.responder].name} no quiere. ${state.room.players[bet.caller].name} suma ${points}.`;
    await writeRoom({scores,status,pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,pendingNextHand:bet.type==='truco'&&status!=='complete'?{id:`declined:${Date.now()}`,winner:bet.caller,message:msg}:null,feed:topFeed(state.room,msg)});
    return;
  }
  if(bet.type==='envido'){
    const reveals={...(bet.reveals||{}),[state.playerId]:handEnvido(state.hand,state.room.muestra)};
    await writeRoom({pendingBet:{...bet,reveals,revealMode:true},feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere el envido. Ahora canten los tantos.`)});return;
  }
  if(bet.type==='flor'){
    const flowers=state.room.flors||{},winner=flowers.player1===flowers.player2?(state.room.mano||'player1'):(flowers.player1>flowers.player2?'player1':'player2');
    const scores={...state.room.scores};scores[winner]=(scores[winner]||0)+bet.stake;
    const status=scores[winner]>=targetPoints(state.room)?'complete':'started';
    await writeRoom({scores,pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,feed:topFeed(state.room,`Flores: ${flowers.player1} a ${flowers.player2}. ${state.room.players[winner].name} suma ${bet.stake}.`),status});return;
  }
  await writeRoom({trucoLevel:bet.stake,pendingBet:null,feed:topFeed(state.room,`${state.room.players[state.playerId].name} quiere. El truco queda en ${bet.stake}.`) });
}
async function revealEnvido() {
  const bet=state.room?.pendingBet;if(bet?.type!=='envido'||!bet.revealMode||bet.reveals?.[state.playerId]!=null||state.playerId==='table')return;
  const reveals={...(bet.reveals||{}),[state.playerId]:handEnvido(state.hand,state.room.muestra)};
  if(reveals.player1!=null&&reveals.player2!=null){
    const winner=reveals.player1===reveals.player2?(state.room.mano||'player1'):(reveals.player1>reveals.player2?'player1':'player2');
    const scores={...state.room.scores};scores[winner]=(scores[winner]||0)+bet.stake;
    const status=scores[winner]>=targetPoints(state.room)?'complete':'started';
    await writeRoom({scores,pendingBet:status==='complete'?null:(bet.suspendedBet||null),envidoClosed:true,feed:topFeed(state.room,`Envido: ${reveals.player1} a ${reveals.player2}. ${state.room.players[winner].name} suma ${bet.stake}.`),status});
  }else await writeRoom({pendingBet:{...bet,reveals}});
}
async function callFlor() {
  const room=state.room,player=state.playerId;if(!room||player==='table'||(room.playedCount||0)>0||!hasFlor(state.hand,room.muestra)){toast('No tenés flor para cantar.');return;}
  const flors={...(room.flors||{}),[player]:florValue(state.hand,room.muestra)};
  const other=player==='player1'?'player2':'player1';
  const suspendedBet=room.pendingBet?.type==='truco'?room.pendingBet:(room.pendingBet?.suspendedBet||null);
  if(flors[other]){
    await writeRoom({flors,envidoClosed:true,pendingBet:{type:'flor',caller:player,responder:other,stake:3,accepted:0,called:'flor',suspendedBet},feed:topFeed(room,`${room.players[player].name} también canta flor. ¿La mía?`)});
  }else{
    await writeRoom({flors,envidoClosed:true,pendingBet:suspendedBet,feed:topFeed(room,`${room.players[player].name} canta flor. Si el rival tiene, que la cante antes de jugar.`)});
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
async function nextHand(winner, scores, handNumber, message) {
  const deck=shuffleDeck(),p1=state.room.players.player1,p2=state.room.players.player2,muestra=deck[6];
  const patches={};patches[`hands/${state.roomCode}/${p1.uid}/hand`]=deck.slice(0,3);patches[`hands/${state.roomCode}/${p2.uid}/hand`]=deck.slice(3,6);
  patches[`rooms/${state.roomCode}/public/status`]=Math.max(...Object.values(scores))>=targetPoints(state.room)?'complete':'started';
  patches[`rooms/${state.roomCode}/public/scores`]=scores;patches[`rooms/${state.roomCode}/public/handNumber`]=handNumber+1;
  patches[`rooms/${state.roomCode}/public/trickNo`]=1;patches[`rooms/${state.roomCode}/public/trickCards`]=[];patches[`rooms/${state.roomCode}/public/tricks`]=[];
  patches[`rooms/${state.roomCode}/public/deckCount`]=33;patches[`rooms/${state.roomCode}/public/muestra`]=muestra;
  patches[`rooms/${state.roomCode}/public/turn`]=winner;patches[`rooms/${state.roomCode}/public/mano`]=winner;
  patches[`rooms/${state.roomCode}/public/trucoLevel`]=1;patches[`rooms/${state.roomCode}/public/pendingBet`]=null;
  patches[`rooms/${state.roomCode}/public/lastTrucoCaller`]=null;
  patches[`rooms/${state.roomCode}/public/flors`]={};patches[`rooms/${state.roomCode}/public/envidoClosed`]=false;patches[`rooms/${state.roomCode}/public/playedCount`]=0;
  patches[`rooms/${state.roomCode}/public/resolvingTrick`]=false;patches[`rooms/${state.roomCode}/public/resolutionId`]=null;patches[`rooms/${state.roomCode}/public/resolvedWinner`]=null;patches[`rooms/${state.roomCode}/public/resolvedTrickWinner`]=null;patches[`rooms/${state.roomCode}/public/handComplete`]=false;patches[`rooms/${state.roomCode}/public/pendingNextHand`]=null;
  patches[`rooms/${state.roomCode}/public/feed`]=[{text:`${message} Se reparte la siguiente mano.`,time:Date.now()},...(state.room.feed||[]).slice(0,6)];
  await state.firebase.update(state.firebase.ref(state.firebase.db),patches);
}
function scheduleTableResolution() {
  const room=state.room;
  if(!room||state.playerId!=='table')return;
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
          const scores={...current.scores},points=Number(current.trucoLevel)||1;
          scores[winner]=(scores[winner]||0)+points;
          const florists=Object.keys(current.flors||{});
          if(florists.length===1)scores[florists[0]]=(scores[florists[0]]||0)+3;
          const msg=`${current.players[winner].name} gana la mano y suma ${points} ${points===1?'tanto':'tantos'}.${florists.length===1?' Además cobra 3 por la flor.':''}`;
          if(Math.max(...Object.values(scores))>=targetPoints(current)){
            await writeRoom({scores,status:'complete',trickCards:[],resolvingTrick:false,resolutionId:null,resolvedWinner:null,resolvedTrickWinner:null,handComplete:false,feed:topFeed(current,msg)});
          }else await nextHand(winner,scores,current.handNumber||1,msg);
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
  },2000);
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
  if (!state.room || state.playerId==='table' || state.room.turn !== state.playerId || state.room.pendingBet || state.room.resolvingTrick || state.playActionInFlight || !state.hand.some((item)=>item.id===card.id)) return;
  state.playActionInFlight=true;
  const fb = state.firebase; const newHand = state.hand.filter((item) => item.id !== card.id);
  const previousTrick = state.room.trickCards || [];
  const played = [...previousTrick.slice(-1), { playerId:state.playerId, name:state.room.players[state.playerId].name, card }];
  const other = state.playerId === 'player1' ? 'player2' : 'player1';
  const patches = {};
  patches[`hands/${state.roomCode}/${state.uid}/hand`] = newHand;
  if (played.length < 2) {
    patches[`rooms/${state.roomCode}/public/trickCards`] = played;
    patches[`rooms/${state.roomCode}/public/turn`] = other;
    patches[`rooms/${state.roomCode}/public/playedCount`] = (state.room.playedCount||0)+1;
    patches[`rooms/${state.roomCode}/public/envidoClosed`] = true;
    patches[`rooms/${state.roomCode}/public/feed`] = topFeed(state.room,`${state.room.players[state.playerId].name} jugó ${card.label} ${card.suit}.`);
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
function renderGame() {
  if (!state.room) return;
  const room = state.room, players=room.players||{}, isTable=state.playerId==='table', mine=players[state.playerId], opponent=players[state.playerId==='player1'?'player2':'player1'];
  $('game-view').classList.toggle('table-mode', isTable);
  $('game-view').classList.toggle('player-mode', !isTable);
  const tableName=room.table?.name||'La mesa';
  $('score-name-1').textContent=players.player1?.name||'Jugador 1'; $('score-name-2').textContent=players.player2?.name||'Jugador 2';
  $('score-1').textContent=room.scores?.player1||0; $('score-2').textContent=room.scores?.player2||0; $('mobile-score-1').textContent=room.scores?.player1||0; $('mobile-score-2').textContent=room.scores?.player2||0;
  $('score-target').textContent=targetPoints(room);
  $('tally-1').innerHTML=renderTally(room.scores?.player1||0,targetPoints(room));$('tally-2').innerHTML=renderTally(room.scores?.player2||0,targetPoints(room));
  $('mobile-target').textContent=targetPoints(room);$('mobile-tally-1').innerHTML=renderTally(room.scores?.player1||0,targetPoints(room));$('mobile-tally-2').innerHTML=renderTally(room.scores?.player2||0,targetPoints(room));
  $('hand-number').textContent=String(room.handNumber||1).padStart(2,'0'); $('mobile-hand').textContent=String(room.handNumber||1).padStart(2,'0'); $('deck-count').textContent=room.deckCount??40;
  $('game-room-code').textContent='MESA ABIERTA';
  $('my-name').textContent=isTable?tableName:(mine?.name||'Vos'); $('my-avatar').textContent=(isTable?tableName:(mine?.name||'V')).slice(0,1).toUpperCase();
  $('opponent-name').textContent=isTable?'Los jugadores':(opponent?.name||'Esperando rival'); $('opponent-avatar').textContent=(isTable?'♠':(opponent?.name||'J').slice(0,1)).toUpperCase();
  const myTurn=state.demo||(!isTable&&room.turn===state.playerId&&room.status==='started'&&!room.resolvingTrick);
  $('turn-badge').textContent=isTable?'MESA':myTurn?'TU TURNO':'ESPERÁ'; $('turn-badge').classList.toggle('waiting-turn',!myTurn);
  $('hand').innerHTML=isTable?'':state.hand.map((card) => `<button class="hand-card ${card.red?'card-red':''}" data-card="${card.id}" ${!myTurn?'disabled':''}><span class="card-rank">${card.label}</span><span class="card-suit">${card.suit}</span><span class="card-value">${card.suit.toUpperCase()}</span></button>`).join('');
  document.querySelectorAll('.hand-card').forEach((button) => button.addEventListener('click', () => {const card=state.hand.find((item)=>item.id===button.dataset.card); if(card) playCard(card);}));
  $('trick-cards').innerHTML=isTable?(room.trickCards||[]).map(({name,card})=>`<div class="played-card ${card.red?'card-red':''}"><span class="card-rank">${card.label}</span><span class="card-suit">${card.suit}</span><span class="card-who">${escapeHtml(name)}</span></div>`).join(''):'';
  const sample=room.muestra;$('muestra-card').classList.toggle('hidden',!isTable||!sample);$('muestra-card').innerHTML=isTable&&sample?`<span>${sample.label}</span><b>${sample.suit}</b><small>MUESTRA</small>`:'';$('deck-stack').classList.toggle('hidden',!isTable);
  $('table-hint').classList.toggle('hidden',!isTable||(room.trickCards||[]).length>0);
  const visibleFeed=(room.feed||[]).filter(({text=''})=>isTable||!/\bjug[oó]/i.test(text));
  $('round-feed').innerHTML=visibleFeed.slice(0,7).map(({text})=>`<div class="feed-item"><i></i><span>${escapeHtml(text)}</span></div>`).join('');
  const actions=$('player-actions');actions.classList.toggle('hidden',isTable||room.status==='complete');
  const pending=room.pendingBet, other=state.playerId==='player1'?'player2':'player1';
  const canEnvido=!room.envidoClosed&&(room.playedCount||0)===0&&!room.flors?.[state.playerId]&&!room.flors?.[other]&&!hasFlor(state.hand,room.muestra);
  let buttons=[];
  if(pending?.revealMode){buttons.push(pending.reveals?.[state.playerId]!=null?'<span class="action-wait">Esperando los tantos del rival…</span>':'<button class="pass-button" data-action="reveal">CANTAR TANTOS</button>');}
  else if(pending){if(pending.responder===state.playerId){if(['envido','truco'].includes(pending.type)&&(room.playedCount||0)===0&&hasFlor(state.hand,room.muestra)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor">FLOR</button>');if(pending.type==='truco'&&canEnvido)buttons.push('<button class="pass-button" data-action="envido">ENVIDO</button><button class="pass-button" data-action="real">REAL</button><button class="pass-button" data-action="falta">FALTA</button>');buttons.push(`<button class="call-button" data-action="yes">${pending.type==='flor'?'LA MÍA':'QUIERO'}</button><button class="pass-button" data-action="no">NO QUIERO</button>`);if(pending.type==='truco'&&pending.stake<4)buttons.push(`<button class="pass-button" data-action="raise">${pending.stake===2?'RETRUCO':'VALE 4'}</button>`);if(pending.type==='envido'){buttons.push('<button class="pass-button" data-action="raise-envido">ENVIDO</button><button class="pass-button" data-action="raise-real">REAL</button><button class="pass-button" data-action="raise-falta">FALTA</button>');}if(pending.type==='flor'){buttons.push('<button class="pass-button" data-action="raise-conflor">CON FLOR ENVIDO</button><button class="pass-button" data-action="raise-faltaflor">CONTRA FLOR AL RESTO</button>');}}else buttons.push('<span class="action-wait">ESPERANDO RESPUESTA…</span>');}
  else {
    if((room.playedCount||0)===0&&state.hand.length&&hasFlor(state.hand,room.muestra)&&!room.flors?.[state.playerId])buttons.push('<button class="call-button" data-action="flor">FLOR</button>');
    if(myTurn){
    if(canEnvido)buttons.push('<button class="pass-button" data-action="envido">ENVIDO</button><button class="pass-button" data-action="real">REAL</button><button class="pass-button" data-action="falta">FALTA</button>');
    const level=Number(room.trucoLevel)||1;if(level<4&&(level===1||room.lastTrucoCaller!==state.playerId))buttons.push(`<button class="call-button" data-action="${level===1?'truco':level===2?'retruco':'vale4'}">${level===1?'TRUCO':level===2?'RETRUCO':'VALE 4'}</button>`);
    }else if(!buttons.length)buttons.push('<span class="action-wait">ESPERÁ TU TURNO</span>');
  }
  actions.innerHTML=buttons.join('');
  actions.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>{const act=button.dataset.action;if(['yes','no','raise'].includes(act)||act.startsWith('raise-'))answerBet(act);else if(act==='reveal')revealEnvido();else if(act==='flor')callFlor();else callBet(act);}));
  $('turn-badge').textContent=isTable?'MESA':pending?(pending.responder===state.playerId?'RESPONDÉ':'ESPERANDO'):myTurn?'TU TURNO':'ESPERÁ';$('turn-badge').classList.toggle('waiting-turn',!myTurn||!!pending);
  if(room.status==='complete') toast('¡Partida terminada!');
}
function renderTally(points,target){const n=Math.min(Math.max(0,Number(points)||0),Number(target)||30),groups=[];for(let left=n;left>0;left-=5){const count=Math.min(5,left);groups.push(`<span class="tally-group ${count===5?'full':''}" aria-hidden="true">${Array.from({length:Math.min(count,4)},()=>'<i></i>').join('')}${count===5?'<b></b>':''}</span>`);}return groups.join('');}
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function demoStart(role) {
  state.demo=true; state.roomCode='DEMO1'; state.playerId=role; const deck=shuffleDeck();
  state.hand=role==='table'?[]:deck.slice(role==='player1'?0:3,role==='player1'?3:6);
  state.room={status:'started',targetPoints:30,muestra:deck[6],table:{name:'La mesa'},players:{player1:{name:'Matias'},player2:{name:'Nico'}},scores:{player1:4,player2:3},handNumber:7,deckCount:33,turn:'player1',mano:'player1',trickNo:2,trickCards:[{playerId:'player2',name:'Nico',card:deck[13]}],feed:[{text:'Nico jugó 7 de copa.',time:Date.now()},{text:'Matias se llevó la baza anterior.',time:Date.now()}]};
  $('game-room-code').textContent='MESA · DEMO1'; renderGame(); showView('game-view');
}
function demoPlay(card) {
  state.hand=state.hand.filter((c)=>c.id!==card.id); state.room.trickCards=[...(state.room.trickCards||[]),{playerId:state.playerId,name:state.room.players[state.playerId].name,card}]; state.room.deckCount--;
  if(state.room.trickCards.length===2){const winner=cardStrength(state.room.trickCards[0].card)>=cardStrength(state.room.trickCards[1].card)?state.room.trickCards[0].playerId:state.room.trickCards[1].playerId;state.room.scores[winner]++;state.room.feed.unshift({text:`${state.room.players[winner].name} se lleva la baza.`,time:Date.now()});setTimeout(()=>{state.room.trickCards=[];state.room.turn='player1';if(!state.hand.length){state.hand=shuffleDeck().slice(0,3);state.room.handNumber++;}renderGame();},700);} else state.room.turn=state.playerId==='player1'?'player2':'player1'; renderGame(); toast('Jugada de demostración.');
}

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
$('mobile-history').addEventListener('click',()=>toast('La partida queda a la vista en la pantalla de mesa.'));
$('sound-toggle').addEventListener('click',()=>toast('El sonido se agrega en una próxima versión.'));
$('close-config').addEventListener('click',()=>showView('setup-view'));
$('save-config').addEventListener('click',()=>{try{const cfg=JSON.parse($('firebase-config').value);if(!firebaseConfigValid(cfg))throw new Error('missing');state.config=cfg;localStorage.setItem(storageKey,JSON.stringify(cfg));toast('Configuración guardada.',true);runPendingAction();}catch{toast('Pegá una configuración Firebase válida.',true);}});
state.config=loadConfig();
try {
  const bundled = await import('./firebase-config.js');
  if (firebaseConfigValid(bundled.firebaseConfig)) state.config = bundled.firebaseConfig;
} catch { /* Optional during initial setup. */ }
if(location.search.includes('demo=mesa'))demoStart('table');
else if (firebaseConfigValid(state.config)) openLobby();
