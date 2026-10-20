# Primera versión 1.0.0 sin anuncios — preparación de envío

Decisión del titular: publicar primero sin anuncios. Preparación del 14 de octubre de 2026, Uruguay. No equivale a aprobación de las tiendas ni a una build firmada probada.

## Contenido de la versión

- Juego gratuito de truco uruguayo para dos o cuatro jugadores en equipos, práctica contra el bot y aprendizaje.
- Google y Apple según plataforma; sesión y créditos compartidos con la web.
- Recarga gratuita de 5 créditos a saldo cero y sin reservas, una vez por día de Uruguay. En 1 vs 1 el ganador recibe ambos aportes; en 2 vs 2 cada ganador recibe la mitad del pozo de cuatro aportes. Sin compras, retiros ni premios canjeables.
- Chat con filtro, silencio para la partida, reportes y bloqueos persistentes.
- Estadísticas, cuenta, eliminación y páginas públicas de ayuda.
- Sin SDK AdMob, anuncios de prueba/reales, compras ni suscripciones. Las builds rechazan cualquier TRUCO_ADS_MODE distinto de off.

## Comandos de preparación

1. Actualizar main y ejecutar `npm ci` y `npm test`.
2. Ejecutar `npm run mobile:build` y `npm run mobile:verify:no-ads`.
3. Proyecto existente: `npm run mobile:sync`. La limpieza nativa elimina metadatos publicitarios; comprobar el manifiesto Android fusionado y el archivo iOS firmado.
4. iPhone: Codemagic → main → Truco Uruguayo - iPhone TestFlight. Mantener contador creciente. Comprobar procesamiento en App Store Connect y disponibilidad para testers internos. No envía revisión pública.
5. Android: configurar la clave de carga truco_android_upload, Firebase y ANDROID_VERSION_CODE en truco_android; Codemagic → main → Android Google Play (AAB). Subir el AAB a pruebas internas; registrar la firma de Play en Firebase antes de probar Google.

## Material listo para las consolas

- FICHAS.md: descripciones en español, palabras clave y notas para revisión.
- PRIVACIDAD-TIENDAS.md: inventario del juego y SDK de autenticación; no declarar ausencia de recopilación de datos.
- Iconos 512/1024 y gráfico destacado 1024 × 500 en publication/assets.
- Privacidad: https://trucouruguayo.uy/privacidad.html
- Soporte: https://trucouruguayo.uy/soporte.html
- Reglas: https://trucouruguayo.uy/reglas.html
- Eliminación externa: https://trucouruguayo.uy/eliminar-cuenta.html
- Contacto: contacto.trucouruguayo@gmail.com
- Publicidad en Play: esta versión no contiene anuncios. Compras/suscripciones: no implementadas.

## Pendientes que requieren consolas, titular o dispositivos

- Confirmar cuentas de desarrollador, identidad, acuerdos, datos del titular, público objetivo y países. Clasificar la mecánica real de aportes virtuales y chat sin ocultarla en los cuestionarios.
- Verificar certificados Apple, Sign in with Apple y configuración Google. Android necesita clave de carga y Play App Signing confirmados.
- Generar nuevas builds firmadas. No usar builds antiguas con el SDK publicitario ni un APK debug para producción.
- Probar en iPhone y Android reales: acceso, sesión restaurada, créditos, manos, reconexión, abandono sin revancha, silencio/bloqueo/reportes y eliminación con cuentas descartables. Apple requiere comprobar también la revocación.
- Confirmar que un revisor puede acceder a todos los flujos y probar online. Google/Apple login por sí solo no sustituye las instrucciones y el acceso exigido por la revisión. No enviar credenciales de administrador ni inventar un login que la app no admite.
- Obtener capturas reales de la build final, incluidas las de iPad si se mantiene ese soporte. No se fabricaron capturas de una build sin probar.
- Completar App Privacy / Seguridad de los datos, revisar manifests y permisos del binario final y el informe previo al lanzamiento.
- Si la cuenta personal de Play fue creada después del 13/11/2023, cumplir prueba cerrada de 12 testers inscritos continuamente durante 14 días y solicitar acceso a producción.
- Asignar atención del correo, reportes y solicitudes externas de eliminación; comprobar el procedimiento manual con Apple. No está automatizado ni probado por este documento.

## Control del servidor

Mantener `rewardedAds/liveEnabled = false`. Los clientes no pueden modificar esa ruta. Se conservan las funciones y pruebas históricas de recompensas para otro trabajo; esta versión no las llama. No se alteran saldos ni partidas reales para verificar publicidad.

## Comprobaciones antes de pulsar Enviar a revisión

- Versión 1.0.0 correcta, número de build/versionCode mayor que el enviado anteriormente y firma de distribución válida.
- SDK publicitario ausente del binario, no solo oculto en la interfaz.
- Las páginas públicas corresponden a esta versión sin anuncios y sus enlaces funcionan.
- Capturas y textos describen la build enviada; no quedan marcadores de acceso de revisión sin completar.
- Backend disponible, cuenta de prueba y partida online verificadas; atención de soporte confirmada.
- Correcciones probadas y todos los campos obligatorios de las consolas completos.

Fuentes oficiales: https://developer.apple.com/app-store/review/guidelines/ ; https://developer.apple.com/app-store/app-privacy-details/ ; https://support.google.com/googleplay/android-developer/answer/10787469 ; https://support.google.com/googleplay/android-developer/answer/14151465

## Actualización funcional 19/10/2026

Las descripciones y capturas deben reflejar mesas de 1 vs 1 y 2 vs 2, elección de equipo desde el lobby, reparto sin sorteo y las funciones del compañero descritas en ../REGLAS.md. Publicar Hosting no actualiza los binarios instalados: verificar la build antes de enviar una ficha a las tiendas.
