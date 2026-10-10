function save(){session.hands=state.localHands;session.originals=state.localOriginalHands;session.truth=state.localTruth;return session;}
function clock(){const key=turnClockKey();if(!key){state.room.turnClock=null;return;}if(state.room.turnClock?.key!==key)state.room.turnClock={key,startedAt:now};}
function dealOpening(){const room=state.room,draw=room.openingDraw;
 if(draw.cards.player1.rank===draw.cards.player2.rank){session.drawPool=deckFactory();room.openingDraw={cards:{},endsAt:now+30000};localFeed('Empate en el saque. Vuelvan a tocar el mazo.');return;}
 const dealer=draw.cards.player1.rank>draw.cards.player2.rank?'player1':'player2';
 room.mano=dealer;room.status='started';room.handNumber=0;room.scores={player1:0,player2:0};localDealAfterHand();
}
function advance(){const room=state.room;
 if(room.status==='drawing'){
  const draw=room.openingDraw;draw.cards??={};
  if(draw.cards.player1&&draw.cards.player2){if(now>=draw.resolveAt)dealOpening();}
  else if(now>=draw.endsAt){room.status='closed';room.closeReason='draw-timeout';}
 }
 if(room.resolvingTrick&&now>=room.resolutionEndsAt){
  const winner=settleHand(room.tricks,room);room.resolvingTrick=false;room.resolutionEndsAt=null;room.handComplete=false;room.trickCards=[];
  if(winner)localFinishHand(winner,room.trucoLevel||1);else{room.turn=room.resolvedTrickWinner||room.mano;room.trickNo++;}
 }
 if(room.pendingNextHand&&now>=room.pendingNextHand.endsAt){const pending=room.pendingNextHand;room.pendingNextHand=null;localFinishHand(pending.winner,pending.foldPoints,pending.id.startsWith('fold:')?'fold':'declined');}
 if(room.status==='revealing'&&now>=room.endReveal.endsAt)localDealAfterHand();
 if(room.status==='complete'&&!room.endReveal){const groups=buildEndEvidence(room,state.localOriginalHands);if(groups.length)localShowEvidence(groups);else room.endReveal={done:true};}
 if(room.status==='started'&&room.turnClock&&turnClockRemaining(room.turnClock,now).expired){const changes=turnTimeoutChanges(room);Object.assign(room,changes);if(room.status==='timed-out'){localFeed(room.turnTimeout.message);localFinishHand(room.turnTimeout.winner,room.trucoLevel||1);}}
 clock();return save();
}
function action(player,command){
 state.playerId=player;state.hand=localHand(player);advance();const room=state.room;
 if(!['player1','player2'].includes(player))throw new Error('Invalid player.');
 if(command.kind==='draw'){
  if(room.status!=='drawing'||room.openingDraw.cards[player])throw new Error('El sorteo ya cambió.');
  room.openingDraw.cards[player]=session.drawPool.shift();if(room.openingDraw.cards.player1&&room.openingDraw.cards.player2)room.openingDraw.resolveAt=now+2000;
 }else{
  if(room.status!=='started'||room.resolvingTrick||room.pendingNextHand)throw new Error('Esperá a que termine la pausa.');
  if(command.kind==='play'){if(room.turn!==player||room.pendingBet)throw new Error('No te corresponde jugar una carta.');const card=localHand(player).find(c=>c.id===command.cardId);if(!card)throw new Error('Esa carta no está en tu mano.');localPlay(card);}
  else if(command.kind==='call'){
   if(!['truco','retruco','vale4','envido','real','falta','flor','yes','no','raise','raise-envido','raise-real','raise-falta','raise-conflor','raise-faltaflor'].includes(command.value))throw new Error('Canto inválido.');
   if(['yes','no','raise'].includes(command.value)||command.value.startsWith('raise-')){if(!room.pendingBet||room.pendingBet.responder!==player||room.pendingBet.revealMode)throw new Error('No te corresponde responder.');}
   if(command.value.startsWith('raise-')&&room.pendingBet?.type==='envido'&&!['raise-envido','raise-real','raise-falta'].includes(command.value))throw new Error('Respuesta inválida para envido.');
   if(command.value.startsWith('raise-')&&room.pendingBet?.type==='flor'&&!['raise-conflor','raise-faltaflor'].includes(command.value))throw new Error('Respuesta inválida para flor.');
   if(command.value.startsWith('raise-')&&room.pendingBet?.type==='truco')throw new Error('Respuesta inválida para truco.');
   if(command.value==='raise'&&room.pendingBet.stake>=4)throw new Error('No se puede subir vale cuatro.');
   localAction(command.value);
  }else if(command.kind==='declare')revealEnvido(command.good===true,command.value);
  else if(command.kind==='fold'){if(!canFoldHand(room,player))throw new Error('No podés irte al mazo ahora.');Object.assign(room,foldHandChanges(room,player));}
  else throw new Error('Acción inválida.');
 }
 advance();return save();
}
return {action,advance};
}
function serverDeck(){const cards=[];for(const [suit,name] of [['♦','oro'],['♥','copa'],['♠','espada'],['♣','basto']])for(const rank of [1,2,3,4,5,6,7,10,11,12])cards.push({id:name+'-'+rank,rank,suit,red:['♦','♥'].includes(suit),label:String(rank)});for(let i=cards.length-1;i>0;i--){const j=crypto.randomInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
function newSession(code,players,targetPoints,creditMatch,now=Date.now()){
 if(![10,20,30,40,50,60].includes(targetPoints))throw new Error('Puntaje inválido.');
 return {code,hands:{},originals:{},truth:{},drawPool:serverDeck(),room:{managedCredits:true,creditMatch,deviceMode:'two',status:'drawing',createdAt:now,matchNumber:creditMatch.matchNumber||1,targetPoints,table:players.player1,players,scores:{player1:0,player2:0},handNumber:1,trickNo:1,playedCount:0,tricks:[],trickCards:[],feed:[],trucoLevel:1,flors:{},timeoutCounts:{},openingDraw:{cards:{},endsAt:now+30000}}};
}
module.exports={createReferee,newSession};
