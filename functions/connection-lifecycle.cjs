'use strict';
// A suspended server process may retain a stale socket. Reconnect only when no
// other request is using it; never interrupt a transaction already in flight.
function createConnectionLifecycle(db,{idleMs=30000,now=Date.now}={}){
 let active=0,lastFinished=now();
 return async function run(task){
  if(active===0&&now()-lastFinished>=idleMs){db.goOffline();db.goOnline();}
  active++;
  try{return await task();}finally{active--;lastFinished=now();}
 };
}
module.exports={createConnectionLifecycle};
