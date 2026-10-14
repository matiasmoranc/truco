# Inventario para App Privacy y Seguridad de los datos

Revisión de código: 14/10/2026. Es un borrador técnico, no un formulario enviado. La clasificación final debe corresponder a la build y sus SDK y a la configuración de Firebase/AdMob realmente usada. No declarar que no se recopilan datos.

## Datos del juego

| Dato | Dónde / motivo | Relación con la cuenta | Preparación para formularios |
|---|---|---|---|
| Correo y datos del proveedor | Firebase Authentication, Google/Apple; autenticación | Asociados al UID cuando el proveedor los entrega | Contacto / correo; identificadores de usuario; funcionalidad de la app |
| Nombre elegido y UID | Perfil e índice de nombres | Asociados a la cuenta | Nombre e identificadores; funcionalidad |
| Partidas, resultados y movimientos de créditos | Realtime Database y Functions; operar y validar el juego | Asociados a los jugadores, privados según rama | Actividad/interacciones de la app y datos de juego; revisar categoría aplicable, no son pagos reales |
| Chat y reportes | Partida y problemReports; comunicación y moderación | Remitente e información del rival/reportado | Mensajes dentro de la app / contenido del usuario; funcionalidad, prevención de abuso |
| Bloqueos | userBlocks | Cuenta propietaria y cuenta bloqueada | Actividad/otros datos del usuario; funcionalidad y seguridad |
| Presencia y actividad diaria | adminMetrics | UID y sesiones; estadísticas y conexión | Interacciones/actividad; funcionalidad y análisis de uso interno |
| Solicitudes por correo | Gmail de soporte, cuando la persona escribe | Dirección del remitente y datos que envía | Contacto y contenido enviado a soporte; atención y eliminación |

No se observó integración de Firebase Analytics, Crashlytics, Firebase Storage, cámara, contactos, micrófono ni ubicación GPS en el código auditado. Esto no excluye datos técnicos recogidos por Firebase o SDK terceros. La IP puede usarse para inferir ubicación aproximada.

## Google Mobile Ads / UMP

Está instalado el SDK de AdMob. El modo por defecto es test y usa anuncios oficiales de demostración. Puede empaquetarse con `TRUCO_ADS_MODE=off` para ocultar la función; no significa que se deba ignorar sin inspección todo SDK incluido en el archivo final.

Según la documentación de Google, Mobile Ads procesa IP, interacciones de producto/publicidad, diagnósticos e identificadores del dispositivo/cuenta. Clasificar ubicación aproximada derivada de IP, identificadores, actividad y diagnóstico según sus guías para iOS y Android. Hay terceros (Google), además de los datos almacenados por el juego. No confundir anuncios no personalizados con ausencia de recopilación, compartición o seguimiento.

La futura SSV real enviaría UID y una sesión de recompensa a Google; la demostración actual no envía esa sesión y no concede créditos reales. La función exige firma Google y evita créditos duplicados. No declarar compras: no están implementadas.

UMP obtiene consentimiento cuando corresponde y permite opciones de privacidad. No se solicita ATT en el código del juego. Antes de declarar «no tracking», confirmar las prácticas de los SDK y la configuración real; no añadir un aviso ATT de forma automática sin identificar una actividad que requiera esa autorización.

## Seguridad, eliminación y conservación

- Transporte HTTPS/TLS; autorizaciones por Firebase Auth, reglas RTDB y Functions.
- Cuenta eliminable desde la app con reautenticación. Para Apple se solicita revocación.
- Perfil, reserva de nombre, bloqueos, reportes propios y datos personales de actividad se quitan; registros contables/partidas se anonimizan.
- Se retiene una marca UID/fecha de eliminación para impedir escrituras atrasadas. La política lo explica.
- Actividad diaria: ventana móvil de 30 días; presencia inactiva se limpia.
- Reportes de terceros pueden conservarse mientras se revisa el abuso. No hay plazo de eliminación automático fijado para esos reportes: definir una política operativa y no inventar uno en formularios.
- La nueva página eliminar-cuenta.html ofrece solicitud por correo sin instalar la app; debe desplegarse y el correo debe atenderse. No es un sistema automático de validación/eliminación. El administrador debe comprobar titularidad y la autorización Apple. La eliminación administrativa ahora prepara el mismo trabajo de limpieza/anominización del jugador y usa reintentos programados; requiere desplegar Functions. La revocación Apple iniciada dentro de la app usa un código reciente del usuario; por correo no se dispone de ese código, y ese procedimiento queda por verificar. No marcar el proceso manual de soporte como probado.

## Verificar en las consolas antes de enviar

1. Revisar la versión concreta de todos los SDK y el reporte de privacidad del archivo iOS.
2. Completar finalidades, datos vinculados a identidad y compartición siguiendo las definiciones de cada tienda. Seguridad de los datos distingue compartición y prestadores de servicios; no trasladar respuestas de Apple mecánicamente.
3. Seleccionar recopilación opcional/obligatoria según el flujo real: autenticación para jugar, chat/reportes voluntarios y anuncios voluntarios.
4. Revisar publicidad, público objetivo, clasificación por edad y requisitos de niños antes de habilitar anuncios. No se definió ni implementó una experiencia infantil.
5. Confirmar links HTTPS, prueba de eliminación Google y Apple y atención del correo.

Fuentes oficiales consultadas:
- https://developer.apple.com/app-store/app-privacy-details/
- https://developers.google.com/admob/ios/privacy/data-disclosure
- https://developers.google.com/admob/android/privacy/play-data-disclosure
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://support.google.com/googleplay/android-developer/answer/13327111
