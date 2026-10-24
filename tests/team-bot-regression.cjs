const {test}=require('node:test');
const assert=require('node:assert/strict');
const {newTeamSession,strength}=require('../functions/team-referee.cjs');
const {botCommands,signalFor,rivalOptions,unseenCards}=require('../functions/team-bot.cjs');const {envido:teamEnvido,flower:teamFlower}=require('../functions/team-referee.cjs');

const people=Object.fromEntries(['player1','player2','player3','player4'].map(p=>[p,{uid:'bot:'+p,name:'Bot',bot:true}]));
// A fresh hand where the bot on turn got `value` from its partner; envido and flor are already settled.
function signaled(value){
 const s=newTeamSession('ABCDE',people,30,{id:'m1',stake:1,pot:4,matchNumber:1},1000),r=s.room,p=r.turn;
 Object.assign(r,{envidoClosed:true,flors:{[p]:true}});
 r.teamSignal={id:'n1',from:'player3',to:p,text:'',value,handNumber:r.handNumber,trickNo:r.trickNo,time:1000};
 return {s,r,p,sorted:[...s.hands[p]].sort((a,b)=>strength(a,r.muestra)-strength(b,r.muestra))};
}
const firstPlay=commands=>commands.find(c=>c.kind==='play')?.cardId;

test('The bot reads only the signal sent to it in this trick',()=>{
 const {r,p}=signaled('veni');
 assert.equal(signalFor(r,p),'veni');
 assert.equal(signalFor({...r,trickNo:r.trickNo+1},p),null);
 assert.equal(signalFor(r,p==='player1'?'player2':'player1'),null);
});
test('Vení throws the lowest card and jugá leads the highest, without calling truco',()=>{
 let {s,p,sorted}=signaled('veni');
 let commands=botCommands(s,p,()=>0.99);
 assert.equal(firstPlay(commands),sorted[0].id);assert.ok(!commands.some(c=>c.kind==='call'));
 ({s,p,sorted}=signaled('juga'));
 commands=botCommands(s,p,()=>0.99);
 assert.equal(firstPlay(commands),sorted.at(-1).id);assert.ok(!commands.some(c=>c.kind==='call'));
});
test('Gritá makes the bot call truco before playing',()=>{
 const {s,p}=signaled('grita');
 assert.deepEqual(botCommands(s,p,()=>0.99)[0],{kind:'call',value:'truco'});
});

test('Envido declarations: the first must say a number, and whoever\'s partner already leads is skipped',()=>{
 const {createTeamReferee}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m2',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 const order=['player1','player2','player3','player4'];
 r.pendingBet={id:'b1',type:'envido',caller:'player2',callerTeam:'player2',responder:'player1',stake:2,accepted:0,called:'envido',revealMode:true,reveals:{},order,revealTurn:'player1'};
 const ref=createTeamReferee(s,{now:1500});
 assert.throws(()=>ref.action('player1',{kind:'declare',good:true}),/declara primero/);
 ref.action('player1',{kind:'declare',value:28});
 ref.action('player2',{kind:'declare',good:true});assert.equal(r.callNotice.text,'Son buenas');
 // player3's partner (player1) leads with 28: player3 says nothing and player4 declares next.
 assert.equal(r.pendingBet.revealTurn,'player4');
 assert.throws(()=>ref.action('player3',{kind:'declare',good:true}),/No te corresponde/);
 // player4 overtakes with 31: now player3, who has not spoken, may answer.
 ref.action('player4',{kind:'declare',value:31});assert.equal(r.pendingBet.revealTurn,'player3');
 ref.action('player3',{kind:'declare',good:true});assert.equal(r.envidoAudit.winner,'player4');
});

