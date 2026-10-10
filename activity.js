// Only authenticated, visible game pages send a heartbeat. Multiple tabs use
// independent sessions; closing one does not mark another offline.
export function installActivity({send,getUid,document,setTimer=setTimeout,clearTimer=clearTimeout}){
 let uid=null,timer=null,generation=0,inFlight=false;
 const sessionId=globalThis.crypto.randomUUID();
 async function pulse(){
  clearTimer(timer);timer=null;
  if(!uid||uid!==getUid())return;
  const epoch=generation;
  if(inFlight){timer=setTimer(pulse,1000);return;}
  inFlight=true;
  try{await send({sessionId,visible:!document.hidden});}catch{/* Metrics never block gameplay. */}
  finally{inFlight=false;if(epoch===generation&&uid&&!document.hidden)timer=setTimer(pulse,60000);}
 }
 function stop(){const previous=uid;uid=null;++generation;clearTimer(timer);timer=null;if(previous&&previous===getUid())Promise.resolve(send({sessionId,visible:false})).catch(()=>{});}
 function start(){if(uid===getUid()&&uid)return;stop();uid=getUid();if(uid)pulse();}
 document.addEventListener('visibilitychange',()=>{if(uid)pulse();});
 return {start,stop};
}
