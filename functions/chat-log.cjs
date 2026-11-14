'use strict';
// A copy of what players type in a table's chat, for the admin panel. Quick messages
// (the chat's hold menu) are left out: they say nothing about the people writing them.
// Entries live under chatLog/{Uruguay day}/{key} and are removed after CHAT_LOG_DAYS.

const CHAT_LOG_DAYS=30;
const QUICK_MESSAGES=['Andate Fernando!','Falta envido y truco!','Buena jugada!','Jajaja','Que suerte','¡Buena mano!','Un segundo','¿Otra partida?'];
const fold=text=>String(text||'').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[¡!¿?.\s]+/g,' ').trim();
const QUICK=new Set(QUICK_MESSAGES.map(fold));
const isQuickMessage=text=>QUICK.has(fold(text));

// Uruguay is UTC-3 all year.
const chatDay=at=>new Date(at-3*3600000).toISOString().slice(0,10);

// {path, value} to store, or null when the message is a quick one or is not usable.
function chatLogRecord({at,code,uid,name,text,mode,id}){
 if(typeof text!=='string'||!text.trim()||!Number.isFinite(at)||isQuickMessage(text))return null;
 const key=at.toString(36).padStart(9,'0')+'-'+String(id||Math.random().toString(36).slice(2,10)).replace(/[.#$/[\]]/g,'_').slice(0,40);
 return {path:'chatLog/'+chatDay(at)+'/'+key,value:{at,code:String(code||''),uid:String(uid||''),name:String(name||'').slice(0,40),text:text.trim().slice(0,200),...(mode==='2v2'?{mode:'2v2'}:{})}};
}

// Newest first, from the stored days ({day:{key:entry}}).
function chatLogList(days,limit=2000){
 const list=[];
 for(const entries of Object.values(days||{}))for(const [key,e] of Object.entries(entries||{}))if(e&&typeof e.text==='string'&&Number.isFinite(e.at))list.push({key,...e});
 return list.sort((a,b)=>b.at-a.at||b.key.localeCompare(a.key)).slice(0,limit);
}

// Groups the messages by the game they were written in, with everyone seated at that table (also those who never wrote).
// matches: the credit ledger's matches ({id, code, mode, players:{seat:{uid,name}}, createdAt, settledAt, closedAt, refundedAt}).
// A message belongs to the game of its table code that was running then; without one, it stays grouped by code and day.
const isBotUid=uid=>typeof uid!=='string'||uid.startsWith('bot:');
function chatLogGroups(messages,matches){
 const byCode={};
 for(const m of Object.values(matches||{}))if(m?.code&&Number.isFinite(m.createdAt))(byCode[m.code]??=[]).push(m);
 for(const list of Object.values(byCode))list.sort((a,b)=>a.createdAt-b.createdAt);
 const groups=new Map();
 for(const msg of [...messages].sort((a,b)=>a.at-b.at)){
  const list=byCode[msg.code]||[];
  // The latest game of that table that had started by then (after a rematch, the new one).
  const match=[...list].reverse().find(m=>m.createdAt<=msg.at)||null;
  // Rematches keep the table code and the people: they stay in the same group.
  const key=match?'table:'+msg.code+':'+Object.values(match.players||{}).map(p=>p?.uid).filter(Boolean).sort().join(','):'code:'+msg.code+':'+chatDay(msg.at);
  if(!groups.has(key)){
   const players=match?Object.entries(match.players||{}).filter(([,p])=>p).sort(([a],[b])=>a.localeCompare(b)).map(([seat,p])=>({seat,uid:p.uid||'',name:p.name||'',bot:isBotUid(p.uid)})):[];
   groups.set(key,{key,code:msg.code,mode:match?.mode||msg.mode||'1v1',startedAt:match?.createdAt||msg.at,games:new Set(),players,messages:[]});
  }
  const g=groups.get(key);g.messages.push(msg);if(match)g.games.add(match.id);
  // Someone who wrote but is not among the seats (an older table) is still listed.
  if(msg.uid&&!g.players.some(p=>p.uid===msg.uid))g.players.push({seat:'',uid:msg.uid,name:msg.name||'',bot:false});
 }
 for(const g of groups.values()){g.lastAt=g.messages.at(-1).at;g.games=g.games.size||1;const wrote=new Set(g.messages.map(m=>m.uid));for(const p of g.players)p.wrote=wrote.has(p.uid);}
 return [...groups.values()].sort((a,b)=>b.lastAt-a.lastAt);
}

module.exports={CHAT_LOG_DAYS,QUICK_MESSAGES,isQuickMessage,chatDay,chatLogRecord,chatLogList,chatLogGroups};
