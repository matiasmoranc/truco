'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {envidoCards,envido}=require('../functions/team-referee.cjs');
const c=(suit,rank)=>({suit,rank,id:suit+'-'+rank});
const ranks=cards=>cards.map(x=>x.suit+'-'+x.rank).sort();

test('2v2 envido reveal shows only the cards that add up the points',()=>{
 const muestra=c('oro',6);
 // Two of a suit: 7 and 6 de copa = 33; the 12 de basto stays hidden.
 assert.deepEqual(ranks(envidoCards([c('copa',7),c('copa',6),c('basto',12)],muestra)),['copa-6','copa-7']);
 // A piece and the best other card: 2 de oro (30) + 7 de espada = 37.
 const piece=[c('oro',2),c('espada',7),c('basto',3)];
 assert.equal(envido(piece,muestra),37);
 assert.deepEqual(ranks(envidoCards(piece,muestra)),['espada-7','oro-2']);
 // No pair and no piece: the best single card.
 assert.deepEqual(ranks(envidoCards([c('copa',7),c('espada',5),c('basto',12)],muestra)),['copa-7']);
 // Two pieces (an unsung flor): only the best piece counts.
 assert.deepEqual(ranks(envidoCards([c('oro',2),c('oro',4),c('basto',12)],muestra)),['oro-2']);
});
