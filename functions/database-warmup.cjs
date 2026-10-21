'use strict';
// Retain the SDK's transaction cache briefly around reservations. Never expose
// this server-only data, and release it when the entry flow becomes idle.
function createLedgerWarmup(db,{idleMs=30000,schedule=setTimeout,cancel=clearTimeout}={}){
 let ref,listener,ready,timer;
 function stop(){if(timer)cancel(timer);timer=null;if(ref&&listener)ref.off('value',listener);ref=null;listener=null;ready=null;}
 function touch(){if(timer)cancel(timer);timer=schedule(stop,idleMs);timer?.unref?.();}
 function warm(){
  touch();if(ready)return ready;
  ref=db.ref('creditEconomy');
  ready=new Promise((resolve,reject)=>{let first=true;listener=snapshot=>{if(!first)return;first=false;console.info('Ledger cache ready',{bytes:Buffer.byteLength(JSON.stringify(snapshot.val()||{}))});resolve();};ref.on('value',listener,error=>{stop();reject(error);});});
  return ready;
 }
 return {warm,stop,touch};
}
module.exports={createLedgerWarmup};
