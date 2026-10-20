# Plan de publicación — App Store y Google Play

Estado al 14/10/2026: preparación técnica en curso. Ninguna aprobación ni envío público se realizó en esta auditoría.

## Primero: cerrar la versión que se enviará

El juego usa créditos gratuitos; cada participante aporta la misma cantidad; en 1 vs 1 el ganador recibe el pozo y en 2 vs 2 cada ganador recibe la mitad del pozo de cuatro aportes. No hay compras ni canje por dinero/premios. Declarar esa mecánica en reglas, cuestionarios y notas. La versión actual se prepara sin anuncios ni SDK de AdMob; no declarar recompensas publicitarias en su ficha.

La primera versión está fijada sin anuncios. TRUCO_ADS_MODE=off es obligatorio en builds locales y de Codemagic. Se retiró el plugin AdMob y se limpian sus permisos y metadatos. No habilitar anuncios reales ni compras sin otra versión y revisión adicional.

## Apple

1. Confirmar Apple Developer activo, acuerdos requeridos y datos de App Store Connect.
2. App existente: `com.matiasmoranc.truco`; acceso nativo Google y Apple, certificado y perfil con Sign in with Apple.
3. Ejecutar Codemagic desde main. El workflow genera y sube la build según la integración existente; no envía revisión pública automática. Verificar número creciente y resultado de procesamiento.
4. Probar desde TestFlight en iPhone real: Google, Apple, revocación/eliminación, juego, reconexión, chat y créditos. Si se mantiene iPad, probarlo y completar sus capturas.
5. Completar ficha usando FICHAS.md; App Privacy usando PRIVACIDAD-TIENDAS.md; edad declarando apuestas simuladas, chat/mensajería y contenido de usuarios tal como se presenta.
6. Preparar acceso completo del revisor: cuenta compatible o modo completo verificable, instrucciones, backend disponible y forma de probar online sin esperar jugadores desconocidos. Pendiente.
7. Revisar manifests de privacidad del archivo firmado y reporte de Xcode, cifrado, links, permisos y estabilidad. Requisito actual: Xcode 26+ y SDK iOS 26+; el workflow usa latest. No confundir usar latest con haber inspeccionado un IPA nuevo.
8. Seleccionar build, completar campos pendientes y enviar a revisión solo después de cerrar las pruebas.

## Google Play

1. Crear/verificar cuenta de Play Console y sus requisitos de identidad/dispositivo. Tipo y fecha de la cuenta no fueron confirmados.
2. Crear ficha Android con `com.matiasmoranc.truco`.
3. Preparar clave de carga y Play App Signing, grupo truco_android y archivo Firebase. Ver MOBILE.md. Registrar en Firebase SHA-1/SHA-256 de la firma de Play para Google.
4. Ejecutar workflow android-play, descargar AAB firmado, subirlo a pruebas internas e instalar desde Play. No subir APK debug.
5. Completar contenido de la app: privacidad, Seguridad de los datos, publicidad, acceso, clasificación IARC, público objetivo y enlace externo de eliminación. Enviar respuestas que describan la build.
6. Si es cuenta personal creada después del 13/11/2023, iniciar prueba cerrada con al menos 12 testers inscritos continuamente 14 días y pedir acceso a producción. Cumplir el plazo no equivale a aprobación automática.
7. La configuración base de Capacitor 8 usa target/compile SDK 36. Google exige API 36 para nuevas apps/actualizaciones desde el 31/08/2026. Revisar informe previo al lanzamiento, incluido soporte de páginas de memoria de 16 KB en dependencias nativas cuando corresponda.
8. Cerrar fallos, preparar notas y pasar a producción tras revisión.

## Pruebas manuales de salida

| Flujo | Verificación |
|---|---|
| Cuenta | Instalación limpia, Google/Apple, sesión restaurada, nombre repetido, cambio de cuenta |
| Eliminación | Cuenta descartable para cada proveedor, confirmar datos y revocación Apple, reintentar si se corta |
| Mesas | Pública/clave, invitación, saldo insuficiente, espera vencida, salir y reconectar |
| Partidas | Cartas, muestra, flor, envido y declaraciones, truco, pardas, mazo, fin y revancha |
| Créditos | Recarga 5 a saldo 0, una vez por día Uruguay, reservas, ganador, sin duplicar cobros |
| Chat | Mensaje normal, insulto/amenaza filtrado, reporte, bloqueo, salir y desbloquear, revisión admin |
| Build sin anuncios | Sin SDK, permisos ni botones publicitarios; recarga diaria y práctica funcionan |
| Dispositivos | iPhone con notch, Android API 36, texto grande/teclado, iPad si se conserva |
| Backend | Funciones/reglas desplegadas, tiempos y reintegros, borrado programado y reportes atendidos |

La revisión de código no sustituye estas pruebas en instalaciones firmadas. No ejecutar borrado ni cambios de saldo sobre el administrador o Pinar93 para “probar”. Usar cuentas descartables y datos de prueba autorizados.

## Después de publicar

Vincular fichas de ambas tiendas en AdMob, verificar app-ads.txt y esperar revisión de la app publicitaria. Activar publicidad real solo después de resolver recompensa/mecánica y probar SSV firmada completa. Las compras de créditos serían una versión posterior con Apple In-App Purchase/Google Play Billing y una nueva revisión de la mecánica, clasificación y formularios; no están preparadas en esta versión.

Fuentes oficiales (consultadas 14/10/2026):
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.android.com/google/play/requirements/target-sdk
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/9859455
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://support.google.com/admob/answer/7313578
- https://support.google.com/admob/answer/10564477
- https://docs.codemagic.io/yaml-code-signing/signing-android/

## Actualización funcional 19/10/2026

Las descripciones y capturas deben reflejar mesas de 1 vs 1 y 2 vs 2, elección de equipo desde el lobby, reparto sin sorteo y las funciones del compañero descritas en ../REGLAS.md. Publicar Hosting no actualiza los binarios instalados: verificar la build antes de enviar una ficha a las tiendas.
