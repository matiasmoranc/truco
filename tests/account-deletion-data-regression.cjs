'use strict';
// Account deletion removes every personal branch, reads only the player's branches
// (never the whole database) and writes one multi-path update. Legacy rooms are
// closed to clients and forged rooms cannot block a deletion.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../functions/self-deletion.cjs');
const {legacyTableActive}=require('../functions/admin-service.cjs');
const {chatDay}=require('../functions/chat-log.cjs');
const {uruguayDate}=require('../functions/activity-service.cjs');

const NOW=Date.parse('2026-11-12T15:00:00Z'),TODAY=uruguayDate(NOW).day,CHAT_DAY=chatDay(NOW);
function fullRoot(){
 return {
  profiles:{U7:{name:'Mati'},R7:{name:'Rival'}},usernames:{mati:'U7',rival:'R7',viejo:'U7'},
  administrators:{R7:true},creditRateLimits:{U7:{tables:{start:1,count:1}},R7:{tables:{start:1,count:1}}},
  userAccess:{R7:{blocked:false}},
  userBlocks:{U7:{R7:true},R7:{U7:{blocked:true,name:'Mati',blockedAt:1},x:true}},
  avatars:{U7:{icon:'mate',photo:'data:image/jpeg;base64,AAAA',use:'photo'},R7:{icon:'persona'}},
  friends:{U7:{R7:{name:'Rival',since:1}},R7:{U7:{name:'Mati',since:1},x:{name:'X',since:1}}},
  friendRequests:{U7:{y:{name:'Y',at:1}},z:{U7:{name:'Mati',at:1}}},
  friendRequestsSent:{y:{U7:{name:'Mati',at:1}},U7:{z:{name:'Z',at:1}}},
  pushTokens:{U7:{t1:{token:'tok',platform:'ios',at:1}},R7:{t2:{token:'tok2',platform:'android',at:1}}},
  presence:{U7:{state:'lobby',at:1},R7:{state:'off',at:1}},
  playerStatus:{U7:{playing:true,at:1}},
  levels:{U7:{points:200},R7:{points:10}},
  adminMessages:{U7:{m1:{text:'hola',at:1}},R7:{m2:{text:'hola',at:1}}},
  adminThreads:{U7:{m1:{from:'admin',text:'hola',at:1}},R7:{m2:{from:'admin',text:'hola',at:1}}},
  tableInvites:{U7:{i1:{from:'R7',fromName:'Rival',code:'ABCDE',at:1}},R7:{i2:{from:'U7',fromName:'Mati',code:'ABCDE',at:1},i3:{from:'x',fromName:'X',code:'ABCDE',at:1}}},
  tableInviteReplies:{U7:{i2:{to:'R7',name:'Rival',at:1}},R7:{i1:{to:'U7',name:'Mati',at:1},i4:{to:'x',name:'X',at:1}}},
  tableInviteLog:{U7:{R7:[1]},R7:{U7:[1],x:[1]}},
  adminConfig:{testUsers:{U7:true,R7:true}},
  adminMetrics:{presence:{U7:{s:{at:1}},R7:{s:{at:1}}},
   days:{[TODAY]:{users:{U7:true,R7:true},platforms:{U7:{'app-ios':true},R7:{'web-desktop':true}},hours:{'12':{U7:true,R7:true}}}},
   visitLog:{[TODAY]:{v1:{uid:'U7',platform:'app-ios',at:NOW},v2:{uid:'R7',platform:'web-ios',at:NOW},v3:{platform:'web-ios',at:NOW}}}},
  chatLog:{[CHAT_DAY]:{k1:{uid:'U7',name:'Mati',text:'hola',at:NOW,code:'ABCDE'},k2:{uid:'R7',name:'Rival',text:'chau',at:NOW,code:'ABCDE'}}},
  problemReports:{U7_req:{uid:'U7',message:'personal'},R7_req:{uid:'R7',message:'other'}},
  rooms:{OLD:{public:{status:'closed',players:{player1:{uid:'U7',name:'Mati'},player2:{uid:'R7',name:'Rival'}}}},KEEP:{public:{status:'closed',players:{player1:{uid:'R7'}}}}},
  hands:{OLD:{U7:{hand:[]},R7:{hand:[]}},KEEP:{R7:{hand:[]}}},
  adminUserAudit:{a1:{actor:'admin',uid:'U7',action:'rename',before:'Viejo',after:'Mati',at:1},a2:{actor:'admin',uid:'R7',action:'level',at:1}},
  creditAccountingAudit:{h1:{changes:[{uid:'U7',before:null,after:{balance:5}}]},h2:{changes:[{uid:'R7'}]}},
  accountDeletionJobs:{U7:{anonymousId:'deleted_x',requestId:'req',at:1}}
 };
}
const ledger=()=>({wallets:{U7:{balance:4,locked:0,deleting:true},R7:{balance:5,locked:0}},matches:{m:{player1:'U7',player2:'R7',players:{player1:{uid:'U7',name:'Mati'},player2:{uid:'R7',name:'Rival'}},status:'settled',session:{room:{}}}},walletMovements:{U7:{k:{at:1}}}});

