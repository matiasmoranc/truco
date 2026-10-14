'use strict';
const fs=require('node:fs'),path=require('node:path');
function prepareNoAds(root){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(pkg.dependencies?.['@capacitor-community/admob'])throw new Error('La versión sin anuncios no debe instalar AdMob.');
 const manifest=path.join(root,'android/app/src/main/AndroidManifest.xml');
 if(fs.existsSync(manifest)){
  let xml=fs.readFileSync(manifest,'utf8');
  xml=xml.replace(/\s*<meta-data\b[^>]*android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^>]*\/>/g,'');
  xml=xml.replace(/\s*<uses-permission\b[^>]*android:name="(?:com\.google\.android\.gms\.permission\.AD_ID|android\.permission\.ACCESS_ADSERVICES_[A-Z_]+)"[^>]*\/>/g,'');
  if(!xml.includes('xmlns:tools='))xml=xml.replace('<manifest ','<manifest xmlns:tools="http://schemas.android.com/tools" ');
  // Prevent transitive libraries from restoring advertising permissions.
  const permissions=['com.google.android.gms.permission.AD_ID','android.permission.ACCESS_ADSERVICES_AD_ID','android.permission.ACCESS_ADSERVICES_ATTRIBUTION','android.permission.ACCESS_ADSERVICES_TOPICS'];
  xml=xml.replace(/\s*<\/manifest>/,'\n'+permissions.map(name=>`    <uses-permission android:name="${name}" tools:node="remove" />`).join('\n')+'\n</manifest>');
  fs.writeFileSync(manifest,xml);
 }
 const info=path.join(root,'ios/App/App/Info.plist');
 if(fs.existsSync(info)){
  let xml=fs.readFileSync(info,'utf8');
  for(const key of ['GADApplicationIdentifier','NSUserTrackingUsageDescription'])xml=xml.replace(new RegExp('<key>'+key+'</key>\\s*<string>[\\s\\S]*?</string>','g'),'');
  xml=xml.replace(/<key>SKAdNetworkItems<\/key>\s*<array>[\s\S]*?<\/array>/g,'');
  fs.writeFileSync(info,xml);
 }
}
if(require.main===module){try{prepareNoAds(path.resolve(__dirname,'..'));console.log('Configuración nativa preparada sin anuncios.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepareNoAds};
