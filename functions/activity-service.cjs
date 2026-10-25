'use strict';
const ACTIVE_MS=90000;
function uruguayDate(now){
 const local=new Date(now-10800000);
 return {day:local.toISOString().slice(0,10),hour:String(local.getUTCHours()).padStart(2,'0')};
}
const PLATFORMS=['app-ios','app-android','web-ios','web-android','web-desktop'];
// Platform from the request itself, for clients that do not send one (older
// web pages still open and app builds published before this field existed).
// Capacitor serves the iOS app from capacitor://localhost and Android from
// https://localhost.
function requestPlatform({origin='',userAgent=''}={}){
 const agent=String(userAgent);
 if(/^capacitor:\/\/localhost$/i.test(origin))return 'app-ios';
 if(/^https?:\/\/localhost(:\d+)?$/i.test(origin))return /Android/.test(agent)?'app-android':/iPhone|iPad|iPod/.test(agent)?'app-ios':'web-desktop';
 if(/iPhone|iPad|iPod/.test(agent))return 'web-ios';
 if(/Android/.test(agent))return 'web-android';
 return 'web-desktop';
}
function activityUpdates({uid,sessionId,visible,now,platform}){
 if(typeof sessionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)||['__proto__','constructor','prototype'].includes(sessionId)||typeof visible!=='boolean')throw new Error('Sesión inválida.');
 const {day,hour}=uruguayDate(now);
 const result={['presence/'+uid+'/'+sessionId]:visible?{at:now}:null};
 if(visible){result['days/'+day+'/users/'+uid]=true;result['days/'+day+'/hours/'+hour+'/'+uid]=true;}
 // Older clients send no platform; their activity still counts without it.
 if(visible&&PLATFORMS.includes(platform))result['days/'+day+'/platforms/'+uid+'/'+platform]=true;
 return result;
}
function activityUserIds({scope,metrics,now}){
 if(scope==='today')return Object.keys(metrics.days?.[uruguayDate(now).day]?.users||{}).sort();
 if(scope==='active')return Object.entries(metrics.presence||{}).filter(([,sessions])=>Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now&&now-s.at<ACTIVE_MS)).map(([uid])=>uid).sort();
 throw new Error('Filtro inválido.');
}
// Players with an open, visible session right now.
function onlineUids(presence,now){return Object.entries(presence||{}).filter(([,sessions])=>Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now&&now-s.at<ACTIVE_MS)).map(([uid])=>uid);}
// Keeps the highest number of players connected at once (and when it happened).
const higherPeak=(current,count,now)=>count>0&&count>(Number(current?.count)||0)?{count,at:now}:undefined;
// concurrentKey: 'all' or 'real' (without test accounts), whichever the panel shows.
function activitySummary({metrics,registeredUids,now,concurrentKey='all'}){
 const registered=new Set(registeredUids);
 const online=Object.entries(metrics.presence||{}).filter(([uid,sessions])=>registered.has(uid)&&Object.values(sessions||{}).some(s=>Number.isFinite(s?.at)&&s.at<=now&&now-s.at<ACTIVE_MS)).map(([uid])=>uid);
 const today=uruguayDate(now).day;
 const days=Object.entries(metrics.days||{}).sort(([a],[b])=>b.localeCompare(a)).map(([day,data])=>({day,users:Object.keys(data.users||{}).length,hours:Array.from({length:24},(_,h)=>({hour:h,users:Object.keys(data.hours?.[String(h).padStart(2,'0')]||{}).length})),concurrent:data.concurrent?.[concurrentKey]||null}));
 return {total:registered.size,active:online.length,online,todayUsers:days.find(d=>d.day===today)?.users||0,today,days,startedAt:metrics.startedAt||null,updatedAt:now};
}
module.exports={onlineUids,higherPeak,PLATFORMS,requestPlatform,activityUserIds,ACTIVE_MS,uruguayDate,activityUpdates,activitySummary};
