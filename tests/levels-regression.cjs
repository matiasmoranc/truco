const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../levels.js'),'utf8')).toString('base64'));
test('Levels: 3 points each up to 5, then 5, 8 and 12; points are kept in tenths',async()=>{
 const L=await load();
 assert.deepEqual(L.levelFor(0),{level:1,points:0,need:30,progress:0});
 assert.equal(L.levelFor(29).level,1);assert.equal(L.levelFor(30).level,2);
 assert.equal(L.levelFor(150).level,6);assert.equal(L.levelFor(150+250).level,11);assert.equal(L.levelFor(150+250+800).level,21);
 assert.equal(L.badgeFor(4),null);assert.equal(L.badgeFor(5).id,'bronce');assert.equal(L.badgeFor(10).id,'plata');assert.equal(L.badgeFor(20).id,'oro');assert.equal(L.badgeFor(30).id,'diamante');
});
test('A win is worth 1 point, or 1,2 against a higher level; only people on the winning side get it',async()=>{
 const L=await load();
 const duel=(winner,levels)=>L.levelAwards({status:'settled',mode:'1v1',winner,players:{player1:{uid:'a',name:'A'},player2:{uid:'b',name:'B'}}},levels);
 assert.deepEqual(duel('a',{a:0,b:0}),{a:10});
 assert.deepEqual(duel('a',{a:0,b:60}),{a:12});
 assert.deepEqual(duel('b',{a:0,b:60}),{b:10});
 // Against the house: its fixed level decides; the house itself gets nothing.
 const house=L.levelAwards({status:'settled',mode:'1v1',house:'player1',winner:'p',players:{player1:{uid:'house_X',name:'Nacho_Pereira'},player2:{uid:'p',name:'P'}}},{});
 assert.deepEqual(house,{p:L.houseLevel('Nacho_Pereira')>1?12:10});
 assert.deepEqual(L.levelAwards({status:'settled',mode:'1v1',house:'player1',winner:'house_X',players:{player1:{uid:'house_X',name:'X'},player2:{uid:'p',name:'P'}}},{}),{});
 // 2 vs 2: both people of the winning team, bots left out.
 const team=L.levelAwards({status:'settled',mode:'2v2',session:{room:{matchResult:{winner:'player2'}}},players:{player1:{uid:'a'},player2:{uid:'b'},player3:{uid:'c'},player4:{uid:'bot:player4'}}},{a:300,b:0,c:0});
 assert.deepEqual(team,{b:12});
 assert.deepEqual(L.levelAwards({status:'reserved'}),{});
});
test('The own photo opens at level 6, 15 points, in the game and in the database rules',async()=>{
 const L=await load();
 assert.equal(L.PHOTO_LEVEL,6);assert.equal(L.pointsToReach(L.PHOTO_LEVEL),150);
 const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase.database.rules.json'),'utf8'));
 assert.match(rules.rules.avatars.$uid.photo['.validate'],/val\(\) >= 150$/);
});
test('House players stay between levels 1 and 5, with an icon their level has',async()=>{
 const L=await load();
 for(const name of ['Nacho_Pereira','Santi_Fernandez','Vale_Rodriguez','Caro.Suarez','x','']){
  const level=L.houseLevel(name);assert.ok(level>=1&&level<=5,name+' '+level);
  assert.ok(L.ICONS.some(i=>i.id===L.houseIcon(name)&&i.level<=level));
 }
});
