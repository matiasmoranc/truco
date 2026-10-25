'use strict';
// Seats filled with "Usar bot" in a 2v2 waiting room. A bot has no wallet: the
// bank covers its stake, so the humans of the winning team still get twice theirs.
const BOT_PREFIX='bot:';
const BOT_NAME='Bot';
// House players host the 1 vs 1 tables the lobby keeps open; they have no wallet
// either: their stake is covered the same way.
const HOUSE_PREFIX='house_';
const isHouseUid=uid=>typeof uid==='string'&&uid.startsWith(HOUSE_PREFIX);
const houseUid=name=>HOUSE_PREFIX+String(name).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,60);
const isBotUid=uid=>typeof uid==='string'&&(uid.startsWith(BOT_PREFIX)||uid.startsWith(HOUSE_PREFIX));
const botPlayer=seat=>({uid:BOT_PREFIX+seat,name:BOT_NAME,online:true,bot:true});
module.exports={BOT_NAME,isBotUid,botPlayer,HOUSE_PREFIX,isHouseUid,houseUid};
