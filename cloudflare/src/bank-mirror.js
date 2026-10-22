// Backup copy of the bank under creditBank in Firebase. Every bank change queues
// its rows in the same atomic write as the change itself; an alarm then sends
// the queue to Firebase in one multi-path update, retrying until it lands.
import {rowPath} from './bank-core.js';

export const PENDING='mirror:pending';
export const RESET='__reset';

// store: the bank's row store; database: {patch(path,updates), put(path,value)}.
export function createBankMirror(store,database,{root='creditBank'}={}){
 async function pending(){return (await store.get([PENDING])).get(PENDING)||{};}
 return {
  // Rows to add to the bank's own write: the merged queue.
  async beforeCommit(writes,removed){
   const queue=await pending();
   for(const [key,value] of Object.entries(writes)){const path=rowPath(key);if(path)queue[path]=value;}
   for(const key of removed){const path=rowPath(key);if(path)queue[path]=null;}
   return {[PENDING]:queue};
  },
  // Clears the backup too: used only when the bank is reset before the switch.
  async queueReset(){await store.put({[PENDING]:{[RESET]:true}});},
  async hasPending(){return Object.keys(await pending()).length>0;},
  // Sends the queue. Entries that changed again while sending stay queued.
  async flush(){
   const sent=await pending(),paths=Object.keys(sent);
   if(!paths.length)return {sent:0,remaining:0};
   if(sent[RESET])await database.put(root,null);
   const updates=Object.fromEntries(paths.filter(p=>p!==RESET).map(p=>[p,sent[p]]));
   if(Object.keys(updates).length)await database.patch(root,updates);
   const now=await pending(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   for(const path of paths)if(same(now[path],sent[path]))delete now[path];
   await store.put({[PENDING]:now});
   return {sent:paths.length,remaining:Object.keys(now).length};
  }
 };
}
