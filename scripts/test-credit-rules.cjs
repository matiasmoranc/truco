// Run only against an isolated demo RTDB emulator, never a production database.
// firebase emulators:exec --only database --project demo-truco "node scripts/test-credit-rules.cjs"
const assert=require('node:assert/strict');
const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if(!host||!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host)||!String(process.env.GCLOUD_PROJECT||'').startsWith('demo-'))throw new Error('This test requires an isolated local demo Firebase emulator.');
const namespace=process.env.GCLOUD_PROJECT+'-default-rtdb';
const jwt=(uid,provider='google.com')=>{
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 return [encode({alg:'none',typ:'JWT'}),encode({iss:'https://securetoken.google.com/'+process.env.GCLOUD_PROJECT,aud:process.env.GCLOUD_PROJECT,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000),sub:uid,user_id:uid,firebase:{sign_in_provider:provider,identities:{}}}),''].join('.');
};
async function request(path,method,value,token='owner'){
 const url=new URL('http://'+host+'/'+path+'.json');url.searchParams.set('ns',namespace);
 if(token!=='owner')url.searchParams.set('auth',token);
 const response=await fetch(url,{method,headers:{...(token==='owner'?{Authorization:'Bearer owner'}:{}),'Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const body=await response.json();return {status:response.status,body};
}
const grant=()=>({balance:5,locked:0,lastGrantAt:{'.sv':'timestamp'}});
const wallet='creditEconomy/wallets/a';
(async()=>{
 await request('','PUT',{profiles:{a:{name:'Mati'},b:{name:'Ricky'}}});
 const token=jwt('a');
 assert.equal((await request('administrators/a','PUT',true,token)).status,401,'clients cannot grant admin access');
 await request('administrators/a','PUT',true);
 assert.equal((await request('administrators/a','GET',undefined,jwt('b'))).status,401,'admin roster is private');
 await request('userAccess/a','PUT',{blocked:true});
 assert.equal((await request(wallet,'PUT',grant(),token)).status,401,'blocked accounts cannot claim');
 await request('userAccess/a','DELETE');
 const first=await request(wallet,'PUT',grant(),token);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.balance,5);assert.equal(typeof first.body.lastGrantAt,'number');
 assert.equal((await request(wallet,'PUT',grant(),token)).status,401,'no second grant while funded');
 await request(wallet+'/balance','PUT',0);
 assert.equal((await request(wallet,'PUT',grant(),token)).status,401,'no second grant after spending on same day');
 const yesterday=Date.now()-86400000;
 await request(wallet,'PUT',{balance:1,locked:0,lastGrantAt:yesterday});
 assert.equal((await request(wallet,'PUT',grant(),token)).status,401,'remaining one credit prevents grant');
 await request(wallet,'PUT',{balance:0,locked:0,lastGrantAt:yesterday});
 assert.equal((await request(wallet,'PUT',{...grant(),balance:100},token)).status,401,'forged balance rejected');
 assert.equal((await request(wallet,'PUT',{...grant(),lastGrantAt:1},token)).status,401,'forged timestamp rejected');
 assert.equal((await request(wallet,'DELETE',undefined,token)).status,401,'cannot reset wallet by deletion');
 assert.equal((await request(wallet,'GET',undefined,jwt('b'))).status,401,'another user cannot read wallet');
 assert.equal((await request(wallet,'PUT',grant(),jwt('b'))).status,401,'another user cannot fund wallet');
 assert.equal((await request(wallet,'PUT',grant(),jwt('a','anonymous'))).status,401,'anonymous account cannot claim');
 assert.equal((await request(wallet,'PUT',{...grant(),bonus:100},token)).status,401,'unexpected fields rejected');
 assert.equal((await request(wallet,'PUT',grant(),jwt('a','apple.com'))).status,200,'Apple account can claim');
 await request(wallet,'PUT',{balance:0,locked:1,lastGrantAt:yesterday});
 assert.equal((await request(wallet,'PUT',grant(),token)).status,401,'reserved credits prevent daily claim');
 assert.equal((await request('creditEconomy/matches/forged','PUT',{winner:'a'},token)).status,401,'browser cannot pay a winner');
 await request(wallet,'PUT',{balance:0,locked:0,lastGrantAt:yesterday});
 await Promise.all([request(wallet,'PUT',grant(),token),request(wallet,'PUT',grant(),token)]).then(results=>assert.deepEqual(results.map(x=>x.status).sort(),[200,401],'simultaneous claims credit only once'));
 const managed='rooms/ABCDE/public';
 await request(managed,'PUT',{managedCredits:true,status:'started',matchNumber:1,players:{player1:{uid:'a'},player2:{uid:'b'}},scores:{player1:0,player2:0}});
 assert.equal((await request(managed+'/scores/player1','PUT',20,token)).status,401,'client cannot forge a credited winner');
 assert.equal((await request(managed+'/managedCredits','PUT',false,token)).status,401,'client cannot disable server authority');
 assert.equal((await request(managed,'DELETE',undefined,token)).status,401,'client cannot delete a credited table');
 assert.equal((await request('hands/ABCDE/a','PUT',{hand:[]},token)).status,401,'client cannot replace private credited cards');
 assert.equal((await request('creditEconomy/tables/ABCDE','PUT','forged',token)).status,401,'client cannot map tables');
 assert.equal((await request('rooms/BCDEF/public','PUT',{managedCredits:true},token)).status,401,'client cannot create a fake credited table');
 const presence={uid:'a',matchNumber:1,session:'session-a',online:true};
 assert.equal((await request(managed+'/connectionPresence/player1','PUT',presence,token)).status,200,'own presence allowed');
 assert.equal((await request(managed+'/connectionPresence/player2','PUT',{...presence,uid:'b'},token)).status,401,'rival presence cannot be forged');
 assert.equal((await request(managed+'/connectionPresence/player1','PUT',{...presence,online:false,disconnectedAt:{'.sv':'timestamp'}},token)).status,200,'own disconnection server timestamp allowed');
 assert.equal((await request(managed+'/connectionPresence/player1','PUT',{...presence,matchNumber:2},token)).status,401,'wrong match presence denied');
 assert.equal((await request(managed+'/connectionPresence/player1','PUT',{...presence,online:false,disconnectedAt:1},token)).status,401,'backdated presence denied');
 console.log('Firebase emulator: daily grant, balance 1, ownership, forgery, deletion, Apple, reserved funds and simultaneous claims passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
