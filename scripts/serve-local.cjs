// Local development: serves the game as static files and forwards /live/* to
// the table server started with `npx wrangler dev` (cloudflare/), WebSockets included.
// Usage: node scripts/serve-local.cjs [port=5174] [liveTarget=127.0.0.1:8787]
const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.argv[2]||5174);
const [liveHost,livePort]=(process.argv[3]||'127.0.0.1:8787').split(':');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json','.txt':'text/plain'};
const hidden=['cloudflare','functions','node_modules','.git','android','ios','www'];
const livePath=url=>url.replace(/^\/live/,'')||'/';

const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/live/')){
  const proxied=http.request({host:liveHost,port:livePort,path:livePath(req.url),method:req.method,headers:req.headers},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});
  proxied.on('error',()=>{res.writeHead(502);res.end('Servidor de mesas apagado. Ejecutá npx wrangler dev en cloudflare/.');});
  req.pipe(proxied);return;
 }
 let file=decodeURIComponent(new URL(req.url,'http://local').pathname);
 if(file.endsWith('/'))file+='index.html';
 const full=path.join(root,file);
 if(!full.startsWith(root+path.sep)||hidden.includes(file.split('/')[1])){res.writeHead(404);res.end();return;}
 fs.readFile(full,(error,data)=>{
  if(error){res.writeHead(404);res.end('No encontrado');return;}
  res.writeHead(200,{'content-type':types[path.extname(full)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
 });
});
// WebSocket upgrade: replay the handshake to the table server and splice the sockets.
server.on('upgrade',(req,socket,head)=>{
 if(!req.url.startsWith('/live/')){socket.destroy();return;}
 const upstream=net.connect(Number(livePort),liveHost,()=>{
  const lines=[`${req.method} ${livePath(req.url)} HTTP/1.1`];
  for(let i=0;i<req.rawHeaders.length;i+=2)lines.push(req.rawHeaders[i]+': '+req.rawHeaders[i+1]);
  upstream.write(lines.join('\r\n')+'\r\n\r\n');if(head?.length)upstream.write(head);
  upstream.pipe(socket);socket.pipe(upstream);
 });
 const close=()=>{upstream.destroy();socket.destroy();};
 upstream.on('error',close);socket.on('error',close);
});
server.listen(port,'localhost',()=>console.log(`Juego en http://localhost:${port} (mesas -> ${liveHost}:${livePort})`));
