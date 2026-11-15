'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('Android speaks the calls with the phone voice (its web view has no speech synthesis)',()=>{
 const entry=read('mobile/entry.js'),app=read('app.js'),pkg=JSON.parse(read('package.json'));
 assert.ok(pkg.dependencies['@capacitor-community/text-to-speech'],'native voice plugin installed');
 assert.match(entry,/const nativeVoice = Capacitor\.getPlatform\(\) === 'android'/,'only Android uses the native voice');
 assert.match(entry,/^\s*nativeVoice,\r?$/m,'exposed to the game');
 const speak=app.slice(app.indexOf('function speakCall('),app.indexOf('function renderCallNotice('));
 assert.ok(speak.indexOf('nativeVoice()')<speak.indexOf("'speechSynthesis' in window"),'native voice before the web voice check');
 assert.match(app,/if\(soundEnabled&&nativeVoice\(\)\)\{voiceUnlocked=true;return;\}/);
});
