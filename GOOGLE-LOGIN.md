# Activar cuentas de Google

La web conserva el invitado de Firebase y lo vincula a Google. Si Google ya pertenece a una cuenta existente, se abre esa cuenta y se carga su apodo. El apodo se guarda de forma privada en `profiles/{uid}/name`; no se guarda el correo en las mesas. El cambio de cuenta se hace desde el lobby.

## Configuración del proyecto truco-6553d

1. En Firebase Console → Authentication → Sign-in method, habilitar Google y elegir el correo de soporte. Mantener Anonymous habilitado.
2. En Authentication → Settings → Authorized domains, agregar `matiasmoranc.github.io`. Para otros dominios de producción, autorizarlos también.
3. En Realtime Database → Rules, publicar el contenido de `firebase.database.rules.json`. También se puede desplegar con Firebase CLI: `firebase deploy --only database --project truco-6553d`.

GitHub Pages publica los archivos web, pero no despliega las reglas ni activa proveedores de Firebase.

## Verificación real antes de anunciar el acceso

- Entrar como invitado, guardar apodo, vincular Google y comprobar que el UID no cambia.
- Cerrar sesión, entrar con el mismo Google y comprobar que vuelve el apodo guardado.
- Entrar desde otro dispositivo con Google y comprobar el apodo.
- Cancelar el popup: el invitado debe seguir pudiendo jugar.
- Probar Safari de iPhone y Chrome de Android; permitir popups si el navegador los bloquea.
- Verificar que un usuario no pueda leer ni escribir el perfil de otro UID.

Apple y Facebook pueden agregarse después vinculándolos al mismo UID. Esta primera versión guarda el apodo; no agrega estadísticas globales ni sustituye la seguridad del motor de partidas.
