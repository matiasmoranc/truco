import {TableRoom} from './table-room.js';
import {Lobby} from './lobby.js';
import {Bank} from './bank.js';
import {lobbyStub,tableStub,bankStub} from './routing.js';
export {TableRoom,Lobby,Bank};

function originAllowed(request,env){
 const origin=request.headers.get('origin');
 // Native WebViews and server-to-server calls may omit Origin; auth is by token.
 if(!origin||env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).includes(origin))return true;
 return env.DEV_MODE==='1'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/health')return new Response('ok');
  // The fake ledger and dev tokens must never be reachable on a public host.
  if(env.DEV_MODE==='1'&&!['localhost','127.0.0.1'].includes(url.hostname))return new Response('Modo desarrollo solo en localhost.',{status:503});
  if(!originAllowed(request,env))return new Response('Origen no permitido.',{status:403});
  if(url.pathname==='/lobby')return lobbyStub(env).fetch(request);
  // Live balance and daily claim (only while the bank holds the credits).
  if(url.pathname==='/bank')return env.CREDITS_BACKEND==='bank'?bankStub(env).fetch(request):new Response('El banco no está activo.',{status:503});
  const table=/^\/tables\/([A-Z2-9]{5})$/.exec(url.pathname);
  if(table){
   const forwarded=new Request(request);forwarded.headers.set('x-table-code',table[1]);
   return tableStub(env,table[1]).fetch(forwarded);
  }
  // Cloud Functions reading or editing the whole credit ledger in the bank.
  const bank=/^\/internal\/bank\/(status|export|wallet|patch|import|reset|mirror)$/.exec(url.pathname);
  if(bank){
   if(!env.INTERNAL_SECRET||request.headers.get('x-internal-secret')!==env.INTERNAL_SECRET)return new Response('No autorizado.',{status:401});
   if(bank[1]==='status')return Response.json({active:env.CREDITS_BACKEND==='bank'});
   // Reset is for rehearsals: never while the bank holds the credits.
   if(bank[1]==='reset'&&env.CREDITS_BACKEND==='bank')return Response.json({ok:false,error:'El banco está activo.'},{status:409});
   // Export, import, reset and the backup state work before the switch; the rest only while the bank is active.
   if(!['import','export','reset','mirror'].includes(bank[1])&&env.CREDITS_BACKEND!=='bank')return Response.json({ok:false,error:'inactive',code:'inactive'},{status:409});
   return bankStub(env).fetch(new Request('https://bank/'+bank[1]+url.search,{method:request.method,body:request.method==='POST'?await request.text():undefined}));
  }
  // Administrator panel (Cloud Function) closing a live table.
  const admin=/^\/internal\/tables\/([A-Z2-9]{5})\/admin-close$/.exec(url.pathname);
  if(admin&&request.method==='POST'){
   if(!env.INTERNAL_SECRET||request.headers.get('x-internal-secret')!==env.INTERNAL_SECRET)return new Response('No autorizado.',{status:401});
   const forwarded=new Request('https://table/admin-close',{method:'POST',body:await request.text(),headers:{'x-table-code':admin[1]}});
   return tableStub(env,admin[1]).fetch(forwarded);
  }
  return new Response('No encontrado.',{status:404});
 }
};
