// Durable Object storage behind the bank core's store interface, with a copy of
// every row kept in memory. Reading the whole ledger (admin, history, friends)
// used to read every row from storage each time, and Cloudflare bills and limits
// rows read per day. Now the rows are read once per wake-up and every write
// updates the copy, so later reads cost nothing.
// Puts and deletes are issued without awaiting in between, so the runtime commits
// them as one batch.
const CHUNK=128;
const copy=value=>value===undefined?undefined:structuredClone(value);

export function durableStore(storage){
 let rows=null,loading=null,writes=0;
 // All rows, read once. A write that lands while reading makes that read stale:
 // it is used for that call only and read again next time.
 async function all(){
  if(rows)return rows;
  if(!loading){
   const startedAt=writes;
   loading=storage.list().then(found=>{
    const map=new Map(found);
    if(writes===startedAt)rows=map;
    return map;
   }).finally(()=>{loading=null;});
  }
  return loading;
 }
 return {
  async get(keys){
   const found=new Map();
   if(rows){for(const k of keys)if(rows.has(k))found.set(k,copy(rows.get(k)));return found;}
   for(let i=0;i<keys.length;i+=CHUNK)for(const [k,v] of await storage.get(keys.slice(i,i+CHUNK)))found.set(k,v);
   return found;
  },
  async put(entries,removed=[]){
   writes++;
   const pending=[],list=Object.entries(entries);
   for(let i=0;i<list.length;i+=CHUNK)pending.push(storage.put(Object.fromEntries(list.slice(i,i+CHUNK))));
   for(let i=0;i<removed.length;i+=CHUNK)pending.push(storage.delete(removed.slice(i,i+CHUNK)));
   try{await Promise.all(pending);}
   catch(error){rows=null;throw error;}
   if(rows){for(const [k,v] of list)rows.set(k,copy(v));for(const k of removed)rows.delete(k);}
  },
  async list(prefix=''){
   const source=await all(),found=new Map();
   for(const k of [...source.keys()].filter(k=>k.startsWith(prefix)).sort())found.set(k,copy(source.get(k)));
   return found;
  },
  // After storage was wiped behind the store's back (bank reset).
  forget(){writes++;rows=null;}
 };
}
