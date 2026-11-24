'use strict';
// Plays the house seat of a 1 vs 1 table opened by the lobby (see bot-seat.cjs).
// It only knows its own cards. Its moves come best first, followed by every other
// move that could be legal; the table tries them in order and keeps the first one
// the referee accepts, so a misjudged rule never leaves the table waiting.
const {strength,flower,florValue}=require('./team-referee.cjs');

const DECK=[['♦','oro'],['♥','copa'],['♠','espada'],['♣','basto']].flatMap(([suit,name])=>[1,2,3,4,5,6,7,10,11,12].map(rank=>({id:name+'-'+rank,suit,rank})));
const call=value=>({kind:'call',value});
const play=card=>({kind:'play',cardId:card.id});
const other=p=>p==='player1'?'player2':'player1';
const unique=list=>{const seen=new Set();return list.filter(c=>{const k=JSON.stringify(c);if(seen.has(k))return false;seen.add(k);return true;});};

// 0 (weakest card of the deck) to 1 (strongest), with this hand's muestra.
function rank(card,m){const all=DECK.map(c=>strength(c,m)),mine=strength(card,m);return all.filter(v=>v<mine).length/(all.length-1);}
// How good the cards left look, counting the tricks already won or lost.
function power(s,p){
 const r=s.room,m=r.muestra,held=s.hands[p]||[];
 // With no cards left, the card it already put on the table is what it still has.
 const hand=held.length?held:(r.trickCards||[]).filter(c=>c.playerId===p).map(c=>c.card);
 const ranks=hand.map(c=>rank(c,m)).sort((a,b)=>b-a),base=ranks.length?(ranks[0]*0.6+(ranks[1]??ranks[0])*0.4):0;
 const won=(r.tricks||[]).filter(t=>t.winner===p).length,lost=(r.tricks||[]).filter(t=>t.winner===other(p)).length;
 return Math.max(0,Math.min(1,base+0.18*won-0.2*lost));
}
const hasFlower=(s,p)=>flower(s.originals?.[p]||s.hands?.[p]||[],s.room.muestra);
const tantos=(s,p)=>Number(s.truth?.[p])||0;
const firstRound=(r,p)=>Number(r.trickNo||1)===1&&!(r.trickCards||[]).some(c=>c.playerId===p)&&!r.envidoClosed&&!(Number(r.trucoLevel)>1);

// Cards in the order the bot prefers to play them.
function cardOrder(s,p){
 const r=s.room,m=r.muestra,hand=[...(s.hands[p]||[])].sort((a,b)=>strength(a,m)-strength(b,m));
 const rival=(r.trickCards||[]).find(c=>c.playerId!==p);
 if(rival){
  // Win the trick as cheaply as possible; if it cannot, throw the lowest card.
  const beat=hand.filter(c=>strength(c,m)>strength(rival.card,m));
  return beat.length?[beat[0],...hand.filter(c=>c!==beat[0])]:hand;
 }
 if(Number(r.trickNo||1)===1&&hand.length===3)return [hand[1],hand[0],hand[2]];
 return [...hand].reverse();
}

// Whether the table is waiting for `p` to play, answer or declare. A call must be
// answered even after its last card is down (a truco before the rival's last card).
function mustAct(s,p){
 const r=s?.room;
 if(!r||r.status!=='started'||r.resolvingTrick||r.pendingNextHand||!s.hands?.[p])return false;
 const b=r.pendingBet;
 return b?(b.revealMode?b.revealTurn===p:b.responder===p):r.turn===p&&s.hands[p].length>0;
}

function declarations(s,p){
 const r=s.room,b=r.pendingBet,best=Object.values(b.reveals||{}).filter(Number.isInteger).reduce((n,v)=>Math.max(n,v),-1);
 const value=b.type==='flor'?florValue(s.originals?.[p]||[],r.muestra):tantos(s,p);
 const say={kind:'declare',value,good:false},good={kind:'declare',value:0,good:true};
 return best<0||value>best?[say,good]:[good,say];
}

