const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
// Every local module the game imports has to be copied into the app, or the iPhone and Android builds fail.
test('The app build copies every local module the game imports',()=>{
 const build=fs.readFileSync(path.join(root,'scripts/build-mobile.cjs'),'utf8');
 const listed=new Set([...build.matchAll(/'([\w-]+\.js)'/g)].map(m=>m[1]));
 const seen=new Set(),queue=['app.js'];
 while(queue.length){
  const file=queue.shift();if(seen.has(file))continue;seen.add(file);
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const m of source.matchAll(/(?:import|from)\s*\(?\s*['"]\.\/([\w-]+\.js)(?:\?[^'"]*)?['"]/g))queue.push(m[1]);
 }
 for(const file of seen)assert.ok(listed.has(file),file+' falta en scripts/build-mobile.cjs');
});
