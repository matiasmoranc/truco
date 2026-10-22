// Durable Object storage stand-in for tests: values are copied like the real storage does.
export function memoryStore(){
 const rows=new Map(),copy=v=>v===undefined?undefined:structuredClone(v);
 return {rows,
  async get(keys){return new Map(keys.filter(k=>rows.has(k)).map(k=>[k,copy(rows.get(k))]));},
  async put(entries,removed=[]){for(const [k,v] of Object.entries(entries))rows.set(k,copy(v));for(const k of removed)rows.delete(k);},
  async list(prefix){return new Map([...rows].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>[k,copy(v)]));}};
}
