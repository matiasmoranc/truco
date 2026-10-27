// After a match: take a photo and share it with the final score drawn in the lower-right
// corner, signed trucouruguayo.uy. The browser's share sheet is used on the web; the
// apps use the native one (globalThis.trucoNative.shareImage).
const SITE='trucouruguayo.uy';

function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function fitText(ctx,text,max){if(ctx.measureText(text).width<=max)return text;let t=text;while(t.length>1&&ctx.measureText(t+'…').width>max)t=t.slice(0,-1);return t+'…';}
function loadImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});}

// Tally squares as at the table: 5 points per square (four sides, then the diagonal),
// stacked down a column; the "malas" half sits above the line and the "buenas" below.
function drawTally(ctx,x,y,points,target,size,gap){
  const slots=target/10,half=slots*(size+gap),n=Math.min(Math.max(0,Math.floor(points)),target);
  for(let group=0;group<Math.ceil(n/5);group++){
    const count=Math.min(5,n-group*5),top=y+(group%slots)*(size+gap)+(group>=slots?half+gap:0),left=x,s=size;
    const sides=[[left,top,left,top+s],[left,top+s,left+s,top+s],[left+s,top+s,left+s,top],[left+s,top,left,top],[left,top+s,left+s,top]];
    ctx.beginPath();for(const [x1,y1,x2,y2] of sides.slice(0,count)){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}ctx.stroke();
  }
  return half*2+gap;
}

// Every shared picture is vertical 9:16 (stories size).
const W=1080,H=1920,U=Math.min(W,H)/100,CARD_MARGIN=6*U;

// The photo cropped from its middle to fill the 9:16 picture.
export function drawPhoto(photo){
  const pw=photo.naturalWidth||photo.width,ph=photo.naturalHeight||photo.height;
  const cover=Math.max(W/pw,H/ph),sw=W/cover,sh=H/cover;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  canvas.getContext('2d').drawImage(photo,(pw-sw)/2,(ph-sh)/2,sw,sh,0,0,W,H);
  return canvas;
}

// Looks for the card: the same layout with other colors and small details.
// winner/other: names and tallies; lines: malas/buenas and middle lines; site: the address.
export const CARD_THEMES={
  clasico:{name:'Clásico',swatch:'#0e3a2b',fill:'rgba(9,38,28,.82)',border:'rgba(232,201,131,.75)',winner:'#f0d596',other:'#dfe6e1',tally:'#f0eee2',lines:'rgba(239,235,215,.4)',footLine:'rgba(232,201,131,.35)',site:'#e8c983'},
  claro:{name:'Claro',swatch:'#f7f1e2',logoTint:'#1f6b4c',fill:'rgba(250,246,236,.94)',border:'rgba(176,138,62,.9)',winner:'#1f6b4c',other:'#4b5a52',tally:'#4b5a52',winnerTally:'#1f6b4c',lines:'rgba(31,61,46,.25)',footLine:'rgba(176,138,62,.5)',site:'#1f6b4c',shadow:.35},
  madera:{name:'Madera',swatch:'#7a4b27',wood:true,border:'rgba(58,32,14,.9)',winner:'#ffe2a3',other:'#f3e6cf',tally:'#f6ecd9',winnerTally:'#ffe2a3',lines:'rgba(246,236,217,.35)',footLine:'rgba(255,226,163,.4)',site:'#ffe2a3'},
  pizarra:{name:'Pizarra',swatch:'#26332e',fill:'#26332e',frame:'#7a4f2a',border:'rgba(0,0,0,0)',winner:'#f8e7b0',other:'#eef0ea',tally:'#f4f4ee',winnerTally:'#f8e7b0',lines:'rgba(244,244,238,.45)',footLine:'rgba(244,244,238,.3)',site:'#f8e7b0',chalk:true}
};

