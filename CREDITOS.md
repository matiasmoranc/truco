# Créditos gratuitos — primera etapa

Los créditos son virtuales: no representan pesos, dinero ni premios canjeables.

## Implementado

- Saldo por cuenta de Google o Apple, persistido en Realtime Database.
- Reclamo manual de exactamente 2 créditos, una vez por día de Uruguay (UTC−3).
- Sólo se permite cuando el saldo es 0; tener 1 del día anterior no permite recibir más.
- No se acumulan reclamos de días anteriores.
- Hora validada por Firebase, no por el teléfono. Se rechazan cambios de saldo, timestamps falsos y borrados de la billetera.
- Las transacciones esperan confirmación remota, evitan doble toque y se actualizan entre dispositivos.
- Créditos reservados también bloquean el reclamo: no cuentan como quedarse sin créditos.
- Motor de contabilidad del servidor probado para reservar ambos aportes, entregar el pozo íntegro al ganador, reintegros y revanchas sin cobros o pagos duplicados.

## Activar el saldo y el reclamo

Publicar el archivo completo `firebase.database.rules.json` en Firebase Console → Realtime Database → Rules. No reemplazarlo por sólo la sección de créditos: el archivo conserva las reglas de perfiles, nombres y partidas existentes.

También se puede usar:

```sh
firebase deploy --only database --project truco-6553d
```

Después recargar el juego. No se necesitan Cloud Functions ni cambiar de plan de Firebase para el reclamo diario: lo protege la regla de la base con `now` y `serverTimestamp()`.

Sin las reglas publicadas, el lobby indica que los créditos aún no están habilitados; no inventa un saldo ni bloquea las partidas actuales.

## Antes de activar partidas con créditos

La lógica actual de Truco calcula resultados desde los dispositivos y permite escribir `rooms/public`. No puede usarse como autorización para entregar créditos al ganador: un cliente podría falsear el resultado.

El módulo `server/credit-ledger.cjs` se debe ejecutar únicamente mediante Firebase Admin SDK en un servidor confiable. `commitCreditOperation` cambia las dos billeteras y el recibo de la partida en una sola transacción. No hay un endpoint público que permita declarar un ganador ni un import del módulo en el navegador.

Hace falta integrar un árbitro de partidas del lado del servidor que controle reparto, jugadas, cantos, puntaje, abandono y desconexión. Sólo ese árbitro puede reservar y liquidar los aportes. Cada partida y revancha usa un identificador nuevo; reintentar una operación usa el mismo identificador. Un fallo previo al inicio debe reintegrar ambos aportes.

Por eso esta primera etapa todavía no cobra créditos al crear mesa, no limita las partidas actuales por saldo y no reparte créditos a partir de los resultados del navegador. Tampoco incluye publicidad ni compras.

## Validación

```sh
node --test tests/*.cjs
```

`credits-regression.cjs` prueba el cliente y las expresiones reales del archivo de reglas (reclamos repetidos, saldo 1, medianoche de Uruguay, privacidad y manipulación). `credit-ledger-regression.cjs` verifica reservas, insuficiencia de saldo, pagos, reintegros y revanchas idempotentes.

Las reglas también se compilaron y probaron con el emulador oficial de Firebase: reclamos repetidos y simultáneos, saldo 1, intentos de cambiar el importe, timestamps falsos, borrados, privacidad, cuentas Apple, créditos reservados y escritura de un ganador desde el navegador.

Para repetir esa comprobación aislada (requiere Node y Java 17):

```sh
npx --yes firebase-tools@13 emulators:exec --only database --project demo-truco --config firebase.emulators.json "node scripts/test-credit-rules.cjs"
```

Usar siempre el proyecto `demo-truco`; el script rechaza endpoints que no sean del emulador local.
