// WebSocket client for the live table server (Cloudflare Durable Objects).
// Each table and the lobby keep one socket open; it reconnects on its own and
// the server pushes every change, so nothing waits on polling.
// Locally, scripts/serve-local.cjs forwards /live to `wrangler dev`.
export const LIVE_SERVER_URL=['localhost','127.0.0.1'].includes(globalThis.location?.hostname)&&!globalThis.trucoNative?.isNative
  ?globalThis.location.origin+'/live'
  :'https://truco-live.mati-moran-castro.workers.dev';

const CALL_TIMEOUT_MS=15000,PING_MS=25000,MAX_BACKOFF_MS=5000;

export class LiveError extends Error{constructor(message,code){super(message);this.code=code||null;}}

class Channel{
  constructor(url,token,onEvent){
    this.url=url;this.token=token;this.onEvent=onEvent;
    this.seq=0;this.pending=new Map();this.outbox=[];this.statusListeners=new Set();
    this.connected=false;this.authed=false;this.closed=false;this.backoff=250;
    this.connect();
  }
  connect(){
    if(this.closed)return;
    const ws=new WebSocket(this.url);this.ws=ws;
    ws.onopen=async()=>{
      let token;
      try{token=await this.token();}catch(error){console.error('[truco:live] token',error);ws.close();return;}
      if(this.ws!==ws)return;
      const id=String(++this.seq);
      this.pending.set(id,{resolve:()=>{this.authed=true;this.backoff=250;this.setConnected(true);},reject:error=>{console.error('[truco:live] auth',error);}});
      ws.send(JSON.stringify({t:'auth',id,token}));this.authSent=true;
      for(const message of this.outbox.splice(0))ws.send(message);
      clearInterval(this.pinger);this.pinger=setInterval(()=>{if(ws.readyState===1)ws.send('ping');},PING_MS);
    };
    ws.onmessage=event=>{
      if(event.data==='pong')return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.t==='res'){
        const call=this.pending.get(message.id);if(!call)return;
        this.pending.delete(message.id);clearTimeout(call.timer);
        if(message.ok)call.resolve(message.data);else call.reject(new LiveError(message.error,message.code));
        return;
      }
      this.onEvent(message);
    };
    ws.onclose=()=>{
      if(this.ws!==ws)return;
      clearInterval(this.pinger);this.authed=false;this.authSent=false;this.setConnected(false);
      for(const [id,call] of this.pending){clearTimeout(call.timer);call.reject(new LiveError('Se perdió la conexión con la mesa.','disconnected'));this.pending.delete(id);}
      if(this.closed)return;
      const wait=this.backoff;this.backoff=Math.min(this.backoff*2,MAX_BACKOFF_MS);
      clearTimeout(this.retry);this.retry=setTimeout(()=>this.connect(),wait);
    };
  }
  // Called when the device comes back online or the app returns to the foreground.
  wake(){
    if(this.closed||(this.ws&&this.ws.readyState<=1))return;
    clearTimeout(this.retry);this.backoff=250;this.connect();
  }
  setConnected(value){if(this.connected===value)return;this.connected=value;for(const listener of this.statusListeners)listener(value);}
  call(t,data={}){
    const id=String(++this.seq),message=JSON.stringify({...data,t,id});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new LiveError('El servidor no respondió. Volvé a intentar.','timeout'));},CALL_TIMEOUT_MS);
      this.pending.set(id,{resolve,reject,timer});
      // Sent right behind auth on the same socket: the server handles messages in order.
      if(this.ws?.readyState===1&&this.authSent)this.ws.send(message);else this.outbox.push(message);
    });
  }
  close(){this.closed=true;clearTimeout(this.retry);clearInterval(this.pinger);this.outbox.length=0;try{this.ws?.close();}catch{}}
}

