'use strict';
// Plays a 2v2 seat filled with "Usar bot", at the "difícil" level. Like a person
// it knows its own cards and its partner's (shown to every player at the start of
// the hand); the rivals' cards stay hidden, so truco decisions and the card to play
// come from sampling the hands the rivals could still hold, keeping only those that
// fit what the table showed: the envido each rival declared, a flor it sang, and the
// cards it already played.
const {SEATS,team,ordered,strength,flower,florValue,envido,settledTricks}=require('./team-referee.cjs');

const DECK=[['♦','oro'],['♥','copa'],['♠','espada'],['♣','basto']].flatMap(([suit,name])=>[1,2,3,4,5,6,7,10,11,12].map(rank=>({id:name+'-'+rank,suit,rank})));
const SAMPLES=40;
const partnerOf=p=>({player1:'player3',player2:'player4',player3:'player1',player4:'player2'})[p];
const call=value=>({kind:'call',value});
const byStrength=m=>(a,b)=>strength(a,m)-strength(b,m);
const prefer=(ok,yes,no)=>ok?[yes,no]:[no,yes];

function teamTantos(s,p){const r=s.room;return Math.max(...[p,partnerOf(p)].filter(q=>!r.folded?.[q]).map(q=>s.truth?.[q]??0));}
const canOpenEnvido=(r,p)=>r.trickNo===1&&!r.envidoClosed&&(r.playedBy?.[p]||0)===0;
// The pie, the team's last player from the mano, is the one who sings envido.
const isPie=(r,p)=>ordered(r.mano).filter(q=>team(q)===team(p)&&!r.folded?.[q]).at(-1)===p;
const owesFlor=(s,p)=>(s.room.playedBy?.[p]||0)===0&&s.room.flors?.[p]==null&&flower(s.originals?.[p]||[],s.room.muestra);

// Every simulated player wins the trick as cheaply as possible, never overtakes
// a partner, and otherwise throws its lowest card.
function simulatedCard(hand,cards,q,m,trickIndex){
 const sorted=[...hand].sort(byStrength(m));
 if(!cards.length)return trickIndex===0&&sorted.length===3?sorted[1]:sorted.at(-1);
 const best=Math.max(...cards.map(c=>strength(c.card,m)));
 if(cards.filter(c=>strength(c.card,m)===best).every(c=>team(c.playerId)===team(q)))return sorted[0];
 return sorted.find(c=>strength(c,m)>best)||sorted[0];
}

// Plays the rest of the hand with the given cards and returns the winning team.
function playOut(s,hands,forced){
 const r=s.room,m=r.muestra,live=SEATS.filter(q=>!r.folded?.[q]);
 const tricks=(r.tricks||[]).map(t=>({winner:t.winner}));
 const left=Object.fromEntries(live.map(q=>[q,[...(hands[q]||[])]]));
 let cards=(r.trickCards||[]).map(c=>({playerId:c.playerId,card:c.card})),turn=r.turn||r.mano;
 while(tricks.length<3){
  for(const q of ordered(turn).filter(q=>live.includes(q)&&!cards.some(c=>c.playerId===q))){
   if(!left[q].length)continue;
   const card=forced?.seat===q?forced.card:simulatedCard(left[q],cards,q,m,tricks.length);
   if(forced?.seat===q)forced=null;
   left[q]=left[q].filter(c=>c.id!==card.id);cards.push({playerId:q,card});
  }
  if(!cards.length)break;
  const best=Math.max(...cards.map(c=>strength(c.card,m))),leaders=cards.filter(c=>strength(c.card,m)===best);
  const winner=new Set(leaders.map(c=>team(c.playerId))).size===1?team(leaders[0].playerId):null;
  tricks.push({winner});
  const done=settledTricks(tricks,r.mano);if(done)return done;
  const lead=winner?leaders[0].playerId:cards[0].playerId;
  turn=live.includes(lead)?lead:ordered(lead).find(q=>live.includes(q));cards=[];
 }
 return settledTricks(tricks,r.mano)||team(r.mano);
}