// How the score looks for the bot: risk 1 when it is well behind or the rival is about to win (it takes
// chances), -1 when it is well ahead (it plays safe), 0 otherwise. rivalNear: the rival needs a few points.
function scoreMood(s,p){
 const r=s.room,target=Number(r.targetPoints)||30,mine=Number(r.scores?.[p])||0,theirs=Number(r.scores?.[other(p)])||0;
 const rivalNear=target-theirs<=Math.max(3,Math.round(target*0.15))&&theirs>=mine,lead=(mine-theirs)/target;
 const risk=lead<=-0.25||rivalNear?1:lead>=0.25&&target-mine>3?-1:0;
 return {risk,rivalNear,mine,theirs,target};
}
// How much the bot doubts the rival: 0 at first; after two bluffs found out, 1 (see observe).
const suspicion=memory=>{const n=Number(memory?.bluffs)||0;return n>=2?1:n>=1?0.4:0;};

function answers(s,p,random,memory){
 const r=s.room,b=r.pendingBet,moves=[],{risk,rivalNear}=scoreMood(s,p),sus=suspicion(memory);
 if(b.type==='truco'){
  // With envido still open and good points, sing it over the truco first.
  if(firstRound(r,p)&&tantos(s,p)>=28)moves.push(call(tantos(s,p)>=30&&(rivalNear||risk>0)?'falta':tantos(s,p)>=31?'real':'envido'));
  const strong=power(s,p),level=Number(b.stake)||2;
  if(level<4&&strong>=0.82-0.05*risk)moves.push(call('raise'));
  // Behind it wants more; ahead it wants less; a rival who bluffed is believed less.
  const need=({2:0.42,3:0.5,4:0.58})[level]-0.06*risk-0.14*sus;
  moves.push(...(strong>=need||random()<0.08+0.1*sus?[call('yes'),call('no')]:[call('no'),call('yes')]));
  return moves;
 }
 if(b.type==='envido'){
  const t=tantos(s,p);
  if(b.called!=='falta'&&(t>=31||t>=29&&rivalNear))moves.push(call(b.called==='envido'&&!rivalNear?'raise-real':'raise-falta'));
  const need=({envido:26,real:28,falta:risk>0?29:risk<0?32:31})[b.called]??28;
  moves.push(...(t>=need-Math.round(2*sus)?[call('yes'),call('no')]:[call('no'),call('yes')]));
  return moves;
 }
 if(b.type==='flor'){
  if(!hasFlower(s,p))return [call('no'),call('yes')];
  const value=florValue(s.originals?.[p]||[],r.muestra);
  if(b.single||b.called==='flor'){if(value>=37)moves.push(call('raise-conflor'));return [...moves,call('yes'),call('raise-faltaflor'),call('no')];}
  const need=b.called==='conflor'?32:35;
  if(b.called==='conflor'&&value>=38)moves.push(call('raise-faltaflor'));
  return [...moves,...(value>=need?[call('yes'),call('no')]:[call('no'),call('yes')])];
 }
 return [call('no'),call('yes')];
}

// Commands for the house seat, best first; [] when it is not its move.
function botCommands(s,p,random=Math.random,memory=null){
 if(!mustAct(s,p))return [];
 const r=s.room,b=r.pendingBet,cards=cardOrder(s,p).map(play);
 const fallback=[call('flor'),call('yes'),call('no'),...cards];
 if(b?.revealMode)return unique([...declarations(s,p),...fallback]);
 // Holding a flower, it is sung before anything else.
 const flor=hasFlower(s,p)&&r.flors?.[p]==null&&Number(r.trickNo||1)===1?[call('flor')]:[];
 if(b)return unique([...flor,...answers(s,p,random,memory),...fallback]);
 const moves=[...flor];
 if(!flor.length&&firstRound(r,p)){
  // Envido with 27 or more; with less than 22 it bluffs 3 times out of 10. With 30 or more and the score
  // tight (it is behind, or the rival is about to win), the falta envido.
  const t=tantos(s,p),{risk,rivalNear}=scoreMood(s,p);
  if(t>=27||t<22&&random()<0.3)moves.push(call(t>=30&&(rivalNear||risk>0)?'falta':t>=31?'real':'envido'));
 }
 const level=Number(r.trucoLevel)||1,next=level+1,strong=power(s,p),{risk}=scoreMood(s,p);
 const mayRaise=next<=4&&(level===1||r.lastTrucoCaller!==p);
 // Behind it calls with less and bluffs more; ahead it waits for better cards.
 const bluff=next===2&&random()<(risk>0?0.2:risk<0?0.04:0.1);
 if(mayRaise&&Number(r.trickNo||1)>1&&(strong>=({2:0.62,3:0.72,4:0.8})[next]-0.07*risk||bluff))moves.push(call({2:'truco',3:'retruco',4:'vale4'}[next]));
 return unique([...moves,...cards,...fallback]);
}

