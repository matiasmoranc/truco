'use strict';
// Anonymous page visits: counters plus a per-visit detail with device type,
// browser and origin. No IP, account or device identifier is stored. A device
// reports "first" once per Uruguay day, so visitors approximate unique devices.
const {uruguayDate,PLATFORMS}=require('./activity-service.cjs');
const PAGES=['juego','anotador','aprender','otra'];
const VISIT_DAYS=90;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function visitUpdates({platform,page,first,now,increment}){
 if(!PLATFORMS.includes(platform)||!PAGES.includes(page)||typeof first!=='boolean')throw new Error('Visita inválida.');
 const {day,hour}=uruguayDate(now),base=day+'/';
 const result={[base+'visits/'+platform]:increment(1),[base+'pages/'+page]:increment(1),[base+'hours/'+hour]:increment(1)};
 if(first)result[base+'visitors/'+platform]=increment(1);
 return result;
}
// Short, readable device facts from the user agent the server received.
function deviceFacts(agent=''){
 agent=String(agent).slice(0,400);
 let os='Otro',browser='Otro',model='';
 const ios=/(?:iPhone|iPad|iPod).*?OS (\d+)/.exec(agent),android=/Android (\d+)/.exec(agent);
 if(ios)os=(/iPad/.test(agent)?'iPadOS ':'iOS ')+ios[1];
 else if(android){os='Android '+android[1];const m=/Android [\d.]+; ([^;)]+)[;)]/.exec(agent);if(m&&m[1].trim()!=='K'&&!/^wv$/.test(m[1].trim()))model=m[1].trim().slice(0,40);}
 else if(/Windows/.test(agent))os='Windows';
 else if(/Macintosh/.test(agent))os='macOS';
 else if(/CrOS/.test(agent))os='ChromeOS';
 else if(/Linux/.test(agent))os='Linux';
 if(/Instagram/.test(agent))browser='Instagram';
 else if(/FBAN|FBAV|FB_IAB/.test(agent))browser='Facebook';
 else if(/WhatsApp/.test(agent))browser='WhatsApp';
 else if(/EdgA?\//.test(agent))browser='Edge';
 else if(/OPR\/|Opera/.test(agent))browser='Opera';
 else if(/SamsungBrowser/.test(agent))browser='Samsung Internet';
 else if(/Firefox|FxiOS/.test(agent))browser='Firefox';
 else if(/CriOS|Chrome\//.test(agent))browser=/; wv\)/.test(agent)?'App':'Chrome';
 else if(/Safari\//.test(agent))browser='Safari';
 else if(/AppleWebKit/.test(agent))browser='App';
 return {os,browser,model};
}
// Origin: a campaign tag (utm_source) or the referring site, grouped by brand.
function visitOrigin(ref){
 const value=typeof ref==='string'&&/^[a-z0-9.-]{1,80}$/i.test(ref)?ref.toLowerCase():'';
 if(!value)return 'Directo';
 const known=[[/instagram|^ig$/,'Instagram'],[/facebook|fb\.com|^fb$/,'Facebook'],[/google/,'Google'],[/bing/,'Bing'],[/whatsapp|wa\.me/,'WhatsApp'],[/^t\.co$|twitter|^x\.com$/,'X'],[/tiktok/,'TikTok'],[/youtube|youtu\.be/,'YouTube'],[/github/,'GitHub'],[/apple\.com|apps\.apple/,'App Store'],[/play\.google/,'Google Play']];
 for(const [pattern,name] of known)if(pattern.test(value))return name;
 return value.replace(/^www\./,'');
}
function visitRecord({platform,page,first,ref,userAgent,now,test}){
 return {at:now,platform,page,first,origin:visitOrigin(ref),...deviceFacts(userAgent),...(test===true?{test:true}:{})};
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
function visitRange({from,to,platform,page,now}){
 if(!DAY.test(from||'')||!DAY.test(to||'')||from>to)throw new Error('Período inválido.');
 if(from<uruguayDate(now-(VISIT_DAYS-1)*86400000).day)throw new Error('El período puede abarcar hasta '+VISIT_DAYS+' días atrás.');
 if(platform!=='all'&&!PLATFORMS.includes(platform))throw new Error('Plataforma inválida.');
 if(page!=null&&!PAGES.includes(page))throw new Error('Página inválida.');
 return {from,to,platform,page:page??null};
}
// The visit a signed-in player's first signal claims: only a well-formed id.
function visitClaimPath(data){
 const id=data?.visitId,day=data?.visitDay;
 return typeof id==='string'&&/^-[A-Za-z0-9_-]{19}$/.test(id)&&DAY.test(day||'')?'adminMetrics/visitLog/'+day+'/'+id:null;
}
// Who came in a period: visit details (with the player when one signed in) and signed-in players.
// exclude: test account uids to leave out, together with visits from test devices (null keeps everything).
function visitorsInRange({log,activity,platform,page=null,exclude=null,limit=1000}){
 const matches=p=>platform==='all'||p===platform,hidden=r=>exclude&&(r.test===true||exclude.has(r.uid));
 const visits=[];
 for(const records of Object.values(log||{}))for(const r of Object.values(records||{}))if(r&&Number.isFinite(r.at)&&matches(r.platform)&&(!page||r.page===page)&&!hidden(r))visits.push(r);
 visits.sort((a,b)=>b.at-a.at);
 const players=new Map();
 const player=uid=>players.get(uid)||{uid,days:0,lastDay:'',platforms:[],visits:0};
 // Activity says which days and platforms a player used; a page filter only has the visits.
 if(!page)for(const [day,data] of Object.entries(activity||{})){
  for(const [uid,platforms] of Object.entries(data?.platforms||{})){
   if(exclude?.has(uid))continue;
   const used=Object.keys(platforms||{}).filter(p=>PLATFORMS.includes(p)&&matches(p));
   if(!used.length)continue;
   const p=player(uid);
   p.days++;if(day>p.lastDay)p.lastDay=day;p.platforms=[...new Set([...p.platforms,...used])];players.set(uid,p);
  }
 }
 for(const v of visits){
  if(typeof v.uid!=='string')continue;
  const p=player(v.uid),day=uruguayDate(v.at).day;
  p.visits++;if(!p.days)p.lastDay=day>p.lastDay?day:p.lastDay;if(!p.platforms.includes(v.platform))p.platforms.push(v.platform);players.set(v.uid,p);
 }
 for(const p of players.values())if(!p.days)p.days=new Set(visits.filter(v=>v.uid===p.uid).map(v=>uruguayDate(v.at).day)).size;
 const anonymous=visits.filter(v=>typeof v.uid!=='string');
 return {visits:visits.slice(0,limit),totalVisits:visits.length,signedVisits:visits.length-anonymous.length,anonymousVisits:anonymous.length,anonymousDevices:anonymous.filter(v=>v.first).length,
  players:[...players.values()].sort((a,b)=>b.visits-a.visits||b.lastDay.localeCompare(a.lastDay)||b.days-a.days)};
}
module.exports={PLATFORMS,PAGES,VISIT_DAYS,visitUpdates,visitSummary,deviceFacts,visitOrigin,visitRecord,visitRange,visitorsInRange,visitClaimPath};
