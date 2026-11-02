'use strict';
// Anonymous use of the scorer and the learning section for the admin panel.
// events: what was used, per day and platform (people: first time that day on a device).
// journeys: what devices that first came through the scorer or the guide did next,
// counted on the day they arrived. Nothing identifies the person or the device.
const {uruguayDate,PLATFORMS}=require('./activity-service.cjs');
const {visitOrigin,VISIT_DAYS}=require('./visit-service.cjs');
const USAGE_EVENTS=['anotador-web-start','anotador-web-finish','anotador-web-promo','anotador-web-play',
 'anotador-game-open','anotador-game-start','anotador-game-finish','anotador-game-share',
 'aprender-web-end','aprender-web-play','aprender-game-open','aprender-game-videos','aprender-game-videos-end',
 'aprender-game-stage-0','aprender-game-stage-1','aprender-game-stage-2','aprender-game-finish-0','aprender-game-finish-1','aprender-game-finish-2',
 'aprender-game-envido','aprender-game-flor','aprender-game-flor-points','aprender-game-guide'];
const USAGE_TARGETS=[10,20,30,40,50,60];
const JOURNEY_PAGES=['anotador','aprender'];
const JOURNEY_STEPS=['landing','used','finished','game','entered','registered','scorer','learn','played','returned'];
const JOURNEY_ORIGINS=['Google','Instagram','Facebook','WhatsApp','Directo','Otros'];
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const nextDay=day=>new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
function journeyOrigin(ref){const origin=visitOrigin(ref);return JOURNEY_ORIGINS.includes(origin)?origin:'Otros';}
function usageUpdates({platform,event,first,target,step,landing,now,increment}){
 if(!PLATFORMS.includes(platform)||(event==null&&step==null))throw new Error('Uso inválido.');
 const today=uruguayDate(now).day,result={};
 if(event!=null){
  if(!USAGE_EVENTS.includes(event)||typeof first!=='boolean')throw new Error('Uso inválido.');
  result[today+'/events/'+event+'/'+platform]=increment(1);
  if(first)result[today+'/people/'+event+'/'+platform]=increment(1);
 }
 if(target!=null){
  if(!USAGE_TARGETS.includes(target))throw new Error('Uso inválido.');
  result[today+'/targets/'+target]=increment(1);
 }
 if(step!=null){
  const day=landing?.day;
  if(!JOURNEY_STEPS.includes(step)||!JOURNEY_PAGES.includes(landing?.page)||!DAY.test(day||'')||day>today||day<uruguayDate(now-(VISIT_DAYS-1)*86400000).day)throw new Error('Uso inválido.');
  result[day+'/journeys/'+landing.page+'/'+journeyOrigin(landing.ref)+'/'+step]=increment(1);
 }
 return result;
}
// Real plus test counters, for the "include test data" view.
function mergeUsage(a,b){
 if(typeof a==='number'||typeof b==='number')return count(a)+count(b);
 const out={...a};
 for(const [key,value] of Object.entries(b||{}))out[key]=mergeUsage(a?.[key],value);
 return out;
}
// A period's numbers: page visits come from the visit details, the rest from the usage counters.
// exclude: test account uids to leave out, together with visits from test devices (null keeps everything).
function usageSummary({log,usage,from,to,exclude=null}){
 const pages=Object.fromEntries(JOURNEY_PAGES.map(page=>[page,{visits:0,people:0,origins:{},platforms:{}}]));
 const days=new Map();
 for(let day=from;day<=to;day=nextDay(day))days.set(day,Object.fromEntries(JOURNEY_PAGES.map(page=>[page,{page:0,google:0,game:0}])));
 for(const [day,records] of Object.entries(log||{})){
  const daily=days.get(day);if(!daily)continue;
  for(const r of Object.values(records||{})){
   const group=pages[r?.page];
   if(!group||(exclude&&(r.test===true||exclude.has(r.uid))))continue;
   const origin=r.origin||'Directo',source=group.origins[origin]??={visits:0,people:0},first=r.first===true?1:0;
   group.visits++;group.people+=first;source.visits++;source.people+=first;
   group.platforms[r.platform]=(group.platforms[r.platform]||0)+first;
   daily[r.page].page+=first;if(origin==='Google')daily[r.page].google+=first;
  }
 }
 const events={},targets={},journeys={};
 for(const [day,data] of Object.entries(usage||{})){
  const daily=days.get(day);if(!daily)continue;
  for(const [event,platforms] of Object.entries(data?.events||{})){
   const total=events[event]??={count:0,people:0,apps:0,web:0};
   for(const [platform,value] of Object.entries(platforms||{})){total.count+=count(value);total[platform.startsWith('app-')?'apps':'web']+=count(value);}
  }
  for(const [event,platforms] of Object.entries(data?.people||{})){
   const people=Object.values(platforms||{}).reduce((sum,value)=>sum+count(value),0);
   (events[event]??={count:0,people:0,apps:0,web:0}).people+=people;
   if(event==='anotador-game-open')daily.anotador.game+=people;
   if(event==='aprender-game-open')daily.aprender.game+=people;
  }
  for(const [target,value] of Object.entries(data?.targets||{}))targets[target]=(targets[target]||0)+count(value);
  for(const [page,origins] of Object.entries(data?.journeys||{}))for(const [origin,steps] of Object.entries(origins||{}))for(const [step,value] of Object.entries(steps||{})){
   const bucket=((journeys[page]??={})[origin]??={});bucket[step]=(bucket[step]||0)+count(value);
  }
 }
 return {from,to,pages,events,targets,journeys,days:[...days].map(([day,data])=>({day,...data}))};
}
module.exports={USAGE_EVENTS,USAGE_TARGETS,JOURNEY_PAGES,JOURNEY_STEPS,JOURNEY_ORIGINS,journeyOrigin,usageUpdates,mergeUsage,usageSummary};
