// Señas: the face each card is signalled with, drawn as an SVG that loops between the
// neutral face and the sign. "Derecho/izquierdo" are the signer's own sides, so the right
// eye or lip corner is drawn on the viewer's left. Arrows mark the movement so the sign
// reads even in the small icon.
export const CARD_SIGNS={
 105:{kind:'cejas',text:'Levantar las dos cejas'},
 104:{kind:'trompa',text:'Hacer trompita, como un beso'},
 103:{kind:'nariz',text:'Fruncir la nariz, como un chancho'},
 102:{kind:'guino-der',text:'Guiñar el ojo derecho'},
 101:{kind:'guino-izq',text:'Guiñar el ojo izquierdo'},
 90:{kind:'comisura-der',text:'Mover la comisura derecha del labio hacia el costado'},
 89:{kind:'comisura-der',text:'Mover la comisura derecha del labio hacia el costado'},
 88:{kind:'comisura-izq',text:'Mover la comisura izquierda del labio hacia el costado'},
 87:{kind:'comisura-izq',text:'Mover la comisura izquierda del labio hacia el costado'},
 80:{kind:'morder',text:'Morderse el labio inferior'},
 70:{kind:'boca',text:'Abrir la boca'},
 60:{kind:'lengua',text:'Sacar la punta de la lengua, sin abrir mucho la boca'}
};
const INK='#3b2416',LIP='#c9584f',SKIN_LINE='#b98560',CUE='#1f6fbf';
// The viewer's left is the signer's right.
const R=37,L=63;
const eye=(x,ry=5.2)=>`<ellipse cx="${x}" cy="47" rx="5.6" ry="${ry}" fill="#fff" stroke="${INK}" stroke-width="1.3"/><circle cx="${x}" cy="47.6" r="3" fill="${INK}"/><circle cx="${x+1}" cy="46.4" r="1" fill="#fff"/>`;
const closedEye=x=>`<path d="M${x-6} 47 Q${x} 52.5 ${x+6} 47" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/><path d="M${x-5} 50 l-2 2.4 M${x} 51.6 v2.8 M${x+5} 50 l2 2.4" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>`;
const squint=x=>`<path d="M${x-6} 49 Q${x} 43.5 ${x+6} 49" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
const brow=(x,y=36,frown=0)=>{const inner=x<50?x+7:x-7,outer=x<50?x-7:x+7;return `<path d="M${outer} ${y} Q${x} ${y-4.5} ${inner} ${y+frown}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;};
const arrow=(x1,y1,x2,y2)=>{const a=Math.atan2(y2-y1,x2-x1),h=4.2,p=(d)=>`${(x2+h*Math.cos(a+d)).toFixed(1)} ${(y2+h*Math.sin(a+d)).toFixed(1)}`;
 return `<path d="M${x1} ${y1} L${x2} ${y2} M${p(Math.PI*0.8)} L${x2} ${y2} L${p(-Math.PI*0.8)}" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x1} ${y1} L${x2} ${y2} M${p(Math.PI*0.8)} L${x2} ${y2} L${p(-Math.PI*0.8)}" fill="none" stroke="${CUE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;};
const NEUTRAL={
 brows:brow(R)+brow(L),
 eyes:eye(R)+eye(L),
 nose:`<path d="M50 51 L46.5 61 Q50 63.5 53.5 61" fill="none" stroke="${SKIN_LINE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
 mouth:`<path d="M39 73 Q50 79.5 61 73" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`
};
// Each sign replaces some of the neutral parts and may add cues on top.
const SIGNS={
 cejas:{brows:brow(R,27)+brow(L,27),eyes:eye(R,6.6)+eye(L,6.6),
  extra:arrow(24,40,24,27)+arrow(76,40,76,27)},
 trompa:{mouth:`<ellipse cx="50" cy="75" rx="7" ry="6.2" fill="${LIP}" stroke="#9c3d36" stroke-width="1.2"/><ellipse cx="50" cy="75" rx="2.4" ry="1.8" fill="#6e2622"/><path d="M45 72.5 q1.2 2.5 0 5 M55 72.5 q-1.2 2.5 0 5" fill="none" stroke="#9c3d36" stroke-width="1"/>`,
  extra:`<path d="M71 66 c-2.5-3.6 -7.5-1.2 -5 2.6 l5 4.6 l5-4.6 c2.5-3.8 -2.5-6.2 -5-2.6z" fill="#e2483f" stroke="#fff" stroke-width="1.2"/>`},
 nariz:{brows:brow(R,38,4)+brow(L,38,4),eyes:squint(R)+squint(L),
  nose:`<path d="M47 50 q3 1.6 6 0 M46.5 53.5 q3.5 1.8 7 0" fill="none" stroke="${SKIN_LINE}" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="50" cy="60.5" rx="7.6" ry="5.2" fill="#f0a690" stroke="${SKIN_LINE}" stroke-width="1.6"/><ellipse cx="47.2" cy="60.8" rx="1.6" ry="2.4" fill="#7d4026"/><ellipse cx="52.8" cy="60.8" rx="1.6" ry="2.4" fill="#7d4026"/>`,
  mouth:`<path d="M40 74 Q50 72 60 74" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`},
 'guino-der':{eyes:closedEye(R)+eye(L),brows:brow(R,39)+brow(L),
  mouth:`<path d="M36 70 Q46 79 61 74" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`},
 'guino-izq':{eyes:eye(R)+closedEye(L),brows:brow(R)+brow(L,39),
  mouth:`<path d="M39 74 Q54 79 64 70" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`},
 'comisura-der':{mouth:`<path d="M27 70 Q39 79 50 76.5 Q57 75 61 73" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`,
  extra:arrow(38,84,24,80)},
 'comisura-izq':{mouth:`<path d="M39 73 Q43 75 50 76.5 Q61 79 73 70" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`,
  extra:arrow(62,84,76,80)},
 // Two upper front teeth pressing on the lower lip, tucked under them.
 morder:{mouth:`<path d="M39.5 75.5 Q50 84 60.5 75.5 Q50 79.5 39.5 75.5 Z" fill="${LIP}" stroke="#9c3d36" stroke-width="1"/>`
  +`<rect x="44.6" y="69.5" width="5.2" height="8.6" rx="1.6" fill="#fff" stroke="#bdb3a3" stroke-width="1"/><rect x="50.2" y="69.5" width="5.2" height="8.6" rx="1.6" fill="#fff" stroke="#bdb3a3" stroke-width="1"/>`
  +`<path d="M39 71.5 Q50 67 61 71.5" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`},
 boca:{mouth:`<ellipse cx="50" cy="77" rx="9" ry="9.5" fill="#4d1714" stroke="${LIP}" stroke-width="3"/><path d="M43 70.6 Q50 69 57 70.6 L56 73.4 Q50 72.4 44 73.4 Z" fill="#fff"/><ellipse cx="50" cy="82.5" rx="5.6" ry="3.2" fill="#e07a80"/>`},
 lengua:{mouth:`<path d="M44.5 74 Q44.2 84.5 50 84.5 Q55.8 84.5 55.5 74 Z" fill="#ec7f8a" stroke="#b44a57" stroke-width="1.3"/><path d="M50 75.5 V81" stroke="#b44a57" stroke-width="1.1" stroke-linecap="round"/><path d="M39 73 Q50 76.5 61 73" fill="none" stroke="${LIP}" stroke-width="3.4" stroke-linecap="round"/>`}
};
// A face doing the sign. pose: the sign held still (the list icon); otherwise it loops.
export function signFaceSvg(kind,{pose=false,label=''}={}){
 const sign=SIGNS[kind];if(!sign)return '';
 const parts=['brows','eyes','nose','mouth'],base=parts.filter(p=>!sign[p]).map(p=>NEUTRAL[p]).join('');
 const before=parts.filter(p=>sign[p]).map(p=>NEUTRAL[p]).join(''),after=parts.filter(p=>sign[p]).map(p=>sign[p]).join('')+(sign.extra||'');
 // The small icon comes closer to where the sign happens: the eyes or the mouth.
 const view=!pose?'0 0 100 100':sign.mouth&&!sign.eyes?'15 30 70 70':'15 14 70 70';
 return `<svg class="sign-face${pose?' pose':''}" viewBox="${view}" ${label?`role="img" aria-label="${label}"`:'aria-hidden="true"'}>`
  +`<ellipse cx="17" cy="57" rx="4.8" ry="8" fill="#efc197" stroke="#c99a72" stroke-width="1.2"/><ellipse cx="83" cy="57" rx="4.8" ry="8" fill="#efc197" stroke="#c99a72" stroke-width="1.2"/>`
  +`<ellipse cx="50" cy="55" rx="33" ry="39" fill="#f2c9a1" stroke="#c99a72" stroke-width="1.5"/>`
  +`<path d="M17 44 Q16 12 50 11 Q84 12 83 44 Q77 19 50 18 Q23 19 17 44 Z" fill="#4a2d1c"/>`
  +`<ellipse cx="31" cy="63" rx="5" ry="3" fill="#ee9e8c" opacity=".45"/><ellipse cx="69" cy="63" rx="5" ry="3" fill="#ee9e8c" opacity=".45"/>`
  +base+`<g class="sign-n">${before}</g><g class="sign-s">${after}</g></svg>`;
}
