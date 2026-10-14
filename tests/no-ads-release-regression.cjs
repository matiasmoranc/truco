'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareNoAds}=require('../scripts/prepare-no-ads.cjs');
test('Existing native projects lose advertising metadata and preserve login settings',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'truco-noads-'));
 try{
  fs.writeFileSync(path.join(root,'package.json'),'{}');
  fs.mkdirSync(path.join(root,'android/app/src/main'),{recursive:true});fs.mkdirSync(path.join(root,'ios/App/App'),{recursive:true});
  const manifest=path.join(root,'android/app/src/main/AndroidManifest.xml'),plist=path.join(root,'ios/App/App/Info.plist');
  fs.writeFileSync(manifest,'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application><meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="old" /></application></manifest>');
  fs.writeFileSync(plist,'<plist><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>google-login</string></array></dict></array><key>GADApplicationIdentifier</key><string>old</string><key>SKAdNetworkItems</key><array><dict><key>SKAdNetworkIdentifier</key><string>old</string></dict></array><key>NSUserTrackingUsageDescription</key><string>old</string></dict></plist>');
  prepareNoAds(root);const android=fs.readFileSync(manifest,'utf8'),ios=fs.readFileSync(plist,'utf8');
  assert.doesNotMatch(android,/APPLICATION_ID/);assert.match(android,/INTERNET/);assert.match(android,/AD_ID" tools:node="remove"/);
  assert.doesNotMatch(ios,/GADApplicationIdentifier|SKAdNetworkItems|NSUserTracking/);assert.match(ios,/google-login/);
  prepareNoAds(root);assert.equal(fs.readFileSync(manifest,'utf8'),android);assert.equal(fs.readFileSync(plist,'utf8'),ios);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Advertising cleanup refuses a package that still installs the SDK',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'truco-noads-'));try{fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{'@capacitor-community/admob':'8.2.1'}}));assert.throws(()=>prepareNoAds(root),/no debe instalar/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Release build rejects advertising modes before changing output',()=>{
 const {spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['scripts/build-mobile.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TRUCO_ADS_MODE:'test'},encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/solo admite/);
});
