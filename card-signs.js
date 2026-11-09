// Señas: the face each card is signalled with, drawn as an SVG that loops between the
// neutral face and the sign. "Derecho/izquierdo" are the signer's own sides, so the right
// eye or lip corner is drawn on the viewer's left.
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
const INK='#3b2416',LIP='#c4655a';
// The viewer's left is the signer's right.
const RIGHT_X=37,LEFT_X=63;
const eye=x=>`<ellipse cx="${x}" cy="47" rx="3.6" ry="4.4" fill="${INK}"/><circle cx="${x+1.2}" cy="45.6" r="1.1" fill="#fff"/>`;
const wink=x=>`<path d="M${x-5} 47.5 Q${x} 51.5 ${x+5} 47.5" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
const brow=(x,y=37,tilt=0)=>`<path d="M${x-7} ${y+tilt} Q${x} ${y-4} ${x+7} ${y-tilt}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
const nose=`<path d="M50 50 L47 61 Q50 63.5 53 61" fill="none" stroke="#b07a55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const mouth=`<path d="M40 73 Q50 78 60 73" fill="none" stroke="${LIP}" stroke-width="3" stroke-linecap="round"/>`;
// Neutral pieces of the face that each sign replaces, and what it puts in their place.
const PARTS={
 cejas:{n:brow(RIGHT_X)+brow(LEFT_X),s:brow(RIGHT_X,29)+brow(LEFT_X,29)+`<path d="M40 24.5 Q50 22.5 60 24.5 M42 27 Q50 25.5 58 27" fill="none" stroke="#c99a72" stroke-width="1.2" stroke-linecap="round"/>`},
 trompa:{n:mouth,s:`<ellipse cx="50" cy="74" rx="5.5" ry="4.6" fill="${LIP}"/><ellipse cx="50" cy="74" rx="1.8" ry="1.4" fill="#7a2f2a"/>`},
 nariz:{n:nose,s:`<path d="M50 51 L47.5 59 Q50 61 52.5 59" fill="none" stroke="#b07a55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="47" cy="60" rx="1.6" ry="1.2" fill="#8a5636"/><ellipse cx="53" cy="60" rx="1.6" ry="1.2" fill="#8a5636"/><path d="M45 53 l-3 -2 M45 56 l-3.5 -0.5 M55 53 l3 -2 M55 56 l3.5 -0.5" stroke="#b07a55" stroke-width="1.8" stroke-linecap="round"/><path d="M47 49 l3 2.5 l3 -2.5" fill="none" stroke="#b07a55" stroke-width="1.4" stroke-linecap="round"/>`},
 'guino-der':{n:eye(RIGHT_X),s:wink(RIGHT_X)},
 'guino-izq':{n:eye(LEFT_X),s:wink(LEFT_X)},
 'comisura-der':{n:mouth,s:`<path d="M29 68 Q36 76.5 47 76 Q55 75.5 60 73.5" fill="none" stroke="${LIP}" stroke-width="3" stroke-linecap="round"/><path d="M27 65.5 Q26 69 28.5 71.5" fill="none" stroke="#c99a72" stroke-width="1.4" stroke-linecap="round"/>`},
 'comisura-izq':{n:mouth,s:`<path d="M40 73.5 Q45 75.5 53 76 Q64 76.5 71 68" fill="none" stroke="${LIP}" stroke-width="3" stroke-linecap="round"/><path d="M73 65.5 Q74 69 71.5 71.5" fill="none" stroke="#c99a72" stroke-width="1.4" stroke-linecap="round"/>`},
 morder:{n:mouth,s:`<path d="M40 72 Q50 69 60 72" fill="none" stroke="${LIP}" stroke-width="3" stroke-linecap="round"/><rect x="44" y="72" width="12" height="3.6" rx="1" fill="#fff" stroke="#d9d2c4" stroke-width=".6"/><path d="M41 76.5 Q50 79 59 76.5" fill="none" stroke="${LIP}" stroke-width="2.4" stroke-linecap="round"/>`},
 boca:{n:mouth,s:`<ellipse cx="50" cy="75" rx="7.5" ry="7" fill="#5a1e1a" stroke="${LIP}" stroke-width="2.4"/><ellipse cx="50" cy="79" rx="4.5" ry="2.4" fill="#d9776c"/>`},
 lengua:{n:mouth,s:`<path d="M46.5 74 Q46 80.5 50 80.5 Q54 80.5 53.5 74 Z" fill="#e0848b" stroke="#b9555d" stroke-width="1"/><path d="M40 73 Q50 76.5 60 73" fill="none" stroke="${LIP}" stroke-width="3" stroke-linecap="round"/>`}
};
// A face doing the sign. pose: the sign held still (the list icon); otherwise it loops.
export function signFaceSvg(kind,{pose=false,label=''}={}){
 const part=PARTS[kind];if(!part)return '';
 const has=key=>part.n.includes(key);
 const eyes=(kind==='guino-der'?'':eye(RIGHT_X))+(kind==='guino-izq'?'':eye(LEFT_X));
 const base=[kind==='cejas'?'':brow(RIGHT_X)+brow(LEFT_X),eyes,kind==='nariz'?'':nose,has(mouth)?'':mouth].join('');
 return `<svg class="sign-face${pose?' pose':''}" viewBox="0 0 100 100" ${label?`role="img" aria-label="${label}"`:'aria-hidden="true"'}>`
  +`<ellipse cx="50" cy="55" rx="33" ry="39" fill="#f2c9a1" stroke="#c99a72" stroke-width="1.5"/>`
  +`<ellipse cx="17" cy="57" rx="4.5" ry="7.5" fill="#efc197" stroke="#c99a72" stroke-width="1.2"/><ellipse cx="83" cy="57" rx="4.5" ry="7.5" fill="#efc197" stroke="#c99a72" stroke-width="1.2"/>`
  +`<path d="M17 44 Q16 14 50 13 Q84 14 83 44 Q76 20 50 19 Q24 20 17 44 Z" fill="#4a2d1c"/>`
  +`<ellipse cx="33" cy="63" rx="5" ry="3" fill="#ee9e8c" opacity=".45"/><ellipse cx="67" cy="63" rx="5" ry="3" fill="#ee9e8c" opacity=".45"/>`
  +base+`<g class="sign-n">${part.n}</g><g class="sign-s">${part.s}</g></svg>`;
}
