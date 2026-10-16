// Restore local sessions without eagerly opening the OAuth iframe.
// Process redirects only when a sign-in was actually started; preserve storage.
export async function initializeGameAuth(sdk,app,{onStage=()=>{},timeoutMs=20000}={}) {
  onStage('session');
  let auth;
  let pendingRedirect=false;
  try{pendingRedirect=!!globalThis.sessionStorage?.getItem('truco-apple-redirect-pending')||!!globalThis.sessionStorage?.getItem('truco-google-redirect-pending')||globalThis.sessionStorage?.getItem('firebase:pendingRedirect:'+app.options?.apiKey+':'+app.name)==='true';}catch{}
  const sameOrigin=!!app.options?.authDomain&&globalThis.location?.hostname===app.options.authDomain;
  try {
    auth=sdk.initializeAuth(app,{
      persistence:[sdk.browserLocalPersistence,sdk.indexedDBLocalPersistence,sdk.browserSessionPersistence,sdk.inMemoryPersistence],
    });
  }catch(error){
    if(error?.code!=='auth/already-initialized')throw error;
    auth=sdk.getAuth(app);
  }
  let timer;
  try{
    await Promise.race([
      (async()=>{
        await auth.authStateReady();
        if(sameOrigin&&pendingRedirect){
          await sdk.getRedirectResult(auth,sdk.browserPopupRedirectResolver);
          try{globalThis.sessionStorage?.removeItem('truco-apple-redirect-pending');globalThis.sessionStorage?.removeItem('truco-google-redirect-pending');}catch{}
        }
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Authentication startup timed out');error.code='auth/startup-timeout';reject(error);},timeoutMs);})
    ]);
  }finally{clearTimeout(timer);}
  onStage('ready');
  return auth;
}