// Cards the bot has not seen: neither its team's, the muestra, nor any played card.
function unseenCards(s,p){
 const r=s.room,known=new Set([r.muestra?.id]);
 for(const q of [p,partnerOf(p)])for(const c of s.originals?.[q]||[])known.add(c.id);
 for(const t of r.tricks||[])for(const c of t.cards||[])known.add(c.card.id);
 for(const c of r.trickCards||[])known.add(c.card.id);
 return DECK.filter(c=>!known.has(c.id));
}
const shownBy=(r,q)=>[...(r.tricks||[]).flatMap(t=>t.cards||[]),...(r.trickCards||[])].filter(c=>c.playerId===q).map(c=>c.card);
function combos(cards,k){const out=[],pick=(start,acc)=>{if(acc.length===k){out.push(acc.slice());return;}for(let i=start;i<cards.length;i++){acc.push(cards[i]);pick(i+1,acc);acc.pop();}};pick(0,[]);return out;}
// For each rival with a clue, every hidden hand that fits it: its shown cards plus
// the hidden ones must give the envido it declared, and a flor if it sang one.
function rivalOptions(s,p,pool){
 const r=s.room,m=r.muestra,out={};
 const reveals={...(r.envidoAudit?.reveals||{}),...(r.pendingBet?.type==='envido'?r.pendingBet.reveals||{}:{})};
 for(const q of SEATS){
  if(team(q)===team(p)||r.folded?.[q])continue;
  const said=Number.isInteger(reveals[q])&&reveals[q]>=0?reveals[q]:null,sang=r.flors?.[q]!=null;
  if(said==null&&!sang)continue;
  const shown=shownBy(r,q);
  const fits=combos(pool,Math.max(0,3-shown.length)).filter(h=>{const full=[...shown,...h];return (said==null||envido(full,m)===said)&&(!sang||flower(full,m));});
  if(fits.length)out[q]=fits;
 }
 return out;
}
// What the bot knows when it samples: the unseen cards and the hands each rival can hold.
function knowledge(s,p){const pool=unseenCards(s,p);return {pool,options:rivalOptions(s,p,pool)};}
function sampleHands(s,p,{pool,options},random){
 const r=s.room,hands={[p]:s.hands[p]||[]},mate=partnerOf(p),used=new Set();
 if(!r.folded?.[mate])hands[mate]=s.hands[mate]||[];
 // Rivals with clues first: a random hand among those that fit, without reusing cards.
 for(const [q,fits] of Object.entries(options))for(let t=0;t<12;t++){const h=fits[Math.floor(random()*fits.length)];if(h.every(c=>!used.has(c.id))){hands[q]=h;for(const c of h)used.add(c.id);break;}}
 const deck=pool.filter(c=>!used.has(c.id));
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 let k=0;
 for(const q of SEATS)if(team(q)!==team(p)&&!r.folded?.[q]&&!hands[q]){const n=Math.max(0,3-(r.playedBy?.[q]||0));hands[q]=deck.slice(k,k+n);k+=n;}
 return hands;
}
// Share of sampled hands the bot's team wins, optionally playing `card` now.
function winChance(s,p,random=Math.random,card=null,known=knowledge(s,p)){
 let wins=0;
 for(let i=0;i<SAMPLES;i++)if(playOut(s,sampleHands(s,p,known,random),card?{seat:p,card}:null)===team(p))wins++;
 return wins/SAMPLES;
}
// Best card first; on a tie, the cheaper card.
function rankedCards(s,p,random){
 const m=s.room.muestra,known=knowledge(s,p);
 return [...(s.hands[p]||[])].sort(byStrength(m)).map(card=>({card,chance:winChance(s,p,random,card,known)})).sort((a,b)=>b.chance-a.chance);
}

function declarations(s,p){
 const r=s.room,b=r.pendingBet,best=Object.values(b.reveals||{}).reduce((n,v)=>Math.max(n,v),-1);
 const truth=b.type==='flor'?florValue(s.originals[p],r.muestra):s.truth[p];
 return prefer(best<0||truth>best,{kind:'declare',value:truth,good:false},{kind:'declare',value:0,good:true});
}

// Envido and flor thresholds: the 1v1 "difícil" bot's plus 3, since a team table plays more reserved.
// Tantos are the best of the pair. A flower is always sung; con flor envido needs 32 (1v1 accepts it always).
const ENVIDO={open:28,real:36,overTruco:30,raise:35,accept:{envido:26,real:29,falta:33}};
const FLOR={raise:41,accept:{conflor:32,falta:35}};
function answers(s,p,random){
 const r=s.room,b=r.pendingBet,moves=[];
 if(b.type==='truco'){
  const tantos=teamTantos(s,p);
  if(canOpenEnvido(r,p)&&tantos>=ENVIDO.overTruco)moves.push(call(tantos>=ENVIDO.real?'real':'envido'));
  const chance=winChance(s,p,random),level=b.stake;
  if(level<4&&chance>=(level===2?0.75:0.82))moves.push(call('raise'));
  return [...moves,...prefer(chance>=({2:0.35,3:0.4,4:0.45})[level],call('yes'),call('no'))];
 }
 if(b.type==='envido'){
  const tantos=teamTantos(s,p);
  if(b.called!=='falta'&&tantos>=ENVIDO.raise)moves.push(call(b.called==='envido'?'raise-real':'raise-falta'));
  return [...moves,...prefer(tantos>=(ENVIDO.accept[b.called]??ENVIDO.accept.real),call('yes'),call('no'))];
 }
 if(b.type==='flor'){
  const ours=[p,partnerOf(p)].filter(q=>!r.folded?.[q]&&(r.flors?.[q]!=null||q===p&&owesFlor(s,p))).map(q=>florValue(s.originals[q],r.muestra));
  if(!ours.length)return [call('no'),call('yes')];
  const best=Math.max(...ours);
  if(b.called!=='falta'&&best>=FLOR.raise)moves.push(call(b.called==='flor'?'raise-conflor':'raise-faltaflor'));
  return [...moves,...prefer(best>=(FLOR.accept[b.called]??0),call('yes'),call('no'))];
 }
 return [call('no'),call('yes')];
}

