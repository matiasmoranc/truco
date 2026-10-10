const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function setup(){
 const container={children:[],append(node){this.children.push(node);node.parent=this;}};
 const document={createElement(){return {style:{},dataset:{},setAttribute(){},remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}};}};
 const state={roomCode:'room',playerId:'player1'};
 const context={document,state,$:id=>id==='trick-cards'?container:{querySelector:()=>null},CSS:{escape:x=>x},cardImageStyle:()=>'',cardAccessibleName:()=>''};
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
