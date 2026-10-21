'use strict';
async function usersBlockEachOther(db,uid,peerUid){
 if(!uid||!peerUid||uid===peerUid)return false;
 const [own,peer]=await Promise.all([
  db.ref(`userBlocks/${uid}/${peerUid}`).once('value'),
  db.ref(`userBlocks/${peerUid}/${uid}`).once('value')
 ]);
 const isBlocked=value=>value===true||value?.blocked===true;
 return isBlocked(own.val())||isBlocked(peer.val());
}
module.exports={usersBlockEachOther};
