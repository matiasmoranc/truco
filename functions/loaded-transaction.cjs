'use strict';
async function loadedTransaction(ref,update){
 // get() alone does not keep the SDK transaction cache populated. Keep the
 // listener attached until completion, including all concurrent-write retries.
 let listener;
 try{
  await new Promise((resolve,reject)=>{
   listener=()=>resolve();
   ref.on('value',listener,reject);
  });
  return await ref.transaction(update);
 }finally{if(listener)ref.off('value',listener);}
}
module.exports={loadedTransaction};