// What the bot remembers of its rival in this match, from what anyone at the table can see (never the
// rival's hidden cards): a bluff is an envido called and then declared under 24 (or "son buenas"), or a truco
// it accepted and the rival then went to the deck or showed no card better than a middling one. Two bluffs
// and it believes the rival less (see suspicion). An honest call takes half a bluff back.
// memory: {bluffs, hand: {n, envido, truco, cards: {id: card}, muestra}}; call it after every move.
function observe(memory,prev,next,house){
 const mem=memory||{bluffs:0,hand:null},rival=other(house),r=next?.room,pr=prev?.room;
 if(!r)return mem;
 const judge=h=>{
  if(!h?.trucoAccepted)return;
  const cards=Object.values(h.cards||{}),best=cards.reduce((n,c)=>Math.max(n,rank(c,h.muestra)),0);
  if(h.folded||cards.length&&best<0.55)mem.bluffs=Math.min(4,mem.bluffs+1);else if(best>=0.8)mem.bluffs=Math.max(0,mem.bluffs-0.5);
 };
 // A fold that ended the last hand is seen with the next hand already dealt.
 if(mem.hand&&r.callNotice?.kind==='fold'&&r.callNotice.from===rival&&r.callNotice.handNumber===mem.hand.n)mem.hand.folded=true;
 // A new hand (or the match is over): the last hand is judged, then forgotten.
 if(mem.hand&&(mem.hand.n!==r.handNumber||r.status==='complete'&&pr?.status!=='complete')){
  judge(mem.hand);mem.hand=null;
 }
 if(r.status!=='started'&&r.status!=='complete')return mem;
 const h=mem.hand??={n:r.handNumber,envido:false,truco:false,trucoAccepted:false,cards:{},muestra:r.muestra};
 const b=r.pendingBet,pb=pr?.pendingBet;
 // The rival went to the deck in this hand.
 if(r.callNotice?.kind==='fold'&&r.callNotice.from===rival&&r.callNotice.handNumber===h.n)h.folded=true;
 if(b&&b.caller===rival&&!(pb&&pb.caller===rival&&pb.type===b.type&&pb.stake===b.stake)){if(b.type==='envido')h.envido=true;if(b.type==='truco')h.truco=true;}
 // The truco the rival called was accepted: the level went up.
 if(h.truco&&(Number(r.trucoLevel)||1)>(Number(pr?.trucoLevel)||1)&&pb?.type==='truco'&&pb.caller===rival)h.trucoAccepted=true;
 for(const c of [...(r.trickCards||[]),...(r.tricks||[]).flatMap(t=>t.played||[])])if(c?.playerId===rival&&c.card)h.cards[c.card.id]=c.card;
 // The envido the rival called is settled: what it declared is on the table.
 const audit=r.envidoAudit;
 if(h.envido&&audit&&!pr?.envidoAudit&&audit.handNumber===r.handNumber){
  const said=audit.reveals?.[rival];
  if(said==null||Number(said)<24)mem.bluffs=Math.min(4,mem.bluffs+1);else if(Number(said)>=28)mem.bluffs=Math.max(0,mem.bluffs-0.5);
  h.envido=false;
 }
 return mem;
}

module.exports={mustAct,botCommands,power,cardOrder,observe,scoreMood,suspicion};
