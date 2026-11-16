'use strict';
// What share of the registered players came in each day, week or month, and how many times.
// The registered total of a period is the players who had an account by the end of that period
// (not today's total). A "time" is a visit with the account (adminMetrics/visitLog records with uid).
const UY_OFFSET_MS=3*3600000;
const MAX_TIMES=30;
const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const dayStartMs=d=>Date.parse(d+'T00:00:00Z')+UY_OFFSET_MS;
const weekday=d=>(new Date(Date.parse(d+'T12:00:00Z')).getUTCDay()+6)%7; // Monday 0

// The periods that end on or before today, newest last: 30 days, 12 weeks (Monday to Sunday) or 3 months.
function periodsFor(kind,today){
 const list=[];
 if(kind==='week'){let start=addDays(today,-weekday(today));for(let i=0;i<12;i++){list.unshift({from:start,to:addDays(start,6)});start=addDays(start,-7);}}
 else if(kind==='month'){let [y,m]=today.split('-').map(Number);for(let i=0;i<3;i++){const from=`${y}-${String(m).padStart(2,'0')}-01`,next=m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`;list.unshift({from,to:addDays(next,-1)});m--;if(!m){m=12;y--;}}}
 else for(let i=29;i>=0;i--){const d=addDays(today,-i);list.push({from:d,to:d});}
 return list;
}

// signups: [{uid,at}] of real accounts; log: {day:{id:{uid,at,test}}}; exclude: test account uids.
// firstDay: the first day with visit records (older periods are marked as partial).
function activityShare({kind='day',signups=[],log={},today,exclude=new Set(),firstDay=null}){
 kind=['day','week','month'].includes(kind)?kind:'day';
 const accounts=signups.filter(s=>s&&typeof s.uid==='string'&&!exclude.has(s.uid)&&Number.isFinite(s.at));
 // Periods that ended before there were records say nothing: they are left out.
 const periods=periodsFor(kind,today).filter(p=>!firstDay||p.to>=firstDay).map(p=>{
  const end=dayStartMs(addDays(p.to,1)),registered=new Set(accounts.filter(s=>s.at<end).map(s=>s.uid)),times={};
  for(let d=p.from;d<=p.to&&d<=today;d=addDays(d,1))for(const r of Object.values(log?.[d]||{})){
   if(!r||typeof r.uid!=='string'||r.test===true||!registered.has(r.uid))continue;
   times[r.uid]=(times[r.uid]||0)+1;
  }
  const histogram={};for(const n of Object.values(times)){const key=Math.min(n,MAX_TIMES);histogram[key]=(histogram[key]||0)+1;}
  return {...p,registered:registered.size,histogram,current:p.to>=today,partial:!!firstDay&&p.from<firstDay};
 });
 return {kind,today,maxTimes:MAX_TIMES,periods};
}

module.exports={activityShare,periodsFor,MAX_TIMES};