test('Erasing a player removes every personal branch and keeps everyone else',()=>{
 const n=S.erasePlayerData(fullRoot(),{uid:'U7',anonymousId:'deleted_x',now:NOW});
 for(const branch of ['profiles','avatars','pushTokens','presence','playerStatus','levels','adminMessages','adminThreads','friends','friendRequests','friendRequestsSent','userBlocks','tableInvites','tableInviteReplies','tableInviteLog','creditRateLimits'])assert.equal(n[branch].U7,undefined,branch);
 assert.deepEqual(n.usernames,{rival:'R7'});
 assert.equal(n.friends.R7.U7,undefined);assert.ok(n.friends.R7.x);
 assert.equal(n.friendRequestsSent.y.U7,undefined);assert.equal(n.friendRequests.z.U7,undefined);
 assert.equal(n.userBlocks.R7.U7,undefined);assert.equal(n.userBlocks.R7.x,true);
 assert.equal(n.tableInvites.R7.i2,undefined);assert.ok(n.tableInvites.R7.i3);
 assert.equal(n.tableInviteReplies.R7.i1,undefined);assert.ok(n.tableInviteReplies.R7.i4);
 assert.equal(n.tableInviteLog.R7.U7,undefined);assert.ok(n.tableInviteLog.R7.x);
 assert.equal(n.adminConfig.testUsers.U7,undefined);assert.equal(n.adminConfig.testUsers.R7,true);
 const day=n.adminMetrics.days[TODAY];
 assert.equal(day.users.U7,undefined);assert.equal(day.platforms.U7,undefined);assert.equal(day.hours['12'].U7,undefined);assert.equal(day.users.R7,true);
 assert.equal(n.adminMetrics.presence.U7,undefined);
 // The visit stays counted, without the account.
 assert.deepEqual(n.adminMetrics.visitLog[TODAY].v1,{platform:'app-ios',at:NOW});assert.equal(n.adminMetrics.visitLog[TODAY].v2.uid,'R7');
 assert.equal(n.chatLog[CHAT_DAY].k1,undefined);assert.ok(n.chatLog[CHAT_DAY].k2);
 assert.equal(n.problemReports.U7_req,undefined);assert.ok(n.problemReports.R7_req);
 assert.equal(n.rooms.OLD,undefined);assert.equal(n.hands.OLD,undefined);assert.ok(n.rooms.KEEP);
 assert.equal(n.adminUserAudit.a1.uid,'deleted_x');assert.equal(n.adminUserAudit.a1.after,'Jugador eliminado');
 assert.equal(n.creditAccountingAudit.h1.changes[0].uid,'deleted_x');
 assert.deepEqual(n.userAccess.U7,{blocked:true,deletedAt:NOW});
 assert.equal(n.administrators.R7,true);assert.deepEqual(n.profiles.R7,{name:'Rival'});assert.ok(n.avatars.R7);assert.ok(n.pushTokens.R7);
 assert.equal(JSON.stringify(n).includes('"Mati"'),false,'the name is gone');
 // Only the deletion tombstone and the pending job keep the uid (as their key).
 const {userAccess,accountDeletionJobs,...rest}=n;
 assert.equal(JSON.stringify(rest).includes('U7'),false,'the uid is gone');
 assert.deepEqual(Object.keys(userAccess).sort(),['R7','U7']);
 assert.deepEqual(S.erasePlayerData(n,{uid:'U7',anonymousId:'deleted_x',now:NOW}),n);
});