test('Envido never passes 37: two pieces count only the best one, like the 1v1 game',()=>{
 const {envido}=require('../functions/team-referee.cjs');
 const muestra={id:'oro-4',suit:'♦',rank:4},card=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada'})[suit]+'-'+rank,suit,rank});
 assert.equal(envido([card('♦',2),card('♥',2),card('♦',12)],muestra),30);
 assert.equal(envido([card('♦',2),card('♥',7),card('♠',3)],muestra),37);
 assert.equal(envido([card('♥',7),card('♥',6),card('♠',3)],muestra),33);
});
test('A table saved with an impossible envido unblocks: the timed-out player declares the recounted points',()=>{
 const {createTeamReferee}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m3',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 const muestra={id:'oro-4',suit:'♦',rank:4,label:'4'},card=(suit,rank)=>({id:({'♦':'oro','♥':'copa'})[suit]+'-'+rank,suit,rank,label:String(rank)});
 r.muestra=muestra;s.originals.player1=[card('♦',2),card('♥',2),card('♦',12)];s.hands.player1=s.originals.player1.slice(1);
 s.truth.player1=59;
 r.pendingBet={id:'b2',type:'envido',caller:'player2',callerTeam:'player2',responder:'player1',stake:2,accepted:0,called:'envido',revealMode:true,reveals:{},order:['player1','player2','player3','player4'],revealTurn:'player1'};
 r.turnClock={key:'k',player:'player1',startedAt:1000};
 createTeamReferee(s,{now:1000+46000}).advance();
 assert.equal(r.pendingBet.reveals.player1,30);assert.equal(s.truth.player1,30);assert.equal(r.pendingBet.revealTurn,'player2');
});
test('A timed-out flor declaration uses the flor points, and says son buenas when it cannot win',()=>{
 const {createTeamReferee,florValue}=require('../functions/team-referee.cjs');
 const s=newTeamSession('ABCDE',people,30,{id:'m4',stake:1,pot:4,matchNumber:1},1000),r=s.room,order=['player1','player2','player3','player4'];
 r.pendingBet={id:'b3',type:'flor',caller:'player2',callerTeam:'player2',responder:'player1',stake:5,accepted:3,called:'conflor',revealMode:true,reveals:{},order:['player1','player2'],revealTurn:'player1'};
 r.turnClock={key:'k',player:'player1',startedAt:1000};
 createTeamReferee(s,{now:47000}).advance();
 assert.equal(r.pendingBet.reveals.player1,florValue(s.originals.player1,r.muestra));
 r.pendingBet.reveals.player1=99;r.turnClock={key:'k2',player:'player2',startedAt:47000};
 createTeamReferee(s,{now:93000}).advance();
 assert.equal(r.callNotice.text,'Son buenas');
});

