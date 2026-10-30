// Counts one anonymous visit per page load for the admin statistics. It sends
// only the platform, the page and whether this device already came today.
const ENDPOINT='https://us-central1-truco-6553d.cloudfunctions.net/siteVisit';
const DAY_KEY='truco-visit-day',TEST_KEY='truco-test-device',GUEST_DAY_KEY='truco-guest-day';
const GUEST_ENDPOINT='https://us-central1-truco-6553d.cloudfunctions.net/guestVisit';

// Static pages inside the app have no trucoNative, but the native bridge still
// injects Capacitor into every page.
function nativePlatform(){
 if(globalThis.trucoNative?.isNative)return globalThis.trucoNative.platform;
 const bridge=globalThis.Capacitor;
 return bridge?.isNativePlatform?.()?bridge.getPlatform():null;
}
export function visitPlatform(nav=globalThis.navigator,native=nativePlatform()){
 if(native)return native==='ios'?'app-ios':'app-android';
 const agent=nav?.userAgent||'';
 if(/iPhone|iPad|iPod/.test(agent)||(/Macintosh/.test(agent)&&nav?.maxTouchPoints>1))return 'web-ios';
 if(/Android/.test(agent))return 'web-android';
 return 'web-desktop';
}
export function visitPage(path=globalThis.location?.pathname||''){
 if(/anotador/.test(path))return 'anotador';
 if(/aprender/.test(path))return 'aprender';
 if(/\/$|index\.html$/.test(path))return 'juego';
 return 'otra';
}
// Where the visit came from: a campaign tag or the referring site's host.
export function visitReferrer(location=globalThis.location,referrer=globalThis.document?.referrer||''){
 let tag='';try{tag=new URLSearchParams(location?.search||'').get('utm_source')||'';}catch{}
 if(/^[a-z0-9.-]{1,80}$/i.test(tag))return tag.toLowerCase();
 try{const host=new URL(referrer).hostname;return host&&host!==location?.hostname?host.slice(0,80):'';}catch{return '';}
}
function uruguayDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Montevideo'}).format(now);}
function storedDay(){try{return localStorage.getItem(DAY_KEY);}catch{return null;}}
function storeDay(day){try{localStorage.setItem(DAY_KEY,day);}catch{/* Private mode: every visit counts as new. */}}
// A device where a test account played: its visits count apart from the real ones.
function testDevice(){try{return localStorage.getItem(TEST_KEY)==='1';}catch{return false;}}
export function markTestDevice(test){try{if(test)localStorage.setItem(TEST_KEY,'1');else localStorage.removeItem(TEST_KEY);}catch{/* Storage unavailable. */}}

export function recordVisit({fetch=globalThis.fetch,nav=globalThis.navigator,location=globalThis.location}={}){
 if(!location||typeof fetch!=='function')return null;
 // Local copies, crawlers and automated browsers stay out of the numbers.
 if(!nativePlatform()&&/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location?.hostname||''))return null;
 // Claude's own browser checks the live site while working on it: not a visitor.
 if(nav?.webdriver||/bot|crawl|spider|slurp|lighthouse|headless|Claude\//i.test(nav?.userAgent||''))return null;
 const day=uruguayDay(),first=storedDay()!==day;storeDay(day);
 const data={platform:visitPlatform(nav),page:visitPage(location?.pathname),first,ref:visitReferrer(location),...(testDevice()?{test:true}:{})};
 return visitRequest=fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data}),keepalive:true})
  .then(response=>response?.json?.()).then(body=>{const r=body?.result;if(r?.id&&r?.day)pendingVisit={visitId:r.id,visitDay:r.day};}).catch(()=>null);
}
// The visit that opened this page, handed once to the first signal after signing in.
// In the app the session comes back before the visit is answered, so the first signal
// waits for it a few seconds instead of going out without it.
let pendingVisit=null,visitRequest=null;
export async function takeVisit(wait=4000){
 if(!pendingVisit&&visitRequest)await Promise.race([visitRequest,new Promise(done=>setTimeout(done,wait))]);
 visitRequest=null;const visit=pendingVisit;pendingVisit=null;return visit;
}
// "Jugar sin cuenta": marks this page's visit as a guest one, once per page load. The
// visit stays available, so it can still be claimed if the guest signs in later.
let guestMarked=false;
export async function markGuestVisit({fetch=globalThis.fetch,wait=6000}={}){
 if(guestMarked||typeof fetch!=='function')return false;
 guestMarked=true;
 if(!pendingVisit&&visitRequest)await Promise.race([visitRequest,new Promise(done=>setTimeout(done,wait))]);
 const visit=pendingVisit;if(!visit)return false;
 const day=uruguayDay();let first=true;
 try{first=localStorage.getItem(GUEST_DAY_KEY)!==day;localStorage.setItem(GUEST_DAY_KEY,day);}catch{/* Private mode: counts as a new guest. */}
 await fetch(GUEST_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{...visit,first}}),keepalive:true}).catch(()=>null);
 return true;
}
recordVisit();
