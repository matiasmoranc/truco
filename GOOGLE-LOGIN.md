# Activar cuentas de Google

La primera pantalla pide iniciar sesión con Google. No hay acceso de invitado ni se crean cuentas anónimas nuevas. Si una instalación anterior tiene una cuenta anónima, se vincula a Google para conservar su UID; si Google ya pertenece a otra cuenta, se abre esa cuenta.

Al registrarse, el jugador elige su nombre de usuario antes de entrar al lobby. Se guarda de forma privada en `profiles/{uid}/name`; no se guarda el correo en las mesas. Las siguientes visitas recuperan la sesión con la persistencia local de Firebase cuando el navegador permite almacenamiento. Un nombre previamente guardado para el mismo UID también se puede recuperar si la conexión tarda en responder.

Mi cuenta muestra solamente Cambiar nombre de usuario y Cerrar sesión. El formulario de edición aparece al elegir la primera opción. Cerrar sesión vuelve a la pantalla de Google y no crea una cuenta de invitado.

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

