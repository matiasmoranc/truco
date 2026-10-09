export function installAccount({ services, getState, savedName, rememberName, document }) {
  const el=id=>document.getElementById(id);
  let busy=false, unsubscribe=null, profileUid=null;
  const message=text=>{el('account-status').textContent=text;};
  const inRoom=()=>!!getState().room;
  function render(user) {
    el('account-summary').textContent=user&&!user.isAnonymous?'Cuenta conectada con Google':'Jugás como invitado';
    el('account-google').hidden=!!user&&!user.isAnonymous;
    el('account-logout').hidden=!user||user.isAnonymous;
    el('account-guest').textContent=user&&!user.isAnonymous?'Seguir jugando':'Jugar como invitado';
    for(const id of ['account-google','account-logout','account-save'])el(id).disabled=busy||!user||inRoom();
  }
  function observe(fb,user) {
    if(unsubscribe)unsubscribe();
    profileUid=user?.uid||null;
    getState().uid=profileUid;
    el('account-name').value=savedName();
    message('');render(user);
    if(!user)return;
    const uid=user.uid;
    unsubscribe=fb.onValue(fb.ref(fb.db,`profiles/${uid}`),snapshot=>{
      if(profileUid!==uid)return;
      const name=snapshot.val()?.name;
      if(typeof name==='string'&&name.trim()){
        rememberName(name);el('account-name').value=name;el('player-name').value=name;
      }
    },()=>{if(profileUid===uid)message('Tu apodo sigue guardado en este dispositivo. Para sincronizarlo, falta habilitar los perfiles en Firebase.');});
  }
  function errorText(error) {
    switch(error?.code){
      case 'auth/popup-closed-by-user':return 'Cerraste la ventana. Podés seguir como invitado.';
      case 'auth/cancelled-popup-request':return 'Ya hay una ventana de acceso abierta.';
      case 'auth/popup-blocked':return 'Permití las ventanas emergentes y volvé a intentar.';
      case 'auth/operation-not-allowed':return 'Falta habilitar el acceso con Google en Firebase.';
      case 'auth/unauthorized-domain':return 'Falta autorizar el dominio de esta página en Firebase.';
      case 'auth/account-exists-with-different-credential':return 'Este correo ya tiene otra forma de acceso. Usá el proveedor original para vincular Google.';
      default:return 'No pudimos conectar tu cuenta. Revisá tu conexión y volvé a intentar.';
    }
  }
  async function action(task) {
    if(busy)return;
    if(inRoom()){message('Volvé al lobby antes de cambiar tu cuenta.');return;}
    busy=true;
    try {const fb=await services();render(fb.auth.currentUser);await task(fb);}
    catch(error){message(errorText(error));}
    finally{busy=false;render(getState().firebase?.auth.currentUser);}
  }
  el('account-google').addEventListener('click',()=>action(async fb=>{
    const provider=new fb.authSdk.GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    const user=fb.auth.currentUser;
    try{
      if(user?.isAnonymous)await fb.authSdk.linkWithPopup(user,provider);
      else await fb.authSdk.signInWithPopup(fb.auth,provider);
    }catch(error){
      if(!['auth/credential-already-in-use','auth/email-already-in-use'].includes(error.code))throw error;
      const credential=fb.authSdk.GoogleAuthProvider.credentialFromError(error);
      if(!credential)throw error;
      await fb.authSdk.signInWithCredential(fb.auth,credential);
    }
    message('Cuenta conectada. Guardá el apodo que querés usar.');
  }));
  el('account-save').addEventListener('click',()=>action(async fb=>{
    const name=el('account-name').value.trim().slice(0,18);
    if(!name){message('Escribí tu apodo.');return;}
    rememberName(name);el('player-name').value=name;
    try{
      await fb.set(fb.ref(fb.db,`profiles/${fb.auth.currentUser.uid}/name`),name);
      message('Apodo guardado.');
    }catch{message('Apodo guardado en este dispositivo. No pudimos sincronizarlo: revisá la conexión y las reglas de perfiles en Firebase.');}
  }));
  el('account-logout').addEventListener('click',()=>action(async fb=>{
    await fb.authSdk.signOut(fb.auth);
    rememberName('');el('player-name').value='';
    await fb.authSdk.signInAnonymously(fb.auth);
    message('Ahora jugás como invitado.');
  }));
  el('account-open').addEventListener('click',async()=>{
    el('account-panel').showModal();
    try{const fb=await services();render(fb.auth.currentUser);}catch{message('No pudimos conectar. Revisá tu conexión.');}
    el('account-close').focus();
  });
  function close(){el('account-panel').close();el('account-open').focus();}
  el('account-close').addEventListener('click',close);
  el('account-guest').addEventListener('click',close);
  el('account-panel').addEventListener('click',event=>{if(event.target===el('account-panel'))close();});
  el('account-panel').addEventListener('cancel',()=>el('account-open').focus());
  return { observe };
}
