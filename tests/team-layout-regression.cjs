const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../team-table-ui.js'),'utf8');
const ui=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('The dealer deck follows all four seats relative to every viewer',async()=>{
 const {TEAM_SEATS,teamSeatsFor,dealerPosition,positionDealerDeck}=await ui;
 for(const viewer of TEAM_SEATS){
  const seats=teamSeatsFor(viewer);
  for(let i=0;i<4;i++){
   const position=['self','right','partner','left'][i];
   assert.equal(dealerPosition(seats[i],viewer,true),position);
   const felt={append(el){el.parentElement=this;}},deck={style:{},dataset:{}},sample={style:{},dataset:{}};
   positionDealerDeck(id=>({'felt-area':felt,'deck-stack':deck,'muestra-card':sample}[id]),seats[i],viewer,true);
   assert.equal(deck.parentElement,felt);assert.equal(sample.parentElement,felt);
   assert.equal(deck.dataset.dealerPosition,position);assert.equal(sample.style.top,deck.style.top);
   assert.equal(deck.style.right,'auto');
  }
 }
});
test('Two-player and bot decks are to the right of the local or opposite dealer',async()=>{
 const {dealerPosition}=await ui;
 for(const viewer of ['player1','player2']){
  assert.equal(dealerPosition(viewer,viewer),'self');
  assert.equal(dealerPosition(viewer==='player1'?'player2':'player1',viewer),'partner');
 }
});