// The scoreboard card alone, on a transparent canvas with room around it for its shadow.
export async function drawScoreCard({sides,target=30},logo,theme='clasico'){
  await document.fonts?.ready;
  const t=CARD_THEMES[theme]||CARD_THEMES.clasico;
  target=[10,20,30,40,50,60].includes(Number(target))?Number(target):30;
  const u=U,pad=3.6*u,colW=16.8*u,cardW=pad*2+colW*sides.length,logoH=logo?8*u:0;
  const size=Math.min(3.6*u,30*u/(target/5)),gap=size*.45,tallyH=(target/10)*(size+gap)*2+gap,nameH=7*u,footH=7*u;
  const cardH=pad+(logo?logoH+2.5*u:0)+nameH+tallyH+2*u+footH+pad*.6,x=CARD_MARGIN,y=CARD_MARGIN,r=3.5*u;
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(cardW+2*CARD_MARGIN);canvas.height=Math.ceil(cardH+2*CARD_MARGIN);
  const ctx=canvas.getContext('2d');
  ctx.save();ctx.shadowColor=`rgba(0,0,0,${t.shadow??.55})`;ctx.shadowBlur=5*u;ctx.shadowOffsetY=1.5*u;
  roundRect(ctx,x,y,cardW,cardH,r);
  if(t.wood){const g=ctx.createLinearGradient(x,y,x+cardW,y+cardH);g.addColorStop(0,'#8a5a32');g.addColorStop(.5,'#6e4423');g.addColorStop(1,'#5a3519');ctx.fillStyle=g;}
  else ctx.fillStyle=t.frame||t.fill;
  ctx.fill();ctx.restore();
  ctx.save();roundRect(ctx,x,y,cardW,cardH,r);ctx.clip();
  // Wood grain, a chalkboard inside a wooden frame, or a sky-blue band at the top.
  if(t.wood){ctx.strokeStyle='rgba(40,20,6,.22)';ctx.lineWidth=.3*u;for(let i=0;i<26;i++){const yy=y+i*cardH/26+Math.sin(i*1.7)*u;ctx.beginPath();ctx.moveTo(x,yy);ctx.bezierCurveTo(x+cardW*.3,yy+u*Math.sin(i),x+cardW*.7,yy-u*Math.cos(i),x+cardW,yy+.5*u);ctx.stroke();}}
  if(t.frame){const f=1.6*u;roundRect(ctx,x+f,y+f,cardW-2*f,cardH-2*f,r*.6);ctx.fillStyle=t.fill;ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.035)';for(let i=0;i<180;i++)ctx.fillRect(x+f+((i*97)%1000)/1000*(cardW-2*f),y+f+((i*61)%1000)/1000*(cardH-2*f),((i*13)%10)/10*1.2*u,.4*u);}
  if(t.band){ctx.fillStyle=t.band;ctx.fillRect(x,y,cardW,pad+logoH+1.2*u);}
  ctx.restore();
  roundRect(ctx,x,y,cardW,cardH,r);ctx.lineWidth=Math.max(1,.35*u);ctx.strokeStyle=t.border;ctx.stroke();
  if(t.doubleBorder){roundRect(ctx,x+1.1*u,y+1.1*u,cardW-2.2*u,cardH-2.2*u,r*.7);ctx.lineWidth=Math.max(1,.18*u);ctx.stroke();}
  let cy=y+pad;
  if(logo){const lw=logoH*(logo.naturalWidth/logo.naturalHeight);
    // Light cards tint the logo (white on the sky-blue band); Celeste adds a sun of Uruguay on each side.
    if(t.logoTint){const tint=document.createElement('canvas');tint.width=logo.naturalWidth;tint.height=logo.naturalHeight;const tc=tint.getContext('2d');tc.drawImage(logo,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=t.logoTint;tc.fillRect(0,0,tint.width,tint.height);ctx.drawImage(tint,x+(cardW-lw)/2,cy,lw,logoH);}
    else ctx.drawImage(logo,x+(cardW-lw)/2,cy,lw,logoH);
    if(t.sun)for(const sx of [x+pad+2.6*u,x+cardW-pad-2.6*u]){const sy=cy+logoH/2;ctx.save();ctx.translate(sx,sy);ctx.fillStyle='#f7c948';ctx.strokeStyle='#f7c948';ctx.lineWidth=.3*u;for(let k=0;k<16;k++){ctx.rotate(Math.PI/8);ctx.beginPath();ctx.moveTo(0,1.4*u);ctx.lineTo(0,2.3*u);ctx.stroke();}ctx.beginPath();ctx.arc(0,0,1.15*u,0,Math.PI*2);ctx.fill();ctx.restore();}
    cy+=logoH+2.5*u;}
  ctx.textBaseline='middle';ctx.textAlign='center';
  sides.forEach((side,i)=>{
    const cx=x+pad+colW*i+colW/2;
    ctx.font=`${side.winner?700:500} ${(t.chalk?4.2:3)*u}px ${t.chalk?"'Caveat','DM Sans'":"'DM Sans'"},sans-serif`;ctx.fillStyle=side.winner?t.winner:t.other;
    ctx.fillText(fitText(ctx,side.name,colW-2*u),cx,cy+nameH/2-u);
    ctx.lineWidth=Math.max(1.5,.55*u);ctx.lineCap='round';ctx.strokeStyle=side.winner?(t.winnerTally||t.winner):t.tally;
    drawTally(ctx,cx-size/2,cy+nameH,side.points,target,size,gap);
  });
  // The line between malas and buenas, and the one between both players.
  const mid=cy+nameH+(target/10)*(size+gap)+gap/2;
  ctx.fillStyle=t.lines;ctx.fillRect(x+pad,mid-.15*u,cardW-2*pad,Math.max(1,.3*u));
  if(sides.length===2)ctx.fillRect(x+pad+colW-.15*u,cy,Math.max(1,.3*u),nameH+tallyH);
  cy+=nameH+tallyH+2*u;
  ctx.fillStyle=t.footLine;ctx.fillRect(x+pad,cy,cardW-2*pad,Math.max(1,.25*u));
  ctx.font=`700 ${3.6*u}px 'DM Sans',sans-serif`;ctx.fillStyle=t.site;ctx.fillText(SITE,x+cardW/2,cy+footH/2+.5*u);
  return canvas;
}

// Where the card starts: well inside the lower-right corner, slightly tilted.
// x and y are the card's middle on the 1080x1920 picture; rotation is in radians.
export function cardPlacement(card,{rotation=-3*Math.PI/180}={}){
  const w=card.width-2*CARD_MARGIN,h=card.height-2*CARD_MARGIN,margin=7*U+1.5*U;
  return {x:W-margin-w/2,y:H-margin-h/2,scale:1,rotation};
}

// The final picture: the photo with the card where the player left it.
export function placeCard(background,card,place){
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.drawImage(background,0,0,W,H);
  ctx.save();ctx.translate(place.x,place.y);ctx.rotate(place.rotation);ctx.scale(place.scale,place.scale);ctx.drawImage(card,-card.width/2,-card.height/2);ctx.restore();
  return canvas;
}

// The photo with the card in its starting place (also used by the ad videos).
export async function composeMatchPhoto(photo,score,logo,place){
  const card=await drawScoreCard(score,logo);
  return placeCard(drawPhoto(photo),card,place||cardPlacement(card,{rotation:0}));
}

export function installMatchPhoto({$,document,toast,score}){
  const input=$('match-photo-input'),dialog=$('match-photo-dialog'),stage=$('match-photo-stage'),bgCanvas=$('match-photo-bg'),cardImg=$('match-photo-card');
  let background=null,card=null,place=null,logo=null,currentScore=score,theme='clasico',score$=null;
  try{const saved=localStorage.getItem('truco-card-theme');if(CARD_THEMES[saved])theme=saved;}catch{}
  // The circles under the photo: one per look; the chosen one is remembered on this device.
  const themes=$('match-photo-themes');
  function renderThemes(){
    themes.replaceChildren(...Object.entries(CARD_THEMES).map(([id,t])=>{
      const b=document.createElement('button');b.type='button';b.className='match-photo-theme'+(id===theme?' active':'');b.style.setProperty('--swatch',t.swatch);b.style.setProperty('--edge',t.frame||t.border);
      b.setAttribute('aria-label','Marcador '+t.name);b.setAttribute('aria-pressed',String(id===theme));b.title=t.name;
      b.onclick=async()=>{if(id===theme||!score$)return;theme=id;try{localStorage.setItem('truco-card-theme',id);}catch{}renderThemes();card=await drawScoreCard(score$,logo,theme);cardImg.src=card.toDataURL('image/png');show();};
      return b;
    }));
  }
  // Opens the camera; the score comes from the match panel unless another screen passes its own.
  const start=(provider=score)=>{currentScore=provider;input.value='';input.click();};
  $('share-match').onclick=()=>start();
  // The card over the photo, at the stage's size (the picture is 1080 wide).
  function show(){
    const k=stage.clientWidth/W;if(!card||!k)return;
    cardImg.style.width=card.width*k+'px';cardImg.style.height=card.height*k+'px';
    cardImg.style.transform=`translate(${place.x*k-card.width*k/2}px,${place.y*k-card.height*k/2}px) rotate(${place.rotation}rad) scale(${place.scale})`;
  }
  const keepInside=()=>{place.scale=Math.min(2.5,Math.max(.4,place.scale));place.x=Math.min(W,Math.max(0,place.x));place.y=Math.min(H,Math.max(0,place.y));};
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    const url=URL.createObjectURL(file);
    try{
      logo??=await loadImage('assets/truco-v3.png').catch(()=>null);
      background=drawPhoto(await loadImage(url));
      score$=currentScore();card=await drawScoreCard(score$,logo,theme);place=cardPlacement(card);renderThemes();
      bgCanvas.getContext('2d').drawImage(background,0,0);cardImg.src=card.toDataURL('image/png');
      if(!dialog.open)dialog.showModal();show();
      requestAnimationFrame(show);
    }catch(error){console.error('[truco:photo]',error);toast('No pudimos preparar la foto.',true);}
    finally{URL.revokeObjectURL(url);}
  };
  // Moving the card: one finger drags it (starting on the card); two fingers pinch to
  // resize and turn to rotate it. With a mouse, the wheel resizes and Shift+wheel rotates.
  const pointers=new Map();let gesture=null;
  const local=event=>{const r=stage.getBoundingClientRect(),k=W/r.width;return {x:(event.clientX-r.left)*k,y:(event.clientY-r.top)*k};};
  const onCard=p=>{const dx=p.x-place.x,dy=p.y-place.y,c=Math.cos(-place.rotation),s=Math.sin(-place.rotation);const lx=(dx*c-dy*s)/place.scale,ly=(dx*s+dy*c)/place.scale;return Math.abs(lx)<=card.width/2-CARD_MARGIN+2*U&&Math.abs(ly)<=card.height/2-CARD_MARGIN+2*U;};
  const begin=()=>{
    const list=[...pointers.values()];
    if(list.length===1)gesture={from:list[0],place:{...place}};
    else if(list.length>=2){const [a,b]=list;gesture={a,b,place:{...place},mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},dist:Math.hypot(b.x-a.x,b.y-a.y)||1,angle:Math.atan2(b.y-a.y,b.x-a.x)};}
    else gesture=null;
  };
  stage.addEventListener('pointerdown',event=>{
    if(!card)return;const p=local(event);
    if(!pointers.size&&!onCard(p))return;
    try{stage.setPointerCapture(event.pointerId);}catch{}pointers.set(event.pointerId,p);begin();stage.classList.add('moving');
  });
  stage.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;
    pointers.set(event.pointerId,local(event));const list=[...pointers.values()];
    if(list.length===1&&gesture.from){place.x=gesture.place.x+list[0].x-gesture.from.x;place.y=gesture.place.y+list[0].y-gesture.from.y;}
    else if(list.length>=2&&gesture.a){
      const [a,b]=list,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      place.scale=gesture.place.scale*Math.hypot(b.x-a.x,b.y-a.y)/gesture.dist;
      place.rotation=gesture.place.rotation+Math.atan2(b.y-a.y,b.x-a.x)-gesture.angle;
      place.x=gesture.place.x+mid.x-gesture.mid.x;place.y=gesture.place.y+mid.y-gesture.mid.y;
    }
    keepInside();show();
  });
  const end=event=>{if(!pointers.delete(event.pointerId))return;begin();if(!pointers.size)stage.classList.remove('moving');};
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
  stage.addEventListener('wheel',event=>{
    if(!card)return;event.preventDefault();
    if(event.shiftKey)place.rotation+=(event.deltaY>0?1:-1)*3*Math.PI/180;else place.scale*=event.deltaY>0?1/1.06:1.06;
    keepInside();show();
  },{passive:false});
  addEventListener('resize',()=>{if(dialog.open)show();});
  $('match-photo-retake').onclick=()=>start(currentScore);
  $('match-photo-close').onclick=()=>dialog.close();
  $('match-photo-share').onclick=async()=>{
    if(!background||!card)return;
    // Only the photo travels: no text is attached to the message.
    const blob=await new Promise(resolve=>placeCard(background,card,place).toBlob(resolve,'image/jpeg',.9));
    const name='truco-uruguayo-'+Date.now()+'.jpg';
    try{
      if(globalThis.trucoNative?.shareImage){
        const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
        await globalThis.trucoNative.shareImage(base64,name);
      }else{
        const file=new File([blob],name,{type:'image/jpeg'});
        if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});
        else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('Guardamos la foto en tu dispositivo.');}
      }
    }catch(error){if(error?.name!=='AbortError'&&!/cancel/i.test(error?.message||''))toast('No se pudo compartir la foto.',true);}
  };
  return {start};
}
