// Credit bank kept in Cloudflare (CREDITS_BACKEND=bank). The ledger has the same
// shape as creditEconomy in Firebase, but each wallet, receipt, history and
// movement is its own row, so an accounting step only reads and writes the rows
// of the players at that table.
import accountingGuard from '../../functions/accounting-guard.cjs';
import {applyLedgerOp,ledgerKeys} from './ledger-ops.js';

const {validateAccounting}=accountingGuard;
export const CREDIT_DAY_MS=86400000,URUGUAY_OFFSET_MS=10800000,DAILY_CREDITS=5;
// Branches stored row by row; anything else in an imported ledger is kept whole.
const ROWS={wallets:'w:',matches:'m:',tables:'t:',history:'h:',peaks:'p:',adminAudit:'aa:'};
const MOVEMENTS='mv:',BLOB='b:',VERSION='meta:version';
// Which matches each person played (ids), so one player's history is read without
// reading the whole ledger. Not part of the ledger: not exported nor backed up.
const PLAYER_INDEX='pi:',INDEX_READY='meta:playerIndex';
const matchUids=m=>[...new Set([m?.player1,m?.player2,...Object.values(m?.players||{}).map(p=>p?.uid)])]
 .filter(uid=>typeof uid==='string'&&uid&&!uid.startsWith('bot:')&&!uid.startsWith('house_'));

// Accounting rows that may never be removed (same branches as validateAccounting).
const PROTECTED=[ROWS.wallets,ROWS.matches,ROWS.history,ROWS.peaks,ROWS.adminAudit,MOVEMENTS];
function flatRows(ledger){
 const rows=new Map();
 for(const [branch,prefix] of Object.entries(ROWS))for(const [id,value] of Object.entries(ledger[branch]||{}))rows.set(prefix+id,value);
 for(const [uid,items] of Object.entries(ledger.walletMovements||{}))for(const [id,value] of Object.entries(items||{}))rows.set(MOVEMENTS+uid+':'+id,value);
 for(const [branch,value] of Object.entries(ledger))if(!ROWS[branch]&&branch!=='walletMovements')rows.set(BLOB+branch,value);
 return rows;
}
const dayStart=now=>Math.floor((now-URUGUAY_OFFSET_MS)/CREDIT_DAY_MS)*CREDIT_DAY_MS+URUGUAY_OFFSET_MS;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Same rule the database enforced for the daily grant: only from zero, once per Uruguay day.
export function dailyGrant(wallet,now){
 if(wallet&&(wallet.deleting||wallet.deletedAt))throw new Error('La cuenta fue eliminada.');
 if(wallet&&((wallet.balance??0)!==0||(wallet.locked??0)!==0))throw new Error('Podés reclamar créditos cuando tu saldo llegue a 0.');
 if(wallet&&Number.isFinite(wallet.lastGrantAt)&&wallet.lastGrantAt>=dayStart(now))throw new Error('Ya reclamaste los créditos de hoy.');
 return {...(wallet||{}),balance:DAILY_CREDITS,locked:0,lastGrantAt:now};
}

// store: {get(keys)->Map, put(entries), remove(keys), list(prefix)->Map}. All
// writes of one call go through one put, which the Durable Object makes atomic.
// Firebase path of a bank row, for the backup copy under creditBank.
export function rowPath(key){
 if(key===VERSION)return 'meta/version';
 if(key.startsWith(MOVEMENTS)){const [uid,id]=key.slice(MOVEMENTS.length).split(/:(.*)/s);return 'walletMovements/'+uid+'/'+id;}
 if(key.startsWith(BLOB))return key.slice(BLOB.length);
 const branch=Object.keys(ROWS).find(b=>key.startsWith(ROWS[b]));
 return branch?branch+'/'+key.slice(ROWS[branch].length):null;
}

