'use strict';
// Test accounts and devices stay out of the admin numbers. Their visits are
// counted under visitsTest instead of visits, and their activity is filtered
// out of the summaries unless the panel asks to include it.
const {uruguayDate}=require('./activity-service.cjs');
// Counter paths (under adminMetrics) a visit adds to, in the real or the test bucket.
function visitCounterPaths(record,test){
 const {day,hour}=uruguayDate(record.at),base=(test?'visitsTest/':'visits/')+day+'/';
 const paths=[base+'visits/'+record.platform,base+'pages/'+record.page,base+'hours/'+hour];
 if(record.first)paths.push(base+'visitors/'+record.platform);
 return paths;
}
// Moves logged visits between the real and the test counters; visits that share
// a counter add up into one increment.
function moveVisitsUpdates(records,toTest,increment){
 const totals={};
 for(const record of records){
  for(const path of visitCounterPaths(record,!toTest))totals[path]=(totals[path]||0)-1;
  for(const path of visitCounterPaths(record,toTest))totals[path]=(totals[path]||0)+1;
 }
 return Object.fromEntries(Object.entries(totals).map(([path,n])=>[path,increment(n)]));
}
const moveVisitUpdates=(record,toTest,increment)=>moveVisitsUpdates([record],toTest,increment);
const add=(a,b)=>{const out={...a};for(const [k,v] of Object.entries(b||{}))out[k]=(Number.isSafeInteger(out[k])?out[k]:0)+(Number.isSafeInteger(v)?v:0);return out;};
// Real plus test counters, for the "include test data" view.
function mergeVisitCounters(real,test){
 const out={};
 for(const day of new Set([...Object.keys(real||{}),...Object.keys(test||{})])){
  const a=real?.[day]||{},b=test?.[day]||{};
  out[day]=Object.fromEntries(['visits','visitors','pages','hours'].map(key=>[key,add(a[key],b[key])]));
 }
 return out;
}
// Daily activity and presence without the test accounts.
function withoutTestActivity({days,presence},testUids){
 const drop=obj=>Object.fromEntries(Object.entries(obj||{}).filter(([uid])=>!testUids.has(uid)));
 const cleanDays={};
 for(const [day,data] of Object.entries(days||{}))cleanDays[day]={...data,users:drop(data?.users),platforms:drop(data?.platforms),hours:Object.fromEntries(Object.entries(data?.hours||{}).map(([h,users])=>[h,drop(users)]))};
 return {days:cleanDays,presence:drop(presence)};
}
module.exports={visitCounterPaths,moveVisitUpdates,moveVisitsUpdates,mergeVisitCounters,withoutTestActivity};
