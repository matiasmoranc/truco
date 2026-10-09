# Activar cuentas de Google y Apple

La primera pantalla pide iniciar sesión con Google o Apple. Apple se muestra solamente en dispositivos Apple. No hay acceso de invitado ni se crean cuentas anónimas nuevas. Si una instalación anterior tiene una cuenta anónima, se vincula a Google para conservar su UID; si Google ya pertenece a otra cuenta, se abre esa cuenta.

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

Facebook puede agregarse después. Las identidades de Apple y Google no se vinculan automáticamente. Esta primera versión guarda el apodo; no agrega estadísticas globales ni sustituye la seguridad del motor de partidas.



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


## Activar Apple (web)

El código ya usa Firebase OAuthProvider('apple.com') con email/name y locale es. Se muestra en iPhone, iPad (incluido el modo escritorio) y Mac. No se crean usuarios invitados. La sesión utiliza la persistencia existente y el perfil usa el mismo UID autenticado que las reservas de nombres. Apple puede ocultar el correo; se pide el nombre de usuario del juego por separado. No se asocian automáticamente cuentas Apple/Google ni sus correos.

La publicación en Pages no activa el proveedor. Se necesita pertenecer al Apple Developer Program para configurar Sign in with Apple:

1. En Apple Developer → Certificates, Identifiers & Profiles, registrar un App ID propio y habilitar Sign in with Apple.
2. Registrar un Services ID para el acceso web y asociarlo al App ID. Ejemplo de identificador: com.matiasmoranc.truco.web (debe estar disponible y pertenecer a tu cuenta).
3. En su configuración web, registrar el dominio truco-6553d.firebaseapp.com y el sitio matiasmoranc.github.io. Return URL: https://truco-6553d.firebaseapp.com/__/auth/handler. Confirmar esta URL con la que muestra Firebase si se cambia el authDomain.
4. Crear una clave con Sign in with Apple. Anotar Team ID y Key ID, y descargar el archivo .p8.
5. En Firebase → Authentication → Sign-in method → Apple, habilitar y cargar Services ID, Team ID, Key ID y la clave privada .p8. Esa clave se carga únicamente en Firebase: no subirla al repositorio ni incluirla en el JavaScript.
6. Guardar y probar en un iPhone/iPad y una Mac: entrar, elegir nombre único, recargar, cerrar sesión y volver a entrar. Comprobar cancelación, ventanas bloqueadas y Ocultar mi correo. En Windows/Android el botón no debe aparecer.

El flujo web abre una ventana de Apple a través del SDK de Firebase; la autenticación real requiere completar los pasos anteriores. No se ha verificado una cuenta Apple real todavía. Las reglas de RTDB actuales validan por UID y no necesitan un cambio por este proveedor.

Documentación oficial: https://firebase.google.com/docs/auth/web/apple
