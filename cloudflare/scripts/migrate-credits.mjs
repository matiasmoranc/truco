// Copies creditEconomy from Firebase into the Cloudflare credit bank and checks
// that both hold exactly the same accounting. Read-only for Firebase.
//
//   INTERNAL_SECRET=... node scripts/migrate-credits.mjs verify --url <worker> --key <service-account.json>
//   INTERNAL_SECRET=... node scripts/migrate-credits.mjs import --url <worker> --key <service-account.json>
//
// import refuses while any match is waiting or in play, and refuses a bank that
// already has data; verify only compares and reports.
import fs from 'node:fs';
import {createDatabase} from '../src/firebase.js';

const [command,...rest]=process.argv.slice(2);
const option=name=>{const i=rest.indexOf('--'+name);return i>=0?rest[i+1]:null;};
const url=(option('url')||'').replace(/\/$/,''),keyFile=option('key'),secret=process.env.INTERNAL_SECRET;
if(!['verify','import'].includes(command)||!url||!keyFile||!secret){
 console.error('Uso: INTERNAL_SECRET=... node scripts/migrate-credits.mjs verify|import --url <worker> --key <clave.json>');process.exit(2);
}

const db=createDatabase({FIREBASE_SERVICE_ACCOUNT:fs.readFileSync(keyFile,'utf8'),FIREBASE_DATABASE_URL:'https://truco-6553d-default-rtdb.firebaseio.com'});
async function bank(path,body){
 const res=await fetch(url+'/internal/bank/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-internal-secret':secret},body:body&&JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(path+': '+(data.error||res.status));return data;
}
// Firebase omits nulls and empty objects; compare both sides the same way.
const normalize=value=>JSON.parse(JSON.stringify(value??{},(k,v)=>v===null||(v&&typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length)?undefined:v))??{};
const credits=ledger=>Object.values(ledger.wallets||{}).reduce((n,w)=>n+(w.balance||0)+(w.locked||0),0);
function summary(label,ledger){
 console.log(label.padEnd(10),'billeteras',Object.keys(ledger.wallets||{}).length,'créditos',credits(ledger),'reservados',Object.values(ledger.wallets||{}).reduce((n,w)=>n+(w.locked||0),0),
  'partidas',Object.keys(ledger.matches||{}).length,'ramas',Object.keys(ledger).sort().join(','));
}
function differences(a,b,path='',out=[]){
 if(JSON.stringify(a)===JSON.stringify(b))return out;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[key],b[key],path+'/'+key,out);return out;}
 out.push(path||'/');return out;
}

const source=normalize(await db.get('creditEconomy'));
summary('Firebase',source);
if(command==='import'){
 const active=Object.values(source.matches||{}).filter(m=>['waiting','reserved'].includes(m.status));
 if(active.length){console.error('Hay '+active.length+' partidas en curso. Esperá a que terminen.');process.exit(1);}
 const done=await bank('import',{ledger:source});
 console.log('Importado. Versión del banco:',done.version);
}
const {ledger,version}=await bank('export');
const copy=normalize(ledger);
summary('Banco v'+version,copy);
const diff=differences(source,copy);
if(diff.length){console.error('DIFERENCIAS ('+diff.length+'):');for(const path of diff.slice(0,30))console.error('  '+path);process.exit(1);}
console.log('OK: el banco y Firebase tienen exactamente la misma contabilidad.');
