const {test}=require('node:test');const assert=require('node:assert/strict');
const S=require('../functions/social-service.cjs');
test('Search terms become username key prefixes and reject anything else',()=>{
 assert.equal(S.searchPrefix('Mati'),'mati');assert.equal(S.searchPrefix(' Juan.P '),'juan%2Ep');
 for(const bad of ['a','',null,'<b>','../x','a b'])assert.equal(S.searchPrefix(bad),null);
});
test('Recent opponents are the last distinct people, newest first, without bots or yourself',()=>{
 const m=(id,createdAt,players)=>({id,createdAt,startedAt:createdAt,status:'settled',players:Object.fromEntries(players.map((p,i)=>['player'+(i+1),p])),session:{room:{status:'complete'}}});
 const ledger={matches:{a:m('a',1,[{uid:'me',name:'Yo'},{uid:'u1',name:'Ana'}]),b:m('b',3,[{uid:'me',name:'Yo'},{uid:'bot:player2',name:'Bot'},{uid:'u2',name:'Beto'},{uid:'u1',name:'Ana'}]),c:m('c',2,[{uid:'x',name:'X'},{uid:'y',name:'Y'}])}};
 assert.deepEqual(S.recentOpponents(ledger,'me').map(r=>r.uid),['u2','u1']);
 assert.equal(S.recentOpponents(ledger,'me',1).length,1);
});
test('Friendship steps write both sides and a crossed request becomes a friendship',()=>{
 const sent=S.requestUpdates({from:'a',fromName:'Ana',to:'b',toName:'Beto',now:5,reverseExists:false});
 assert.deepEqual(sent['friendRequests/b/a'],{name:'Ana',at:5});assert.deepEqual(sent['friendRequestsSent/a/b'],{name:'Beto',at:5});
 const crossed=S.requestUpdates({from:'a',fromName:'Ana',to:'b',toName:'Beto',now:5,reverseExists:true});
 assert.deepEqual(crossed['friends/a/b'],{name:'Beto',since:5});assert.deepEqual(crossed['friends/b/a'],{name:'Ana',since:5});assert.equal(crossed['friendRequests/a/b'],null);
 const removed=S.removeUpdates({uid:'a',peer:'b'});assert.equal(removed['friends/a/b'],null);assert.equal(removed['friends/b/a'],null);
 assert.equal(S.relation('a','b',{friends:{b:{}}}),'friend');assert.equal(S.relation('a','b',{incoming:{b:{}}}),'incoming');assert.equal(S.relation('a','a',{}),'self');
});
test('A table invitation carries the code, the private password and expires in minutes',()=>{
 const invite=S.inviteRecord({from:'a',fromName:'Ana',table:{code:'ABCDE',mode:'2v2',targetPoints:30,stake:5,password:'clave'},now:1000});
 assert.equal(invite.code,'ABCDE');assert.equal(invite.password,'clave');assert.equal(invite.expiresAt,1000+S.INVITE_MS);
 assert.equal(S.inviteText(invite),'Ana te invita a jugar al truco: 2 vs 2, a 30 puntos.');
 assert.equal(S.inviteRecord({from:'a',fromName:'Ana',table:{code:'ABCDE'},now:1}).password,undefined);
 assert.throws(()=>S.inviteRecord({from:'a',fromName:'Ana',table:{code:'../x'},now:1}));
});
test('A fresh "playing" report blocks invitations; a missing or stale one does not',()=>{
 const now=10*3600000;
 assert.equal(S.isPlaying({playing:true,at:now-60000},now),true);
 assert.equal(S.isPlaying({playing:true,at:now-S.PLAYING_FRESH_MS-1},now),false);
 assert.equal(S.isPlaying(null,now),false);assert.equal(S.isPlaying({playing:false,at:now},now),false);
});
test('The same friend gets at most 2 invitations every 20 minutes',()=>{
 const now=5*3600000,min=60000;
 assert.deepEqual(S.inviteAllowance(null,now),{allowed:true,next:[now]});
 assert.equal(S.inviteAllowance([now-5*min],now).allowed,true);
 const full=S.inviteAllowance([now-5*min,now-2*min],now);assert.equal(full.allowed,false);assert.equal(full.waitMinutes,15);
 assert.equal(S.inviteAllowance([now-25*min,now-21*min],now).allowed,true);
});

test('Head to head with a friend: rivals in 1v1 and 2v2 count as won or lost, partners apart, bots never',()=>{
 const L={matches:{
  a:{status:'settled',settledAt:1,players:{player1:{uid:'me'},player2:{uid:'caro',name:'Caro'}},winner:'me',session:{room:{scores:{player1:30,player2:22}}}},
  b:{status:'settled',settledAt:2,mode:'2v2',players:{player1:{uid:'me'},player2:{uid:'caro',name:'Caro'},player3:{uid:'bot:x'},player4:{uid:'fede',name:'Fede'}},winners:['caro','fede'],session:{room:{scores:{player1:10,player2:15}}}},
  c:{status:'settled',settledAt:3,mode:'2v2',players:{player1:{uid:'me'},player3:{uid:'caro',name:'Caro'},player2:{uid:'x1'},player4:{uid:'x2'}},winners:['me','caro'],session:{room:{scores:{player1:15,player2:3}}}},
  d:{status:'refunded',players:{player1:{uid:'me'},player2:{uid:'caro'}}}}};
 const all=S.versusStats(L,'me'),caro=all.caro;
 assert.equal(caro.won,1);assert.equal(caro.lost,1);assert.equal(caro.tied,0);
 assert.deepEqual(caro.one,{won:1,lost:0});assert.deepEqual(caro.teamVs,{won:0,lost:1});assert.deepEqual(caro.together,{won:1,lost:0});
 assert.deepEqual(caro.streak,{result:'lost',count:1});
 assert.equal(caro.last[0].together,true);assert.equal(caro.last[2].mine,30);assert.equal(caro.last[2].theirs,22);
 assert.equal(all['bot:x'],undefined);assert.equal(all.fede.lost,1);
});
