# Mesas con créditos gratuitos

Los créditos son virtuales, sin dinero ni premios canjeables. No hay compras ni publicidad.

## Funcionamiento

- Reclamo manual de 5 créditos por día de Uruguay (UTC−3), sólo con saldo 0 y sin créditos reservados. Tener 1 crédito no permite reclamar otros 2.
- El creador elige una apuesta entera de 1 o más, dentro de su saldo disponible, y una mesa pública o con clave de 4 a 64 caracteres.
- La apuesta del creador se reserva al crear la mesa. El rival debe tener al menos ese monto disponible y aporta exactamente lo mismo. Sus saldos totales pueden ser diferentes.
- El ganador recibe ambas apuestas, sin descuento. La revancha necesita saldo suficiente de ambos y usa un recibo nuevo.
- Cancelar la espera devuelve la apuesta. Una mesa sin rival vence a los 10 minutos. Si no se completa el sorteo en 30 segundos, se devuelven ambos aportes.
- Durante el partido, el árbitro aplica los tiempos de inactividad y la desconexión con 45 segundos de gracia. El cierre de la pantalla de resultado envía a ambos al lobby.
- Bot y aprendizaje siguen sin usar créditos.

## Activar las mesas

Publicar las reglas habilita el saldo y el reclamo diario, pero las apuestas necesitan además las funciones del servidor. Firebase requiere el plan Blaze para desplegar Cloud Functions. La cuenta de Firebase usada por la CLI debe tener permiso para desplegar en `truco-6553d`.

Desde una copia actualizada del repositorio, con Node.js 22:

```sh
npm ci --prefix functions
npx firebase-tools login
npx firebase-tools deploy --only functions,database --project truco-6553d
```

Esto publica el archivo completo `firebase.database.rules.json` y estas funciones en `us-central1`:

- `creditCreateTable`: valida el saldo y reserva la apuesta del creador.
- `creditJoinTable`: verifica clave, lugar y saldo; reserva el aporte del rival.
- `creditTableAction`: aplica jugadas, cantos, mensajes, tiempos y revanchas desde el servidor.
- `creditExpireTables`: avanza tiempos y devuelve reservas aunque ningún navegador siga abierto.

El código de GitHub Pages se publica por separado mediante el flujo existente. Si las funciones no están desplegadas, el navegador no inventa una reserva ni una acreditación.

## Autoridad y privacidad

`functions/game-referee.cjs` ejecuta en el servidor las mismas reglas probadas del juego. `scripts/build-credit-referee.cjs` lo genera desde las funciones compartidas de `app.js` y los archivos `functions/referee-*.cjs`. Regenerarlo después de cambiar esas reglas.

`creditEconomy` conserva recibos y partidas privadas. Las billeteras y el recibo cambian juntos mediante una transacción. Repetir una entrada, jugada o resultado no duplica cargos ni pagos. El navegador no puede escribir ganadores, cambiar cartas privadas ni quitar `managedCredits`. Sólo puede actualizar su propia presencia y reclamar el aporte diario protegido por las reglas.

La clave se guarda únicamente como hash con sal aleatoria. La lista pública contiene el monto y la indicación «Con clave», nunca la clave, el hash, el mazo ni las manos privadas. Cada jugador sólo lee sus propias cartas hasta que se revelan al final de la mano.

## Validación

```sh
node --test tests/*.cjs
node scripts/build-credit-referee.cjs
npm ci --prefix functions
npx firebase-tools@13 emulators:exec --only database --project demo-truco --config firebase.emulators.json "node scripts/test-credit-rules.cjs && node scripts/test-credit-functions.cjs"
```

Los tests verifican saldos insuficientes, claves incorrectas, entradas simultáneas, reintegros, pagos únicos, revanchas, cartas falsas, turnos, truco no querido, empate de envido, desconexiones y privacidad. Las últimas dos suites usan exclusivamente un proyecto `demo-` aislado en el emulador; nunca modifican producción.