test('The ledger keeps totals and results under the anonymous id',()=>{
 const l=S.eraseLedger(ledger(),{uid:'U7',anonymousId:'deleted_x',name:'Mati',now:NOW});
 assert.equal(l.wallets.U7,undefined);assert.deepEqual(l.wallets.deleted_x,{balance:0,locked:0,deleting:true,deletedAt:NOW});
 assert.equal(l.matches.m.player1,'deleted_x');assert.equal(l.matches.m.players.player1.name,'Jugador eliminado');assert.equal(l.matches.m.session,undefined);
 assert.ok(l.walletMovements.deleted_x);assert.equal(l.wallets.R7.balance,5);
 assert.deepEqual(S.eraseLedger(l,{uid:'U7',anonymousId:'deleted_x',name:'Mati',now:NOW+5}),l);
});

test('Updates touch only changed paths and never overlap',()=>{
 assert.deepEqual(S.diffUpdates({a:{b:1,c:{d:2}},e:[1]},{a:{b:1},e:[1],f:{g:1}}),{'a/c/d':null,'f/g':1});
 // A branch that was not read (another user's access, the audit log) gets only the new leaves, never a whole replacement.
 assert.deepEqual(S.diffUpdates({},{userAccess:{U7:{deleting:true}},adminUserAudit:{req1:{uid:'U7'}}}),{'userAccess/U7/deleting':true,'adminUserAudit/req1/uid':'U7'});
 assert.deepEqual(S.diffUpdates({avatars:{U7:{photo:'x',at:1}}},{}),{'avatars/U7/photo':null,'avatars/U7/at':null});
 assert.deepEqual(S.mergeUpdates({'a/b':null},{'a/b/c':null,'a/d':1}),{'a/b':null,'a/d':1});
 assert.throws(()=>S.mergeUpdates({'a':{x:1}},{'a/b':null}),/superpuestas/);
 const days=S.activityDayPaths('U7',NOW);
 assert.ok(Object.hasOwn(days,'adminMetrics/days/'+TODAY+'/users/U7'));assert.ok(Object.hasOwn(days,'adminMetrics/days/'+TODAY+'/hours/12/U7'));
 assert.ok(Object.values(days).every(v=>v===null));
});

// In-memory database with the queries deletion uses; records every read.
function fakeDb(initial){
 let data=structuredClone(initial);const reads=[];
 const at=p=>p.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data);
 const ref=(p='',query={})=>({
  orderByChild:child=>ref(p,{...query,child}),orderByValue:()=>ref(p,{...query,byValue:true}),orderByKey:()=>ref(p,{...query,byKey:true}),
  equalTo:v=>ref(p,{...query,equal:v}),startAt:v=>ref(p,{...query,start:v}),endAt:v=>ref(p,{...query,end:v}),
  async get(){
   reads.push({path:p,query});let value=at(p)??null;
   if(value&&Object.keys(query).length){
    const pick=([k,v])=>query.byKey?k>=(query.start??'')&&k<=(query.end??'￿'):(query.byValue?v:query.child.split('/').reduce((x,key)=>x?.[key],v))===query.equal;
    value=Object.fromEntries(Object.entries(value).filter(pick));if(!Object.keys(value).length)value=null;
   }
   return {val:()=>structuredClone(value),exists:()=>value!=null};
  },
  async update(map){
   assert.equal(p,'');
   const keys=Object.keys(map);for(const a of keys)for(const b of keys)assert.ok(a===b||!b.startsWith(a+'/'),'overlap '+a+' '+b);
   for(const [key,v] of Object.entries(map)){const parts=key.split('/');let node=data;for(const k of parts.slice(0,-1))node=node[k]??={};if(v===null)delete node[parts.at(-1)];else node[parts.at(-1)]=structuredClone(v);}
   const prune=node=>{if(!node||typeof node!=='object'||Array.isArray(node))return node;for(const k of Object.keys(node)){node[k]=prune(node[k]);if(node[k]&&typeof node[k]==='object'&&!Array.isArray(node[k])&&!Object.keys(node[k]).length)delete node[k];}return node;};
   prune(data);
  }
 });
 return {ref,reads,data:()=>data};
}
function fakeCredits(initial){
 let state=structuredClone(initial);
 return {state:()=>state,async readLedger(){return structuredClone(state);},async patchLedger(update){const next=update(structuredClone(state));if(next===undefined)return {committed:false,value:state};state=next;return {committed:true,value:next};}};
}

