'use strict';

// Server-only accounting for the next stage of credited matches. Never import
// this module into the browser or settle from rooms/public.scores: those scores
// are currently client-written. A trusted game referee must supply the result.
function amount(value) {
  if(!Number.isSafeInteger(value)||value<0||value>1000000000)throw new Error('invalid-credit-amount');
  return value;
}
function key(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value)||['__proto__','constructor','prototype'].includes(value))throw new Error('invalid-credit-key');
  return value;
}
function walletFor(ledger,uid) {
  const wallet=ledger.wallets?.[key(uid)];if(!wallet)throw new Error('wallet-not-found');
  amount(wallet.balance);amount(wallet.locked);return wallet;
}
function matchFor(ledger,id) {
  const match=ledger.matches?.[key(id)];if(!match)throw new Error('credit-match-not-found');return match;
}
function reserveStakes(ledger,{id,player1,player2,stake,now}) {
  key(id);key(player1);key(player2);amount(stake);
  if(stake<1||player1===player2||!Number.isFinite(now))throw new Error('invalid-credit-match');
  const old=ledger?.matches?.[id];
  if(old){
    if(old.player1!==player1||old.player2!==player2||old.stake!==stake)throw new Error('credit-match-conflict');
    return ledger; // Retried starts, reconnections and completed IDs never debit twice.
  }
  const next=structuredClone(ledger||{});
  const wallets=[walletFor(next,player1),walletFor(next,player2)];
  for(const wallet of wallets){if(wallet.locked!==0)throw new Error('credits-already-reserved');if(wallet.balance<stake)throw new Error('insufficient-credits');}
  for(const wallet of wallets){wallet.balance-=stake;wallet.locked=stake;}
  next.matches??={};next.matches[id]={player1,player2,stake,status:'reserved',reservedAt:now};return next;
}
function settleVerifiedMatch(ledger,{id,winner,now}) {
  const old=matchFor(ledger,id);key(winner);
  if(![old.player1,old.player2].includes(winner)||!Number.isFinite(now))throw new Error('invalid-credit-winner');
  if(old.status==='settled'){if(old.winner!==winner)throw new Error('credit-result-conflict');return ledger;}
  if(old.status!=='reserved')throw new Error('credit-match-not-reserved');
  const next=structuredClone(ledger),match=matchFor(next,id);
  const a=walletFor(next,match.player1),b=walletFor(next,match.player2);
  if(a.locked!==match.stake||b.locked!==match.stake)throw new Error('credit-reservation-mismatch');
  const won=walletFor(next,winner);won.balance=amount(won.balance+2*match.stake);a.locked=0;b.locked=0;
  Object.assign(match,{status:'settled',winner,settledAt:now});return next;
}
function refundCanceledMatch(ledger,{id,now}) {
  const old=matchFor(ledger,id);if(old.status==='refunded')return ledger;
  if(old.status!=='reserved'||!Number.isFinite(now))throw new Error('credit-match-not-refundable');
  const next=structuredClone(ledger),match=matchFor(next,id);
  for(const uid of [match.player1,match.player2]){const wallet=walletFor(next,uid);if(wallet.locked!==match.stake)throw new Error('credit-reservation-mismatch');wallet.balance=amount(wallet.balance+match.stake);wallet.locked=0;}
  Object.assign(match,{status:'refunded',refundedAt:now});return next;
}

// Invoke only from the trusted server. RTDB retries this update against the
// latest data, atomically changing both wallets and the match's receipt.
async function commitCreditOperation(database,operation,parameters) {
  const functions={reserve:reserveStakes,settle:settleVerifiedMatch,refund:refundCanceledMatch};
  if(!Object.hasOwn(functions,operation))throw new Error('invalid-credit-operation');
  const result=await database.ref('creditEconomy').transaction(current=>current===null?null:functions[operation](current,parameters));
  if(!result.committed)throw new Error('credit-operation-not-committed');
  const ledger=result.snapshot.val();if(!ledger)throw new Error('wallet-not-found');return ledger;
}
module.exports={reserveStakes,settleVerifiedMatch,refundCanceledMatch,commitCreditOperation};
