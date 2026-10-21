'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {blockedChatReason,normalizeChatText}=require('../chat-moderation.js');
const serverModeration=require('../functions/chat-moderation.cjs');
const {usersBlockEachOther}=require('../functions/user-blocks.cjs');

test('Chat moderation catches accented, case-folded and leetspeak variants',()=>{
 assert.equal(blockedChatReason('¡SOS UN PÉLOTUDO!'),'offensive');
 assert.equal(blockedChatReason('h1j0 de put4'),'offensive');
 assert.equal(blockedChatReason('Te voy a matar'),'threat');
 assert.equal(normalizeChatText('  PÉLOTUDO!!!  '),'pelotudo');
});

test('Chat moderation uses whole words and allows ordinary game messages',()=>{
 for(const text of ['¡Buena mano!','¿Otra partida?','Qué buena jugada','computadora','disputar la mano'])assert.equal(blockedChatReason(text),null,text);
 assert.equal(blockedChatReason('un boludo'),'offensive');
});

test('Browser and server filters stay in sync',()=>{
 for(const text of ['¡Buena mano!','SOS UN PÉLOTUDO','h1j0 de put4','Te voy a matar','computadora'])assert.equal(serverModeration.blockedChatReason(text),blockedChatReason(text),text);
});

test('Blocking either account prevents the pair from joining a future table',async()=>{
 const blocks={'userBlocks/a/b':{blocked:true,name:'Ricky',blockedAt:123},'userBlocks/c/a':true};
 const db={ref:path=>({once:async()=>({val:()=>blocks[path]??null})})};
 assert.equal(await usersBlockEachOther(db,'a','b'),true);
 assert.equal(await usersBlockEachOther(db,'a','c'),true);
 assert.equal(await usersBlockEachOther(db,'b','a'),true);
 assert.equal(await usersBlockEachOther(db,'a','d'),false);
 assert.equal(await usersBlockEachOther(db,'a','a'),false);
});
