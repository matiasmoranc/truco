'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function verifyNoAds(root,{requireBuild=true}={}){
 const read=file=>fs.readFileSync(path.join(root,file),'utf8');
 for(const name of ['package.json','package-lock.json'])assert.doesNotMatch(read(name),/@capacitor-community\/admob/,name+' todavía contiene el plugin publicitario.');
 assert.match(read('mobile/entry.js'),/from '\.\/no-ads\.js'/);
 assert.doesNotMatch(read('index.html'),/id="(?:credits-ad|credits-ad-note|ads-privacy)"/);
 assert.doesNotMatch(read('credits.js'),/creditPrepareAdReward|rewardedAds|Ver anuncio/);
 const build=path.join(root,'www');
 if(requireBuild){
  assert.ok(fs.existsSync(path.join(build,'index.html')),'Primero ejecutá npm run mobile:build.');
  function inspect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())inspect(file);else if(/\.(js|html)$/.test(entry.name))assert.doesNotMatch(fs.readFileSync(file,'utf8'),/ca-app-pub-|RewardAdPluginEvents|googleads\.g\.doubleclick|creditPrepareAdReward|id="(?:credits-ad|ads-privacy)"/,file+' contiene publicidad.');}}
  inspect(build);
  for(const file of ['privacidad.html','soporte.html','reglas.html','eliminar-cuenta.html'])assert.ok(fs.existsSync(path.join(build,file)),file+' falta en el paquete.');
 }
 const config=path.join(root,'android/capacitor.settings.gradle');
 if(fs.existsSync(config))assert.doesNotMatch(fs.readFileSync(config,'utf8'),/capacitor-community-admob/,'Android todavía tiene el plugin. Ejecutá npm run mobile:sync.');
 return true;
}
if(require.main===module){try{verifyNoAds(path.resolve(__dirname,'..'));console.log('Verificado: paquete y dependencias sin anuncios; páginas de ayuda incluidas.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={verifyNoAds};
