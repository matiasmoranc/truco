// Standalone scorekeeper: never writes game state or credits to Firebase.
// standalone: the scorer is the whole page (anotador page), so it shows at once.
export function installScorer({document,storage=globalThis.localStorage,showView,renderTally=renderCompactTally,now=()=>Date.now(),standalone=false}) {
  const $=id=>document.getElementById(id),key='truco-manual-score-v1';
  const screen = installScorerScreen({document});
  $('scorer-colors')?.addEventListener('click',()=>{
    const inverted=$('scorer-view').classList.toggle('scorer-colors-inverted');
    $('scorer-colors').setAttribute('aria-pressed',String(inverted));
  });
  let match=null;
  try {const saved=JSON.parse(storage.getItem(key));if(Number.isFinite(saved?.startedAt)&&now()-saved.startedAt>=0&&now()-saved.startedAt<86400000&&[10,20,30,40,50,60].includes(saved?.target)&&Array.isArray(saved.scores)&&saved.scores.length===2&&saved.scores.every(n=>Number.isInteger(n)&&n>=0&&n<=saved.target))match=saved;else storage.removeItem(key);}catch{}
  const save=()=>{try{storage.setItem(key,JSON.stringify(match));}catch{}};
  function render(){
    const playing=!!match;
    $('scorer-setup').hidden=playing;$('scorer-board').hidden=!playing;
    $('scorer-new').hidden=!playing;
    if(!playing){$('scorer-status').hidden=false;$('scorer-status').textContent='¿A cuántos puntos jugamos?';return;}
    const winner=match.scores.findIndex(n=>n===match.target);
    $('scorer-status').hidden=winner<0;
    $('scorer-status').textContent=winner<0?'':`Ganó ${winner===0?'Nosotros':'Ellos'}`;
    for(let team=0;team<2;team++){
      $(`scorer-tally-${team}`).innerHTML=renderTally(match.scores[team],match.target);
      $(`scorer-add-${team}`).disabled=winner>=0;
      $(`scorer-minus-${team}`).disabled=match.scores[team]===0;
      $(`scorer-add-${team}`).classList.toggle('scorer-winner',winner===team);
    }
  }
  $('open-scorer')?.addEventListener('click',()=>{if(match&&now()-match.startedAt>=86400000){match=null;save();}render();showView('scorer-view');screen.setActive(true);});
  $('scorer-back')?.addEventListener('click',()=>{screen.setActive(false);showView('welcome-view');});
  $('scorer-new').addEventListener('click',()=>{match=null;save();render();});
  document.querySelectorAll('[data-scorer-target]').forEach(button=>button.addEventListener('click',()=>{match={target:Number(button.dataset.scorerTarget),scores:[0,0],startedAt:now()};save();render();}));
  if(standalone){if(match&&now()-match.startedAt>=86400000){match=null;save();}render();screen.setActive(true);}
  for(let team=0;team<2;team++){
    $(`scorer-add-${team}`).addEventListener('click',()=>{
      if(!match||match.scores.some(n=>n===match.target))return;
      match.scores[team]++;save();render();
    });
    $(`scorer-minus-${team}`).addEventListener('click',()=>{
      if(!match)return;match.scores[team]=Math.max(0,match.scores[team]-1);save();render();
    });
  }
}

// The compact stick tally: groups of five drawn as a square and its diagonal.
export function renderCompactTally(points,target){
  const limit=[10,20,30,40,50,60].includes(Number(target))?Number(target):30,n=Math.min(Math.max(0,Math.floor(Number(points)||0)),limit),slots=limit/10;
  const halfHeight=slots*28+8,height=halfHeight*2,lines=[];
  for(let group=0;group<Math.ceil(n/5);group++){
    const x=5,y=5+(group%slots)*28+(group>=slots?halfHeight:0),size=Math.min(5,n-group*5),d=20;
    const sides=[[x,y,x,y+d],[x,y+d,x+d,y+d],[x+d,y+d,x+d,y],[x+d,y,x,y],[x,y+d,x+d,y]];
    lines.push(...sides.slice(0,size).map(([a,b,c,d])=>`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`));
  }
  return `<svg class="compact-score-sticks" viewBox="0 0 30 ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="${n} puntos de ${limit}"><line x1="0" y1="${halfHeight}" x2="30" y2="${halfHeight}" stroke="#efebd7" stroke-opacity=".4"/><g fill="none" stroke="#f0eee2" stroke-width="2.5" stroke-linecap="round">${lines.join('')}</g></svg>`;
}

// Keep only the visible scorekeeper awake; the browser may deny the request.
export function installScorerScreen({document,navigator=globalThis.navigator}) {
  let active=false,lock=null,pending=false,epoch=0;
  const visible=()=>active&&document.visibilityState==='visible';
  async function release(){
    epoch++;
    const previous=lock;lock=null;
    try{await previous?.release();}catch{}
  }
  async function acquire(){
    if(!visible()||lock||pending||!navigator?.wakeLock?.request)return;
    pending=true;
    const attempt=epoch;
    try{
      const next=await navigator.wakeLock.request('screen');
      if(!visible()||attempt!==epoch){await next.release();return;}
      lock=next;
      next.addEventListener('release',()=>{if(lock===next)lock=null;});
    }catch{}finally{
      pending=false;
      // A rapid tab switch can invalidate an in-flight request.
      if(attempt!==epoch&&visible()&&!lock)void acquire();
    }
  }
  function setActive(value){active=value;if(value)void acquire();else void release();}
  document.addEventListener('visibilitychange',()=>{if(visible())void acquire();else void release();});
  globalThis.addEventListener?.('pagehide',()=>{void release();});
  globalThis.addEventListener?.('pageshow',()=>{void acquire();});
  document.getElementById('scorer-view').addEventListener('pointerdown',()=>{void acquire();},{passive:true});
  if(globalThis.MutationObserver){
    new MutationObserver(()=>setActive(document.getElementById('scorer-view').classList.contains('active')))
      .observe(document.getElementById('scorer-view'),{attributes:true,attributeFilter:['class']});
  }
  return {setActive};
}
