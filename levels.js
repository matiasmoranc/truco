// Player levels, shared by the game and the table server. Points are kept in tenths
// (12 = 1,2 points) so they add up exactly.
export const POINTS_SAME_OR_LOWER=10,POINTS_HIGHER=12;
// Points a level asks for: 3 up to level 5, 5 up to 10, 8 up to 20, 12 from 21 on.
export function pointsForLevel(level){return level<=5?30:level<=10?50:level<=20?80:120;}
// The level a total of points reaches, with the progress inside it (all in tenths).
export function levelFor(tenths=0){
 let level=1,left=Math.max(0,Math.floor(Number(tenths)||0));
 while(left>=pointsForLevel(level)){left-=pointsForLevel(level);level++;}
 const need=pointsForLevel(level);
 return {level,points:left,need,progress:left/need};
}
// Beating someone of a higher level is worth more.
export const winPoints=(winnerLevel,rivalLevel)=>rivalLevel>winnerLevel?POINTS_HIGHER:POINTS_SAME_OR_LOWER;
// Total points (tenths) needed to reach a level.
export function pointsToReach(level){let total=0;for(let l=1;l<level;l++)total+=pointsForLevel(l);return total;}
// A house player's icon: one its level has unlocked, picked from its name.
export function houseIcon(name){const level=houseLevel(name),open=ICONS.filter(i=>i.level<=level);let h=7;for(const ch of String(name||''))h=(h*17+ch.charCodeAt(0))>>>0;return open[h%open.length].id;}
// House players (the lobby's open tables) have a fixed level from their name, 2 to 12.
export function houseLevel(name){let h=0;for(const ch of String(name||''))h=(h*31+ch.charCodeAt(0))>>>0;return 2+h%11;}

// Badge by level, drawn over the edge of the profile picture.
export const BADGES=[{level:30,id:'diamante',name:'Insignia de diamante'},{level:20,id:'oro',name:'Insignia de oro'},{level:10,id:'plata',name:'Insignia de plata'},{level:5,id:'bronce',name:'Insignia de bronce'}];
export const badgeFor=level=>BADGES.find(b=>level>=b.level)||null;
// Profile icons and the level that unlocks each; the own photo comes at PHOTO_LEVEL.
export const ICONS=[{id:'persona',level:1,name:'Muñequito'},{id:'mate',level:2,name:'Mate'},{id:'espada',level:3,name:'Ancho de espada'},{id:'bandera',level:4,name:'Bandera'},{id:'gaucho',level:6,name:'Gaucho'},{id:'termo',level:8,name:'Termo'}];
export const PHOTO_LEVEL=10;
// Everything a level unlocks, in order, for the level details.
export function unlocks(){
 return [...ICONS.map(i=>({level:i.level,kind:'icon',id:i.id,name:'Ícono: '+i.name})),...BADGES.map(b=>({level:b.level,kind:'badge',id:b.id,name:b.name})),{level:PHOTO_LEVEL,kind:'photo',id:'photo',name:'Tu foto de perfil'}].sort((a,b)=>a.level-b.level||(a.kind==='badge'?-1:1));
}

// Points each winning person gets for a finished online game: 1 against a rival of the
// same or lower level, 1,2 against a higher one (the highest rival counts in 2 vs 2).
// levels: {uid: total tenths}. House players use their fixed level; table bots count as level 1.
export function levelAwards(match,levels={}){
 if(match?.status!=='settled')return {};
 const room=match.session?.room,players=match.players||{};
 const team=seat=>match.mode==='2v2'?(seat==='player1'||seat==='player3'?'player1':'player2'):seat;
 const winning=match.mode==='2v2'?room?.matchResult?.winner:Object.keys(players).find(p=>players[p]?.uid===match.winner);
 if(!winning)return {};
 const isPerson=uid=>typeof uid==='string'&&!uid.startsWith('bot:')&&!uid.startsWith('house_');
 const levelOf=p=>p.uid?.startsWith('house_')?houseLevel(p.name):p.uid?.startsWith('bot:')?1:levelFor(levels[p.uid]||0).level;
 const rivals=Object.entries(players).filter(([seat,p])=>p&&team(seat)!==team(winning)).map(([,p])=>levelOf(p));
 if(!rivals.length)return {};
 const rival=Math.max(...rivals),out={};
 for(const [seat,p] of Object.entries(players))if(p&&team(seat)===team(winning)&&isPerson(p.uid))out[p.uid]=winPoints(levelFor(levels[p.uid]||0).level,rival);
 return out;
}
