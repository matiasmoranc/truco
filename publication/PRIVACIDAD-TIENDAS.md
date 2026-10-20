# Inventario para App Privacy y Seguridad de los datos

Revisión de código: 19/10/2026. Es un borrador técnico, no un formulario enviado. La clasificación final debe corresponder a la build y sus SDK y a la configuración de Firebase realmente usada. No declarar que no se recopilan datos.

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

## Primera versión sin anuncios

Se retiró @capacitor-community/admob del paquete y las dependencias. No hay publicidad, UMP, recompensas por anuncios ni solicitud ATT. En Play Console declarar que esta versión no contiene anuncios. Siguen recopilándose datos de cuenta, juego, chat, soporte y actividad. Confirmar Firebase y Google/Apple Sign-In en la build firmada; no declarar ausencia de datos.

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
3. Seleccionar recopilación opcional/obligatoria según el flujo real: autenticación para jugar y chat/reportes voluntarios.
4. Revisar publicidad, público objetivo, clasificación por edad y requisitos de niños antes de habilitar anuncios. No se definió ni implementó una experiencia infantil.
5. Confirmar links HTTPS, prueba de eliminación Google y Apple y atención del correo.

Fuentes oficiales consultadas:
- https://developer.apple.com/app-store/app-privacy-details/
- https://developers.google.com/admob/ios/privacy/data-disclosure
- https://developers.google.com/admob/android/privacy/play-data-disclosure
- https://support.google.com/googleplay/android-developer/answer/10787469
- https://support.google.com/googleplay/android-developer/answer/13327111

## Mesas de cuatro

El estado público incluye equipo y asiento, turnos, cartas jugadas, cantos e indicaciones del pie. El canal privado de cada participante contiene su mano y la de su compañero. La vista de tres segundos es una regla visual; no elimina del dispositivo los datos ya recibidos. Las manos rivales quedan fuera de esos canales. La invitación a WhatsApp es una acción del usuario con un enlace de mesa. Reflejar estas funciones en los formularios aplicables y verificar el binario que se envía.
