import {TableRoom} from './table-room.js';
import {Lobby} from './lobby.js';
import {lobbyStub,tableStub} from './routing.js';
export {TableRoom,Lobby};

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
  const table=/^\/tables\/([A-Z2-9]{5})$/.exec(url.pathname);
  if(table){
   const forwarded=new Request(request);forwarded.headers.set('x-table-code',table[1]);
   return tableStub(env,table[1]).fetch(forwarded);
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
