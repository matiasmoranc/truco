# Panel de administración

URL: https://matiasmoranc.github.io/truco/admin.html

## Activación (una sola vez)
1. Descargá la última versión del proyecto.
2. Desde su carpeta, ejecutá:
   npm ci --prefix functions
   npx firebase-tools deploy --only functions,database --project truco-6553d
3. Abrí admin.html e iniciá sesión con tu cuenta de Google. La página muestra tu UID y deniega acceso hasta que tenga permiso.
4. En Firebase Console → Realtime Database → Datos, agregá un nodo raíz administrators.
5. Dentro, agregá tu UID como clave y el valor booleano true (sin comillas). No uses el apodo ni el correo.
6. Recargá el panel.

Para revocar permisos, eliminá ese UID de administrators. Los permisos se comprueban en el servidor en cada operación; ningún cliente puede otorgárselos.

## Funciones
- Usuarios: nombre, correo, UID, estado y créditos disponibles/reservados. Carga de 100 cuentas por página y búsqueda en las páginas cargadas.
- Editar saldo disponible, sin modificar créditos reservados ni la fecha del último reclamo diario.
- Cambiar nombres con las mismas restricciones y unicidad sin distinguir mayúsculas.
- Bloquear/desbloquear cuentas. No permite bloquear administradores. Reglas y servidor rechazan cuentas bloqueadas incluso con un token anterior.
- Cerrar mesas y devolver apuestas pendientes sin duplicar devoluciones.
- Historial de las últimas 100 modificaciones: autor, motivo y fecha. Cada cambio requiere un motivo.

Si el saldo cambia mientras editabas, actualizá antes de guardar.
Los nombres se reflejan al recargar el juego; no cambian nombres históricos de partidas.
Permite eliminar cuentas sin mesas activas ni créditos reservados, con confirmación del nombre. Elimina Firebase Auth y perfil, libera el nombre y pone el saldo en cero. Conserva historiales de partidas y registros contables. Una nueva inscripción crea otra cuenta.
No incluyas claves de servicio en el repositorio ni en admin.html.

## Estadísticas
Usuarios totales Google/Apple, activos ahora y usuarios únicos diarios. Activos significa juego visible con una señal recibida en los últimos 90 segundos; varias pestañas cuentan como un solo usuario. Horario de Uruguay. Datos por día y hora durante los últimos 30 días, registrados a partir de esta actualización. Los visitantes sin sesión no se cuentan. El panel actualiza usuarios, mesas, historial y métricas cada minuto mientras está visible y no haya una edición abierta. También actualiza al confirmar cada cambio.

Volvé a descargar el proyecto y desplegá functions,database para habilitar playerActivity y activityCleanup. Ninguna estadística histórica anterior se puede reconstruir con precisión.

Los indicadores Activos ahora y Usuarios únicos hoy abren la lista filtrada de cuentas existentes. En Usuarios y créditos se puede volver a mostrar todos. Las filas muestran nombre y saldo, y al desplegarlas aparecen datos y acciones. Para habilitar estos filtros desplegá la función adminConsole después de descargar esta versión.
