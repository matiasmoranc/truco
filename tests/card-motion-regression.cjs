const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function setup(mobile=false){
 const container={children:[],append(node){this.children.push(node);node.parent=this;}};
 const document={createElement(){return {style:{},dataset:{},setAttribute(){},remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}};}};
 const state={roomCode:'room',playerId:'player1'};
 const context={opponentFlights:new Map(),opponentPlaySnapshot:{scope:null,keys:new Set()},matchMedia:()=>({matches:mobile}),document,state,$:id=>id==='trick-cards'?container:{querySelector:()=>null},CSS:{escape:x=>x},cardImageStyle:()=>'',cardAccessibleName:()=>''};
 context.animateOpponentCard=(card,playerId,node,key)=>{context.flights.push(key);context.opponentFlights.set(key,{node,target:node});};context.flights=[];context.clearOpponentFlight=key=>{context.opponentFlights.delete(key);};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let activeCardFlight=null;'),source.indexOf('function animatePlayedHandCard('))+';globalThis.setFlight=value=>activeCardFlight=value;globalThis.getFlight=()=>activeCardFlight;',context);
 return {context,container};
}
const room={status:'started',handNumber:1,trickCards:[{playerId:'player1',card:{id:'1'}}]};
test('Public updates retain the same table card node and remove completed round cards',()=>{
 const {context,container}=setup();context.renderPlayedCards(room);const node=container.children[0];
 context.renderPlayedCards(room);assert.equal(container.children[0],node);assert.equal(container.children.length,1);
 context.renderPlayedCards({...room,trickCards:[]});assert.equal(container.children.length,0);
});
test('Landing waits for confirmation and reveals the confirmed card in the same update',()=>{
 const {context,container}=setup();let removed=0;
 context.setFlight({cardId:'1',playerId:'player1',room:'room',hand:1,finished:true,node:{remove(){removed++;}}});
 context.renderPlayedCards({...room,trickCards:[]});assert.notEqual(context.getFlight(),null);assert.equal(removed,0);
 context.renderPlayedCards(room);assert.equal(context.getFlight(),null);assert.equal(removed,1);assert.equal(container.children[0].style.visibility,'');
});
test('Confirmation before landing stays hidden until the animation finishes',()=>{
 const {context,container}=setup();const flight={cardId:'1',playerId:'player1',room:'room',hand:1,finished:false,node:{remove(){}}};context.setFlight(flight);
 context.renderPlayedCards(room);const node=container.children[0];assert.equal(node.style.visibility,'hidden');
 flight.finished=true;context.renderPlayedCards(room);assert.equal(container.children[0],node);assert.equal(node.style.visibility,'');
});

const rivalCard=id=>({playerId:'player2',card:{id}});
test('Joining or reloading a hand never replays cards already on the table',()=>{
 const {context}=setup(true);context.renderPlayedCards({...room,trickCards:[rivalCard('r1')]});assert.deepEqual(context.flights,[]);
});
test('An opponent play flies once, remains hidden on repeat snapshots and clears on a new round',()=>{
 const {context,container}=setup(true);context.renderPlayedCards({...room,trickCards:[]});
 const played={...room,trickCards:[rivalCard('r1')]};context.renderPlayedCards(played);
 assert.deepEqual(context.flights,['player2:r1']);assert.equal(container.children[0].style.visibility,'hidden');
 context.renderPlayedCards(played);assert.deepEqual(context.flights,['player2:r1']);
 context.renderPlayedCards({...room,trickCards:[]});assert.equal(context.opponentFlights.size,0);assert.equal(container.children.length,0);
});
test('Changing hands clears the flight and does not animate an old snapshot in the new hand',()=>{
 const {context}=setup(true);context.renderPlayedCards({...room,trickCards:[]});context.renderPlayedCards({...room,trickCards:[rivalCard('r1')]});
 context.renderPlayedCards({...room,handNumber:2,trickCards:[rivalCard('r2')]});assert.equal(context.opponentFlights.size,0);assert.deepEqual(context.flights,['player2:r1']);
});
test('Opponent animations follow the other seat on both desktop and mobile',()=>{
 const desktop=setup(false);desktop.context.renderPlayedCards({...room,trickCards:[]});desktop.context.renderPlayedCards({...room,trickCards:[rivalCard('r1')]});assert.deepEqual(desktop.context.flights,['player2:r1']);
 const {context}=setup(true);context.state.playerId='player2';context.renderPlayedCards({...room,trickCards:[]});context.renderPlayedCards(room);assert.deepEqual(context.flights,['player1:1']);
});

test('Both seats rotate during flight and land at the actual table angle without a final snap',()=>{
 for(const playerId of ['player1','player2']){
  const frames=[],state={playerId,roomCode:'room',room:{handNumber:1}};
  const source={offsetWidth:100,offsetHeight:160,angle:12,classList:{add(){}},getBoundingClientRect:()=>({left:20,top:400,width:123,height:175})};
  const nodes=[];
  const c={state,$:id=>id==='hand'?{querySelector:()=>source}:{append(){}},CSS:{escape:v=>v},removeCardFlight(){},getComputedStyle:n=>({transform:String(n.angle)}),DOMMatrixReadOnly:class{constructor(v){const a=Number(v)*Math.PI/180;this.a=Math.cos(a);this.b=Math.sin(a);}},createPlayedCard(){const n={angle:-6,offsetWidth:58,offsetHeight:84,style:{},setAttribute(){},remove(){},getBoundingClientRect:()=>({left:150,top:200,width:66,height:90}),animate(f,o){frames.push(f);return {finished:new Promise(()=>{}),cancel(){}};}};nodes.push(n);return n;},document:{body:{append(){}}},matchMedia:()=>({matches:false}),renderPlayerHand(){},orderedHand:()=>[]};
  vm.createContext(c);vm.runInContext('let activeCardFlight=null;'+sourceText(),c);c.animatePlayedHandCard({id:'a'});
  const destination=frames[0][1].transform;
  const angle=Number(destination.match(/rotate\(([^d]+)deg\)/)[1]);
  assert.ok(Math.abs(angle+6)<1e-8,playerId);
  assert.match(destination,/scale\(0.58,0.525\)/);
  assert.equal(nodes[1].style.width,'100px');assert.equal(nodes[1].style.height,'160px');
 }
 function sourceText(){return source.slice(source.indexOf('function animatePlayedHandCard('),source.indexOf('let handGesture='));}
});
