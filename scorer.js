// Standalone scorekeeper: never writes game state or credits to Firebase.
export function installScorer({document,storage=globalThis.localStorage,showView,renderTally}) {
  const $=id=>document.getElementById(id),key='truco-manual-score-v1';
  let match=null;
  try {const saved=JSON.parse(storage.getItem(key));if([10,20,30,40,50,60].includes(saved?.target)&&Array.isArray(saved.scores)&&saved.scores.length===2&&saved.scores.every(n=>Number.isInteger(n)&&n>=0&&n<=saved.target))match=saved;}catch{}
  const save=()=>{try{storage.setItem(key,JSON.stringify(match));}catch{}};
  function render(){
    const playing=!!match;
    $('scorer-setup').hidden=playing;$('scorer-board').hidden=!playing;
    $('scorer-new').hidden=!playing;
    if(!playing){$('scorer-status').textContent='¿A cuántos puntos jugamos?';return;}
    const winner=match.scores.findIndex(n=>n===match.target);
    $('scorer-status').textContent=winner<0?`Partida a ${match.target} puntos`:`Ganó ${winner===0?'Nosotros':'Ellos'}`;
    for(let team=0;team<2;team++){
      $(`scorer-total-${team}`).textContent=match.scores[team];
      $(`scorer-tally-${team}`).innerHTML=renderTally(match.scores[team],match.target);
      $(`scorer-add-${team}`).disabled=winner>=0;
      $(`scorer-minus-${team}`).disabled=match.scores[team]===0;
      $(`scorer-add-${team}`).classList.toggle('scorer-winner',winner===team);
    }
  }
  $('open-scorer').addEventListener('click',()=>{render();showView('scorer-view');});
  $('scorer-back').addEventListener('click',()=>showView('welcome-view'));
  $('scorer-new').addEventListener('click',()=>{match=null;save();render();});
  document.querySelectorAll('[data-scorer-target]').forEach(button=>button.addEventListener('click',()=>{match={target:Number(button.dataset.scorerTarget),scores:[0,0]};save();render();}));
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