// beforeCommit(writes,removed) may return extra rows written in the same atomic
// put; the Durable Object uses it to queue the backup copy with every change.
export function createBankCore(store,{newId=()=>crypto.randomUUID(),beforeCommit=null}={}){
 async function commit(writes,removed=[]){
  await indexMatches(writes);
  const extra=beforeCommit?await beforeCommit(writes,removed):null;
  await store.put(extra?{...writes,...extra}:writes,removed);
 }
 // New matches join the index of each person in them, in the same write.
 async function indexMatches(writes){
  const added={};
  for(const [key,m] of Object.entries(writes))if(key.startsWith(ROWS.matches)&&m)for(const uid of matchUids(m))(added[uid]??=new Set()).add(key.slice(ROWS.matches.length));
  const uids=Object.keys(added);if(!uids.length)return;
  const current=await store.get(uids.map(uid=>PLAYER_INDEX+uid));
  for(const uid of uids){
   const ids=current.get(PLAYER_INDEX+uid)||[],fresh=[...added[uid]].filter(id=>!ids.includes(id));
   if(fresh.length)writes[PLAYER_INDEX+uid]=[...ids,...fresh];
  }
 }
 // The first time, the index is built from every match already stored.
 async function ensureIndex(){
  if((await store.get([INDEX_READY])).get(INDEX_READY))return;
  const index={};
  for(const [key,m] of await store.list(ROWS.matches))for(const uid of matchUids(m))(index[PLAYER_INDEX+uid]??=[]).push(key.slice(ROWS.matches.length));
  await store.put({...index,[INDEX_READY]:true});
 }
 // Movement and peak rows, as the creditWalletHistory function used to write them.
 function walletTrail(writes,uid,before,after,at,peak){
  if(!after||after.deletedAt||after.deleting)return;
  const high=Math.max(Number(before?.balance)||0,Number(after.balance)||0);
  writes[ROWS.peaks+uid]={balance:Math.max(peak?.balance||0,high),startedAt:Math.min(peak?.startedAt||at,at)};
  if(before?.balance===after.balance&&before?.locked===after.locked)return;
  writes[MOVEMENTS+uid+':'+at+'_'+newId().slice(0,8)]={at,before:before?.balance||0,after:after.balance,reservedBefore:before?.locked||0,reservedAfter:after.locked};
 }
 async function bump(writes){writes[VERSION]=((await store.get([VERSION])).get(VERSION)||0)+1;}

 async function loadRows(keys){
  const wanted=[];
  for(const [branch,ids] of Object.entries(keys))for(const id of ids)wanted.push(ROWS[branch]+id);
  const found=await store.get(wanted),ledger={};
  for(const [branch,ids] of Object.entries(keys)){
   ledger[branch]={};
   for(const id of ids){const value=found.get(ROWS[branch]+id);if(value!==undefined)ledger[branch][id]=value;}
  }
  return ledger;
 }
 // Rows that changed or appeared between two ledgers (never deletions here).
 function changedRows(before,after){
  const writes={};
  for(const [branch,prefix] of Object.entries(ROWS))for(const [id,value] of Object.entries(after[branch]||{}))if(!same(before[branch]?.[id],value))writes[prefix+id]=value;
  return writes;
 }

 return {
  // One table's accounting step. Returns the full match for the table and the
  // wallets that changed, so the bank can push them to their owners.
  async apply(spec){
   const keys=ledgerKeys(spec),before=await loadRows(keys);
   const result=applyLedgerOp(before,spec);
   if(result.closedBy)return {closedBy:result.closedBy,full:null,wallets:{}};
   const writes=changedRows(before,result.ledger),wallets={};
   const peaks=await loadRows({peaks:Object.keys(result.ledger.wallets||{})});
   for(const [uid,wallet] of Object.entries(result.ledger.wallets||{})){
    if(same(before.wallets[uid],wallet))continue;
    wallets[uid]=wallet;walletTrail(writes,uid,before.wallets[uid],wallet,spec.now,peaks.peaks[uid]);
   }
   await bump(writes);await commit(writes);
   return {full:result.full,closedBy:null,wallets};
  },
  // One player's part of the ledger, in the same shape as the whole one: their
  // wallet, peak, movements, and the matches they played with their history.
  async playerLedger(uid){
   await ensureIndex();
   const ids=(await store.get([PLAYER_INDEX+uid])).get(PLAYER_INDEX+uid)||[];
   const rows=await loadRows({wallets:[uid],peaks:[uid],matches:ids,history:ids});
   const movements={};
   for(const [key,value] of await store.list(MOVEMENTS+uid+':'))movements[key.slice(MOVEMENTS.length+uid.length+1)]=value;
   return {...rows,walletMovements:Object.keys(movements).length?{[uid]:movements}:{}};
  },
  async wallet(uid){return (await store.get([ROWS.wallets+uid])).get(ROWS.wallets+uid)??null;},
  async claim(uid,now){
   const key=ROWS.wallets+uid,rows=await store.get([key,ROWS.peaks+uid]),before=rows.get(key)??null;
   const wallet=dailyGrant(before,now),writes={[key]:wallet};
   walletTrail(writes,uid,before,wallet,now,rows.get(ROWS.peaks+uid));
   await bump(writes);await commit(writes);return wallet;
  },
  // The whole ledger in creditEconomy's shape, for admin, history and backups.
  async exportLedger(){
   const all=await store.list(''),ledger={};let version=0;
   for(const [key,value] of all){
    if(key===VERSION){version=value;continue;}
    if(key.startsWith(MOVEMENTS)){const [uid,id]=key.slice(MOVEMENTS.length).split(/:(.*)/s);((ledger.walletMovements??={})[uid]??={})[id]=value;continue;}
    if(key.startsWith(BLOB)){ledger[key.slice(BLOB.length)]=value;continue;}
    const branch=Object.keys(ROWS).find(b=>key.startsWith(ROWS[b]));
    if(branch)(ledger[branch]??={})[key.slice(ROWS[branch].length)]=value;
   }
   return {version,ledger};
  },
  // Administrator and account-deletion steps still edit the whole ledger:
  // they send it back with the version they read, and lose if it changed.
  async replace(version,next,{allowEmpty=false,trail=true}={}){
   const current=await this.exportLedger();
   if(current.version!==version)throw Object.assign(new Error('Los créditos cambiaron. Volvé a intentar.'),{code:'version'});
   if(!allowEmpty)validateAccounting(current.ledger,next);
   const writes={},removed=[];
   const old=flatRows(current.ledger),fresh=flatRows(JSON.parse(JSON.stringify(next)));
   for(const [key,value] of fresh)if(!same(old.get(key),value))writes[key]=value;
   for(const key of old.keys())if(!fresh.has(key))removed.push(key);
   for(const [uid,wallet] of Object.entries(next.wallets||{})){
    const before=current.ledger.wallets?.[uid];
    if(trail&&!same(before,wallet))walletTrail(writes,uid,before,wallet,Date.now(),fresh.get(ROWS.peaks+uid)??current.ledger.peaks?.[uid]);
   }
   writes[VERSION]=version+1;
   await commit(writes,removed);
   const wallets={};for(const [uid,wallet] of Object.entries(next.wallets||{}))if(!same(current.ledger.wallets?.[uid],wallet))wallets[uid]=wallet;
   return {version:version+1,wallets};
  },
  // Administrator and account-deletion steps edit a ledger they exported. Only the
  // rows they changed are written, and only if those rows still match what they
  // read; games at other tables meanwhile do not make the edit fail.
  async patch(base,next){
   const old=flatRows(base),fresh=flatRows(JSON.parse(JSON.stringify(next)));
   const keys=new Set();
   for(const [key,value] of fresh)if(!same(old.get(key),value))keys.add(key);
   for(const key of old.keys())if(!fresh.has(key))keys.add(key);
   if(!keys.size)return {wallets:{}};
   const current=await store.get([...keys]);
   for(const key of keys)if(!same(current.get(key),old.get(key)))throw Object.assign(new Error('Los créditos cambiaron. Volvé a intentar.'),{code:'conflict'});
   for(const key of keys)if(!fresh.has(key)&&PROTECTED.some(prefix=>key.startsWith(prefix)))throw new Error('Se bloqueó la eliminación contable: '+key);
   const writes={},removed=[],wallets={},changedWallets=[...keys].filter(k=>k.startsWith(ROWS.wallets)&&fresh.has(k));
   for(const key of keys)if(fresh.has(key))writes[key]=fresh.get(key);else removed.push(key);
   for(const [uid,wallet] of Object.entries(validateAccounting({wallets:{}},{wallets:Object.fromEntries(changedWallets.map(k=>[k.slice(ROWS.wallets.length),fresh.get(k)]))}).wallets)){
    wallets[uid]=wallet;walletTrail(writes,uid,old.get(ROWS.wallets+uid),wallet,Date.now(),fresh.get(ROWS.peaks+uid)??old.get(ROWS.peaks+uid));
   }
   await bump(writes);await commit(writes,removed);
   return {wallets};
  },
  // One-time copy from Firebase. Refuses to overwrite a bank that is in use.
  async importLedger(ledger){
   const current=await this.exportLedger();
   if(current.version!==0)throw new Error('El banco ya tiene datos.');
   return this.replace(0,ledger,{allowEmpty:true,trail:false});
  }
 };
}
