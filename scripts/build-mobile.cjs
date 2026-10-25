const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const adsMode=process.env.TRUCO_ADS_MODE||'off';
  if(adsMode!=='off')throw new Error('Esta versión solo admite TRUCO_ADS_MODE=off.');
  const stage = path.join(root, '.mobile-web');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  for (const file of ['index.html','style.css','app.js','team-table-ui.js','account.js','auth-init.js','activity.js','credits.js','scorer.js','player-panel.js','firebase-config.js','live-tables.js','chat-moderation.js','visit.js','friends.js','share-photo.js','favicon.svg']) {
    let content = await fs.readFile(path.join(root, file), 'utf8');
    if (file === 'index.html') {
      content = content.replace(/src="\.\/app\.js[^" ]*"/, 'src="./mobile/entry.js"');
      // Let the native WebView inset its viewport around the notch/status bar
      // and home indicator, including fixed game controls and scorekeeper.
      content = content.replace('viewport-fit=cover', 'viewport-fit=auto');
    }
    if (file === 'app.js') {
      content = content.replace(/import\(`https:\/\/www\.gstatic\.com\/firebasejs\/\$\{FIREBASE_VERSION\}\/firebase-(app|database|auth)\.js`\)/g, (_, sdk) => `Promise.resolve(globalThis.trucoNative.sdk.${sdk})`);
      content = content.replace("import('https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js')", 'Promise.resolve(globalThis.trucoNative.sdk.functions)');
      if (content.includes('import(`https://www.gstatic.com') || content.includes("import('https://www.gstatic.com")) throw new Error('Una importación Firebase no está empaquetada.');
    }
    await fs.writeFile(path.join(stage, file), content);
  }
  await fs.cp(path.join(root,'mobile'), path.join(stage,'mobile'), { recursive: true });
  // Legacy ad experiments are not included in the native web package.
  await fs.rm(path.join(stage,'mobile/rewarded-ads.js'),{force:true});
  await fs.rm(path.join(stage,'mobile/skadnetwork-ids.json'),{force:true});
  console.log('Publicidad del paquete: '+adsMode);
  await fs.cp(path.join(root,'assets'), path.join(stage,'assets'), { recursive: true });
  const { build } = await import('vite');
  await build({ root: stage, base: './', publicDir: false, build: { outDir: path.join(root,'www'), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, copyPublicDir: false } });
  const nativeHtml = path.join(root,'www/index.html');
  await fs.writeFile(nativeHtml,(await fs.readFile(nativeHtml,'utf8')).replace('viewport-fit=cover','viewport-fit=auto'));
  await fs.copyFile(path.join(root,'favicon.svg'), path.join(root,'www/favicon.svg'));
  await Promise.all(['privacidad.html','soporte.html','eliminar-cuenta.html','reglas.html','legal.css','aprender-truco-uruguayo.html','anotador-de-truco.html','scorer.js','visit.js'].map(file=>fs.copyFile(path.join(root,file),path.join(root,'www',file))));
  // Code and the static pages load some images and videos by path at runtime
  // (card sprites, tutorial videos, page logos). Copy only what the packaged
  // files mention, so source photos and unused art stay out of the app.
  const www = path.join(root,'www'), wanted = new Set();
  for (const file of await fs.readdir(www, { recursive: true })) {
    if (!/\.(js|css|html)$/.test(file)) continue;
    for (const [, ref] of (await fs.readFile(path.join(www,file),'utf8')).matchAll(/assets\/([\w./-]+)/g)) wanted.add(ref.replace(/\/[^/]*$/, m => m.includes('.') ? m : ''));
  }
  let copied = 0;
  for (const ref of wanted) {
    const source = path.join(root,'assets',ref);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat) continue;
    await fs.cp(source, path.join(www,'assets',ref), { recursive: true });
    copied++;
  }
  console.log('Recursos copiados por ruta: '+copied);
})().catch(error => { console.error(error); process.exitCode = 1; });
