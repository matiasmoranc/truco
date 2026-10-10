// The database rules enforce the grant using Firebase's clock. Browser time is
// only used to explain availability; it can never authorize an extra grant.
export const CREDIT_DAY_MS=86400000;
export const URUGUAY_OFFSET_MS=10800000;
export function creditDayStart(now) {
  return Math.floor((now-URUGUAY_OFFSET_MS)/CREDIT_DAY_MS)*CREDIT_DAY_MS+URUGUAY_OFFSET_MS;
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
  return {...wallet,balance:2,locked:0,lastGrantAt:timestamp};
}

export function installCredits({services,getState,document,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,onChange=()=>{}}) {
  const el=id=>document.getElementById(id);
  let uid=null,generation=0,unsubscribe=null,timer=null,wallet,busy=false,error='',available=false,detailsOpen=false;
  const clock=()=>now()+(Number(getState().serverTimeOffset)||0);
  function render() {
    const panel=el('credits-panel');
    const eligibility=creditEligibility(wallet,clock());
    panel.hidden=!uid||(!detailsOpen&&['balance','claimed'].includes(eligibility));
    el('credits-balance').textContent=wallet===undefined?'—':String(wallet?.balance??0);
    const setupBalance=el('table-stake-available');if(setupBalance)setupBalance.textContent=el('credits-balance').textContent;
    const headerBalance=el('credits-header-balance');if(headerBalance)headerBalance.textContent=el('credits-balance').textContent;
    const messages={loading:'Cargando tus créditos…',invalid:'No pudimos verificar tu saldo.',balance:'Podés reclamar 2 créditos diarios cuando tu saldo llegue a 0.',locked:'Tenés créditos reservados en una partida.',claimed:'Ya recibiste tus 2 créditos de hoy. Podés volver a reclamar mañana si estás en 0.',available:''};
    el('credits-status').textContent=error||messages[eligibility];
    el('credits-status').hidden=!el('credits-status').textContent;
    const button=el('credits-claim');button.hidden=!!error||!available||!['available','claimed'].includes(eligibility);
    button.disabled=busy||eligibility!=='available'||getState().firebaseConnected!==true;
    button.textContent=busy?'Reclamando…':eligibility==='claimed'?'Disponibles mañana':'Reclamar 2 créditos';
    clearTimer(timer);
    if(uid)timer=setTimer(render,Math.min(60000,Math.max(50,creditDayStart(clock())+CREDIT_DAY_MS-clock()+50)));
  }
  function stop() {
    ++generation;unsubscribe?.();unsubscribe=null;clearTimer(timer);timer=null;
    uid=null;wallet=undefined;busy=false;error='';available=false;detailsOpen=false;render();
  }
  async function start() {
    const user=getState().uid;if(!user){stop();return;}
    if(uid===user&&unsubscribe)return;
    stop();uid=user;const epoch=generation;render();
    try {
      const fb=await services();if(epoch!==generation||getState().uid!==user)return;
      unsubscribe=fb.onValue(fb.ref(fb.db,'creditEconomy/wallets/'+user),snapshot=>{
        if(epoch!==generation)return;
        wallet=snapshot.val();available=true;error='';render();onChange();
      },()=>{
        if(epoch!==generation)return;
        wallet=undefined;available=false;error='Los créditos todavía no están habilitados. Podés jugar contra el bot o practicar.';render();
      });
    }catch {
      if(epoch!==generation)return;
      error='No pudimos cargar tus créditos. Revisá la conexión.';render();
    }
  }
  async function claim() {
    if(busy||!uid||!available||getState().firebaseConnected!==true||creditEligibility(wallet,clock())!=='available')return;
    const user=uid,epoch=generation;busy=true;render();
    try {
      const fb=await services();if(epoch!==generation||getState().uid!==user)return;
      const grantTime=fb.serverTimestamp();
      const result=await fb.runTransaction(fb.ref(fb.db,'creditEconomy/wallets/'+user),current=>{
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
    }finally {if(epoch===generation){busy=false;render();}}
  }
  el('credits-open')?.addEventListener('click',()=>{
    if(!uid)return;detailsOpen=true;render();
    const panel=el('credits-panel');
    panel.scrollIntoView({behavior:'smooth',block:'center'});
    el('credits-claim').focus({preventScroll:true});
    panel.classList.remove('credits-highlight');void panel.offsetWidth;panel.classList.add('credits-highlight');
  });
  el('credits-claim').addEventListener('click',claim);
  return {start,stop,refresh:render,claim,wallet:()=>wallet};
}
