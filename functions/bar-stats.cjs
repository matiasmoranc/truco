'use strict';
// The Lobby Virtual (the 3D BAR) for the admin panel. The BAR writes barVisits/{Uruguay day}/{uid} =
// {name, last, h00..h23: true} when someone comes in; tables opened from it carry via 'bar' in the ledger.
const isHouseUid=uid=>typeof uid==='string'&&uid.startsWith('house_');
const isHouse=m=>!!m?.house||Object.values(m?.players||{}).some(p=>isHouseUid(p?.uid));
// People per day (the given days) and per hour of one day, each person once; exclude: test users.
function barVisitStats(visits,{days,day,exclude=new Set()}){
 const perDay=Object.fromEntries(days.map(d=>[d,0])),perHour=Array(24).fill(0),people=[];
 for(const [d,byUid] of Object.entries(visits||{})){
  for(const [uid,v] of Object.entries(byUid||{})){
   if(exclude.has(uid)||!v)continue;
   if(Object.hasOwn(perDay,d))perDay[d]++;
   if(d!==day)continue;
   const hours=Object.keys(v).filter(k=>/^h\d\d$/.test(k)&&v[k]).map(k=>Number(k.slice(1))).sort((a,b)=>a-b);
   for(const h of hours)perHour[h]++;
   people.push({uid,name:v.name||'',hours,last:Number(v.last)||null});
  }
 }
 people.sort((a,b)=>(b.last||0)-(a.last||0));
 return {perDay,perHour,people};
}
// Tables per day, split by where they were opened: lobby or Lobby Virtual (via 'bar').
function tablesByOrigin(ledger,{days,dayOf}){
 const zero=()=>Object.fromEntries(days.map(d=>[d,{lobby:0,bar:0}]));
 const out={created:zero(),vsPlayers:zero(),vsHouse:zero()};
 const add=(key,at,via)=>{if(!Number.isFinite(at))return;const d=dayOf(at);if(out[key][d])out[key][d][via==='bar'?'bar':'lobby']++;};
 for(const m of Object.values(ledger?.matches||{})){
  if(!m)continue;const house=isHouse(m);
  if(!house&&(m.matchNumber||1)===1)add('created',m.createdAt,m.via);
  if(m.status==='settled')add(house?'vsHouse':'vsPlayers',m.settledAt,m.via);
 }
 return out;
}
module.exports={barVisitStats,tablesByOrigin};