export function createLiveTables({url=LIVE_SERVER_URL,token}){
  const base=url.replace(/^http/,'ws');
  const tables=new Map();
  let lobby=null;

  function table(code){
    let entry=tables.get(code);
    if(entry)return entry;
    entry={latest:null,listeners:new Set()};
    entry.channel=new Channel(base+'/tables/'+code,token,message=>{
      if(message.t!=='state')return;
      entry.latest={room:message.room,hand:message.hand};
      // Server time minus local time. Network delay only lowers a sample, so keep the highest recent one.
      if(Number.isFinite(message.now)){entry.clockSamples=[...(entry.clockSamples||[]).slice(-9),message.now-Date.now()];entry.clockOffset=Math.max(...entry.clockSamples);}
      for(const listener of entry.listeners)listener(entry.latest);
    });
    tables.set(code,entry);return entry;
  }
  function firstState(entry){
    if(entry.latest)return Promise.resolve(entry.latest);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{entry.listeners.delete(listener);reject(new LiveError('No pudimos conectar la mesa.','timeout'));},CALL_TIMEOUT_MS);
      const listener=latest=>{clearTimeout(timer);entry.listeners.delete(listener);resolve(latest);};
      entry.listeners.add(listener);
    });
  }
  function ensureLobby(){
    if(lobby)return lobby;
    lobby={rooms:null,listeners:new Set(),config:null,configWaiters:[]};
    lobby.channel=new Channel(base+'/lobby',token,message=>{
      if(message.t==='config'){lobby.config=message;for(const resolve of lobby.configWaiters.splice(0))resolve(message);return;}
      if(message.t==='lobby')lobby.rooms=Object.fromEntries(Object.entries(message.rooms||{}).map(([code,room])=>[code,{public:room}]));
      else if(message.t==='lobby-update'){lobby.rooms={...(lobby.rooms||{})};if(message.room)lobby.rooms[message.code]={public:message.room};else delete lobby.rooms[message.code];}
      else return;
      for(const fn of lobby.listeners)fn(lobby.rooms);
    });
    return lobby;
  }
  // Live balance from the credit bank: {watch, get, claim}.
  let bank=null;
  function ensureBank(){
    if(bank)return bank;
    bank={wallet:undefined,listeners:new Set()};
    bank.channel=new Channel(base+'/bank',token,message=>{
      if(message.t!=='wallet')return;
      bank.wallet=message.wallet??null;for(const fn of bank.listeners)fn(bank.wallet);
    });
    return bank;
  }
  function onWake(){for(const entry of tables.values())entry.channel.wake();lobby?.channel.wake();bank?.channel.wake();}
  globalThis.addEventListener?.('online',onWake);
  globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')onWake();});

  return {
    // Room and private hand pushed by the table; returns an unsubscribe function.
    watchTable(code,listener){
      const entry=table(code);entry.listeners.add(listener);
      if(entry.latest)queueMicrotask(()=>{if(entry.listeners.has(listener))listener(entry.latest);});
      return ()=>entry.listeners.delete(listener);
    },
    async readTable(code){return firstState(table(code));},
    onTableConnection(code,listener){const entry=table(code);entry.channel.statusListeners.add(listener);return ()=>entry.channel.statusListeners.delete(listener);},
    tableConnected(code){return !!tables.get(code)?.channel.connected;},
    // Milliseconds to add to Date.now() to get the table server's time (null until it reports).
    clockOffset(code){return tables.get(code)?.clockOffset??null;},
    call(code,t,data){return table(code).channel.call(t,data);},
    closeTable(code){const entry=tables.get(code);if(!entry)return;entry.channel.close();tables.delete(code);},
    closeAllTables(){for(const key of [...tables.keys()])this.closeTable(key);},
    // Open tables as {code:{public:room}}, the shape the lobby renderer reads.
    watchLobby(listener){
      ensureLobby();
      lobby.listeners.add(listener);
      if(lobby.rooms)queueMicrotask(()=>{if(lobby?.listeners.has(listener))listener(lobby.rooms);});
      return ()=>{lobby?.listeners.delete(listener);};
    },
    lobbyRoom(code){return lobby?.rooms?.[code]?.public||null;},
    // Where credits live ('firebase' or 'bank'), as the server reports on connect.
    creditsBackend(){
      const current=ensureLobby();
      return current.config?Promise.resolve(current.config.creditsBackend):new Promise(resolve=>current.configWaiters.push(message=>resolve(message.creditsBackend)));
    },
    wallet:{
      watch(listener,onError){
        const current=ensureBank();current.listeners.add(listener);
        if(current.wallet!==undefined)queueMicrotask(()=>{if(current.listeners.has(listener))listener(current.wallet);});
        return ()=>current.listeners.delete(listener);
      },
      get(){
        const current=ensureBank();
        if(current.wallet!==undefined)return Promise.resolve(current.wallet);
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{current.listeners.delete(listener);reject(new LiveError('No pudimos confirmar tu saldo.','timeout'));},CALL_TIMEOUT_MS);
          const listener=wallet=>{clearTimeout(timer);current.listeners.delete(listener);resolve(wallet);};
          current.listeners.add(listener);
        });
      },
      async claim(){return (await ensureBank().channel.call('claim')).wallet;}
    }
  };
}
