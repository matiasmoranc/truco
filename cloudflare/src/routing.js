// Ask Cloudflare to create tables and the lobby near South American players.
// Best effort: Cloudflare currently places these objects in the US (observed ATL/ORD).
const LOCATION={locationHint:'sam'};
export const lobbyStub=env=>env.LOBBY.get(env.LOBBY.idFromName('global'),LOCATION);
export const tableStub=(env,code)=>env.TABLES.get(env.TABLES.idFromName(code),LOCATION);
