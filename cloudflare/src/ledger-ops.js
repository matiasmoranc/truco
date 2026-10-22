// The accounting step of a table, as a pure function over a ledger. The same
// step runs on the whole Firebase economy or on the bank's rows for one table.
import tableService from '../../functions/table-service.cjs';
import adminService from '../../functions/admin-service.cjs';
import accountingGuard from '../../functions/accounting-guard.cjs';
import historyService from '../../functions/history-service.cjs';

const {createTable,joinTable,tableOperation}=tableService;
const {adminLedgerChange}=adminService;
const {validateAccounting}=accountingGuard;
const {recordHistory}=historyService;

export const ACTIVE=['waiting','reserved'];
export class CodeTakenError extends Error{constructor(){super('code-taken');this.code='code-taken';}}

const OPERATIONS={
 create:(ledger,code,args,now)=>createTable(ledger,{...args,code,now}),
 join:(ledger,code,args,now)=>joinTable(ledger,{...args,code,now}),
 operation:(ledger,code,args,now)=>tableOperation(ledger,{...args,code,now}),
 admin:(ledger,code,args,now)=>adminLedgerChange(ledger,{...args,code,now})
};

// The ledger keeps match receipts for history, admin and account deletion;
// hands, decks and requests stay in the table's Durable Object.
export function slimMatch(m){
 const {session,requests,...rest}=structuredClone(m);
 const room=session?.room;
 return {...rest,live:'cloudflare',...(room?{session:{room:{status:room.status,scores:room.scores||null,matchResult:room.matchResult||null,closeReason:room.closeReason||null,targetPoints:room.targetPoints}}}:{})};
}
const plain=value=>JSON.parse(JSON.stringify(value));

// spec: {code, match (the table's full match, or null when creating), op, args, now}.
// Returns {ledger} to store and {full} for the table, or {closedBy} when the
// ledger already closed the match (administrator) and nothing must change.
export function applyLedgerOp(economy,spec){
 const {code,match,op,args,now}=spec;
 if(!economy)throw new Error('No hay créditos disponibles.');
 if(!Object.hasOwn(OPERATIONS,op))throw new Error('Operación contable inválida.');
 const before=economy,ledger=structuredClone(before);ledger.matches??={};ledger.tables??={};
 if(!match){if(ledger.tables[code])throw new CodeTakenError();}
 else{
  const stored=ledger.matches[match.id];
  if(stored&&!ACTIVE.includes(stored.status)&&ACTIVE.includes(match.status))return {closedBy:stored};
  ledger.matches[match.id]=structuredClone(match);ledger.tables[code]=match.id;
 }
 const next=OPERATIONS[op](ledger,code,args,now),full=next.matches[next.tables[code]];
 const out=structuredClone(next);
 for(const id of new Set([match?.id,full.id].filter(Boolean)))if(out.matches[id])out.matches[id]=slimMatch(out.matches[id]);
 return {full,ledger:validateAccounting(before,recordHistory(before,plain(out),now))};
}

// Rows an operation can read or change, so the bank loads only those.
export function ledgerKeys(spec){
 const uids=new Set();
 for(const person of Object.values(spec.match?.players||{}))if(person?.uid)uids.add(person.uid);
 if(spec.args?.uid)uids.add(spec.args.uid);
 if(spec.match?.player1)uids.add(spec.match.player1);
 const ids=spec.match?.id?[spec.match.id]:[];
 return {wallets:[...uids],matches:ids,history:ids,tables:[spec.code],adminAudit:spec.op==='admin'&&spec.args?.requestId?[spec.args.requestId]:[]};
}
