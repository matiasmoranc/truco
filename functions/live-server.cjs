'use strict';
// Live tables run on the Cloudflare table server (cloudflare/). Cloud Functions
// only reach it to close a table from the administrator panel.
const LIVE_SERVER_URL='https://truco-live.mati-moran-castro.workers.dev';

// Returns {closed:true} when the live table handled it, or {missing:true} when
// the table server no longer holds that table and the ledger must be closed directly.
async function closeLiveTable({code,actor,requestId,reason,secret,fetchImpl=fetch}){
 const res=await fetchImpl(LIVE_SERVER_URL+'/internal/tables/'+code+'/admin-close',{method:'POST',headers:{'content-type':'application/json','x-internal-secret':secret},body:JSON.stringify({actor,requestId,reason})});
 if(res.ok)return {closed:true};
 const body=await res.json().catch(()=>({}));
 if(res.status===409&&body.error==='La mesa ya no está disponible.')return {missing:true};
 throw new Error(body.error||'El servidor de mesas no respondió.');
}
module.exports={LIVE_SERVER_URL,closeLiveTable};
