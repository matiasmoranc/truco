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
// Same device seen again: a repeat within seconds is one visit (the app can load
// twice when it opens), and a device already counted today is not a new visitor even
// if the phone lost its note of it. Kept only in the server's memory, never stored.
const REPEAT_MS=20000,DEVICE_MEMORY_MS=6*3600000;
function dedupeVisit({seen,key,day,page,now}){
 const last=seen.get(key);
 if(last&&last.day===day&&now-last.at<REPEAT_MS&&last.page===page)return {duplicateOf:last.id};
 const known=!!last&&last.day===day&&now-last.at<DEVICE_MEMORY_MS;
 return {duplicateOf:null,known};
}
function rememberDevice({seen,key,day,page,now,id}){
 seen.set(key,{at:now,day,page,id});
 if(seen.size>5000)for(const [k,v] of seen)if(now-v.at>=DEVICE_MEMORY_MS)seen.delete(k);
}
const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
// Visits from people who chose "Jugar sin cuenta", per day and platform. A guest counts as
// a visitor once per day (guestFirst), like the other visitors.
function guestDays(log,{includeTest=false}={}){
 const days={};
 for(const [day,records] of Object.entries(log||{}))for(const r of Object.values(records||{})){
  if(r?.guest!==true||!PLATFORMS.includes(r.platform)||(!includeTest&&r.test===true))continue;
  const d=days[day]??={visits:{},visitors:{}};
  d.visits[r.platform]=(d.visits[r.platform]||0)+1;
  if(r.guestFirst===true)d.visitors[r.platform]=(d.visitors[r.platform]||0)+1;
 }
 return days;
}
function visitSummary({visits,guests={},now,days=30}){
 const list=[];
 for(let i=days-1;i>=0;i--){
  const day=uruguayDate(now-i*86400000).day,data=visits?.[day]||{};
  const byPlatform=key=>Object.fromEntries(PLATFORMS.map(p=>[p,count(data[key]?.[p])]));
  const visitsBy=byPlatform('visits'),visitorsBy=byPlatform('visitors');
  const guest=guests[day]||{},guestBy=key=>Object.fromEntries(PLATFORMS.map(p=>[p,count(guest[key]?.[p])]));
  const guestVisits=guestBy('visits'),guestVisitors=guestBy('visitors');
  list.push({day,visits:visitsBy,visitors:visitorsBy,
   guests:{visits:guestVisits,visitors:guestVisitors,totalVisits:Object.values(guestVisits).reduce((a,b)=>a+b,0),totalVisitors:Object.values(guestVisitors).reduce((a,b)=>a+b,0)},
   totalVisits:Object.values(visitsBy).reduce((a,b)=>a+b,0),totalVisitors:Object.values(visitorsBy).reduce((a,b)=>a+b,0),
   pages:Object.fromEntries(PAGES.map(p=>[p,count(data.pages?.[p])])),
   hours:Array.from({length:24},(_,h)=>count(data.hours?.[String(h).padStart(2,'0')]))});
 }
 return {platforms:PLATFORMS,days:list};
}
function visitRange({from,to,platform,page,hour,guest,now}){
 if(!DAY.test(from||'')||!DAY.test(to||'')||from>to)throw new Error('Período inválido.');
 if(from<uruguayDate(now-(VISIT_DAYS-1)*86400000).day)throw new Error('El período puede abarcar hasta '+VISIT_DAYS+' días atrás.');
 if(platform!=='all'&&!PLATFORMS.includes(platform))throw new Error('Plataforma inválida.');
 if(page!=null&&!PAGES.includes(page))throw new Error('Página inválida.');
 if(hour!=null&&!(Number.isInteger(hour)&&hour>=0&&hour<24))throw new Error('Hora inválida.');
 return {from,to,platform,page:page??null,hour:hour??null,guest:guest===true};
}
// The visit a signed-in player's first signal claims: only a well-formed id.
function visitClaimPath(data){
 const id=data?.visitId,day=data?.visitDay;
 return typeof id==='string'&&/^-[A-Za-z0-9_-]{19}$/.test(id)&&DAY.test(day||'')?'adminMetrics/visitLog/'+day+'/'+id:null;
}
// Who came in a period: visit details (with the player when one signed in) and signed-in players.
// exclude: test account uids to leave out, together with visits from test devices (null keeps everything).
// hour: only the visits that started in that hour of the day (Uruguay), on any day of the range.
function visitorsInRange({log,activity,platform,page=null,hour=null,guest=false,exclude=null,limit=1000}){
 const matches=p=>platform==='all'||p===platform,hidden=r=>exclude&&(r.test===true||exclude.has(r.uid));
 const inHour=r=>hour==null||Number(uruguayDate(r.at).hour)===hour;
 const visits=[];
 for(const records of Object.values(log||{}))for(const r of Object.values(records||{}))if(r&&Number.isFinite(r.at)&&matches(r.platform)&&(!page||r.page===page)&&inHour(r)&&(!guest||r.guest===true)&&!hidden(r))visits.push(r);
 visits.sort((a,b)=>b.at-a.at);
 const players=new Map();
 const player=uid=>players.get(uid)||{uid,days:0,lastDay:'',platforms:[],visits:0};
 // Activity says which days and platforms a player used; a page filter only has the visits.
 if(!page&&hour==null&&!guest)for(const [day,data] of Object.entries(activity||{})){
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
 const anonymous=visits.filter(v=>typeof v.uid!=='string'),guests=visits.filter(v=>v.guest===true);
 return {visits:visits.slice(0,limit),totalVisits:visits.length,signedVisits:visits.length-anonymous.length,anonymousVisits:anonymous.length,anonymousDevices:anonymous.filter(v=>v.first).length,guestVisits:guests.length,guestDevices:guests.filter(v=>v.guestFirst).length,
  players:[...players.values()].sort((a,b)=>b.visits-a.visits||b.lastDay.localeCompare(a.lastDay)||b.days-a.days)};
}
// Google's own test robots (the Play Console pre-launch report, Firebase Test Lab) open
// the app on Google's devices right after each upload. They come from Google's addresses
// (gstatic.com/ipranges/goog.json) and use a few known devices; their visits count as tests.
const ROBOT_DEVICES=[/OnePlus8Pro Build\/QKR1\.191246\.002/];
const robotDevice=record=>ROBOT_DEVICES.some(re=>re.test(String(record?.model||'')));
function ipToBig(ip){
 ip=String(ip||'').trim().replace(/^::ffff:(?=\d+\.)/,'');
 if(/^\d+\.\d+\.\d+\.\d+$/.test(ip))return {v:4,n:ip.split('.').reduce((a,p)=>(a<<8n)+BigInt(Number(p)&255),0n)};
 if(!ip.includes(':'))return null;
 const [head,tail='']=ip.split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
 if(!ip.includes('::')&&h.length!==8)return null;
 const parts=[...h,...Array(8-h.length-t.length).fill('0'),...t];
 if(parts.length!==8||parts.some(p=>!/^[0-9a-f]{1,4}$/i.test(p)))return null;
 return {v:6,n:parts.reduce((a,p)=>(a<<16n)+BigInt(parseInt(p,16)),0n)};
}
function inRanges(ip,prefixes){
 const addr=ipToBig(ip);if(!addr)return false;
 for(const prefix of prefixes||[]){
  const [base,bits]=String(prefix).split('/'),net=ipToBig(base),len=Number(bits);
  if(!net||net.v!==addr.v||!Number.isInteger(len))continue;
  const size=addr.v===4?32:128,shift=BigInt(size-len);
  if((addr.n>>shift)===(net.n>>shift))return true;
 }
 return false;
}
module.exports.robotDevice=robotDevice;module.exports.inRanges=inRanges;
module.exports={...module.exports,dedupeVisit,rememberDevice,PLATFORMS,PAGES,VISIT_DAYS,visitUpdates,visitSummary,guestDays,deviceFacts,visitOrigin,visitRecord,visitRange,visitorsInRange,visitClaimPath};
