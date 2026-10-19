// Local visual fixture: no accounts, Firebase credentials or live games involved.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function extract(name){const a=app.indexOf('function '+name+'('),b=app.indexOf('{',a);let i=b+1,n=1;for(;n;i++){if(app[i]==='{')n++;if(app[i]==='}')n--;}return app.slice(a,i);}
(async()=>{
 const http=require('node:http');const root=path.join(__dirname,'..');
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'image/jpeg');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.TRUCO_CHROMIUM_PATH?{executablePath:process.env.TRUCO_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer']}:{} )});
 for(const [name,width,height] of [['phone',390,760],['desktop',1440,900]]){
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/app.js?*',route=>route.fulfill({body:'',contentType:'text/javascript'}));
  await page.goto(origin+'/index.html');
  await page.evaluate(async helpers=>{
   document.documentElement.classList.remove('page-loading');document.getElementById('startup-loading').hidden=true;document.getElementById('auth-gate').remove();document.getElementById('app').removeAttribute('inert');
   for(const id of ['welcome-view','invite-view','setup-view','waiting-view','learn-view'])document.getElementById(id).classList.remove('active');document.getElementById('game-view').classList.add('active');
   const $=id=>document.getElementById(id),card=(suit,rank)=>({id:suit+'-'+rank,suit,rank,label:String(rank)});
   globalThis.state={playerId:'player3',roomCode:'ABCDE',hand:[card('♠',1),card('♥',7),card('♣',3)],room:{mode:'2v2',status:'started',mano:'player1',turn:'player2',targetPoints:20,handNumber:1,matchNumber:1,players:Object.fromEntries(['Matias','Nico','Pinar93','Lucía'].map((name,i)=>['player'+(i+1),{name,uid:'u'+i}])),scores:{player1:4,player2:7},handCounts:{player1:3,player2:2,player3:3,player4:3},trucoLevel:1,envidoClosed:false,playedBy:{player2:1},muestra:card('♦',6),trickCards:[{playerId:'player2',card:card('♣',7)}],callNotice:{id:'1',handNumber:1,from:'player4',spoken:'TRUCO'},pendingBet:{type:'truco',responder:'player3',stake:2}}};
   globalThis.$=$;(0,eval)(helpers);const {installTeamTable}=await import('/team-table-ui.js');
   const ui=installTeamTable({$,getState:()=>state,command:()=>{},runAction:()=>{},renderPlayerHand:globalThis.renderPlayerHand,orderedHand:()=>state.hand,cardImageStyle,cardAccessibleName,escapeHtml:s=>String(s).replaceAll('<','&lt;'),renderTally:n=>'<span>'+n+'</span>',syncHeader:()=>{},setTurnBadge:t=>{$('turn-badge').textContent=t;document.querySelector('.game-topbar').append($('turn-badge'));},syncControls:()=>{},gameTime:()=>Date.now(),hasFlor:()=>false});
   ui.render();
   globalThis.teamViewState=state;
   globalThis.teamFixture=ui;
  },['cardImage','cardImageStyle','cardAccessibleName','handFanPose','renderPlayerHand'].map(extract).join('\n'));
  await page.screenshot({path:'/tmp/truco-team-'+name+'.png'});
  await page.evaluate(()=>{state.room.pendingBet={id:'declare1',type:'envido',revealMode:true,revealTurn:state.playerId};teamFixture.render();});
  if(await page.locator('#team-declare-slider').getAttribute('max')!=='37')throw new Error('Envido selector must stop at 37');
  const hand=await page.locator('#hand').boundingBox(),picker=await page.locator('#envido-picker').boundingBox();
  if(hand.y+hand.height>picker.y)throw new Error(name+': declaration overlaps own cards');
  await page.screenshot({path:'/tmp/truco-team-'+name+'-declare.png'});
  const bounds=await page.locator('#hand').boundingBox();if(!bounds||bounds.y<0||bounds.y+bounds.height>height)throw new Error(name+': hand outside viewport');
  if(await page.locator('.team-seat').count()!==4)throw new Error('Expected four seats');
  if(errors.length)throw new Error(errors.join(';'));
  console.log(name+': four seats, visible hand and no browser errors');await page.close();
 }
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
