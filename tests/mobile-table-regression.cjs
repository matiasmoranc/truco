const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function extract(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));}
function harness(){
 const context={opponentFlights:new Map(),state:{playerId:'player1'},otherPlayer:id=>id==='player1'?'player2':'player1'};
 vm.createContext(context);vm.runInContext(extract('opponentCardCount','renderOpponentHand'),context);return context;
}
const play=(playerId,id)=>({playerId,card:{id}});
test('Opponent count uses only public plays and never counts the resolving trick twice',()=>{
 const c=harness();Object.defineProperty(c.state,'localHands',{get(){throw Error('Private hand must not be read');}});
 const a=play('player2','a'),b=play('player2','b');
 const room={status:'started',tricks:[{played:[a,play('player1','x')]},{played:[b]}],trickCards:[b]};
 assert.equal(c.opponentCardCount(room),1);
 c.state.playerId='player2';assert.equal(c.opponentCardCount(room),2);
 assert.equal(c.opponentCardCount({status:'started',tricks:[],trickCards:[]}),3);
});
test('Confirmed counts take priority and inactive or finished hands show no backs',()=>{
 const c=harness();assert.equal(c.opponentCardCount({status:'started',handCounts:{player2:0}}),0);
 for(const status of ['drawing','revealing','complete','closed'])assert.equal(c.opponentCardCount({status,handCounts:{player2:3}}),0);
 assert.equal(c.opponentCardCount({status:'started',handCounts:{player2:20},trickCards:[play('player2','a')]}),2);
});
test('Call anchors follow the correct visible hand in game-relative coordinates',()=>{
 const c=harness(),properties={},card=rect=>({getBoundingClientRect:()=>rect});let speaker='self';
 const nodes={
  'call-notice':{classList:{contains:()=>false},getAttribute:()=>speaker,style:{setProperty:(key,value)=>properties[key]=value}},
  hand:{querySelectorAll:()=>[card({left:20,right:130,top:450,bottom:610}),card({left:110,right:240,top:440,bottom:620})]},
  'opponent-hand':{children:[card({left:130,right:190,top:100,bottom:190}),card({left:190,right:250,top:100,bottom:200})]},
  'game-view':{getBoundingClientRect:()=>({left:0,right:390,top:50})}
 };
 Object.assign(c,{positionMobileTable:()=>{},matchMedia:()=>({matches:true}),$:id=>nodes[id]});c.state.room={};
 vm.runInContext(extract('positionMobileCallNotice','positionMobileTable'),c);c.positionMobileCallNotice();
 assert.equal(properties['--call-anchor-top'],'378px');assert.equal(properties['--call-anchor-x'],'130px');
 speaker='opponent';c.positionMobileCallNotice();assert.equal(properties['--call-anchor-top'],'162px');assert.equal(properties['--call-anchor-x'],'190px');
});
test('Opponent flight reveals the public card and releases the landing card after completion',async()=>{
 let finish;const finished=new Promise(resolve=>finish=resolve),animations=[];
 const node=()=>({style:{},setAttribute(){},append(){},remove(){this.removed=true;},animate(frames,options){animations.push({frames,options});return {finished,cancel(){}};}});
 const c=harness(),target=node();Object.assign(target,{offsetWidth:62,offsetHeight:96,getBoundingClientRect:()=>({left:100,top:300,width:70,height:100})});
 const back={offsetWidth:60,offsetHeight:90,getBoundingClientRect:()=>({left:160,top:100,width:70,height:100})};
 const body={append(value){this.flight=value;}};
 Object.assign(c,{opponentFlights:new Map(),document:{createElement:node,body},$:()=>({lastElementChild:back}),getComputedStyle:()=>({transform:'none'}),matchMedia:()=>({matches:false}),createPlayedCard:node});
 vm.runInContext(extract('clearOpponentFlight','animateOpponentCard')+extract('animateOpponentCard','removeCardFlight').replace('let activeCardFlight=null;',''),c);
 c.animateOpponentCard({id:'a'},'player2',target,'player2:a');
 assert.equal(target.style.visibility,'hidden');assert.equal(c.opponentFlights.size,1);assert.equal(animations[0].options.duration,420);
 assert.match(animations[0].frames[1].transform,/200px/);assert.equal(animations[1].frames[0].opacity,0);
 finish();await Promise.resolve();await Promise.resolve();
 assert.equal(c.opponentFlights.size,0);assert.equal(target.style.visibility,'');assert.equal(body.flight.removed,true);
});
test('Table placement leaves space for either player message and both hands',()=>{
 const c=harness(),properties={};let speaker='self',visible=true;
 const rect=(top,bottom)=>({getBoundingClientRect:()=>({top,bottom,height:bottom-top})});
 const notice={classList:{contains:()=>!visible},getAttribute:()=>speaker,getBoundingClientRect:()=>speaker==='self'?{top:350,bottom:410}:{top:210,bottom:265}};
 const nodes={
  'felt-area':{getBoundingClientRect:()=>({top:50,bottom:700,height:650}),style:{setProperty:(k,v)=>properties[k]=parseFloat(v)}},
  'opponent-hand':{children:[rect(100,195)]},hand:{querySelectorAll:()=>[rect(425,600)]},
  'trick-cards':{children:[rect(280,380)]},'deck-stack':rect(290,374),'call-notice':notice
 };
 Object.assign(c,{$:id=>nodes[id]});vm.runInContext(extract('positionMobileTable','clearOpponentFlight'),c);
 c.positionMobileTable();let center=properties['--mobile-table-center']+50;
 assert.ok(center-50>=205);assert.ok(center+50<=340);
 speaker='opponent';c.positionMobileTable();center=properties['--mobile-table-center']+50;
 assert.ok(center-50>=275);assert.ok(center+50<=415);
 visible=false;c.positionMobileTable();center=properties['--mobile-table-center']+50;
 assert.ok(center-50>=205);assert.ok(center+50<=415);
 c.state.launchingCardId='a';properties['--mobile-table-center']=123;c.positionMobileTable();assert.equal(properties['--mobile-table-center'],123);
 c.state.launchingCardId=null;c.opponentFlights.set('rival',{});c.positionMobileTable();assert.equal(properties['--mobile-table-center'],123);
});
