const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function extract(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));}
function harness(){
 const context={applyMobileTallyPosition:()=>{},opponentFlights:new Map(),state:{playerId:'player1'},otherPlayer:id=>id==='player1'?'player2':'player1'};
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
test('Calls use independent overlay anchors and never write to the board',()=>{
 const c=harness(),noticeProperties={},boardWrites=[];let speaker='self';
 const nodes={
  'call-notice':{getAttribute:()=>speaker,style:{setProperty:(key,value)=>noticeProperties[key]=value}},
  'felt-area':{getBoundingClientRect:()=>({left:0,top:50,width:390,height:620}),style:{setProperty:(...args)=>boardWrites.push(args)}},
  'game-view':{getBoundingClientRect:()=>({left:0,top:0})}
 };
 Object.assign(c,{matchMedia:()=>({matches:true}),$:id=>nodes[id]});c.state.room={};
 vm.runInContext(extract('mobileBoardGeometry','positionMobileTable'),c);
 const g=c.mobileBoardGeometry(390,620);c.positionMobileCallNotice();
 assert.equal(parseFloat(noticeProperties['--call-anchor-top']),g.ownNoticeBottom+50);
 speaker='opponent';c.positionMobileCallNotice();
 assert.equal(parseFloat(noticeProperties['--call-anchor-top']),g.rivalNoticeTop+50);
 assert.deepEqual(boardWrites,[]);
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
test('Board geometry stays identical through calls, responses, declarations and changing controls',()=>{
 const c=harness(),properties={};
 c.state.room={};Object.assign(c,{matchMedia:()=>({matches:true}),$:()=>({getBoundingClientRect:()=>({width:390,height:620}),style:{setProperty:(k,v)=>properties[k]=v}})});
 vm.runInContext(extract('mobileBoardGeometry','clearOpponentFlight'),c);
 c.positionMobileTable();const initial={...properties};
 for(const action of ['normal','flor','raise-conflor','raise-faltaflor','envido','declare','yes','no']){
  c.state.room.pendingBet={type:action,revealMode:action==='declare'};
  c.state.launchingCardId=action==='normal'?'a':null;
  c.positionMobileTable();assert.deepEqual(properties,initial,action);
 }
});
test('Fixed slots reserve room for both messages, table cards and the selector on phone heights',()=>{
 const c=harness();vm.runInContext(extract('mobileBoardGeometry','positionMobileCallNotice'),c);
 for(const height of [500,540,570,620,700,800,900]){
  const g=c.mobileBoardGeometry(390,height);
  assert.ok(g.tableCenter-g.playedHeight/2>=g.rivalNoticeTop+g.noticeHeight,`rival overlap at ${height}`);
  assert.ok(g.tableCenter+g.playedHeight/2<=g.ownNoticeBottom-g.noticeHeight,`own overlap at ${height}`);
  assert.ok(g.handCenter+g.handHeight*.56<=height-112,`selector overlap at ${height}`);
  assert.ok(g.deckHeight>=63&&g.deckHeight<=88.2);
 }
});

test('Desktop board reserves independent call slots and fits the centered hand above actions',()=>{
 const c=harness();vm.runInContext(extract('mobileBoardGeometry','positionMobileCallNotice'),c);
 for(const [width,height] of [[768,600],[1024,650],[1366,688],[1600,820],[1920,1000]]){
  const g=c.desktopBoardGeometry(width,height);
  assert.equal(g.playedHeight,g.deckHeight);
  assert.ok(g.tableCenter-g.playedHeight/2>=g.rivalNoticeTop+g.noticeHeight,`rival overlap at ${height}`);
  assert.ok(g.tableCenter+g.playedHeight/2<=g.ownNoticeBottom-g.noticeHeight,`own overlap at ${height}`);
  assert.ok(g.handCenter+g.handHeight*.56<=height-85,`controls overlap at ${height}`);
  assert.equal(g.ownNoticeX,width/2);
 }
});
test('Desktop calls and changing actions never shift card slots',()=>{
 const c=harness(),properties={},noticeProperties={};let speaker='self';
 const felt={getBoundingClientRect:()=>({left:100,top:80,width:1366,height:688}),style:{setProperty:(k,v)=>properties[k]=v}};
 const nodes={'felt-area':felt,'game-view':{getBoundingClientRect:()=>({left:0,top:0})},'call-notice':{getAttribute:()=>speaker,style:{setProperty:(k,v)=>noticeProperties[k]=v}}};
 c.state.room={};Object.assign(c,{matchMedia:()=>({matches:false}),$:id=>nodes[id]});
 vm.runInContext(extract('mobileBoardGeometry','clearOpponentFlight'),c);
 c.positionMobileTable();const initial={...properties},g=c.desktopBoardGeometry(1366,688);
 for(const action of ['normal','flor','contra-flor','envido','declare','yes','no']){
  c.state.room.pendingBet={type:action};speaker=action==='yes'?'self':'opponent';
  c.positionMobileTable();c.positionMobileCallNotice();assert.deepEqual(properties,initial);
  assert.equal(parseFloat(noticeProperties['--call-anchor-top']),(speaker==='self'?g.ownNoticeBottom:g.rivalNoticeTop)+80);
 }
});
