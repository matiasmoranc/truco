'use strict';
const sharp=require('sharp'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const base=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500"><defs><linearGradient id="bg"><stop stop-color="#123c2e"/><stop offset="1" stop-color="#08291f"/></linearGradient></defs><rect width="1024" height="500" fill="url(#bg)"/><rect x="24" y="24" width="976" height="452" rx="28" fill="none" stroke="#e8c983" stroke-opacity=".45"/><text x="410" y="195" fill="#e8c983" font-family="sans-serif" font-size="56" font-weight="700">Truco Uruguayo</text><text x="412" y="252" fill="#f7f3e9" font-family="sans-serif" font-size="26">La mesa está servida</text><text x="412" y="319" fill="#e8c983" font-family="sans-serif" font-size="25">Gratis · Sin anuncios</text><text x="412" y="362" fill="#cbd9cf" font-family="sans-serif" font-size="22">Con muestra, amigos y práctica</text></svg>');
 const logo=await sharp(path.join(root,'publication/assets/truco-icon-1024.png')).resize(320,320).png().toBuffer();
 await sharp(base).composite([{input:logo,left:62,top:90}]).removeAlpha().png().toFile(path.join(root,'publication/assets/truco-feature-1024x500.png'));
 console.log('Gráfico destacado listo: 1024 × 500, RGB.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
