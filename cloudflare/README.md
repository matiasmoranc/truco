# Servidor de mesas en vivo (Cloudflare)

Las mesas online, el lobby y las jugadas corren en Cloudflare Durable Objects:
cada mesa es un objeto con su estado en memoria y un WebSocket por jugador.
Una carta, un canto o un mensaje se validan ahí mismo y se envían al instante
a toda la mesa, sin pasar por Cloud Functions ni por la base de Firebase.

Firebase sigue haciendo:

- **Login** (Firebase Auth). El servidor verifica el token de cada jugador.
- **Créditos** (`creditEconomy` en Realtime Database). El servidor los mueve
  solo cuando cambian de verdad: crear mesa, unirse, fin de partida, revancha,
  cancelar o vencer. Usa las mismas funciones de contabilidad que antes
  (`validateAccounting`, `recordHistory`), así que el historial, el panel de
  admin y la eliminación de cuentas siguen funcionando.
- Perfiles, bloqueos, panel de admin, reportes y actividad.

Las reglas del juego son las mismas de siempre (`functions/table-service.cjs`,
`functions/game-referee.cjs`, `functions/team-referee.cjs`).

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/index.js` | Worker: recibe las conexiones y las manda a la mesa o al lobby. |
| `src/table-room.js` | Durable Object de una mesa: sockets, presencia, temporizadores (alarmas). |
| `src/table-engine.js` | Estado de la mesa y cuándo tocar el libro de créditos. Se prueba sin Cloudflare. |
| `src/lobby.js` | Durable Object con la lista de mesas abiertas. |
| `src/firebase.js` | Verificación de tokens y acceso a Realtime Database por REST. |
| `../live-tables.js` | Cliente del navegador / app (WebSocket con reconexión automática). |

## Probar en la PC

```bash
cd cloudflare
npm ci
npx wrangler dev --port 8787
```

y en otra terminal, desde la carpeta del juego:

```bash
npm run dev:web
```

Abrir `http://localhost:5174`. Ese servidor sirve el juego y reenvía `/live`
al servidor de mesas local, así el navegador habla con una sola dirección.

Con `DEV_MODE=1` en `cloudflare/.dev.vars` (no se sube a Git) el servidor local
usa créditos de prueba (100 por jugador) guardados en tu PC y nunca toca la
base real. El login sí es el real de Firebase.

```bash
node test/e2e-local.mjs
```

prueba crear, unirse, jugar, chat y abandonar contra el servidor local.

## Publicar (una sola vez)

1. Crear una cuenta gratis en Cloudflare y, en `cloudflare/`, ejecutar
   `npx wrangler login` (abre el navegador para autorizar).
2. Clave de servicio de Firebase: consola de Firebase → Configuración del
   proyecto → Cuentas de servicio → Generar nueva clave privada. Luego
   `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` y pegar el JSON completo.
   **No subir ese archivo a Git ni compartirlo.** Borrarlo de Descargas después.
3. Secreto interno para que el panel de admin pueda cerrar mesas: generar un
   texto largo al azar y guardarlo en los dos lados con el mismo valor:
   `npx wrangler secret put INTERNAL_SECRET` y
   `firebase functions:secrets:set LIVE_INTERNAL_SECRET`.
4. `npx wrangler deploy`. Muestra la dirección, por ejemplo
   `https://truco-live.TU-CUENTA.workers.dev`.
5. Poner esa dirección en `LIVE_SERVER_URL` de `../live-tables.js` y de
   `../functions/live-server.cjs`.
6. Publicar functions y hosting con el workflow "Deploy Firebase"
   (`functions,hosting`).
7. Generar builds nuevas de Android e iOS: las apps instaladas traen el juego
   empaquetado y siguen usando el sistema anterior hasta actualizarse.

## Convivencia con versiones anteriores

Las Cloud Functions de mesas (`creditCreateTable`, `creditJoinTable`,
`creditTableAction`) siguen publicadas para las apps que todavía no se
actualizaron. Las mesas de una versión no aparecen en el lobby de la otra.
Cuando todas las apps estén actualizadas se pueden borrar esas funciones y los
nodos `rooms` y `hands` de la base.

El cron `creditExpireTables` y la reparación de reservas ignoran las partidas
marcadas `live: 'cloudflare'`; las vence y liquida el propio servidor de mesas.

## Banco de créditos (CREDITS_BACKEND)

`CREDITS_BACKEND` en `wrangler.toml` decide dónde viven los créditos:

- `firebase` (actual): las mesas mueven créditos con una transacción sobre todo
  `creditEconomy` en Realtime Database.
- `bank`: los créditos viven en el Durable Object `Bank` (`src/bank.js`), una
  fila por billetera, recibo, historial y movimiento. Cada paso de una mesa toca
  solo las filas de sus jugadores. La app recibe el saldo y reclama los créditos
  diarios por WebSocket (`/bank`), y las Cloud Functions (admin, historial,
  borrado de cuentas) leen y editan por las rutas internas `/internal/bank/*`
  (con el secreto interno). Ver `functions/credit-store.cjs`.

Las mismas reglas contables (`src/ledger-ops.js`) corren en los dos modos; los
tests comprueban que dejan exactamente la misma contabilidad.

### Migración (con las mesas vacías)

```bash
INTERNAL_SECRET=... node scripts/migrate-credits.mjs verify --url <worker> --key <clave.json>
INTERNAL_SECRET=... node scripts/migrate-credits.mjs import --url <worker> --key <clave.json>
```

`import` se niega si hay partidas en curso o si el banco ya tiene datos, y al
terminar compara rama por rama. Firebase solo se lee: `creditEconomy` queda
como copia congelada para volver atrás.

Para probar el banco en local, `cloudflare/.dev.vars` puede tener
`CREDITS_BACKEND=bank` e `INTERNAL_SECRET=dev-secret`.

### Copia de respaldo

Cada cambio del banco anota sus filas en una cola dentro de la misma escritura
atómica; una alarma las envía a Firebase en `creditBank` (misma forma que
`creditEconomy`) a los 2 segundos, en una sola actualización, y reintenta cada
30 segundos si Firebase no responde. `creditEconomy` no se toca: queda como la
copia congelada de antes del corte. `/internal/bank/mirror` dice si hay cambios
sin enviar, y `/internal/bank/reset` vacía el banco y su respaldo, solo mientras
el banco no está activo (para repetir el ensayo).
