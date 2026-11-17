'use strict';
// Tables per day for the admin panel (Uruguay days, the last `days` days, today last):
// created: new tables opened by real players (no rematches, no house tables);
// vsPlayers: games played to the end at tables of real players (rematches and abandons included);
// vsHouse: games played to the end against a house player.
const isHouseUid=uid=>typeof uid==='string'&&uid.startsWith('house_');
const isHouse=m=>!!m?.house||Object.values(m?.players||{}).some(p=>isHouseUid(p?.uid));

function tableDailyStats(ledger,{now,dayOf,days=30}){
 const list=Array.from({length:days},(_,i)=>dayOf(now-(days-1-i)*86400000));
 const series=()=>Object.fromEntries(list.map(day=>[day,0]));
 const out={days:list,created:series(),vsPlayers:series(),vsHouse:series()};
 const add=(key,at)=>{if(!Number.isFinite(at))return;const day=dayOf(at);if(Object.hasOwn(out[key],day))out[key][day]++;};
 for(const m of Object.values(ledger?.matches||{})){
  if(!m)continue;const house=isHouse(m);
  if(!house&&(m.matchNumber||1)===1)add('created',m.createdAt);
  if(m.status==='settled')add(house?'vsHouse':'vsPlayers',m.settledAt);
 }
 return out;
}
// People per day (Uruguay days, all the history): played = real players in a game that started that day
// (against people or the house), finished = real players in a game that ended that day. Someone with
// several games in a day counts once. exclude: uids left out (test users).
const isPerson=uid=>typeof uid==='string'&&uid!==''&&!uid.startsWith('bot:')&&!isHouseUid(uid);
function tablePlayerStats(ledger,{dayOf,exclude=new Set()}){
 const played={},finished={};
 const add=(map,at,uids)=>{if(!Number.isFinite(at))return;const day=dayOf(at);for(const uid of uids)(map[day]||=new Set()).add(uid);};
 for(const m of Object.values(ledger?.matches||{})){
  if(!m)continue;
  const uids=[...new Set(Object.values(m.players||{}).map(p=>p?.uid))].filter(uid=>isPerson(uid)&&!exclude.has(uid));
  if(!uids.length)continue;
  const settled=m.status==='settled',start=Number(m.startedAt)||(settled?Number(m.createdAt):NaN);
  add(played,start,uids);
  if(settled)add(finished,Number(m.settledAt),uids);
 }
 const counts=map=>Object.fromEntries(Object.entries(map).map(([day,set])=>[day,set.size]));
 return {played:counts(played),finished:counts(finished)};
}
module.exports={tableDailyStats,tablePlayerStats,isHouse};
