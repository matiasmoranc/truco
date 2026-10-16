const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function extract(name){const start=source.indexOf('function '+name+'('),open=source.indexOf('{',start);let depth=1,end=open+1;for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}return source.slice(start,end);}
test('Mobile call bubbles contain the action alone and still escape content',()=>{
 const c={state:{playerId:'player1'},escapeHtml:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;')};vm.createContext(c);vm.runInContext(extract('callNoticeHtml'),c);
 for(const from of ['player1','player2'])assert.equal(c.callNoticeHtml({from,spoken:'Quiero'},null,true),'<strong>QUIERO</strong>');
 assert.equal(c.callNoticeHtml({spoken:'<flor>'},null,true),'<strong>&lt;FLOR&gt;</strong>');
});
test('The same clock node moves into the mobile header and returns on desktop without duplication',()=>{
 let mobile=true,moves=0;const badge={},header={append(n){moves++;n.parentElement=this;}},original={append(n){moves++;n.parentElement=this;}};badge.parentElement=original;
 const c={$:()=>badge,matchMedia:()=>({matches:mobile}),document:{querySelector:s=>s==='.game-topbar'?header:original}};
 vm.createContext(c);vm.runInContext(extract('syncMobileGameHeader'),c);c.syncMobileGameHeader();c.syncMobileGameHeader();assert.equal(badge.parentElement,header);assert.equal(moves,1);
 mobile=false;c.syncMobileGameHeader();assert.equal(badge.parentElement,original);assert.equal(moves,2);
});
test('Saved tally positions remain inside phone bounds after resizing',()=>{
 const c={};vm.createContext(c);vm.runInContext(extract('mobileTallyCoordinates'),c);
 for(const [width,height] of [[390,620],[320,400],[700,900]])for(const p of [{x:-2,y:4},{x:1,y:1},{x:.5,y:.5}]){
  const v=c.mobileTallyCoordinates(p,width,height,69,150);assert.ok(v.x>=6&&v.y>=6);assert.ok(v.x+69<=width-6);assert.ok(v.y+150<=height-6);
 }
});
function dragHarness(){
 const listeners={},saved=[],capture=new Set();
 const marker={classList:{add(){},remove(){}},addEventListener:(name,fn)=>listeners[name]=fn,getBoundingClientRect:()=>({left:300,top:350,width:69,height:150}),setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)};
 const c={mobileTallyPosition:null,mobileTallyDrag:null,tallyIgnoreClickUntil:0,matchMedia:()=>({matches:true}),$:()=>({getBoundingClientRect:()=>({left:0,top:50,width:390,height:620})}),Date:{now:()=>1000},localStorage:{setItem:(key,value)=>saved.push(JSON.parse(value))},applyMobileTallyPosition(){}};
 vm.createContext(c);vm.runInContext(extract('installMobileTallyDrag'),c);c.installMobileTallyDrag(marker);
 const event=(type,x,y)=>({type,pointerId:1,button:0,isPrimary:true,clientX:x,clientY:y,preventDefault(){}});
 return {c,listeners,saved,event};
}
test('A tap still opens details; dragging saves a position and suppresses the following click',()=>{
 const {c,listeners,saved,event}=dragHarness();listeners.pointerdown(event('pointerdown',320,400));listeners.pointerup(event('pointerup',320,400));assert.equal(c.tallyIgnoreClickUntil,0);assert.equal(saved.length,0);
 listeners.pointerdown(event('pointerdown',320,400));listeners.pointermove(event('pointermove',50,140));listeners.pointerup(event('pointerup',50,140));
 assert.equal(saved.length,1);assert.ok(saved[0].x<.2&&saved[0].y<.2);assert.equal(c.tallyIgnoreClickUntil,1500);
});
test('Canceled tally drags restore the previous position and do not save a partial gesture',()=>{
 const {c,listeners,saved,event}=dragHarness();listeners.pointerdown(event('pointerdown',320,400));listeners.pointermove(event('pointermove',50,140));listeners.pointercancel(event('pointercancel',50,140));assert.equal(c.mobileTallyPosition,null);assert.equal(saved.length,0);
});
test('Chat notifications dismiss after four seconds and remove their timer state',()=>{
 let callback,delay;const notices=[],timers=new Map();const node=()=>({setAttribute(){},addEventListener(){},append(){},remove(){this.removed=true;}});
 const c={document:{createElement:node},state:{playerId:'player1',room:{players:{player2:{name:'Rival'}}}},matchChat:{noticeTimers:timers},CHAT_NOTICE_MS:4000,$:()=>({append:notice=>notices.push(notice)}),setTimeout:(fn,ms)=>{callback=fn;delay=ms;return 1;},clearTimeout(){}};
 vm.createContext(c);vm.runInContext(extract('showChatNotice'),c);c.showChatNotice({id:'test',sender:'player2',text:'¡Bien jugado!'});assert.equal(delay,4000);assert.equal(timers.size,1);callback();assert.equal(notices[0].removed,true);assert.equal(timers.size,0);
});
