const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../firebase-config.js'),'utf8').replace('export const firebaseConfig','const firebaseConfig')+';globalThis.config=firebaseConfig;';
for(const [hostname,native,expected] of [
 ['trucouruguayo.uy',false,'trucouruguayo.uy'],
 ['matiasmoranc.github.io',false,'truco-6553d.firebaseapp.com'],
 ['truco-6553d.firebaseapp.com',false,'truco-6553d.firebaseapp.com'],
 ['localhost',true,'truco-6553d.firebaseapp.com'],
 ['trucouruguayo.uy',true,'truco-6553d.firebaseapp.com']
])test(`OAuth callback host for ${hostname}, native=${native}`,()=>{
 const c={location:{hostname},trucoNative:{isNative:native}};vm.runInNewContext(source,c);assert.equal(c.config.authDomain,expected);assert.equal(c.config.projectId,'truco-6553d');
});
