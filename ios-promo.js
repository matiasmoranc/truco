// On the website opened from an iPhone or an Android phone: a notice that the app is on
// the App Store or Google Play from the second visit, shown again every five visits after it is closed, and a
// small "Instalá la app" button in the lobby.
const EVERY=5;
const APPLE_MARK='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.05 12.54c.03 3.24 2.84 4.32 2.87 4.34-.02.08-.45 1.54-1.48 3.05-.9 1.3-1.84 2.6-3.3 2.63-1.44.03-1.91-.85-3.55-.85-1.64 0-2.16.82-3.52.88-1.4.05-2.48-1.4-3.39-2.7-1.85-2.67-3.26-7.54-1.36-10.83a5.24 5.24 0 0 1 4.43-2.69c1.39-.03 2.7.94 3.55.94.85 0 2.45-1.16 4.12-.99.7.03 2.67.29 3.94 2.15-.1.06-2.35 1.37-2.31 4.07M14.35 4.5c.75-.91 1.26-2.18 1.12-3.44-1.08.04-2.38.72-3.15 1.63-.69.8-1.3 2.09-1.13 3.32 1.2.1 2.42-.61 3.16-1.51"/></svg>';
const PLAY_MARK='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#00d7fe" d="M3.6 2.3c-.3.3-.5.8-.5 1.4v16.6c0 .6.2 1.1.5 1.4l9.5-9.6z"/><path fill="#ffce00" d="M16.3 15.6 13.1 12l3.2-3.6 3.9 2.2c1.1.6 1.1 1.7 0 2.3z"/><path fill="#ff3a44" d="M16.3 15.6 13.1 12l-9.5 9.7c.4.4 1 .4 1.7 0z"/><path fill="#00f076" d="M16.3 8.4 5.3 2.2c-.7-.4-1.3-.3-1.7.1l9.5 9.7z"/></svg>';
export const STORES={
 ios:{key:'truco-ios-app',url:'https://apps.apple.com/app/id6821732363',mark:APPLE_MARK,small:'Descargalo en el',name:'App Store',
  title:'Truco Uruguayo ya está en el App Store',text:'Instalá la app en tu iPhone para jugar más rápido y recibir las invitaciones de tus amigos.'},
 android:{key:'truco-android-app',url:'https://play.google.com/store/apps/details?id=com.matiasmoranc.truco',mark:PLAY_MARK,small:'DISPONIBLE EN',name:'Google Play',
  title:'Truco Uruguayo ya está en Google Play',text:'Instalá la app en tu Android para jugar más rápido y recibir las invitaciones de tus amigos.'}
};
const nativeApp=()=>globalThis.trucoNative?.isNative||globalThis.Capacitor?.isNativePlatform?.();
// Only iPhone browsers: not the app itself, not iPad (the app is iPhone only), not other phones.
export function iphoneWeb(nav=globalThis.navigator,native=nativeApp()){
 return !native&&/iPhone|iPod/.test(nav?.userAgent||'');
}
// Android browsers, phones and tablets, but not the app itself.
export function androidWeb(nav=globalThis.navigator,native=nativeApp()){
 return !native&&/Android/.test(nav?.userAgent||'');
}
export function storeFor(nav=globalThis.navigator,native=nativeApp()){
 return iphoneWeb(nav,native)?STORES.ios:androidWeb(nav,native)?STORES.android:null;
}
function read(storage,key){try{return JSON.parse(storage.getItem(key))||{};}catch{return {};}}
function write(storage,key,value){try{storage.setItem(key,JSON.stringify(value));}catch{/* Private mode: shown every visit. */}}
// One visit per browser session. The notice waits for the second visit (the first one is for
// the game) and, once closed, comes back when five more visits have passed.
export function promoVisit(storage=globalThis.localStorage,session=globalThis.sessionStorage,key=STORES.ios.key){
 const state=read(storage,key);
 let counted=false;try{counted=session.getItem(key)==='1';session.setItem(key,'1');}catch{}
 if(!counted)state.visits=(state.visits||0)+1;
 write(storage,key,state);
 return {...state,show:state.visits>=2&&(state.closedAt==null||state.visits-state.closedAt>=EVERY)};
}
const badge=store=>'<a class="app-store-badge'+(store===STORES.android?' play-badge':'')+'" href="'+store.url+'" target="_blank" rel="noopener">'+store.mark+'<span><small>'+store.small+'</small><strong>'+store.name+'</strong></span></a>';

export function installIosPromo({document=globalThis.document,storage=globalThis.localStorage,store=storeFor()}={}){
 if(!store)return;
 const key=store.key,visit=promoVisit(storage,globalThis.sessionStorage,key);
 const lobby=document.querySelector('#welcome-view .home-content');
 const button=document.createElement('a');
 button.className='install-app-chip';button.href=store.url;button.target='_blank';button.rel='noopener';
 button.innerHTML=store.mark+'<span>Instalá la app</span>';
 const remember=change=>write(storage,key,{...read(storage,key),...change});
 button.addEventListener('click',()=>remember({clicked:true}));
 const showChip=()=>{button.hidden=!!read(storage,key).clicked;};
 lobby?.prepend(button);showChip();
 if(!visit.show)return;
 const dialog=document.createElement('dialog');
 dialog.className='ios-promo-dialog';dialog.setAttribute('aria-labelledby','ios-promo-title');
 dialog.innerHTML='<button type="button" class="ios-promo-close" aria-label="Cerrar">×</button><img src="assets/app-icon-192.png" alt="" width="72" height="72"><h2 id="ios-promo-title">'+store.title+'</h2><p>'+store.text+'</p>'+badge(store);
 document.body.append(dialog);
 const close=()=>{remember({closedAt:read(storage,key).visits||0});dialog.close();showChip();};
 dialog.querySelector('.ios-promo-close').addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.querySelector('.app-store-badge').addEventListener('click',()=>{remember({clicked:true,closedAt:read(storage,key).visits||0});dialog.close();showChip();});
 // After the loading screen, and never on top of another notice.
 let tries=0;
 const open=()=>{
  // Also never during a game: it waits until the player is back out of the table.
  const busy=!document.getElementById('startup-loading')?.hidden||document.querySelector('dialog[open]')||document.getElementById('game-view')?.classList.contains('active');
  if(busy){if(++tries<2400)setTimeout(open,750);return;}
  if(!dialog.open)dialog.showModal();
 };
 setTimeout(open,1200);
}
