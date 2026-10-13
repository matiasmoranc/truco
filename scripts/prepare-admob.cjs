'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const manifest=path.join(root,'android/app/src/main/AndroidManifest.xml');
if(fs.existsSync(manifest)){
  let content=fs.readFileSync(manifest,'utf8');
  const tag='<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-9142692584360532~2037664412" />';
  if(!content.includes('com.google.android.gms.ads.APPLICATION_ID'))content=content.replace('</application>',tag+'\n    </application>');
  fs.writeFileSync(manifest,content);
}
const info=path.join(root,'ios/App/App/Info.plist');
if(fs.existsSync(info)){
  let content=fs.readFileSync(info,'utf8');
  if(!content.includes('<key>GADApplicationIdentifier</key>')){
    if(!content.includes('<dict>'))throw new Error('Info.plist debe ser XML para configurar AdMob.');
    content=content.replace('<dict>','<dict>\n<key>GADApplicationIdentifier</key>\n<string>ca-app-pub-9142692584360532~2534067442</string>\n<key>SKAdNetworkItems</key>\n<array><dict><key>SKAdNetworkIdentifier</key><string>cstr6suwn9.skadnetwork</string></dict></array>');
    fs.writeFileSync(info,content);
  }
}
