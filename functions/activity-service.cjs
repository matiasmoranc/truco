'use strict';
const ACTIVE_MS=90000;
function uruguayDate(now){
 const local=new Date(now-10800000);
 return {day:local.toISOString().slice(0,10),hour:String(local.getUTCHours()).padStart(2,'0')};
}
function activityUpdates({uid,sessionId,visible,now}){
 if(typeof sessionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)||['__proto__','constructor','prototype'].includes(sessionId)||typeof visible!=='boolean')throw new Error('Sesión inválida.');
 const {day,hour}=uruguayDate(now);
 const result={['presence/'+uid+'/'+sessionId]:visible?{at:now}:null};
 if(visible){result['days/'+day+'/users/'+uid]=true;result['days/'+day+'/hours/'+hour+'/'+uid]=true;}
 return result;
}
function activityUserIds({scope,metrics,now}){
 if(scope==='today')return Object.keys(metrics.days?.[uruguayDate(now).day]?.users||{}).sort();
 if(scope==='active')return Object.entries(metrics.presence||{}).filter(([,sessions])=>Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now&&now-s.at<ACTIVE_MS)).map(([uid])=>uid).sort();
 throw new Error('Filtro inválido.');
}
function activitySummary({metrics,registeredUids,now}){
 const registered=new Set(registeredUids);
 const online=Object.entries(metrics.presence||{}).filter(([uid,sessions])=>registered.has(uid)&&Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now&&now-s.at<ACTIVE_MS)).map(([uid])=>uid);
 const today=uruguayDate(now).day;
 const days=Object.entries(metrics.days||{}).sort(([a],[b])=>b.localeCompare(a)).map(([day,data])=>({day,users:Object.keys(data.users||{}).length,hours:Array.from({length:24},(_,h)=>({hour:h,users:Object.keys(data.hours?.[String(h).padStart(2,'0')]||{}).length}))}));
 return {total:registered.size,active:online.length,online,todayUsers:days.find(d=>d.day===today)?.users||0,today,days,startedAt:metrics.startedAt||null,updatedAt:now};
}
module.exports={activityUserIds,ACTIVE_MS,uruguayDate,activityUpdates,activitySummary};
