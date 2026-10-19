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
   const felt={append(el){el.parentElement=this;},getBoundingClientRect:()=>({width:390,height:700})},deck={style:{},dataset:{}},sample={style:{},dataset:{}};
   positionDealerDeck(id=>({'felt-area':felt,'deck-stack':deck,'muestra-card':sample}[id]),seats[i],viewer,true);
   assert.equal(deck.parentElement,felt);assert.equal(sample.parentElement,felt);
   assert.equal(deck.dataset.dealerPosition,position);assert.equal(sample.style.zIndex,'3');assert.equal(deck.style.zIndex,'4');
   assert.equal(deck.style.right,'auto');
  }
 }
});
test('The sample is perpendicular, underneath the deck, and its top points inward at every screen size',async()=>{
 const {dealerDeckPose}=await ui;
 for(const [width,height] of [[320,700],[390,760],[1440,900]])for(const teams of [true,false])for(const seat of teams?['self','right','partner','left']:['self','partner']){
  const pose=dealerDeckPose(seat,teams,width,height);
  assert.ok(Math.abs(pose.deckAngle-pose.sampleAngle-90)<1e-10);
  const theta=pose.sampleAngle*Math.PI/180;
  assert.ok(Math.abs(Math.sin(theta)-pose.inwardX)<1e-10);
  assert.ok(Math.abs(-Math.cos(theta)-pose.inwardY)<1e-10);
  assert.ok(pose.left>15&&pose.left<85);
 }
});
test('Lobby lists both teammates and inline join buttons with the correct team',async()=>{
 const {renderTeamLobbySeats}=await ui,safe=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 let html=renderTeamLobbySeats('ABCDE',{players:{player1:{name:'Juan'}}},safe);
 assert.equal((html.match(/data-team="player1"/g)||[]).length,1);
 assert.equal((html.match(/data-team="player2"/g)||[]).length,2);
 assert.ok(html.indexOf('Juan')<html.indexOf('lobby-team-versus'));
 html=renderTeamLobbySeats('ABCDE',{players:{player1:{name:'<Juan>'},player3:{name:'Ana'}}},safe,true);
 assert.equal((html.match(/data-team="player1"/g)||[]).length,0);
 assert.equal((html.match(/ disabled/g)||[]).length,2);
 assert.ok(html.includes('&lt;Juan>'));assert.ok(!html.includes('<Juan>'));
});
test('Selecting a lobby team preserves that choice and repeated clicks cannot switch an in-flight join',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const fn=app.slice(app.indexOf('function joinOpenRoom('),app.indexOf('function firebaseError('));
 const input={value:'Juan'},context={state:{},$:()=>input,cleanName:s=>s,savedPlayerName:()=>'',enterRoom(){context.calls++;},calls:0};
 require('node:vm').runInNewContext(fn+';joinOpenRoom("ABCDE","player","player2");',context);
 assert.equal(context.state.joinTeam,'player2');assert.equal(context.calls,1);
 context.state.enteringRoom=true;
 require('node:vm').runInNewContext('joinOpenRoom("ABCDE","player","player1");',context);
 assert.equal(context.state.joinTeam,'player2');assert.equal(context.calls,1);
});
test('Two-player and bot decks are to the right of the local or opposite dealer',async()=>{
 const {dealerPosition}=await ui;
 for(const viewer of ['player1','player2']){
  assert.equal(dealerPosition(viewer,viewer),'self');
  assert.equal(dealerPosition(viewer==='player1'?'player2':'player1',viewer),'partner');
 }
});
