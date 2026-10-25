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

// The photo, at most 1600 px on its long side, with the scoreboard card on top, kept
// well inside the lower-right corner.
export async function composeMatchPhoto(photo,{sides,target=30},logo){
  const scale=Math.min(1,1600/Math.max(photo.naturalWidth||photo.width,photo.naturalHeight||photo.height));
  const W=Math.round((photo.naturalWidth||photo.width)*scale),H=Math.round((photo.naturalHeight||photo.height)*scale);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.drawImage(photo,0,0,W,H);
  await document.fonts?.ready;
  target=[10,20,30,40].includes(Number(target))?Number(target):30;
  const u=Math.min(W,H)/100,pad=4.5*u,colW=21*u,cardW=pad*2+colW*sides.length,logoH=logo?8*u:0;
  const size=Math.min(3.6*u,30*u/(target/5)),gap=size*.45,tallyH=(target/10)*(size+gap)*2+gap,nameH=7*u,footH=7*u;
  const cardH=pad+(logo?logoH+2.5*u:0)+nameH+tallyH+2*u+footH+pad*.6,margin=7*u,x=W-cardW-margin,y=H-cardH-margin;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=5*u;ctx.shadowOffsetY=1.5*u;
  roundRect(ctx,x,y,cardW,cardH,3.5*u);ctx.fillStyle='rgba(9,38,28,.92)';ctx.fill();ctx.restore();
  roundRect(ctx,x,y,cardW,cardH,3.5*u);ctx.lineWidth=Math.max(1,.35*u);ctx.strokeStyle='rgba(232,201,131,.75)';ctx.stroke();
  let cy=y+pad;
  if(logo){const lw=logoH*(logo.naturalWidth/logo.naturalHeight);ctx.drawImage(logo,x+(cardW-lw)/2,cy,lw,logoH);cy+=logoH+2.5*u;}
  ctx.textBaseline='middle';ctx.textAlign='center';
  sides.forEach((side,i)=>{
    const cx=x+pad+colW*i+colW/2;
    ctx.font=`${side.winner?700:500} ${3.4*u}px 'DM Sans',sans-serif`;ctx.fillStyle=side.winner?'#f0d596':'#dfe6e1';
    ctx.fillText(fitText(ctx,side.name,colW-2*u),cx,cy+nameH/2-u);
    ctx.lineWidth=Math.max(1.5,.55*u);ctx.lineCap='round';ctx.strokeStyle=side.winner?'#f0d596':'#f0eee2';
    drawTally(ctx,cx-size/2,cy+nameH,side.points,target,size,gap);
  });
  // The line between malas and buenas, and the one between both players.
  const mid=cy+nameH+(target/10)*(size+gap)+gap/2;
  ctx.fillStyle='rgba(239,235,215,.4)';ctx.fillRect(x+pad,mid-.15*u,cardW-2*pad,Math.max(1,.3*u));
  if(sides.length===2)ctx.fillRect(x+pad+colW-.15*u,cy,Math.max(1,.3*u),nameH+tallyH);
  cy+=nameH+tallyH+2*u;
  ctx.fillStyle='rgba(232,201,131,.35)';ctx.fillRect(x+pad,cy,cardW-2*pad,Math.max(1,.25*u));
  ctx.font=`700 ${3.6*u}px 'DM Sans',sans-serif`;ctx.fillStyle='#e8c983';ctx.fillText(SITE,x+cardW/2,cy+footH/2+.5*u);
  return canvas;
}

export function installMatchPhoto({$,document,toast,score}){
  const input=$('match-photo-input'),dialog=$('match-photo-dialog'),preview=$('match-photo-preview');
  let blob=null,logo=null;
  $('share-match').onclick=()=>{input.value='';input.click();};
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    const url=URL.createObjectURL(file);
    try{
      logo??=await loadImage('assets/truco-v3.png').catch(()=>null);
      const canvas=await composeMatchPhoto(await loadImage(url),score(),logo);
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
      preview.src=canvas.toDataURL('image/jpeg',.85);
      if(!dialog.open)dialog.showModal();
    }catch(error){console.error('[truco:photo]',error);toast('No pudimos preparar la foto.',true);}
    finally{URL.revokeObjectURL(url);}
  };
  $('match-photo-retake').onclick=()=>{input.value='';input.click();};
  $('match-photo-close').onclick=()=>dialog.close();
  $('match-photo-share').onclick=async()=>{
    if(!blob)return;
    const name='truco-uruguayo-'+Date.now()+'.jpg',text='Jugá conmigo en '+SITE;
    try{
      if(globalThis.trucoNative?.shareImage){
        const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
        await globalThis.trucoNative.shareImage(base64,name,text);
      }else{
        const file=new File([blob],name,{type:'image/jpeg'});
        if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],text});
        else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('Guardamos la foto en tu dispositivo.');}
      }
    }catch(error){if(error?.name!=='AbortError'&&!/cancel/i.test(error?.message||''))toast('No se pudo compartir la foto.',true);}
  };
}
