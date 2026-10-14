# Anuncios recompensados

Solo iOS y Android nativos. No se muestran anuncios en la web, al abrir la app
ni durante partidas. El botón está en el panel de créditos con saldo cero y
sin créditos reservados. La recarga diaria gratuita sigue disponible.

## Etapa de prueba

`mobile/rewarded-ads.js` tiene `TEST_ADS = true` y usa unidades oficiales de
demostración. El botón informa que la prueba no agrega créditos al juego. Completar un anuncio suma una unidad a un contador temporal de prueba, separado de la billetera, que se reinicia al cambiar de cuenta o reiniciar la app. No se sincroniza con Firebase ni se puede apostar. AdMob no envía
callbacks SSV con anuncios de prueba; no se acredita dinero virtual desde un
evento del cliente. Probar carga, cierre anticipado, finalización y errores en
dispositivos físicos Android y en TestFlight.

La demostración no llama a `creditPrepareAdReward`: no crea una sesión de
recompensa ni depende de que las nuevas funciones estén desplegadas. Conserva
el consentimiento UMP y no modifica el saldo. Los errores distinguen
consentimiento, inicio del SDK, carga, reproducción y verificación; el detalle
técnico se registra en la consola nativa.

El panel muestra «Ver anuncio» y +1 como diseño de la recompensa prevista,
con una nota visible y etiqueta accesible que aclaran el modo de prueba.
La recarga diaria no muestra cuenta regresiva y conserva su botón tras un
error de publicidad.

Si falla la etapa de consentimiento, revisar en AdMob → Privacidad y mensajes
que el mensaje esté publicado y asociado a la app iOS correcta (ID
`ca-app-pub-9142692584360532~2534067442`) y repetirlo para Android. UMP consulta
el ID de aplicación de Info.plist/AndroidManifest, no la unidad recompensada.
El fallo también puede ser de red; la etapa por sí sola no confirma su causa.
No omitir UMP ni forzar `canRequestAds`. Fuentes:
https://developers.google.com/admob/ios/privacy
https://github.com/capacitor-community/admob/blob/main/docs/consent.md

Instalar con `npm ci`, desplegar `firebase deploy --only functions,hosting` y
ejecutar `npm run mobile:sync` para proyectos nativos existentes. Codemagic
genera iOS y configura el ID de AdMob mediante `scripts/prepare-ios.py`.
Android recibe su ID mediante `scripts/prepare-admob.cjs`. Crear otra build
para TestFlight: un deploy web no actualiza el SDK de una app instalada.

## Antes de anuncios reales

Completar perfil de pagos, vinculación con las tiendas, aprobación de AdMob,
verificación de app-ads.txt y mensajes de consentimiento. El sitio del
desarrollador debe ser https://trucouruguayo.uy para descubrir app-ads.txt.
Confirmar compatibilidad de créditos por anuncios con la mecánica de partidas
y revisar declaraciones de publicidad, privacidad y edad de ambas tiendas.
La lista de 50 SKAdNetwork IDs recomendados por Google está preparada en mobile/skadnetwork-ids.json y se aplica al generar o sincronizar iOS. Revisarla si Google la actualiza o se agrega mediación.

En ambos bloques configurar la URL de verificación del servidor:
https://us-central1-truco-6553d.cloudfunctions.net/admobReward

Después de desplegar `admobReward`, la herramienta «Verificar URL» de AdMob
puede usar ID de usuario `truco-ssv-check` y datos personalizados
`verify-connection-only`. Este diagnóstico exige una firma válida de Google,
responde HTTP 200 y no crea sesiones ni entrega créditos. Usar la URL
verificada y guardar en ambos bloques. No confundir una conexión verificada
con la prueba completa de una recompensa real.
La consola firma algunos valores decodificados, como el nombre «Crédito»;
se admite esa representación solo para este diagnóstico sin saldo. Las
recompensas de partidas mantienen la comprobación del contenido original.

Los nombres desplegados son `creditPrepareAdReward`, `creditAdRewardStatus` y
`admobReward`. El servidor verifica la firma ECDSA con claves oficiales Google,
unidad, importe, usuario, sesión y timestamp. Una transacción atómica registra
la entrega y evita duplicados, incluso con reintentos. No guarda recibos sin
verificar y no acredita a cuentas bloqueadas o eliminadas.

Activar publicidad real requiere una build con `TEST_ADS = false` y establecer
`rewardedAds/liveEnabled = true` desde el servidor o la consola Firebase.
Ese interruptor no está habilitado por este cambio. Las reglas existentes
impiden que un cliente escriba las recompensas o active el interruptor.
La sesión dura 10 minutos; si falla la carga puede reintentarse después de ese
plazo. El crédito puede llegar después de cerrar el anuncio y aparece mediante
la suscripción habitual al saldo. Nunca concederlo desde `Dismissed` o desde
una llamada sin firma del cliente.

## Preparar una primera versión sin anuncios

`TRUCO_ADS_MODE=off npm run mobile:build` empaqueta el juego con el botón y las opciones de anuncios ocultos. El SDK no se inicializa desde la función de publicidad y una llamada al anuncio se rechaza. El valor por defecto es `test`, para mantener las pruebas actuales. Ambos modos conservan intactos los créditos y la recarga diaria. No se habilita `live` mediante esta variable.

En Codemagic, configurar `TRUCO_ADS_MODE` con valor `off` para la build destinada a revisión pública si no está resuelta la recompensa real. Esta alternativa permite terminar la primera publicación sin presentar un botón de recompensa experimental. Aun con los anuncios ocultos, revisar los SDK incluidos y sus datos antes de completar formularios de privacidad.
