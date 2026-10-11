'use strict';
function hasStartedMatch(match){
 if(match.startedAt)return true;
 const room=match.session?.room;
 // Compatibility for games saved before startedAt was introduced.
 return !!match.player2&&(match.status==='settled'||(Number(room?.handNumber)>0&&!['waiting','drawing'].includes(room?.status)));
}
module.exports={hasStartedMatch};
