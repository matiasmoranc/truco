'use strict';
// How long people stay and whether they come back, for the admin panel.
// Each page load (or app launch) is a session: the page says it is open at start and then
// every 30 seconds while it is on screen. Entries live under sessionLog/{Uruguay day}/{sid}
// for SESSION_DAYS; nothing in them identifies the person or the device.
const {uruguayDate,PLATFORMS}=require('./activity-service.cjs');

const SESSION_DAYS=90;
const SESSION_TICK=30;
const SESSION_PAGES=['juego','anotador','aprender','otra'];
const SESSION_AREAS=['inicio','lobby','sala','partida','bot','aprender','anotador','otra'];
// Visit length groups, in seconds: the first one is people who leave almost at once.
const SESSION_BUCKETS=[{id:'lt1',label:'Menos de 1 min',max:60},{id:'1-5',label:'1 a 5 min',max:300},{id:'5-15',label:'5 a 15 min',max:900},{id:'15-30',label:'15 a 30 min',max:1800},{id:'30+',label:'Más de 30 min',max:Infinity}];
const SID=/^[0-9a-z]{6,12}-[0-9a-z]{4,12}$/;

// The session id starts with its start time (base 36), so every tick lands on the day it started.
function sessionUpdates({sid,platform,page,area,signed,seconds,now,increment}){
 if(typeof sid!=='string'||!SID.test(sid))throw new Error('Sesión inválida.');
 const start=parseInt(sid.split('-')[0],36);
 if(!Number.isFinite(start)||start>now+60000||now-start>12*3600000)throw new Error('Sesión inválida.');
 if(!PLATFORMS.includes(platform)||!SESSION_PAGES.includes(page)||!SESSION_AREAS.includes(area)||![0,SESSION_TICK].includes(seconds)||typeof signed!=='boolean')throw new Error('Sesión inválida.');
 const base=uruguayDate(start).day+'/'+sid+'/',result={[base+'p']:platform,[base+'g']:page,[base+'at']:start};
 if(signed)result[base+'s']=true;
 if(seconds){result[base+'t']=increment(seconds);result[base+'a/'+area]=increment(seconds);}
 return result;
}

const dayList=(from,to)=>{const list=[];for(let d=from;d<=to;d=new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10))list.push(d);return list;};
const bucketOf=seconds=>SESSION_BUCKETS.find(b=>seconds<b.max).id;

// stored: {day:{sid:{p,g,s,t,a}}} for the days asked (from..to).
function sessionSummary(stored,from,to){
 const days=dayList(from,to),daily={},buckets=Object.fromEntries(SESSION_BUCKETS.map(b=>[b.id,0])),platforms={},areas={},pages={},accounts={signed:{n:0,t:0},guest:{n:0,t:0}};
 let sessions=0,total=0;
 for(const day of days){
  const list=Object.values(stored?.[day]||{}).filter(s=>s&&PLATFORMS.includes(s.p));
  let dayTotal=0;
  for(const s of list){
   const t=Math.max(0,Number(s.t)||0);dayTotal+=t;buckets[bucketOf(t)]++;
   (platforms[s.p]??={n:0,t:0}).n++;platforms[s.p].t+=t;
   const page=SESSION_PAGES.includes(s.g)?s.g:'otra';(pages[page]??={n:0,t:0}).n++;pages[page].t+=t;
   const who=accounts[s.s?'signed':'guest'];who.n++;who.t+=t;
   for(const [area,secs] of Object.entries(s.a||{}))if(SESSION_AREAS.includes(area))areas[area]=(areas[area]||0)+Math.max(0,Number(secs)||0);
  }
  sessions+=list.length;total+=dayTotal;
  daily[day]={sessions:list.length,seconds:dayTotal,average:list.length?Math.round(dayTotal/list.length):0};
 }
 return {days,daily,sessions,seconds:total,average:sessions?Math.round(total/sessions):0,buckets:SESSION_BUCKETS.map(b=>({...b,max:undefined,count:buckets[b.id]})),platforms,areas,pages,accounts};
}

// Whether players come back: activity {day:{users:{uid:true}}} (signed-in players, every day they
// used the game). A player is new on the first day they appear, skipping the first recorded day
// (everyone appears new there). Back after 1 day: active the next day; in a week: on any of the
// next 7 days; in a month: on any of the next 30. Only cohorts whose window has fully passed count.
function retentionSummary(activity,{today,exclude=new Set(),from=null}={}){
 const days=Object.keys(activity||{}).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
 if(!days.length)return {cohorts:[],totals:{}};
 const active=Object.fromEntries(days.map(d=>[d,new Set(Object.keys(activity[d]?.users||{}).filter(uid=>!exclude.has(uid)))]));
 const first={};for(const d of days)for(const uid of active[d])first[uid]??=d;
 const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const backWithin=(uid,day,n)=>{for(let i=1;i<=n;i++)if(active[addDays(day,i)]?.has(uid))return true;return false;};
 const cohorts=[];
 for(const day of days.slice(1)){
  if(from&&day<from)continue;
  const fresh=[...active[day]].filter(uid=>first[uid]===day);if(!fresh.length)continue;
  const row={day,size:fresh.length};
  for(const [key,n] of [['d1',1],['d7',7],['d30',30]])if(addDays(day,n)<today)row[key]=fresh.filter(uid=>backWithin(uid,day,n)).length;
  cohorts.push(row);
 }
 const totals={};
 for(const key of ['d1','d7','d30']){const rows=cohorts.filter(c=>c[key]!=null);const size=rows.reduce((n,c)=>n+c.size,0);totals[key]={size,back:rows.reduce((n,c)=>n+c[key],0)};}
 return {cohorts,totals};
}

module.exports={SESSION_DAYS,SESSION_TICK,SESSION_PAGES,SESSION_AREAS,SESSION_BUCKETS,sessionUpdates,sessionSummary,retentionSummary};