test('Only the pie bot sings envido; the first of its team just plays',()=>{
 const s=newTeamSession('ABCDE',people,30,{id:'m5',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 Object.assign(r,{mano:'player1',turn:'player1',trickNo:1,envidoClosed:false,playedBy:{},flors:{},trickCards:[]});
 s.truth={player1:36,player2:0,player3:36,player4:0};
 for(const q of ['player1','player2','player3','player4'])r.flors[q]=true;
 assert.ok(!botCommands(s,'player1',()=>0.99).some(c=>c.kind==='call'&&['envido','real'].includes(c.value)));
 r.turn='player3';
 assert.deepEqual(botCommands(s,'player3',()=>0.99)[0],{kind:'call',value:'real'});
});

test('Rivals use the declared envido and shown cards: 35 with a 12 and a 5 shown means the last card is the 2 of the muestra',()=>{
 const {rivalOptions,unseenCards,winChance}=require('../functions/team-bot.cjs');
 const c=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada','♣':'basto'})[suit]+'-'+rank,suit,rank,label:String(rank)});
 const humans={player1:{uid:'a',name:'A'},player3:{uid:'b',name:'B'},player2:{uid:'bot:player2',name:'Bot',bot:true},player4:{uid:'bot:player4',name:'Bot',bot:true}};
 const s=newTeamSession('ABCDE',humans,30,{id:'m6',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 r.muestra=c('♦',6);r.mano='player3';r.dealer='player2';
 s.originals={player1:[c('♠',1),c('♣',4),c('♣',6)],player2:[c('♣',3),c('♥',7),c('♠',3)],player3:[c('♠',12),c('♥',5),c('♦',2)],player4:[c('♥',4),c('♥',2),c('♣',5)]};
 // Trick 1 went to the humans (1 de espadas); in trick 2 player3 showed the 5 and player4 must play.
 r.tricks=[{winner:'player1',leader:'player1',cards:[{playerId:'player3',card:c('♠',12)},{playerId:'player4',card:c('♥',4)},{playerId:'player1',card:c('♠',1)},{playerId:'player2',card:c('♣',3)}]}];
 r.trickNo=2;r.trickCards=[{playerId:'player1',card:c('♣',4)},{playerId:'player2',card:c('♥',7)},{playerId:'player3',card:c('♥',5)}];
 r.playedBy={player1:2,player2:2,player3:2,player4:1};
 s.hands={player1:[c('♣',6)],player2:[c('♠',3)],player3:[c('♦',2)],player4:[c('♥',2),c('♣',5)]};
 r.turn='player4';r.envidoClosed=true;r.flors={};
 r.envidoAudit={winner:'player3',value:35,stake:2,reveals:{player3:35,player4:-1,player1:-1,player2:-1},order:['player3','player4','player1','player2'],settled:true};
 const options=rivalOptions(s,'player2',unseenCards(s,'player2'));
 assert.deepEqual(options.player3.map(h=>h.map(x=>x.id)),[['oro-2']]);
 r.pendingBet={id:'t1',type:'truco',caller:'player3',callerTeam:'player1',responder:'player2',stake:2,called:'truco'};
 let seed=7;const random=()=>((seed=seed*16807%2147483647)/2147483647);
 assert.equal(winChance(s,'player2',random),0);
 assert.deepEqual(botCommands(s,'player2',random)[0],{kind:'call',value:'no'});
 // Without that envido the same cards look good enough to accept.
 r.envidoAudit=null;
 assert.ok(winChance(s,'player2',random)>0.4);
 assert.notDeepEqual(botCommands(s,'player2',random)[0],{kind:'call',value:'no'});
});
const tcard=(suit,rank)=>({id:({'♦':'oro','♥':'copa','♠':'espada','♣':'basto'})[suit]+'-'+rank,suit,rank,label:String(rank)});
function opening(){
 const s=newTeamSession('ABCDE',people,30,{id:'m9',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 Object.assign(r,{mano:'player1',turn:'player1',trickNo:1,envidoClosed:false,playedBy:{},flors:{},trickCards:[],tricks:[],trucoLevel:1,lastTrucoTeam:null,pendingBet:null,muestra:tcard('♦',6)});
 s.hands.player1=[tcard('♥',4),tcard('♣',5),tcard('♠',6)];s.originals=structuredClone(s.hands);
 return {s,r};
}
test('Bots never shout truco in the first round; later they shout with good cards or bluff now and then',()=>{
 const {s,r}=opening();s.truth={player1:5,player2:5,player3:5,player4:5};r.envidoClosed=true;
 const calls=random=>botCommands(s,'player1',random).filter(c=>c.kind==='call').map(c=>c.value);
 assert.ok(!calls(()=>0.05).includes('truco'),'no truco in the first round, not even as a bluff');
 r.trickNo=2;r.tricks=[{winner:'player2'}];
 assert.ok(!calls(()=>0.99).includes('truco'),'a weak hand does not shout without a bluff');
 assert.ok(calls(()=>0.05).includes('truco'),'from the second round a weak hand can bluff');
 s.hands.player1=[tcard('♦',2),tcard('♦',4),tcard('♠',1)];s.originals.player1=s.hands.player1;
 r.trickNo=1;r.tricks=[];assert.ok(!calls(()=>0.99).includes('truco'),'a strong hand also waits for the second round');
 r.tricks=[{winner:'player1'}];r.trickNo=2;
 assert.ok(calls(()=>0.99).includes('truco'),'after winning a round a strong hand shouts');
});
test('The pie bot bluffs envido with few points only now and then',()=>{
 const {s,r}=opening();r.turn='player3';s.truth={player1:4,player2:0,player3:5,player4:0};
 const envido=random=>botCommands(s,'player3',random).some(c=>c.kind==='call'&&c.value==='envido');
 assert.equal(envido(()=>0.99),false);assert.equal(envido(()=>0.05),true);
});
test('A bot answering a flor with its own unsung flower does not fold it',()=>{
 const {s,r}=opening();s.hands.player2=[tcard('♣',1),tcard('♣',4),tcard('♣',7)];s.originals=structuredClone(s.hands);
 r.flors={player1:true};r.pendingBet={id:'f1',type:'flor',caller:'player1',callerTeam:'player1',responder:'player2',stake:3,accepted:0,called:'flor'};
 const first=botCommands(s,'player2',()=>0.99)[0];assert.notDeepEqual(first,{kind:'call',value:'no'});
});
test('Team bots use the 1v1 hard thresholds plus 3 for envido',()=>{
 const {s,r}=opening();r.turn='player3';
 const first=t=>{s.truth={player1:0,player2:0,player3:t,player4:0};return botCommands(s,'player3',()=>0.99).find(c=>c.kind==='call'&&['envido','real'].includes(c.value))?.value||null;};
 assert.equal(first(27),null);assert.equal(first(28),'envido');assert.equal(first(35),'envido');assert.equal(first(36),'real');
 const answer=(called,t)=>{s.truth={player1:0,player2:0,player3:t,player4:0};r.turn='player1';r.pendingBet={id:'e1',type:'envido',caller:'player2',callerTeam:'player2',responder:'player3',stake:2,accepted:0,called};return botCommands(s,'player3',()=>0.99)[0].value;};
 assert.equal(answer('envido',25),'no');assert.equal(answer('envido',26),'yes');assert.equal(answer('real',29),'yes');assert.equal(answer('falta',32),'no');assert.equal(answer('falta',33),'yes');
 assert.equal(answer('envido',35),'raise-real');
});
test('Team bots read son buenas and a quiet first card when guessing rival hands',()=>{
 const {s,r}=opening();
 r.envidoAudit={reveals:{player1:30,player2:-1}};r.trickCards=[{playerId:'player2',card:tcard('♠',5)}];r.playedBy={player2:1};
 const options=rivalOptions(s,'player1',unseenCards(s,'player1'));
 assert.ok(options.player2.length>0);
 for(const h of options.player2){const full=[tcard('♠',5),...h];assert.ok(teamEnvido(full,r.muestra)<=30);assert.equal(teamFlower(full,r.muestra),false);}
});
// Humans in seats 1 and 3, rival bots in 2 and 4; player1 and player3 hold flowers.
function florTable(){
 const humans={...people,player1:{uid:'u1',name:'Mati'},player3:{uid:'u3',name:'Compa'}};
 const s=newTeamSession('ABCDE',humans,30,{id:'m8',stake:1,pot:4,matchNumber:1},1000),r=s.room;
 Object.assign(r,{status:'started',mano:'player1',turn:'player1',trickNo:1,envidoClosed:false,playedBy:{},flors:{},folded:{},trickCards:[],tricks:[],trucoLevel:1,lastTrucoTeam:null,pendingBet:null,muestra:tcard('♦',6),turnClock:null});
 s.hands={player1:[tcard('♥',4),tcard('♥',5),tcard('♥',7)],player2:[tcard('♠',4),tcard('♣',5),tcard('♥',2)],player3:[tcard('♣',1),tcard('♣',3),tcard('♣',7)],player4:[tcard('♠',5),tcard('♣',4),tcard('♥',3)]};
 s.originals=structuredClone(s.hands);
 return {s,r,ref:createTeamReferee(s,{now:1500})};
}
const {createTeamReferee}=require('../functions/team-referee.cjs');
test('After a flor, the others sing theirs before the next card; once a card is played nobody can',()=>{
 let {r,ref}=florTable();
 ref.action('player1',{kind:'call',value:'flor'});
 ref.action('player3',{kind:'call',value:'flor'});
 assert.equal(r.flors.player3,true);
 ({r,ref}=florTable());
 ref.action('player1',{kind:'call',value:'flor'});
 ref.action('player1',{kind:'play',cardId:'copa-4'});
 assert.equal(r.florClosed,true);
 assert.throws(()=>ref.action('player3',{kind:'call',value:'flor'}),/no se puede cantar/);
 // The forgotten flower no longer blocks other calls.
 r.turn='player3';assert.doesNotThrow(()=>ref.action('player3',{kind:'call',value:'truco'}));
});
test('A bot holding a flower sings it at once when someone sings flor',()=>{
 const {s,r,ref}=florTable();
 s.hands.player2=[tcard('♠',1),tcard('♠',4),tcard('♠',7)];s.originals.player2=structuredClone(s.hands.player2);
 ref.action('player1',{kind:'call',value:'flor'});
 assert.equal(r.flors.player2,true);
});
test('The server tells app and web platforms apart from the request',()=>{
 const {requestPlatform}=require('../functions/activity-service.cjs');
 assert.equal(requestPlatform({origin:'capacitor://localhost',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}),'app-ios');
 assert.equal(requestPlatform({origin:'https://localhost',userAgent:'Mozilla/5.0 (Linux; Android 14; wv)'}),'app-android');
 assert.equal(requestPlatform({origin:'https://trucouruguayo.uy',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}),'web-ios');
 assert.equal(requestPlatform({origin:'https://matiasmoranc.github.io',userAgent:'Mozilla/5.0 (Linux; Android 14)'}),'web-android');
 assert.equal(requestPlatform({origin:'https://trucouruguayo.uy',userAgent:'Mozilla/5.0 (Windows NT 10.0)'}),'web-desktop');
});
