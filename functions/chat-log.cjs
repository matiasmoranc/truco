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

module.exports={CHAT_LOG_DAYS,QUICK_MESSAGES,isQuickMessage,chatDay,chatLogRecord,chatLogList};
