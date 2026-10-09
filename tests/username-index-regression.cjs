const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildIndex}=require('../scripts/build-username-index.cjs');
test('Migration reserves old usernames and escapes every period',()=>{
 const result=buildIndex({profiles:{one:{name:'Mati.A.B'},two:{name:'Ñandu'}}});
 assert.deepEqual(result.index,{'mati%2Ea%2Eb':'one','ñandu':'two'});assert.equal(result.conflicts.length,0);
});
test('Migration reports case-insensitive duplicates instead of overwriting owners',()=>{
 const result=buildIndex({usernames:{mati:'one'},profiles:{one:{name:'Mati'},two:{name:'MATI'}}});
 assert.equal(result.index.mati,'one');assert.equal(result.conflicts.length,1);
});
