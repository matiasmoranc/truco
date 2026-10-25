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
 const r=s.room,m=r.muestra,hand=s.hands[p]||[];
 const ranks=hand.map(c=>rank(c,m)).sort((a,b)=>b-a),base=ranks.length?(ranks[0]*0.6+(ranks[1]??ranks[0])*0.4):0;
 const won=(r.tricks||[]).filter(t=>t.winner===p).length,lost=(r.tricks||[]).filter(t=>t.winner===other(p)).length;
 return Math.max(0,Math.min(1,base+0.18*won-0.2*lost));
}
const hasFlower=(s,p)=>flower(s.originals?.[p]||s.hands?.[p]||[],s.room.muestra);
const tantos=(s,p)=>Number(s.truth?.[p])||0;
const firstRound=(r,p)=>Number(r.trickNo||1)===1&&!(r.trickCards||[]).some(c=>c.playerId===p)&&!r.envidoClosed;

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

// Whether the table is waiting for `p` to play, answer or declare.
function mustAct(s,p){
 const r=s?.room;
 if(!r||r.status!=='started'||r.resolvingTrick||r.pendingNextHand||!s.hands?.[p]?.length)return false;
 const b=r.pendingBet;
 return b?(b.revealMode?b.revealTurn===p:b.responder===p):r.turn===p;
}

function declarations(s,p){
 const r=s.room,b=r.pendingBet,best=Object.values(b.reveals||{}).filter(Number.isInteger).reduce((n,v)=>Math.max(n,v),-1);
 const value=b.type==='flor'?florValue(s.originals?.[p]||[],r.muestra):tantos(s,p);
 const say={kind:'declare',value,good:false},good={kind:'declare',value:0,good:true};
 return best<0||value>best?[say,good]:[good,say];
}

function answers(s,p,random){
 const r=s.room,b=r.pendingBet,moves=[];
 if(b.type==='truco'){
  // With envido still open and good points, sing it over the truco first.
  if(firstRound(r,p)&&tantos(s,p)>=28)moves.push(call(tantos(s,p)>=31?'real':'envido'));
  const strong=power(s,p),level=Number(b.stake)||2;
  if(level<4&&strong>=0.82)moves.push(call('raise'));
  moves.push(...(strong>=({2:0.42,3:0.5,4:0.58})[level]||random()<0.08?[call('yes'),call('no')]:[call('no'),call('yes')]));
  return moves;
 }
 if(b.type==='envido'){
  const t=tantos(s,p);
  if(b.called!=='falta'&&t>=31)moves.push(call(b.called==='envido'?'raise-real':'raise-falta'));
  const need={envido:26,real:28,falta:31}[b.called]??28;
  moves.push(...(t>=need?[call('yes'),call('no')]:[call('no'),call('yes')]));
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
function botCommands(s,p,random=Math.random){
 if(!mustAct(s,p))return [];
 const r=s.room,b=r.pendingBet,cards=cardOrder(s,p).map(play);
 const fallback=[call('flor'),call('yes'),call('no'),...cards];
 if(b?.revealMode)return unique([...declarations(s,p),...fallback]);
 // Holding a flower, it is sung before anything else.
 const flor=hasFlower(s,p)&&r.flors?.[p]==null&&Number(r.trickNo||1)===1?[call('flor')]:[];
 if(b)return unique([...flor,...answers(s,p,random),...fallback]);
 const moves=[...flor];
 if(!flor.length&&firstRound(r,p)){
  const t=tantos(s,p);
  if(t>=27||t<22&&random()<0.1)moves.push(call(t>=31?'real':'envido'));
 }
 const level=Number(r.trucoLevel)||1,next=level+1,strong=power(s,p);
 const mayRaise=next<=4&&(level===1||r.lastTrucoCaller!==p);
 if(mayRaise&&Number(r.trickNo||1)>1&&(strong>=({2:0.62,3:0.72,4:0.8})[next]||next===2&&random()<0.1))moves.push(call({2:'truco',3:'retruco',4:'vale4'}[next]));
 return unique([...moves,...cards,...fallback]);
}

module.exports={mustAct,botCommands,power,cardOrder};
