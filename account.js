export function installAccount({ services, getState, rememberName, document, storage=globalThis.localStorage, onReady=()=>{}, onIdentityChange=()=>{}, inRoom=()=>!!getState().room }) {
  const el=id=>document.getElementById(id);
  let busy=false, ready=false, profileKey=null, profilePromise=null, currentUser=null;
  let profileName='', readyUid=null, generation=0, loaded=false;
  const message=text=>{
    el('auth-status').textContent=text;
    el('account-status').textContent=text;
  };
  const registered=user=>!!user&&!user.isAnonymous&&user.providerData?.some(provider=>provider.providerId==='google.com');
  const validName=value=>typeof value==='string'&&/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9._-]{1,18}$/.test(value);
  const nameKey=name=>name.toLowerCase().replaceAll('.', '%2E');
  const cleanName=value=>typeof value==='string'?value.trim().slice(0,18):'';
  function cachedName(uid) {
    try{return cleanName(storage?.getItem('truco-profile-name:'+uid));}catch{return '';}
  }
  function cacheName(uid,name) {
    try{storage?.setItem('truco-profile-name:'+uid,name);}catch{}
  }
  function render() {
    const google=registered(currentUser);
    el('auth-gate').hidden=ready;
    el('app').inert=!ready;
    el('auth-login').hidden=google;
    el('auth-register').hidden=!google||!loaded;
    el('account-google').disabled=busy||!getState().firebase;
    el('auth-name-save').disabled=busy||!google||!loaded;
    for(const id of ['account-change-name','account-logout','account-save'])el(id).disabled=busy||!ready||inRoom();
    el('auth-retry').hidden=!!getState().firebase&&(!google||loaded);
    el('auth-retry').disabled=busy;
  }
  function activate(user,name) {
    profileName=name;rememberName(name);cacheName(user.uid,name);
    el('account-username').textContent=name;
    el('player-name').value=name;el('invite-name').value=name;
    ready=true;render();
    if(readyUid!==user.uid) {
      readyUid=user.uid;
      Promise.resolve(onReady()).catch(()=>message('No pudimos cargar las mesas. Revisá tu conexión.'));
    }
  }
  function observe(fb,user,force=false) {
    const key=user?user.uid+':'+registered(user):'signed-out';
    if(!force&&key===profileKey)return profilePromise||Promise.resolve();
    if(getState().uid&&getState().uid!==user?.uid)onIdentityChange();
    profileKey=key;currentUser=user;getState().uid=user?.uid||null;
    const epoch=++generation;
    ready=false;loaded=false;profileName='';render();
    if(!registered(user)) {
      readyUid=null;el('account-username').textContent='';rememberName('');el('player-name').value='';el('invite-name').value='';
      el('auth-name').value='';message('');
      if(el('account-panel').open)el('account-panel').close();
      profilePromise=Promise.resolve();return profilePromise;
    }
    const uid=user.uid;
    const cached=cachedName(uid);
    if(cached)activate(user,cached);
    else message('Cargando tu cuenta…');
    profilePromise=(async()=>{
      let timer;
      try {
        const snapshot=await Promise.race([
          fb.get(fb.ref(fb.db,'profiles/'+uid)),
          new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('profile-timeout')),12000);})
        ]);
        if(epoch!==generation)return;
        loaded=true;
        const name=cleanName(snapshot.val()?.name);
        if(name){activate(user,name);message('');}
        else if(!cached){
          el('auth-name').value='';
          message('Elegí el nombre con el que vas a jugar.');
        }
      }catch(error){
        if(epoch!==generation)return;
        // A known profile can remain usable on a slow connection. New accounts
        // must save their profile before entering the game.
        loaded=false;
        message(cached?'No pudimos actualizar tu nombre desde la cuenta.':
          'No pudimos cargar tu perfil. Revisá la conexión y las reglas de perfiles en Firebase.');
      }finally{clearTimeout(timer);if(epoch===generation)render();}
    })();
    return profilePromise;
  }
  function errorText(error) {
    switch(error?.code){
      case 'auth/popup-closed-by-user':return 'Cerraste la ventana. Tocá Google para volver a intentar.';
      case 'auth/cancelled-popup-request':return 'Ya hay una ventana de acceso abierta.';
      case 'auth/popup-blocked':return 'Permití las ventanas emergentes y volvé a intentar.';
      case 'auth/operation-not-allowed':return 'Falta habilitar el acceso con Google en Firebase.';
      case 'auth/unauthorized-domain':return 'Falta autorizar el dominio de esta página en Firebase.';
      case 'auth/account-exists-with-different-credential':return 'Este correo ya tiene otra forma de acceso. Usá el proveedor original para vincular Google.';
      default:return 'No pudimos conectar tu cuenta. Revisá tu conexión y volvé a intentar.';
    }
  }
  async function action(task,{allowRegistration=false}={}) {
    if(busy)return;
    if(inRoom()){message('Volvé al lobby antes de cambiar tu cuenta.');return;}
    busy=true;render();
    try {
      const fb=getState().firebase||await services();
      if(!allowRegistration&&!ready)return;
      await task(fb);
    }catch(error){message(errorText(error));}
    finally{busy=false;render();}
  }
  el('account-google').addEventListener('click',()=>action(async fb=>{
    message('Abriendo Google…');
    const provider=new fb.authSdk.GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    const user=fb.auth.currentUser;
    try{
      // Preserve old anonymous seats when an existing installation first links Google.
      if(user?.isAnonymous)await fb.authSdk.linkWithPopup(user,provider);
      else await fb.authSdk.signInWithPopup(fb.auth,provider);
    }catch(error){
      if(!['auth/credential-already-in-use','auth/email-already-in-use'].includes(error.code))throw error;
      const credential=fb.authSdk.GoogleAuthProvider.credentialFromError(error);
      if(!credential)throw error;
      await fb.authSdk.signInWithCredential(fb.auth,credential);
    }
    await observe(fb,fb.auth.currentUser);
  },{allowRegistration:true}));
  async function save(fb,input,registration) {
    const user=fb.auth.currentUser;
    if(!registered(user)){message('Iniciá sesión con Google.');return;}
    const name=input.value.normalize('NFC');
    if(!name){message('Escribí tu nombre de usuario.');input.focus();return;}
    if(!validName(name)){message('Usá de 1 a 18 letras, números, guion (-), guion bajo (_) o punto (.). Sin espacios.');input.focus();return;}
    const key=nameKey(name);
    try{
      const owner=(await fb.get(fb.ref(fb.db,'usernames/'+key))).val();
      if(owner&&owner!==user.uid){message('Ese nombre de usuario ya existe. Elegí otro.');input.focus();return;}
      const previous=(await fb.get(fb.ref(fb.db,'profiles/'+user.uid))).val()?.name;
      const changes={['profiles/'+user.uid+'/name']:name,['usernames/'+key]:user.uid};
      if(previous&&nameKey(previous)!==key){
        const oldKey=nameKey(previous);
        if((await fb.get(fb.ref(fb.db,'usernames/'+oldKey))).val()===user.uid)changes['usernames/'+oldKey]=null;
      }
      // Rules validate the claim and profile together, so concurrent saves cannot claim the same name.
      await fb.update(fb.ref(fb.db),changes);
      if(fb.auth.currentUser?.uid!==user.uid)return;
      loaded=true;activate(user,name);
      message(registration?'':'Nombre de usuario guardado.');
      if(!registration){el('account-edit').hidden=true;el('account-menu').hidden=false;}
    }catch{
      try{const owner=(await fb.get(fb.ref(fb.db,'usernames/'+key))).val();if(owner&&owner!==user.uid){message('Ese nombre de usuario ya existe. Elegí otro.');return;}}catch{}
      message('No pudimos guardar tu nombre en la cuenta. Revisá la conexión y las reglas de perfiles en Firebase.');
    }
  }
  el('auth-register').addEventListener('submit',event=>{
    event.preventDefault();return action(fb=>save(fb,el('auth-name'),true),{allowRegistration:true});
  });
  el('account-edit').addEventListener('submit',event=>{
    event.preventDefault();return action(fb=>save(fb,el('account-name'),false));
  });
  el('auth-retry').addEventListener('click',()=>action(async fb=>observe(fb,fb.auth.currentUser,true),{allowRegistration:true}));
  el('account-logout').addEventListener('click',()=>action(async fb=>{
    await fb.authSdk.signOut(fb.auth);
    await observe(fb,null);
    el('account-panel').close();
    el('account-google').focus();
  }));
  el('account-change-name').addEventListener('click',()=>{
    if(!ready||inRoom())return;
    message('');el('account-menu').hidden=true;el('account-edit').hidden=false;
    el('account-name').value=profileName;el('account-name').focus();
  });
  el('account-edit-back').addEventListener('click',()=>{
    message('');el('account-edit').hidden=true;el('account-menu').hidden=false;
  });
  el('account-open').addEventListener('click',()=>{
    if(!ready)return;
    el('account-menu').hidden=false;el('account-edit').hidden=true;message('');render();
    el('account-panel').showModal();el('account-close').focus();
  });
  function close(){el('account-panel').close();el('account-open').focus();}
  el('account-close').addEventListener('click',close);
  el('account-panel').addEventListener('click',event=>{if(event.target===el('account-panel'))close();});
  el('account-panel').addEventListener('cancel',()=>el('account-open').focus());
  return {observe,isReady:()=>ready,failed:error=>{message(errorText(error));render();}};
}

