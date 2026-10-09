# Activar cuentas de Google

La primera pantalla pide iniciar sesión con Google. No hay acceso de invitado ni se crean cuentas anónimas nuevas. Si una instalación anterior tiene una cuenta anónima, se vincula a Google para conservar su UID; si Google ya pertenece a otra cuenta, se abre esa cuenta.

Al registrarse, el jugador elige su nombre de usuario antes de entrar al lobby. Se guarda de forma privada en `profiles/{uid}/name`; no se guarda el correo en las mesas. Las siguientes visitas recuperan la sesión con la persistencia local de Firebase cuando el navegador permite almacenamiento. Un nombre previamente guardado para el mismo UID también se puede recuperar si la conexión tarda en responder.

En el encabezado del lobby, tocá tu nombre de usuario y el icono de perfil para abrir Mi cuenta. Mi cuenta muestra solamente Cambiar nombre de usuario y Cerrar sesión. El formulario de edición aparece al elegir la primera opción. Cerrar sesión vuelve a la pantalla de Google y no crea una cuenta de invitado.

## Configuración del proyecto truco-6553d

1. En Firebase Console → Authentication → Sign-in method, habilitar Google y elegir el correo de soporte. Mantener Anonymous habilitado.
2. En Authentication → Settings → Authorized domains, agregar `matiasmoranc.github.io`. Para otros dominios de producción, autorizarlos también.
3. En Realtime Database → Rules, publicar el contenido de `firebase.database.rules.json`. También se puede desplegar con Firebase CLI: `firebase deploy --only database --project truco-6553d`.

GitHub Pages publica los archivos web, pero no despliega las reglas ni activa proveedores de Firebase.

## Verificación real antes de anunciar el acceso

- Abrir la página sin sesión, entrar con Google y comprobar que pide el nombre de usuario antes de entrar al lobby.
- Recargar la página y comprobar que entra sin pedir acceso ni nombre nuevamente.
- Para instalaciones anteriores con cuenta anónima, vincular Google y comprobar que el UID no cambia.
- Cerrar sesión, entrar con el mismo Google y comprobar que vuelve el nombre guardado.
- Entrar desde otro dispositivo con Google y comprobar el apodo.
- Cancelar el popup: debe conservarse la pantalla de acceso, sin permitir entrar al juego.
- Probar Safari de iPhone y Chrome de Android; permitir popups si el navegador los bloquea.
- Verificar que un usuario no pueda leer ni escribir el perfil de otro UID.

Apple y Facebook pueden agregarse después vinculándolos al mismo UID. Esta primera versión guarda el apodo; no agrega estadísticas globales ni sustituye la seguridad del motor de partidas.



## Nombres únicos (actualización del 9 de octubre)

La pantalla de cambio oculta el menú de cuenta. Los nombres nuevos admiten de 1 a 18 letras (incluyendo ñ y acentos), números, guion, guion bajo y punto; no admiten espacios. La reserva usa minúsculas y conserva la escritura elegida para mostrarla.

**La publicación en GitHub Pages no despliega las reglas ni migra los datos de Firebase.** Antes de permitir nuevos registros o cambios:

1. En Realtime Database → Data, exportar una copia privada de la base completa. No subirla a GitHub.
2. Ejecutar `node scripts/build-username-index.cjs database-export.json usernames.json`. Si informa nombres duplicados, resolverlos en los perfiles antes de repetir. No elige un dueño arbitrariamente.
3. En Data, crear/seleccionar exclusivamente el nodo `usernames` e importar allí `usernames.json`. Nunca importar este archivo en la raíz. Hacer esto sin registros/cambios simultáneos; si hubo cambios después de exportar, volver a exportar y generar el índice.
4. En Rules, publicar el contenido completo de `firebase.database.rules.json`.
5. Probar con dos cuentas: un nombre tomado debe rechazar también su versión en mayúsculas. Probar puntos, guiones, espacios y cambiar solamente mayúsculas de un nombre propio.

Los nombres de perfiles anteriores quedan reservados mediante la migración aunque sus dueños no hayan vuelto a entrar. Las nuevas reservas y los cambios de perfil son una actualización atómica: las reglas impiden que dos cuentas reclamen el mismo nombre. Si falta desplegar las reglas, guardar falla y mantiene el nombre anterior.


### Protección mientras se migran los nombres

La aplicación bloquea los cambios y registros de nombres hasta que el administrador termine de reservar los nombres existentes. Después de importar el índice en /usernames y publicar las reglas, crear en la raíz /usernameIndexReady con valor booleano true (no el texto "true"). No activar esa marca antes de completar la migración. Si ya existen duplicados, resolverlos primero: cada nombre debe pertenecer a una única cuenta. El cliente no puede modificar esta marca.

Un cambio correcto muestra "Nombre de usuario cambiado correctamente." durante dos segundos, cierra Mi cuenta y vuelve al lobby.


La ventana de cuenta se cierra con la X (o Escape); tocar el fondo no la descarta. Durante la confirmación de un cambio no puede reabrirse el formulario. Si falla la lectura del índice por permisos, el mensaje identifica que falta habilitar la reserva de nombres en Firebase.
