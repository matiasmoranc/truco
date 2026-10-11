const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require('node:path').join(__dirname,'../scorer.js'),'utf8')).toString('base64'));
test('Scorekeeper preserves scores before 24 hours and expires without reloading',async()=>{
 const {installScorer}=await modulePromise;let time=100000000,stored=null;
 const elements={};const node=id=>elements[id]??=( {hidden:false,disabled:false,innerHTML:'',textContent:'',classList:{toggle(){},contains(){return false;}},setAttribute(){},addEventListener(type,fn){this[type]=fn;}} );
 const target={...node('target'),dataset:{scorerTarget:'10'}};
 const document={visibilityState:'hidden',getElementById:node,querySelectorAll:()=>[target],addEventListener(){}};
 const storage={getItem:()=>stored,setItem:(_key,value)=>stored=value,removeItem:()=>stored=null};
 const options={document,storage,now:()=>time,showView(){},renderTally:String};
 installScorer(options);target.click();node('scorer-add-0').click();
 time+=86400000-1;installScorer(options);node('open-scorer').click();
 assert.equal(node('scorer-tally-0').innerHTML,'1');assert.equal(node('scorer-setup').hidden,true);
 time++;node('open-scorer').click();assert.equal(node('scorer-setup').hidden,false);
 assert.equal(node('scorer-status').textContent,'¿A cuántos puntos jugamos?');assert.equal(JSON.parse(stored),null);
});
