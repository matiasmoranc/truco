// Tables and the lobby are created near South American players.
const LOCATION={locationHint:'sam'};
export const lobbyStub=env=>env.LOBBY.get(env.LOBBY.idFromName('global'),LOCATION);
export const tableStub=(env,code)=>env.TABLES.get(env.TABLES.idFromName(code),LOCATION);
