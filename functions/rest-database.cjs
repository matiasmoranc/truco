'use strict';
// Short server requests use REST rather than a socket that can be suspended
// between invocations. ETags preserve the database's atomic compare-and-set.
function directRequest(url,options){
 const started=Date.now(),stages={};
 return new Promise((resolve,reject)=>{
  const client=require(url.protocol==='http:'?'node:http':'node:https');
  const req=client.request(url,{method:options.method,headers:options.headers,agent:false,family:4,signal:options.signal},res=>{
   stages.headersMs=Date.now()-started;const chunks=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;chunks.push(chunk);});res.on('error',reject);
   res.on('end',()=>{if(Date.now()-started>200)console.info('Game database HTTP timing',{...stages,totalMs:Date.now()-started,bytes});const body=Buffer.concat(chunks).toString('utf8');resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:{get:key=>res.headers[key.toLowerCase()]||null},json:async()=>JSON.parse(body)});});
  });
  req.on('socket',socket=>{socket.once('lookup',()=>{stages.dnsMs=Date.now()-started;});socket.once('connect',()=>{stages.connectMs=Date.now()-started;});socket.once('secureConnect',()=>{stages.tlsMs=Date.now()-started;});});
  req.on('error',reject);if(options.body!==undefined)req.write(options.body);req.end();
 });
}
function createRestDatabase({baseUrl,getAccessToken,fetchImpl=directRequest,emulatorHost=process.env.FIREBASE_DATABASE_EMULATOR_HOST}){
 const origin=new URL(baseUrl),namespace=origin.searchParams.get('ns')||origin.hostname.split('.')[0];
 let cachedToken,tokenExpires=0,tokenPending;
 async function accessToken(){
  if(emulatorHost)return 'owner';if(cachedToken&&Date.now()<tokenExpires)return cachedToken;
  return tokenPending??=(async()=>{const value=await getAccessToken();if(!value.access_token)throw Error('Database authentication unavailable');cachedToken=value.access_token;tokenExpires=Date.now()+Math.max(0,Number(value.expires_in||0)-60)*1000;return cachedToken;})().finally(()=>{tokenPending=null;});
 }
 async function request(path,{method='GET',etag,body,readEtag=false}={}){
  const url=new URL(path.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json',emulatorHost?'http://'+emulatorHost+'/':origin.origin+'/');
  if(emulatorHost)url.searchParams.set('ns',namespace);
  const tokenStarted=Date.now(),token=await accessToken();if(Date.now()-tokenStarted>200)console.info('Game database token timing',{elapsedMs:Date.now()-tokenStarted});
  if(!token)throw Error('Database authentication unavailable');
  const headers={Authorization:'Bearer '+token,Connection:'close'};if(readEtag)headers['X-Firebase-ETag']='true';if(etag)headers['if-match']=etag;if(body!==undefined){headers['Content-Type']='application/json';headers['Content-Length']=String(Buffer.byteLength(JSON.stringify(body)));}
  const response=await fetchImpl(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  if(!response.ok&&response.status!==412)throw Error('Database request failed ('+response.status+')');
  return {status:response.status,value:await response.json(),etag:response.headers.get('etag')};
 }
 function snapshot(value){return {val:()=>structuredClone(value),exists:()=>value!==null&&value!==undefined};}
 function ref(path=''){
  async function atomicUpdate(update){
   const started=Date.now();let readMs=0,computeMs=0,writeMs=0,attempts=0;
   let at=Date.now(),current=await request(path,{readEtag:true});readMs+=Date.now()-at;
   const timing=()=>{if(Date.now()-started>200)console.info('Game REST transaction timing',{scope:path.split('/')[0]||'root',readMs,computeMs,writeMs,attempts,totalMs:Date.now()-started});};
   for(let attempt=0;attempt<25;attempt++){
    attempts++;at=Date.now();const next=update(structuredClone(current.value));computeMs+=Date.now()-at;
    if(next===undefined){timing();return {committed:false,snapshot:snapshot(current.value)};}
    if(!current.etag)throw Error('Database did not return an ETag');
    at=Date.now();const written=await request(path,{method:'PUT',etag:current.etag,body:next});writeMs+=Date.now()-at;
    if(written.status!==412){timing();return {committed:true,snapshot:snapshot(written.value)};}
    current=written.etag?written:await request(path,{readEtag:true});
   }
   throw Error('Database transaction contention; retry the action');
  }
  const get=async()=>snapshot((await request(path)).value);
  return {get,once:event=>{if(event!=='value')throw Error('Unsupported event');return get();},atomicUpdate,transaction:atomicUpdate,child:key=>ref(path+'/'+key),toString:()=>new URL(path,origin).href,set:async value=>{await request(path,{method:'PUT',body:value});},update:async value=>{await request(path,{method:'PATCH',body:value});},remove:async()=>{await request(path,{method:'DELETE'});}};
 }
 return {ref};
}
module.exports={createRestDatabase};
