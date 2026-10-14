'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareAndroidRelease}=require('../scripts/prepare-android-release.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'truco-release-'));fs.mkdirSync(path.join(root,'android/app'),{recursive:true});
 fs.writeFileSync(path.join(root,'android/app/build.gradle'),'android { defaultConfig { applicationId "com.matiasmoranc.truco" } }');
 const key=path.join(root,'test.jks');fs.writeFileSync(key,'fixture');
 const firebase={project_info:{project_id:'truco-6553d'},client:[{client_info:{android_client_info:{package_name:'com.matiasmoranc.truco'}},oauth_client:[{client_type:3}]}]};
 return {root,firebase,env:{CM_KEYSTORE_PATH:key,CM_KEYSTORE_PASSWORD:'not-a-real-secret',CM_KEY_ALIAS:'upload',CM_KEY_PASSWORD:'fixture-secret',ANDROID_VERSION_CODE:'7',GOOGLE_SERVICES_JSON_BASE64:Buffer.from(JSON.stringify(firebase)).toString('base64')}};
}
test('Android release preserves application ID, reads secrets from environment and is idempotent',()=>{
 const h=fixture();try{
  assert.equal(prepareAndroidRelease(h.root,h.env),7);assert.equal(prepareAndroidRelease(h.root,h.env),7);
  const gradle=fs.readFileSync(path.join(h.root,'android/app/build.gradle'),'utf8'),config=fs.readFileSync(path.join(h.root,'android/app/truco-release.gradle'),'utf8');
  assert.equal(gradle.match(/apply from:/g).length,1);assert.match(config,/signingConfig signingConfigs.release/);assert.match(config,/targetSdkVersion < 36/);
  assert.equal(config.includes(h.env.CM_KEYSTORE_PASSWORD),false);assert.equal(config.includes(h.env.CM_KEY_PASSWORD),false);
 }finally{fs.rmSync(h.root,{recursive:true,force:true});}
});
test('Android release rejects missing signing data and invalid version codes before editing',()=>{
 const h=fixture();try{
  for(const code of ['0','-1','1.5','99999999999999999999'])assert.throws(()=>prepareAndroidRelease(h.root,{...h.env,ANDROID_VERSION_CODE:code}),/VERSION_CODE/);
  assert.throws(()=>prepareAndroidRelease(h.root,{...h.env,CM_KEYSTORE_PASSWORD:''}),/CM_KEYSTORE_PASSWORD/);
  assert.equal(fs.existsSync(path.join(h.root,'android/app/truco-release.gradle')),false);
 }finally{fs.rmSync(h.root,{recursive:true,force:true});}
});
test('Android release rejects Firebase projects/packages without a valid Google client',()=>{
 const h=fixture();try{
  for(const change of [f=>f.project_info.project_id='another',f=>f.client[0].client_info.android_client_info.package_name='another',f=>f.client[0].oauth_client=[]]){
   const f=structuredClone(h.firebase);change(f);
   assert.throws(()=>prepareAndroidRelease(h.root,{...h.env,GOOGLE_SERVICES_JSON_BASE64:Buffer.from(JSON.stringify(f)).toString('base64')}),/Firebase/);
  }
  assert.equal(fs.existsSync(path.join(h.root,'android/app/truco-release.gradle')),false);
 }finally{fs.rmSync(h.root,{recursive:true,force:true});}
});
