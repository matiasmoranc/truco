const {test}=require('node:test'),assert=require('node:assert/strict');
const {hasStartedMatch}=require('../functions/match-start.cjs');
test('Waiting and opening-draw cancellations are not played matches',()=>{
 for(const status of ['waiting','refunded'])assert.equal(hasStartedMatch({status,player1:'a'}),false);
 for(const status of ['drawing','closed'])assert.equal(hasStartedMatch({status:'refunded',player2:'b',session:{room:{status,handNumber:0}}}),false);
 assert.equal(hasStartedMatch({player2:'b',status:'reserved',session:{room:{status:'started',handNumber:1}}}),true);
 assert.equal(hasStartedMatch({startedAt:100,status:'refunded',player2:'b'}),true);
 assert.equal(hasStartedMatch({status:'settled',player2:'b'}),true);
});
