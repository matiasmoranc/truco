const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const videos=[...source.matchAll(/src:'(assets\/tutorial\/[^']+\.mp4)'/g)].map(match=>match[1]);
test('Learning screen offers the tutorial videos in a dialog with navigation',()=>{
  for(const id of ['learn-videos','learn-videos-dialog','learn-videos-player','learn-videos-prev','learn-videos-next','learn-videos-close'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes('Ver videos explicativos'));
  assert.ok(/<video[^>]*id="learn-videos-player"[^>]*playsinline/.test(html),'inline playback on iPhone');
});
test('Every tutorial video exists, in order, and opens once on the first visit',()=>{
  assert.equal(videos.length,6);
  for(const file of videos)assert.ok(fs.existsSync(path.join(root,file)),file);
  assert.deepEqual(videos.map(file=>Number(path.basename(file).split('-')[0])),[1,2,3,4,5,6]);
  const open=source.slice(source.indexOf('function openLearning('),source.indexOf('const LEARN_VIDEOS'));
  assert.ok(open.includes('if(!learnVideosSeen())openLearnVideos();'));
  assert.ok(source.includes("localStorage.setItem('truco-learn-videos-seen-v1','true')"));
});
