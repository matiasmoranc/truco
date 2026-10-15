'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('Server referee is identical for Windows and Unix line endings and contains no client dispatch',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'truco-referee-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'functions'));
  fs.copyFileSync('scripts/build-credit-referee.cjs',path.join(root,'scripts/build-credit-referee.cjs'));
  for(const file of ['referee-header.cjs','referee-footer.cjs'])fs.copyFileSync('functions/'+file,path.join(root,'functions',file));
  const source=fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
  const outputs=[];
  for(const content of [source,source.replace(/\n/g,'\r\n')]){
   fs.writeFileSync(path.join(root,'app.js'),content);execFileSync(process.execPath,[path.join(root,'scripts/build-credit-referee.cjs')]);
   outputs.push(fs.readFileSync(path.join(root,'functions/game-referee.cjs'),'utf8'));
  }
  assert.equal(outputs[0],outputs[1]);assert.doesNotMatch(outputs[0],/if\(state\.room\?\.managedCredits\)return creditCommand/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
