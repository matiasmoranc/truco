// The database rules enforce the grant using Firebase's clock. Browser time is
// only used to explain availability; it can never authorize an extra grant.
export const CREDIT_DAY_MS=86400000;
export const URUGUAY_OFFSET_MS=10800000;
const giftIcon='<svg class="credit-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18v4H3zM5 14v7h14v-7M12 10v11M12 10H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/></svg>';
export function creditDayStart(now) {
  return Math.floor((now-URUGUAY_OFFSET_MS)/CREDIT_DAY_MS)*CREDIT_DAY_MS+URUGUAY_OFFSET_MS;
}
export function creditCountdown(now) {
  const seconds=Math.max(0,Math.ceil((creditDayStart(now)+CREDIT_DAY_MS-now)/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
export function creditEligibility(wallet,now) {
  if(wallet===undefined)return 'loading';
  const balance=wallet?.balance??0,locked=wallet?.locked??0;
  if(!Number.isSafeInteger(balance)||balance<0||!Number.isSafeInteger(locked)||locked<0)return 'invalid';
  if(balance>0)return 'balance';
  if(locked>0)return 'locked';
  const last=wallet?.lastGrantAt;
  if(last!=null&&(!Number.isFinite(last)||last<0))return 'invalid';
  return last!=null&&last>=creditDayStart(now)?'claimed':'available';
}
export function dailyCreditChanges(wallet,timestamp) {
  // Never overwrite a funded or reserved balance, even on transaction retries.
  if((wallet?.balance??0)!==0||(wallet?.locked??0)!==0)return undefined;
  return {...wallet,balance:5,locked:0,lastGrantAt:timestamp};
}

// walletSource: resolves to the credit bank's live wallet ({watch,get,claim}) when
// the server keeps credits in Cloudflare, or to null to keep using Firebase.
export function installCredits({services,getState,document,api,walletSource=async()=>null,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,onChange=()=>{},notify=()=>{}}) {
  const el=id=>document.getElementById(id);
  let uid=null,generation=0,unsubscribe=null,timer=null,wallet,busy=false,error='',available=false,detailsOpen=false,initialAttempted=false;
  const clock=()=>now()+(Number(getState().serverTimeOffset)||0);
  let syncing=null,firstLoad=Promise.resolve(false),finishFirstLoad=null;
  function settled(value){const finish=finishFirstLoad;finishFirstLoad=null;finish?.(value);}
  async function sync() {
    if(!uid||getState().firebaseConnected!==true)return false;
    if(syncing)return syncing;
    const user=uid,epoch=generation;
    syncing=(async()=>{
      try{
        const bank=await walletSource();
        const value=bank?await bank.get():(await (async()=>{const fb=await services();return fb.get(fb.ref(fb.db,'creditEconomy/wallets/'+user));})()).val();
        if(epoch!==generation||getState().uid!==user)return false;
        wallet=value;available=true;error='';render();onChange();return true;
      }catch{
        if(epoch===generation){wallet=undefined;available=false;error='No pudimos confirmar tu saldo. Volvé a intentar.';render();onChange();}
        return false;
      }
    })();
    const pending=syncing;
    try{return await pending;}finally{if(syncing===pending)syncing=null;}
  }
  function render() {
    const panel=el('credits-panel');
    const eligibility=creditEligibility(wallet,clock());
    const loading=wallet===undefined||(wallet===null&&busy);
    panel.hidden=!uid||(loading&&!error)||(!detailsOpen&&['balance','claimed'].includes(eligibility));
    el('credits-balance').textContent=loading?(error?'—':'…'):String(wallet?.balance??0);
    const setupBalance=el('table-stake-available');if(setupBalance)setupBalance.textContent=el('credits-balance').textContent;
    const headerBalance=el('credits-header-balance');if(headerBalance){headerBalance.textContent=el('credits-balance').textContent;headerBalance.setAttribute?.('aria-busy',String(loading&&!error));}
    const open=el('credits-open');if(open)open.disabled=!available||loading;
    const messages={loading:'Cargando tus créditos…',invalid:'No pudimos verificar tu saldo.',balance:'Podés reclamar 5 créditos diarios cuando tu saldo llegue a 0.',locked:'Tenés créditos reservados en una partida.',claimed:'',available:''};
    el('credits-status').textContent=error||messages[eligibility];
    el('credits-status').hidden=!el('credits-status').textContent;
    const button=el('credits-claim');button.hidden=!available||!['available','claimed'].includes(eligibility);
    button.disabled=busy||eligibility!=='available'||getState().firebaseConnected!==true;
    button.innerHTML=giftIcon+'<span>'+(busy?'Reclamando…':eligibility==='claimed'?'5 créditos disponibles mañana':'Reclamar 5 créditos')+'</span>';
    clearTimer(timer);
    if(uid)timer=setTimer(render,Math.min(60000,Math.max(50,creditDayStart(clock())+CREDIT_DAY_MS-clock()+50)));
    if(uid&&available&&wallet===null&&!busy&&!initialAttempted&&getState().firebaseConnected===true){initialAttempted=true;void claim(true);}
  }
  function stop() {
    settled(false);firstLoad=Promise.resolve(false);
    ++generation;unsubscribe?.();unsubscribe=null;clearTimer(timer);timer=null;
    uid=null;wallet=undefined;busy=false;error='';available=false;detailsOpen=false;initialAttempted=false;syncing=null;render();
  }
  async function start() {
    const user=getState().uid;if(!user){stop();return;}
    if(uid===user&&unsubscribe)return;
    stop();uid=user;const epoch=generation;
    firstLoad=new Promise(resolve=>{finishFirstLoad=resolve;});render();
    try {
      const bank=await walletSource();if(epoch!==generation||getState().uid!==user)return;
      if(bank){
        unsubscribe=bank.watch(value=>{
          if(epoch!==generation)return;
          wallet=value;available=true;error='';render();onChange();if(wallet!==null)settled(true);
        });
        return;
      }
      const fb=await services();if(epoch!==generation||getState().uid!==user)return;
      unsubscribe=fb.onValue(fb.ref(fb.db,'creditEconomy/wallets/'+user),snapshot=>{
        if(epoch!==generation)return;
        wallet=snapshot.val();available=true;error='';render();onChange();if(wallet!==null)settled(true);
      },()=>{
        if(epoch!==generation)return;
        wallet=undefined;available=false;error='Los créditos todavía no están habilitados. Podés jugar contra el bot o practicar.';render();settled(false);
      });
    }catch {
      if(epoch!==generation)return;
      error='No pudimos cargar tus créditos. Revisá la conexión.';render();settled(false);
    }
  }
  async function claim(initial=false) {
    if(busy||!uid||!available||getState().firebaseConnected!==true||creditEligibility(wallet,clock())!=='available')return;
    const user=uid,epoch=generation;busy=true;render();
    try {
      const bank=await walletSource();if(epoch!==generation||getState().uid!==user)return;
      if(bank){
        // The bank applies the daily rule itself; a refusal is answered from its latest balance.
        try{const value=await bank.claim();if(epoch!==generation)return;wallet=value;detailsOpen=false;error='';}
        catch{const value=await bank.get();if(epoch!==generation)return;wallet=value;error=creditEligibility(wallet,clock())==='available'?'No se pudieron acreditar. Revisá la conexión y volvé a intentar.':'';}
        return;
      }
      const fb=await services();if(epoch!==generation||getState().uid!==user)return;
      const grantTime=fb.serverTimestamp();
      const result=await fb.runTransaction(fb.ref(fb.db,'creditEconomy/wallets/'+user),current=>{
        if(initial&&current!==null)return undefined;
        // Null can be an empty SDK cache. The rules still check the existing
        // server balance and daily timestamp before committing the transaction.
        if(current&&creditEligibility(current,clock())!=='available')return undefined;
        return dailyCreditChanges(current,grantTime);
      },{applyLocally:false});
      if(epoch!==generation)return;
      wallet=result.snapshot.val();if(result.committed)detailsOpen=false;error=result.committed?'':'Tu saldo cambió. Revisá los créditos disponibles.';
    }catch {
      if(epoch!==generation)return;
      // A concurrent claim can be rejected by the rules before the transaction
      // retries; read the server instead of displaying a second grant locally.
      try {
        const fb=await services(),snapshot=await fb.get(fb.ref(fb.db,'creditEconomy/wallets/'+user));
        if(epoch!==generation)return;
        wallet=snapshot.val();error=creditEligibility(wallet,clock())==='available'?'No se pudieron acreditar. Revisá la conexión y volvé a intentar.':'';
      }catch {if(epoch===generation)error='No pudimos confirmar los créditos. Revisá la conexión.';}
    }finally {if(epoch===generation){busy=false;render();settled(available);}}
  }
  el('credits-open')?.addEventListener('click',()=>{
    if(!uid)return;
    if((wallet?.balance??0)>0){detailsOpen=false;render();notify('Ya tenés créditos disponibles.');return;}
    detailsOpen=true;render();
    const panel=el('credits-panel');
    panel.scrollIntoView({behavior:'smooth',block:'center'});
    el('credits-claim').focus({preventScroll:true});
    panel.classList.remove('credits-highlight');void panel.offsetWidth;panel.classList.add('credits-highlight');
  });
  el('credits-claim').addEventListener('click',()=>claim());
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')void sync();});
  globalThis.addEventListener?.('pageshow',()=>{void sync();});
  return {start,stop,whenReady:()=>firstLoad,refresh:render,sync,claim,wallet:()=>wallet};
}
