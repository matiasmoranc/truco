const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const adsMode=process.env.TRUCO_ADS_MODE||'test';
  if(!['test','off'].includes(adsMode))throw new Error('TRUCO_ADS_MODE debe ser test u off. Los anuncios reales todavía requieren revisión.');
  const stage = path.join(root, '.mobile-web');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  for (const file of ['index.html','style.css','app.js','account.js','auth-init.js','activity.js','credits.js','scorer.js','player-panel.js','firebase-config.js','chat-moderation.js','favicon.svg']) {
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
  if(adsMode==='off'){
    const adsFile=path.join(stage,'mobile/rewarded-ads.js');
    const adsSource=await fs.readFile(adsFile,'utf8');
    if(!adsSource.includes('const ADS_ENABLED = true;'))throw new Error('No se pudo aplicar el modo sin anuncios.');
    await fs.writeFile(adsFile,adsSource.replace('const ADS_ENABLED = true;','const ADS_ENABLED = false;'));
  }
  console.log('Publicidad del paquete: '+adsMode);
  await fs.cp(path.join(root,'assets'), path.join(stage,'assets'), { recursive: true });
  const { build } = await import('vite');
  await build({ root: stage, base: './', publicDir: false, build: { outDir: path.join(root,'www'), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, copyPublicDir: false } });
  const nativeHtml = path.join(root,'www/index.html');
  await fs.writeFile(nativeHtml,(await fs.readFile(nativeHtml,'utf8')).replace('viewport-fit=cover','viewport-fit=auto'));
  await fs.copyFile(path.join(root,'favicon.svg'), path.join(root,'www/favicon.svg'));
  await Promise.all(['privacidad.html','soporte.html','eliminar-cuenta.html','reglas.html','legal.css'].map(file=>fs.copyFile(path.join(root,file),path.join(root,'www',file))));
  // CSS dynamically selects card images; retain their original bytes and paths.
  await fs.cp(path.join(root,'assets'), path.join(root,'www/assets'), { recursive: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
