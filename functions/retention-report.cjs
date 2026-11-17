'use strict';
// Retention panel of the admin: whether registered players are playing, how many, how much,
// and whether they keep playing. "Played" means finishing an online game (a settled match of
// the bank), against people or at a table with the house bots. Games against the computer on
// the phone or the page are not recorded per player and are not counted.
// Days are Uruguay days (UTC-3). Test accounts are left out everywhere.
const UY_OFFSET_MS=3*3600000;
const MAX_GAMES=30;
const MAX_DAYS=731;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const dayOf=at=>new Date(at-UY_OFFSET_MS).toISOString().slice(0,10);
const dayStart=d=>Date.parse(d+'T00:00:00Z')+UY_OFFSET_MS;
const daysBetween=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
const weekday=d=>(new Date(Date.parse(d+'T12:00:00Z')).getUTCDay()+6)%7; // Monday 0
const person=uid=>typeof uid==='string'&&uid!==''&&!uid.startsWith('bot:')&&!uid.startsWith('house_');
const validDay=d=>typeof d==='string'&&DAY.test(d)&&dayOf(dayStart(d))===d;

// A from..to range the panel can ask for: valid days, in order, not after today, at most MAX_DAYS long.
function cleanRange(from,to,today){
 if(!validDay(from)||!validDay(to)||from>to||from>today)return null;
 if(to>today)to=today;
 if(daysBetween(from,to)+1>MAX_DAYS)return null;
 return {from,to};
}

// Finished online games: [{day,uids,house}], one per match, with the real players in it.
function finishedGames(matches,exclude=new Set()){
 const list=[];
 for(const m of Object.values(matches||{})){
  const at=Number(m?.settledAt);if(m?.status!=='settled'||!Number.isFinite(at)||at<=0)continue;
  const all=Object.values(m.players||{}).map(p=>p?.uid);
  const uids=[...new Set(all.filter(person))].filter(uid=>!exclude.has(uid));
  if(uids.length)list.push({day:dayOf(at),uids,house:!!m.house||all.some(uid=>typeof uid==='string'&&!person(uid))});
 }
 return list;
}

// The chart groups of a range: each day, each week (Monday to Sunday) or each calendar month,
// cut to the range.
function groupsOf(from,to,group){
 const list=[];
 for(let start=from;start<=to;){
  let end=group==='week'?addDays(start,6-weekday(start)):group==='month'?addDays(addDays(start.slice(0,8)+'01',32).slice(0,8)+'01',-1):start;
  if(end>to)end=to;list.push({from:start,to:end});start=addDays(end,1);
 }
 return list;
}

const histogramOf=counts=>{const h={};for(const n of Object.values(counts)){const k=Math.min(n,MAX_GAMES);h[k]=(h[k]||0)+1;}return h;};

