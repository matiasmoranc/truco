'use strict';
// Where Cloud Functions read and edit credits. Before the switch they live in
// creditEconomy (Realtime Database); after it, in the Cloudflare credit bank,
// reached through the table server's internal routes. If the bank's state
// cannot be confirmed the call fails instead of writing the frozen copy.
const {LIVE_SERVER_URL}=require('./live-server.cjs');
const {loadedTransaction}=require('./loaded-transaction.cjs');

function createCreditStore({db,secret,fetchImpl=(...args)=>fetch(...args),baseUrl=LIVE_SERVER_URL,cacheMs=30000}){
 let active=null,checkedAt=0;
 async function call(path,{method='GET',body}={}){
  const res=await fetchImpl(baseUrl+'/internal/bank/'+path,{method,headers:{'content-type':'application/json','x-internal-secret':secret()},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.error||'El banco de créditos no respondió.'),{code:data.code||null});
  return data;
 }
 async function isActive(){
  if(active!==null&&Date.now()-checkedAt<cacheMs)return active;
  active=(await call('status')).active===true;checkedAt=Date.now();return active;
 }
 async function bankLedger(){return (await call('export')).ledger||{};}
 // Writes only the rows that changed; retried when another writer touched them.
 async function patchBank(update){
  for(let attempt=0;attempt<5;attempt++){
   const base=await bankLedger(),next=update(structuredClone(base));
   if(next===undefined)return {committed:false,value:base};
   try{await call('patch',{method:'POST',body:{base,next}});return {committed:true,value:next};}
   catch(error){if(error.code!=='conflict')throw error;}
  }
  throw new Error('Los créditos cambiaron. Volvé a intentar.');
 }
 return {
  isActive,
  async readLedger(){return await isActive()?bankLedger():(await db.ref('creditEconomy').get()).val()||{};},
  async wallet(uid){return await isActive()?(await call('wallet?uid='+encodeURIComponent(uid))).wallet??null:(await db.ref('creditEconomy/wallets/'+uid).get()).val();},
  patchBank,
  // The whole database plus credits, for account deletion. With the bank active
  // the credit part is written to the bank after the database part commits;
  // deletion steps are idempotent and the deletion job retries a failed write.
  async readRoot(){
   const root=(await db.ref().get()).val()||{};
   return await isActive()?{...root,creditEconomy:await bankLedger()}:root;
  },
  async rootTransaction(update){
   if(!await isActive())return loadedTransaction(db.ref(),update);
   const base=await bankLedger();let credit;
   const result=await loadedTransaction(db.ref(),root=>{
    credit=undefined;if(!root)return undefined;
    const next=update({...root,creditEconomy:structuredClone(base)});
    if(next===undefined)return undefined;
    credit=next.creditEconomy;return {...next,creditEconomy:root.creditEconomy??null};
   });
   if(result.committed&&credit)await call('patch',{method:'POST',body:{base,next:credit}});
   const value=result.snapshot.val();
   return {committed:result.committed,snapshot:{val:()=>value&&{...value,creditEconomy:credit??base},exists:()=>value!=null}};
  }
 };
}
module.exports={createCreditStore};