test('Deletion reads only the player branches, never the root, and leaves no personal data',async()=>{
 const root=fullRoot();delete root.accountDeletionJobs;
 const db=fakeDb(root),credits=fakeCredits({...ledger(),wallets:{U7:{balance:4,locked:0},R7:{balance:5,locked:0}}});
 const job={anonymousId:'deleted_x',requestId:'req',at:NOW};
 await S.prepareDeletion({db,creditStore:credits,uid:'U7',requestId:'req',prepare:r=>S.prepareSelfDeletion(r,{uid:'U7',requestId:'req',now:NOW}),extraUpdates:()=>({'accountDeletionJobs/U7':job})});
 assert.equal(db.data().userAccess.U7.blocked,true);assert.equal(credits.state().wallets.U7.deleting,true);assert.deepEqual(db.data().accountDeletionJobs.U7,job);
 assert.equal(db.data().adminUserAudit.req.action,'delete');
 await S.completeDeletion({db,creditStore:credits,uid:'U7',job,now:NOW});
 assert.ok(db.reads.every(r=>r.path!==''),'never reads the whole database');
 for(const whole of ['profiles','friends','avatars','chatLog','adminMetrics','rooms','usernames','adminUserAudit','problemReports'])assert.ok(db.reads.every(r=>r.path!==whole||Object.keys(r.query).length),'no full read of '+whole);
 const after=db.data();
 const prune=node=>{if(!node||typeof node!=='object'||Array.isArray(node))return node;for(const k of Object.keys(node)){node[k]=prune(node[k]);if(node[k]&&typeof node[k]==='object'&&!Array.isArray(node[k])&&!Object.keys(node[k]).length)delete node[k];}return node;};
 const expected=prune(S.erasePlayerData(fullRoot(),{uid:'U7',anonymousId:'deleted_x',now:NOW}));
 for(const branch of ['profiles','usernames','avatars','friends','friendRequests','friendRequestsSent','pushTokens','presence','playerStatus','levels','adminMessages','adminThreads','tableInvites','tableInviteReplies','tableInviteLog','userBlocks','chatLog','problemReports','rooms','hands','creditAccountingAudit'])
  assert.deepEqual(after[branch],expected[branch],branch);
 assert.deepEqual(after.adminMetrics.visitLog,expected.adminMetrics.visitLog);assert.equal(after.adminMetrics.days[TODAY].users.U7,undefined);assert.equal(after.adminMetrics.days[TODAY].users.R7,true);
 assert.equal(after.adminMetrics.presence.U7,undefined);assert.equal(after.adminConfig.testUsers.U7,undefined);
 assert.equal(after.userAccess.U7.deletedAt,NOW);assert.equal(after.userAccess.U7.deletionRequestId,'req');
 assert.equal(credits.state().wallets.U7,undefined);assert.equal(credits.state().wallets.deleted_x.balance,0);
 assert.equal(JSON.stringify(after).includes('Mati'),false);assert.equal(JSON.stringify(credits.state()).includes('Mati'),false);
 // A retry (the job is removed only after the Firebase account) changes nothing personal.
 const again=await S.completeDeletion({db,creditStore:credits,uid:'U7',job,now:NOW});
 assert.deepEqual(Object.keys(again).filter(k=>!k.startsWith('adminMetrics/days/')),[]);
});

test('Preparation keeps the safety checks: reserved credits and active own tables',async()=>{
 const db=fakeDb({profiles:{U7:{name:'Mati'}},rooms:{MINE:{public:{status:'started',createdAt:NOW-1000,table:{uid:'U7'},players:{player1:{uid:'U7'}}}}}});
 const credits=fakeCredits({wallets:{U7:{balance:4,locked:0}}});
 const prepare=r=>S.prepareSelfDeletion(r,{uid:'U7',requestId:'req',now:NOW});
 await assert.rejects(()=>S.prepareDeletion({db,creditStore:credits,uid:'U7',requestId:'req',prepare}),/Cerrá tu mesa/);
 const locked=fakeCredits({wallets:{U7:{balance:4,locked:1}}});
 await assert.rejects(()=>S.prepareDeletion({db:fakeDb({profiles:{U7:{name:'Mati'}}}),creditStore:locked,uid:'U7',requestId:'req',prepare}),/créditos/);
 assert.equal(locked.state().wallets.U7.deleting,undefined);
});