// accounts: [{uid,at}] real accounts (sign-up time); games: finishedGames(); entered: {day:Set(uid)}
// (players who opened the game with their account, kept for entryDays); entryFrom: first day of it.
function report({accounts=[],games=[],entered={},entryFrom=null,today,from,to,compareFrom=null,compareTo=null,group='day',exclude=new Set()}){
 group=['day','week','month'].includes(group)?group:'day';
 const real=accounts.filter(a=>a&&person(a.uid)&&!exclude.has(a.uid)&&Number.isFinite(a.at));
 const byDay={};for(const g of games)(byDay[g.day]??=[]).push(g);
 const registeredBy=end=>new Set(real.filter(a=>a.at<end).map(a=>a.uid));

 // Who played in a range, how many games each and on which days.
 function play(from,to,registered){
  const counts={},days={},last={};let total=0,vsPeople=0,vsBots=0;
  for(let d=from;d<=to;d=addDays(d,1))for(const g of byDay[d]||[]){
   const uids=g.uids.filter(uid=>registered.has(uid));if(!uids.length)continue;
   total++;if(g.house)vsBots++;else vsPeople++;
   for(const uid of uids){counts[uid]=(counts[uid]||0)+1;(days[uid]??=new Set()).add(d);last[uid]=d;}
  }
  return {counts,days,last,total,vsPeople,vsBots};
 }

 function stats(from,to,{lists=false}={}){
  const length=daysBetween(from,to)+1,end=dayStart(addDays(to,1)),start=dayStart(from);
  const registered=registeredBy(end),fresh=real.filter(a=>a.at>=start&&a.at<end).map(a=>a.uid);
  const now=play(from,to,registered);
  // The same number of days just before: how many of those players played again now.
  const prevFrom=addDays(from,-length),prevTo=addDays(from,-1),before=play(prevFrom,prevTo,registered);
  const prevPlayers=Object.keys(before.counts),kept=prevPlayers.filter(uid=>now.counts[uid]);
  // Opened the game with their account but finished no game (only while entries are kept).
  let entry=null;
  if(entryFrom&&to>=entryFrom){
   const seen=new Set();for(let d=from<entryFrom?entryFrom:from;d<=to;d=addDays(d,1))for(const uid of entered[d]||[])if(registered.has(uid))seen.add(uid);
   entry={entered:seen.size,withoutPlaying:[...seen].filter(uid=>!now.counts[uid]).length,partial:from<entryFrom};
  }
  const result={from,to,days:length,registered:registered.size,newAccounts:fresh.length,newPlayed:fresh.filter(uid=>now.counts[uid]).length,
   players:Object.keys(now.counts).length,histogram:histogramOf(now.counts),plays:Object.values(now.counts).reduce((a,b)=>a+b,0),games:now.total,vsPeople:now.vsPeople,vsBots:now.vsBots,
   severalDays:Object.values(now.days).filter(s=>s.size>=2).length,
   previous:{from:prevFrom,to:prevTo,players:prevPlayers.length,kept:kept.length},entry,
   series:groupsOf(from,to,group).map(p=>{
    const r=registeredBy(dayStart(addDays(p.to,1))),s=play(p.from,p.to,r);
    return {from:p.from,to:p.to,histogram:histogramOf(s.counts),games:s.total,newAccounts:real.filter(a=>a.at>=dayStart(p.from)&&a.at<dayStart(addDays(p.to,1))).length};
   })};
  if(lists){
   // Most active players, and the ones who played the period before but not in this one.
   result.top=Object.entries(now.counts).sort((a,b)=>b[1]-a[1]||now.last[b[0]].localeCompare(now.last[a[0]])).slice(0,30)
    .map(([uid,n])=>({uid,games:n,days:now.days[uid].size,last:now.last[uid]}));
   result.stopped=prevPlayers.filter(uid=>!now.counts[uid]).sort((a,b)=>before.counts[b]-before.counts[a]||before.last[b].localeCompare(before.last[a])).slice(0,30)
    .map(uid=>({uid,games:before.counts[uid],last:before.last[uid]}));
  }
  return result;
 }

 // Groups of players by the week (or month) they signed up, within the range: the share that
 // played in their first, second… week (or 30 days) after signing up. Newest group first.
 function cohorts(from,to){
  const span=group==='month'?30:7,columns=group==='month'?6:8;
  const groups=groupsOf(from,to,group==='month'?'month':'week').slice(-12).reverse();
  return {span,columns,rows:groups.map(p=>{
   const members=real.filter(a=>a.at>=dayStart(p.from)&&a.at<dayStart(addDays(p.to,1))).map(a=>({uid:a.uid,day:dayOf(a.at)}));
   const cells=[];
   for(let k=0;k<columns;k++){
    // Only the members whose k-th window has started; it is complete once it ended for all of them.
    const started=members.filter(m=>addDays(m.day,k*span)<=today);if(!started.length)break;
    const played=started.filter(m=>{for(let d=addDays(m.day,k*span),e=addDays(m.day,k*span+span-1);d<=e&&d<=today;d=addDays(d,1))if((byDay[d]||[]).some(g=>g.uids.includes(m.uid)))return true;return false;}).length;
    cells.push({players:started.length,played,complete:members.every(m=>addDays(m.day,k*span+span-1)<today)});
   }
   return {from:p.from,to:p.to,size:members.length,cells};
  }).filter(r=>r.size)};
 }

 const main=stats(from,to,{lists:true});
 const compare=compareFrom&&compareTo?stats(compareFrom,compareTo):null;
 return {today,group,maxGames:MAX_GAMES,main,compare,cohorts:cohorts(from,to),entryFrom};
}

module.exports={report,finishedGames,groupsOf,cleanRange,MAX_GAMES,MAX_DAYS};
