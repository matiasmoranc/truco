'use strict';
// Short server requests use REST rather than a socket that can be suspended
// between invocations. ETags preserve the database's atomic compare-and-set.
function createRestDatabase({baseUrl,getAccessToken,fetchImpl=fetch,emulatorHost=process.env.FIREBASE_DATABASE_EMULATOR_HOST}){
 const origin=new URL(baseUrl),namespace=origin.hostname.split('.')[0];
 async function request(path,{method='GET',etag,body,readEtag=false}={}){
  const url=new URL(path.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json',emulatorHost?'http://'+emulatorHost+'/':origin.origin+'/');
  if(emulatorHost)url.searchParams.set('ns',namespace);
  const token=emulatorHost?'owner':(await getAccessToken()).access_token;
  if(!token)throw Error('Database authentication unavailable');
  const headers={Authorization:'Bearer '+token};if(readEtag)headers['X-Firebase-ETag']='true';if(etag)headers['if-match']=etag;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetchImpl(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  if(!response.ok&&response.status!==412)throw Error('Database request failed ('+response.status+')');
  return {status:response.status,value:await response.json(),etag:response.headers.get('etag')};
 }
 function snapshot(value){return {val:()=>structuredClone(value),exists:()=>value!==null&&value!==undefined};}
 function ref(path=''){
  async function atomicUpdate(update){
   let current=await request(path,{readEtag:true});
   for(let attempt=0;attempt<25;attempt++){
    const next=update(structuredClone(current.value));
    if(next===undefined)return {committed:false,snapshot:snapshot(current.value)};
    if(!current.etag)throw Error('Database did not return an ETag');
    const written=await request(path,{method:'PUT',etag:current.etag,body:next});
    if(written.status!==412)return {committed:true,snapshot:snapshot(written.value)};
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
