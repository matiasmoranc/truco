// Firebase access from the Worker: ID token verification (login stays in
// Firebase Auth) and Realtime Database REST calls for the credit ledger.
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ALLOWED_PROVIDERS=['google.com','apple.com','password'];
const encoder=new TextEncoder();

function b64urlDecode(text){
 const base=text.replace(/-/g,'+').replace(/_/g,'/'),padded=base+'='.repeat((4-base.length%4)%4);
 return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
function b64urlEncode(bytes){
 let binary='';for(const b of new Uint8Array(bytes))binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
const jsonPart=text=>JSON.parse(new TextDecoder().decode(b64urlDecode(text)));

let jwksCache={keys:null,expires:0};
async function signingKey(kid){
 if(!jwksCache.keys||Date.now()>=jwksCache.expires||!jwksCache.keys.has(kid)){
  const res=await fetch(JWKS_URL);if(!res.ok)throw new Error('No se pudo validar la sesión.');
  const maxAge=Number(/max-age=(\d+)/.exec(res.headers.get('cache-control')||'')?.[1]||3600);
  const keys=new Map();
  for(const jwk of (await res.json()).keys||[])keys.set(jwk.kid,await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']));
  jwksCache={keys,expires:Date.now()+maxAge*1000};
 }
 const key=jwksCache.keys.get(kid);if(!key)throw new Error('Sesión inválida.');return key;
}

// Same acceptance rules as identity() in functions/index.cjs.
export async function verifyIdToken(token,projectId,env,now=Date.now()){
 if(env?.DEV_MODE==='1'&&typeof token==='string'&&/^dev:[A-Za-z0-9_-]{1,64}$/.test(token))return {uid:token.slice(4),exp:now+3600000};
 if(typeof token!=='string'||token.length>4096)throw new Error('Iniciá sesión con tu cuenta.');
 const parts=token.split('.');if(parts.length!==3)throw new Error('Iniciá sesión con tu cuenta.');
 let header,payload;
 try{header=jsonPart(parts[0]);payload=jsonPart(parts[1]);}catch{throw new Error('Iniciá sesión con tu cuenta.');}
 if(header.alg!=='RS256')throw new Error('Sesión inválida.');
 const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',await signingKey(header.kid),b64urlDecode(parts[2]),encoder.encode(parts[0]+'.'+parts[1]));
 const seconds=now/1000;
 if(!valid||payload.aud!==projectId||payload.iss!=='https://securetoken.google.com/'+projectId||!payload.sub||payload.exp<=seconds||payload.iat>seconds+300)throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
 if(!ALLOWED_PROVIDERS.includes(payload.firebase?.sign_in_provider))throw new Error('Iniciá sesión con tu cuenta.');
 return {uid:payload.sub,exp:payload.exp*1000};
}

let accessCache={token:null,expires:0};
async function accessToken(env){
 if(accessCache.token&&Date.now()<accessCache.expires-60000)return accessCache.token;
 const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
 const now=Math.floor(Date.now()/1000);
 const claims={iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
 const unsigned=b64urlEncode(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})))+'.'+b64urlEncode(encoder.encode(JSON.stringify(claims)));
 const pem=account.private_key.replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
 const key=await crypto.subtle.importKey('pkcs8',b64urlDecode(pem.replace(/\+/g,'-').replace(/\//g,'_')),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const jwt=unsigned+'.'+b64urlEncode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(unsigned)));
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt});
 if(!res.ok)throw new Error('No se pudo conectar con la base de créditos.');
 const data=await res.json();accessCache={token:data.access_token,expires:Date.now()+data.expires_in*1000};return accessCache.token;
}

export function createDatabase(env){
 const base=env.FIREBASE_DATABASE_URL.replace(/\/$/,'');
 async function request(path,init={}){
  const started=Date.now(),token=await accessToken(env),authorized=Date.now();
  const res=await fetch(base+'/'+path+'.json',{...init,headers:{authorization:'Bearer '+token,...(init.headers||{})}});
  if(Date.now()-started>200)console.info('rtdb slow',init.method||'GET',path,res.status,'token',authorized-started,'ms request',Date.now()-authorized,'ms bytes',res.headers.get('content-length'));
  return res;
 }
 async function get(path){const res=await request(path);if(!res.ok)throw new Error('No se pudo leer la base ('+res.status+').');return res.json();}
 // Value plus ETag; started early, it lets a transaction skip its first read.
 async function read(path){
  const res=await request(path,{headers:{'x-firebase-etag':'true'}});
  if(!res.ok)throw new Error('No se pudo leer la base ('+res.status+').');
  return {etag:res.headers.get('etag'),value:await res.json()};
 }
 // Optimistic-concurrency transaction, equivalent to ref.transaction() in the
 // Admin SDK: retried against the latest value when another writer wins.
 async function transaction(path,update,{initial,attempts=10}={}){
  let {etag,value:current}=initial||await read(path),res;
  for(let i=0;i<attempts;i++){
   const next=update(current);
   if(next===undefined)return {committed:false,value:current};
   res=await request(path,{method:'PUT',headers:{'if-match':etag,'content-type':'application/json'},body:JSON.stringify(next)});
   if(res.ok)return {committed:true,value:next};
   if(res.status!==412)throw new Error('No se pudo guardar en la base ('+res.status+').');
   etag=res.headers.get('etag');current=await res.json();
  }
  throw new Error('La base está ocupada. Volvé a intentar.');
 }
 return {get,read,transaction};
}

// Local development only (wrangler dev with DEV_MODE=1 in .dev.vars): a fake
// ledger kept by the lobby object, where every player starts with 100 credits.
export function createDevDatabase(ledgerStub){
 const seen=new Set();
 return {
  async get(path){
   const [root,uid]=path.split('/');
   if(root==='profiles'){seen.add(uid);return 'Jugador '+uid.slice(0,6);}
   if(root==='administrators')return true;
   return null;
  },
  async read(){return (await ledgerStub().fetch('https://lobby/dev-ledger')).json();},
  async transaction(path,update,{initial}={}){
   for(let i=0;i<10;i++){
    const {etag,value}=i===0&&initial?initial:await this.read();
    const current=structuredClone(value||{});current.wallets??={};
    for(const uid of seen)current.wallets[uid]??={balance:100,locked:0};
    const next=update(current);if(next===undefined)return {committed:false,value:current};
    const res=await ledgerStub().fetch('https://lobby/dev-ledger',{method:'POST',body:JSON.stringify({etag,value:next})});
    if(res.ok)return {committed:true,value:next};
   }
   throw new Error('La base está ocupada. Volvé a intentar.');
  }
 };
}

export async function playerIdentity(db,uid){
 const [blocked,name]=await Promise.all([db.get('userAccess/'+uid+'/blocked'),db.get('profiles/'+uid+'/name')]);
 if(blocked===true)throw new Error('Tu cuenta está bloqueada.');
 if(typeof name!=='string'||!name)throw new Error('Guardá tu nombre de usuario primero.');
 return {uid,name};
}

export async function usersBlockEachOther(db,uid,peerUid){
 if(!uid||!peerUid||uid===peerUid)return false;
 const [own,peer]=await Promise.all([db.get('userBlocks/'+uid+'/'+peerUid),db.get('userBlocks/'+peerUid+'/'+uid)]);
 const blocked=value=>value===true||value?.blocked===true;
 return blocked(own)||blocked(peer);
}

export async function isAdministrator(db,uid){return (await db.get('administrators/'+uid))===true;}
