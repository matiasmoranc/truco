// Firebase recommends delaying the mobile auth iframe until a popup is requested.
// Existing local and IndexedDB sessions are kept; no credentials are cleared.
export async function initializeGameAuth(sdk,app,{onStage=()=>{},timeoutMs=20000}={}) {
  onStage('session');
  let auth;
  const sameOrigin=!!app.options?.authDomain&&globalThis.location?.hostname===app.options.authDomain;
  try {
    auth=sdk.initializeAuth(app,{
      persistence:[sdk.browserLocalPersistence,sdk.indexedDBLocalPersistence,sdk.browserSessionPersistence,sdk.inMemoryPersistence],
      ...(sameOrigin?{popupRedirectResolver:sdk.browserPopupRedirectResolver}:{})
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
        if(sameOrigin)await sdk.getRedirectResult(auth,sdk.browserPopupRedirectResolver);
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Authentication startup timed out');error.code='auth/startup-timeout';reject(error);},timeoutMs);})
    ]);
  }finally{clearTimeout(timer);}
  onStage('ready');
  return auth;
}
