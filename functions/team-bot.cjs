'use strict';
// Plays a 2v2 seat filled with "Usar bot", at the "difícil" level. Like a person
// it knows its own cards and its partner's (shown to every player at the start of
// the hand); the rivals' cards stay hidden, so truco decisions and the card to play
// come from sampling the hands the rivals could still hold.
const {SEATS,team,ordered,strength,flower,florValue,settledTricks}=require('./team-referee.cjs');

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
function sampleHands(s,p,pool,random){
 const r=s.room,deck=[...pool];
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 const hands={[p]:s.hands[p]||[]},mate=partnerOf(p);
 if(!r.folded?.[mate])hands[mate]=s.hands[mate]||[];
 let k=0;
 for(const q of SEATS)if(team(q)!==team(p)&&!r.folded?.[q]){const n=Math.max(0,3-(r.playedBy?.[q]||0));hands[q]=deck.slice(k,k+n);k+=n;}
 return hands;
}
// Share of sampled hands the bot's team wins, optionally playing `card` now.
function winChance(s,p,random=Math.random,card=null){
 const pool=unseenCards(s,p);let wins=0;
 for(let i=0;i<SAMPLES;i++)if(playOut(s,sampleHands(s,p,pool,random),card?{seat:p,card}:null)===team(p))wins++;
 return wins/SAMPLES;
}
// Best card first; on a tie, the cheaper card.
function rankedCards(s,p,random){
 const m=s.room.muestra;
 return [...(s.hands[p]||[])].sort(byStrength(m)).map(card=>({card,chance:winChance(s,p,random,card)})).sort((a,b)=>b.chance-a.chance);
}

function declarations(s,p){
 const r=s.room,b=r.pendingBet,best=Object.values(b.reveals||{}).reduce((n,v)=>Math.max(n,v),-1);
 const truth=b.type==='flor'?florValue(s.originals[p],r.muestra):s.truth[p];
 return prefer(best<0||truth>best,{kind:'declare',value:truth,good:false},{kind:'declare',value:0,good:true});
}

function answers(s,p,random){
 const r=s.room,b=r.pendingBet,moves=[];
 if(b.type==='truco'){
  const tantos=teamTantos(s,p);
  if(canOpenEnvido(r,p)&&tantos>=27)moves.push(call(tantos>=31?'real':'envido'));
  const chance=winChance(s,p,random),level=b.stake;
  if(level<4&&chance>=(level===2?0.75:0.82))moves.push(call('raise'));
  return [...moves,...prefer(chance>=({2:0.35,3:0.4,4:0.45})[level],call('yes'),call('no'))];
 }
 if(b.type==='envido'){
  const tantos=teamTantos(s,p);
  if(b.called==='envido'&&tantos>=31)moves.push(call('raise-real'));
  else if(b.called==='real'&&tantos>=33)moves.push(call('raise-falta'));
  return [...moves,...prefer(tantos>=({envido:27,real:29,falta:31}[b.called]??29),call('yes'),call('no'))];
 }
 if(b.type==='flor'){
  const ours=[p,partnerOf(p)].filter(q=>r.flors?.[q]!=null&&!r.folded?.[q]).map(q=>florValue(s.originals[q],r.muestra));
  if(!ours.length)return [call('no'),call('yes')];
  const best=Math.max(...ours);
  if(b.called==='flor'&&best>=35)moves.push(call('raise-conflor'));
  return [...moves,...prefer(best>=({conflor:32,falta:34}[b.called]??0),call('yes'),call('no'))];
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
const SIGNAL_WAIT_MS=10000;
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
function botCommands(s,p,random=Math.random){
 if(!mustAct(s,p))return [];
 const r=s.room,b=r.pendingBet;
 if(b?.revealMode)return declarations(s,p);
 if(b)return owesFlor(s,p)&&b.type!=='flor'?[call('flor'),...answers(s,p,random)]:answers(s,p,random);
 const moves=owesFlor(s,p)?[call('flor')]:[],tantos=teamTantos(s,p);
 if(canOpenEnvido(r,p)&&isPie(r,p)&&tantos>=27)moves.push(call(tantos>=31?'real':'envido'));
 const signal=signalFor(r,p),next=r.trucoLevel+1,trucoOpen=next<=4&&r.lastTrucoTeam!==team(p),truco=call({2:'truco',3:'retruco',4:'vale4'}[next]);
 if(signal==='veni'||signal==='juga')return [...moves,...obeyedCards(s,p,signal).map(card=>({kind:'play',cardId:card.id}))];
 const ranked=rankedCards(s,p,random),chance=ranked[0]?.chance??0;
 if(trucoOpen&&(signal==='grita'||chance>=({2:0.66,3:0.74,4:0.8})[next]||next===2&&chance>=0.45&&random()<0.1))moves.push(truco);
 return [...moves,...ranked.map(({card})=>({kind:'play',cardId:card.id}))];
}

module.exports={SIGNAL_WAIT_MS,mustAct,awaitsSignal,signalFor,botCommands,winChance,teamTantos};
