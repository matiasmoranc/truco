// On the website opened from an iPhone: a notice that the app is on the App Store, shown
// again every five visits after it is closed, and a small "Instalá la app" button in the lobby.
const APP_STORE_URL='https://apps.apple.com/app/id6821732363';
const KEY='truco-ios-app',EVERY=5;
const APPLE_MARK='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.05 12.54c.03 3.24 2.84 4.32 2.87 4.34-.02.08-.45 1.54-1.48 3.05-.9 1.3-1.84 2.6-3.3 2.63-1.44.03-1.91-.85-3.55-.85-1.64 0-2.16.82-3.52.88-1.4.05-2.48-1.4-3.39-2.7-1.85-2.67-3.26-7.54-1.36-10.83a5.24 5.24 0 0 1 4.43-2.69c1.39-.03 2.7.94 3.55.94.85 0 2.45-1.16 4.12-.99.7.03 2.67.29 3.94 2.15-.1.06-2.35 1.37-2.31 4.07M14.35 4.5c.75-.91 1.26-2.18 1.12-3.44-1.08.04-2.38.72-3.15 1.63-.69.8-1.3 2.09-1.13 3.32 1.2.1 2.42-.61 3.16-1.51"/></svg>';

// Only iPhone browsers: not the app itself, not iPad (the app is iPhone only), not other phones.
export function iphoneWeb(nav=globalThis.navigator,native=globalThis.trucoNative?.isNative||globalThis.Capacitor?.isNativePlatform?.()){
 return !native&&/iPhone|iPod/.test(nav?.userAgent||'');
}
function read(storage){try{return JSON.parse(storage.getItem(KEY))||{};}catch{return {};}}
function write(storage,value){try{storage.setItem(KEY,JSON.stringify(value));}catch{/* Private mode: shown every visit. */}}
// One visit per browser session. The notice shows on the first visit and, once closed,
// again when five more visits have passed.
export function promoVisit(storage=globalThis.localStorage,session=globalThis.sessionStorage){
 const state=read(storage);
 let counted=false;try{counted=session.getItem(KEY)==='1';session.setItem(KEY,'1');}catch{}
 if(!counted)state.visits=(state.visits||0)+1;
 write(storage,state);
 return {...state,show:state.closedAt==null||state.visits-state.closedAt>=EVERY};
}
const badge=()=>'<a class="app-store-badge" href="'+APP_STORE_URL+'" target="_blank" rel="noopener">'+APPLE_MARK+'<span><small>Descargalo en el</small><strong>App Store</strong></span></a>';

export function installIosPromo({document=globalThis.document,storage=globalThis.localStorage}={}){
 if(!iphoneWeb())return;
 const visit=promoVisit(storage);
 const lobby=document.querySelector('#welcome-view .home-content');
 const button=document.createElement('a');
 button.className='install-app-chip';button.href=APP_STORE_URL;button.target='_blank';button.rel='noopener';
 button.innerHTML=APPLE_MARK+'<span>Instalá la app</span>';
 const remember=change=>write(storage,{...read(storage),...change});
 button.addEventListener('click',()=>remember({clicked:true}));
 const showChip=()=>{button.hidden=!!read(storage).clicked;};
 lobby?.prepend(button);showChip();
 if(!visit.show)return;
 const dialog=document.createElement('dialog');
 dialog.className='ios-promo-dialog';dialog.setAttribute('aria-labelledby','ios-promo-title');
 dialog.innerHTML='<button type="button" class="ios-promo-close" aria-label="Cerrar">×</button><img src="assets/app-icon-192.png" alt="" width="72" height="72"><h2 id="ios-promo-title">Truco Uruguayo ya está en el App Store</h2><p>Instalá la app en tu iPhone para jugar más rápido y recibir las invitaciones de tus amigos.</p>'+badge();
 document.body.append(dialog);
 const close=()=>{remember({closedAt:read(storage).visits||0});dialog.close();showChip();};
 dialog.querySelector('.ios-promo-close').addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.querySelector('.app-store-badge').addEventListener('click',()=>{remember({clicked:true,closedAt:read(storage).visits||0});dialog.close();showChip();});
 // After the loading screen, and never on top of another notice.
 let tries=0;
 const open=()=>{
  const busy=!document.getElementById('startup-loading')?.hidden||document.querySelector('dialog[open]');
  if(busy&&++tries<40){setTimeout(open,750);return;}
  if(!dialog.open)dialog.showModal();
 };
 setTimeout(open,1200);
}
