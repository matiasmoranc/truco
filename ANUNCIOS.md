# Anuncios recompensados

Solo iOS y Android nativos. No se muestran anuncios en la web, al abrir la app
ni durante partidas. El botón está en el panel de créditos con saldo cero y
sin créditos reservados. La recarga diaria gratuita sigue disponible.

## Etapa de prueba

`mobile/rewarded-ads.js` tiene `TEST_ADS = true` y usa unidades oficiales de
demostración. El botón informa que la prueba no agrega créditos. AdMob no envía
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
Completar los SKAdNetwork IDs recomendados por Google para la publicación.

En ambos bloques configurar la URL de verificación del servidor:
https://us-central1-truco-6553d.cloudfunctions.net/admobReward

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