test('Forged legacy rooms cannot block a deletion forever',()=>{
 const base={status:'started',players:{player1:{uid:'victim'}},table:{uid:'victim'}};
 assert.equal(legacyTableActive(base,NOW),false,'no timestamps');
 assert.equal(legacyTableActive({...base,createdAt:NOW+86400000*365},NOW),false,'future createdAt');
 assert.equal(legacyTableActive({...base,createdAt:NOW-1000,feed:[{time:NOW+86400000}]},NOW),false,'future activity');
 assert.equal(legacyTableActive({...base,createdAt:NOW-1000},NOW),true,'a real recent game still counts');
 assert.equal(legacyTableActive({...base,createdAt:NOW-3600000},NOW),false,'an hour without activity');
 assert.doesNotThrow(()=>S.prepareSelfDeletion({profiles:{victim:{name:'V'}},rooms:{FAKE:{public:{...base,createdAt:NOW*2}}}},{uid:'victim',requestId:'req',now:NOW}));
});

// Rules: evaluate the shipped expressions with the documented snapshot methods.
class Snapshot{constructor(v){this.v=v??null;}child(k){return new Snapshot(this.v?.[k]);}exists(){return this.v!==null;}val(){return this.v;}}
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase.database.rules.json'),'utf8')).rules;
const run=(expression,context)=>typeof expression==='boolean'?expression:Function(...Object.keys(context),'return ('+expression+')')(...Object.values(context));
test('Legacy rooms and hands are closed to client writes and readable only by their players',()=>{
 const json=JSON.stringify({rooms:rules.rooms,hands:rules.hands});
 assert.equal(/"\.write":(?!false)/.test(json),false,'no client write anywhere under rooms or hands');
 assert.equal(rules.rooms['.read'],false);assert.equal(rules.hands['.read'],false);
 assert.equal(rules.rooms.$room.public.connectionPresence,undefined);
 const room={players:{player1:{uid:'a'},player2:{uid:'b'}},table:{uid:'a'}},read=rules.rooms.$room.public['.read'];
 const ctx=uid=>({auth:uid?{uid}:null,data:new Snapshot(room),root:new Snapshot({userAccess:{blocked:{blocked:true}}})});
 assert.equal(run(read,ctx('a')),true);assert.equal(run(read,ctx('b')),true);
 assert.equal(run(read,ctx('c')),false);assert.equal(run(read,ctx(null)),false);
 const blocked={...ctx('a'),root:new Snapshot({userAccess:{a:{blocked:true}}})};assert.equal(run(read,blocked),false);
 const hand=rules.hands.$room.$uid['.read'];
 assert.equal(run(hand,{auth:{uid:'a'},$uid:'a',root:new Snapshot({})}),true);assert.equal(run(hand,{auth:{uid:'b'},$uid:'a',root:new Snapshot({})}),false);
});
test('Server indexes for targeted deletion queries are declared',()=>{
 assert.ok(rules.rooms['.indexOn'].includes('public/table/uid'));assert.ok(rules.rooms['.indexOn'].includes('public/players/player4/uid'));
 assert.equal(rules.usernames['.indexOn'],'.value');
 assert.deepEqual(rules.adminUserAudit['.indexOn'],['uid','actor']);
 assert.deepEqual(rules.chatLog.$day['.indexOn'],['uid']);assert.deepEqual(rules.adminMetrics.visitLog.$day['.indexOn'],['uid']);
 for(const branch of ['adminUserAudit','chatLog','adminMetrics'])assert.equal(rules[branch]['.read'],false);
});
test('deleteMyAccount is rate limited and never reads or transacts the whole database',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../functions/index.cjs'),'utf8');
 const fn=source.slice(source.indexOf('async function completeSelfDeletion('),source.indexOf('exports.adminConsole='));
 assert.match(fn,/rateLimit\(uid,\d+,'account-deletion'\)/);
 assert.doesNotMatch(fn,/readRoot|rootTransaction|db\.ref\(\)\.(get|transaction|once)/);
 const admin=source.slice(source.indexOf("if(action==='delete'){"),source.indexOf("if(action==='levels-backfill')"));
 assert.doesNotMatch(admin,/readRoot|rootTransaction/);
 const rename=source.slice(source.indexOf("if(action==='rename'){"),source.indexOf("if(action==='level'){"));
 assert.doesNotMatch(rename,/db\.ref\(\)\.(get|transaction)/);
});
