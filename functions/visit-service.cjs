'use strict';
// Anonymous page visits: counters only, no identifiers. A device reports
// "first" once per Uruguay day, so visitors approximate unique devices.
const {uruguayDate}=require('./activity-service.cjs');
const PLATFORMS=['app-ios','app-android','web-ios','web-android','web-desktop'];
const PAGES=['juego','anotador','aprender','otra'];
const VISIT_DAYS=90;
function visitUpdates({platform,page,first,now,increment}){
 if(!PLATFORMS.includes(platform)||!PAGES.includes(page)||typeof first!=='boolean')throw new Error('Visita inválida.');
 const {day,hour}=uruguayDate(now),base=day+'/';
 const result={[base+'visits/'+platform]:increment(1),[base+'pages/'+page]:increment(1),[base+'hours/'+hour]:increment(1)};
 if(first)result[base+'visitors/'+platform]=increment(1);
 return result;
}
const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
function visitSummary({visits,now,days=30}){
 const list=[];
 for(let i=days-1;i>=0;i--){
  const day=uruguayDate(now-i*86400000).day,data=visits?.[day]||{};
  const byPlatform=key=>Object.fromEntries(PLATFORMS.map(p=>[p,count(data[key]?.[p])]));
  const visitsBy=byPlatform('visits'),visitorsBy=byPlatform('visitors');
  list.push({day,visits:visitsBy,visitors:visitorsBy,
   totalVisits:Object.values(visitsBy).reduce((a,b)=>a+b,0),totalVisitors:Object.values(visitorsBy).reduce((a,b)=>a+b,0),
   pages:Object.fromEntries(PAGES.map(p=>[p,count(data.pages?.[p])])),
   hours:Array.from({length:24},(_,h)=>count(data.hours?.[String(h).padStart(2,'0')]))});
 }
 return {platforms:PLATFORMS,days:list};
}
module.exports={PLATFORMS,PAGES,VISIT_DAYS,visitUpdates,visitSummary};
