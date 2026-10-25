// Messages between the administrator and a player. The player sees the administrator's
// messages in adminMessages/{uid} (read only) and answers through the playerSocial
// callable; the whole conversation is kept in adminThreads/{uid}/{id} for the panel.
const MAX_TEXT=800;
function cleanText(value){
 const text=typeof value==='string'?value.replace(/\r\n?/g,'\n').trim():'';
 if(!text)throw new Error('Escribí un mensaje.');
 if(text.length>MAX_TEXT)throw new Error('El mensaje puede tener hasta '+MAX_TEXT+' caracteres.');
 return text;
}
const validId=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value);
// What the panel lists: one conversation per player, newest activity first, with how
// many of the player's answers the administrator has not seen yet.
function threadList(threads,names={}){
 return Object.entries(threads||{}).map(([uid,items])=>{
  const messages=Object.entries(items||{}).map(([id,m])=>({id,from:m?.from==='player'?'player':'admin',text:String(m?.text||''),at:Number(m?.at)||0,readAt:Number(m?.readAt)||null,seen:m?.seen!==false,replyTo:m?.replyTo||null})).sort((a,b)=>a.at-b.at);
  return {uid,name:names[uid]||'',messages,unread:messages.filter(m=>m.from==='player'&&!m.seen).length,lastAt:messages.length?messages[messages.length-1].at:0};
 }).filter(t=>t.messages.length).sort((a,b)=>b.lastAt-a.lastAt);
}
// Updates for the administrator's new message to a player.
function sendUpdates({uid,id,text,now,actor}){
 return {[`adminMessages/${uid}/${id}`]:{text,at:now},[`adminThreads/${uid}/${id}`]:{from:'admin',text,at:now,actor}};
}
// The player read a message, optionally answering it.
function answerUpdates({uid,messageId,replyId,text,now}){
 const updates={[`adminMessages/${uid}/${messageId}/readAt`]:now,[`adminThreads/${uid}/${messageId}/readAt`]:now};
 if(text)updates[`adminThreads/${uid}/${replyId}`]={from:'player',text,at:now,replyTo:messageId,seen:false};
 return updates;
}
module.exports={MAX_TEXT,cleanText,validId,threadList,sendUpdates,answerUpdates};
