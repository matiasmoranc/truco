'use strict';
async function loadedTransaction(ref,update){
 // get() alone does not keep the SDK transaction cache populated. Keep the
 // listener attached until completion, including all concurrent-write retries.
 let listener,attempts=0,loadedAt;const started=Date.now();
 try{
  await new Promise((resolve,reject)=>{
   listener=()=>resolve();
   ref.on('value',listener,reject);
  });
  loadedAt=Date.now();
  return await ref.transaction(current=>{attempts++;return update(current);},undefined,false);
 }finally{if(listener)ref.off('value',listener);const ended=Date.now();if(ended-started>500)console.info('Database transaction timing',{loadMs:(loadedAt||ended)-started,commitMs:loadedAt?ended-loadedAt:0,attempts});}
}
module.exports={loadedTransaction};
