'use strict';
// Seats filled with "Usar bot" in a 2v2 waiting room. A bot has no wallet: the
// bank covers its stake, so the humans of the winning team still get twice theirs.
const BOT_PREFIX='bot:';
const BOT_NAME='Bot · Difícil';
const isBotUid=uid=>typeof uid==='string'&&uid.startsWith(BOT_PREFIX);
const botPlayer=seat=>({uid:BOT_PREFIX+seat,name:BOT_NAME,online:true,bot:true});
module.exports={BOT_NAME,isBotUid,botPlayer};