// Whether the table is waiting for `p` to play, answer or declare.
function mustAct(s,p){
 const r=s?.room;
 if(!r||r.status!=='started'||r.resolvingTrick||r.pendingNextHand||r.folded?.[p]||!s.hands?.[p])return false;
 const b=r.pendingBet;
 return b?.revealMode?b.revealTurn===p:b?b.responder===p:r.turn===p;
}

// A bot that plays first for its team waits this long for its partner's signal.
const SIGNAL_WAIT_MS=12000;
// Whether the bot's partner (the pie) is a person who can signal it now: vení, jugá or gritá.
function awaitsSignal(s,p){
 const r=s?.room;if(!mustAct(s,p)||r.pendingBet)return false;
 const mates=ordered(r.mano).filter(q=>team(q)===team(p)&&!r.folded?.[q]);
 return mates.length===2&&mates[0]===p&&!r.players?.[mates[1]]?.bot;
}
// The signal the bot got for this trick, if any.
function signalFor(r,p){
 const n=r.teamSignal;if(!n||n.to!==p||n.handNumber!==r.handNumber||n.trickNo!==r.trickNo)return null;
 return n.value||({'Vení':'veni','Jugá':'juga','Gritá':'grita'})[n.text]||null;
}
// Vení: throw the lowest card. Jugá: take the trick as cheaply as possible, or lead the highest.
function obeyedCards(s,p,signal){
 const r=s.room,m=r.muestra,sorted=[...(s.hands[p]||[])].sort(byStrength(m));
 if(signal==='veni')return sorted;
 const best=Math.max(-1,...(r.trickCards||[]).map(c=>strength(c.card,m)));
 const winner=r.trickCards?.length?sorted.find(c=>strength(c,m)>best):null;
 const first=winner||sorted.at(-1);
 return [first,...sorted.filter(c=>c!==first).reverse()];
}

// Commands for the bot in `seat`, best first; the table tries them in order, so
// a rule the bot misjudged falls back to the next legal move. [] = not its move.
const BLUFF=0.15;
function botCommands(s,p,random=Math.random){
 if(!mustAct(s,p))return [];
 const r=s.room,b=r.pendingBet;
 if(b?.revealMode)return declarations(s,p);
 if(b)return owesFlor(s,p)&&b.type!=='flor'?[call('flor'),...answers(s,p,random)]:answers(s,p,random);
 const moves=owesFlor(s,p)?[call('flor')]:[],tantos=teamTantos(s,p);
 // Now and then (about 15% of the time) the pie bluffs an envido with few points.
 if(canOpenEnvido(r,p)&&isPie(r,p)&&(tantos>=ENVIDO.open||tantos<23&&random()<BLUFF))moves.push(call(tantos>=ENVIDO.real?'real':'envido'));
 const signal=signalFor(r,p),next=r.trucoLevel+1,trucoOpen=next<=4&&r.lastTrucoTeam!==team(p),truco=call({2:'truco',3:'retruco',4:'vale4'}[next]);
 if(signal==='veni'||signal==='juga')return [...moves,...obeyedCards(s,p,signal).map(card=>({kind:'play',cardId:card.id}))];
 const ranked=rankedCards(s,p,random),chance=ranked[0]?.chance??0;
 // Never shout in the first round (unless the partner says gritá); later, when the cards look like winning, or as an occasional bluff.
 if(trucoOpen&&(signal==='grita'||r.trickNo>1&&(chance>=({2:0.66,3:0.74,4:0.8})[next]||next===2&&chance<0.3&&random()<BLUFF)))moves.push(truco);
 return [...moves,...ranked.map(({card})=>({kind:'play',cardId:card.id}))];
}

module.exports={SIGNAL_WAIT_MS,mustAct,awaitsSignal,signalFor,botCommands,winChance,teamTantos,rivalOptions,unseenCards};
