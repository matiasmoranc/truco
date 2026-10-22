# App Android y iPhone (fase de pruebas)

La web continúa publicándose en GitHub Pages. Capacitor empaqueta el mismo juego y sus cartas originales; las cuentas, mesas y créditos usan el mismo Firebase. No se publicó ninguna app en las tiendas.

## Primera versión sin anuncios

Todas las nuevas compilaciones usan TRUCO_ADS_MODE=off. No se incluye el plugin AdMob. Ejecutar npm ci después de actualizar; cap sync actualiza las dependencias nativas y prepare-no-ads.cjs limpia configuración publicitaria anterior. Los proyectos nativos viejos deben volver a sincronizarse; un APK/IPA anterior no representa esta versión. npm run mobile:verify:no-ads verifica el resultado antes de firmar.

## Preparar en Windows

Instalá Node.js 22 o superior y Android Studio. Desde la carpeta del repositorio:

```
git pull --ff-only
npm ci
npm run mobile:build
npm run mobile:add:android
```

El identificador propuesto es `com.matiasmoranc.truco`. Confirmalo antes de registrar las apps en Firebase o Apple. No cambia el nombre público: **Truco Uruguayo**.

## Registrar Android en Firebase

En el proyecto `truco-6553d`, Configuración del proyecto → Tus apps → Agregar app → Android. Usá el identificador de `capacitor.config.json`.

Descargá `google-services.json` y colocalo en `android/app/google-services.json`. Agregá las huellas SHA-1 y SHA-256 del certificado de desarrollo (Android Studio/Gradle `signingReport`) y descargá nuevamente el archivo si Firebase lo modifica. Google requiere estas huellas.

Después:

```
npm run mobile:sync
npm run mobile:open:android
```

Probá en un dispositivo/emulador desde Android Studio. El proyecto Android se genera localmente; no se suben archivos de firma a GitHub.

## iPhone con Xcode local

En Firebase agregá una app iOS con el mismo identificador. Descargá `GoogleService-Info.plist`.

```
npm ci
npm run mobile:build
npm run mobile:add:ios
npm run mobile:open:ios
```

En Xcode agregá `GoogleService-Info.plist` al target App, seleccioná tu equipo de Apple para firmar y habilitá la capacidad **Sign in with Apple** en el identificador de Apple y en Signing & Capabilities. Para Google agregá en Info → URL Types el `REVERSED_CLIENT_ID` del plist. No reemplaces el Service ID del login web.

Se usa Swift Package Manager con el proveedor Google; Apple usa el acceso nativo. La configuración `skipNativeAuth: true` entrega las credenciales a Firebase JavaScript para mantener una única sesión en el juego. No uses popup/redirect web dentro de la app.

## iPhone sin Mac: Codemagic y TestFlight

El archivo `codemagic.yaml` prepara el proyecto iOS desde cero en una Mac de Codemagic. No hay compilaciones automáticas por cada cambio: se inician manualmente. Requiere configurar estos datos antes de ejecutar **Truco Uruguayo - iPhone TestFlight**:

1. Firebase → Configuración del proyecto → Tus apps → Agregar app iOS. Bundle ID: `com.matiasmoranc.truco`. Descargá `GoogleService-Info.plist` con Google habilitado.
2. Convertí ese archivo a Base64 en PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Downloads\GoogleService-Info.plist"))`.
3. En Codemagic → aplicación truco → Environment variables, agregá `GOOGLE_SERVICE_INFO_PLIST_BASE64`, pegá el Base64 como valor, marcá Secret y usá el grupo `truco_ios`.
4. En Apple Developer registrá el identificador explícito `com.matiasmoranc.truco` y habilitá **Sign in with Apple**. Este identificador nativo es distinto del Service ID del login web.
5. En App Store Connect creá la app para ese Bundle ID. Creá una clave API de App Store Connect con permisos para distribución. La clave de Sign in with Apple que usaste para Firebase no reemplaza esta clave.
6. En la integración de Apple Developer Portal de Codemagic agregá esa clave API con el nombre `truco-apple`, Key ID e Issuer ID. Guardá el archivo `.p8` fuera de GitHub.
7. En Code signing identities generá/agregá un certificado Apple Distribution y un perfil App Store para `com.matiasmoranc.truco` que incluya Sign in with Apple.
8. Volvé a la aplicación → rama main → Check for configuration files. Iniciá el workflow cuando estén completos los pasos anteriores.

El workflow sube el archivo firmado a App Store Connect; no solicita revisión pública ni revisión beta externa automáticamente. Tras procesarlo, se asigna a testers internos desde TestFlight. La primera compilación nativa todavía debe verificarse en Codemagic: desde Windows no se puede ejecutar Xcode. El número de build aumenta con `PROJECT_BUILD_NUMBER`; no reinicies su contador después de subir versiones.

## Generar un APK de prueba para Android

Con el proyecto Android que ya usaste en el emulador, ejecutá desde Visual Studio:

```powershell
git pull --ff-only
npm run mobile:apk
```

El comando actualiza el juego, sincroniza Android y compila un APK de desarrollo firmado con el mismo certificado debug de tu computadora. Así mantiene las huellas de Google que ya registraste en Firebase. No borres ni cambies ese certificado.

El archivo queda en `artifacts/truco-uruguayo-prueba.apk`. Pasalo a un Android por USB o Google Drive, abrilo y permití instalar desde esa fuente si Android lo solicita. Para actualizar, generá y enviá nuevamente el APK; se instala sobre la versión anterior si conserva la misma firma. Un APK no se puede instalar en iPhone.

Esta versión usa las cuentas, mesas y créditos reales del Firebase actual. Distribuila inicialmente a tus testers. No es una publicación en Play Store ni una base de datos separada. Antes de compartirla, verificá el inicio de sesión, las cartas, la reconexión y los saldos tras partidas y revanchas.

## Actualizar el código de la app

Después de cambiar el código:

```
npm run mobile:sync
```

Este comando reconstruye y copia el juego a los proyectos nativos existentes. Para comprobar solo el paquete: `npm run mobile:build`. Las cartas se copian sin recomprimir.

Antes de una beta: probar Google y Apple en dispositivos reales, restauración de cuenta, crear/unirse a mesa, desconexión, abandonar, cobro de créditos y revanchas. La compilación web no sustituye esas pruebas. La firma de release, iconos/splash definitivos, privacidad y publicación se preparan después.

## Android firmado para Google Play desde Codemagic

El workflow manual **Truco Uruguayo - Android Google Play (AAB)** genera un AAB firmado. Por ahora se sube a mano a Play Console; la subida automática a la prueba interna está lista en `codemagic.yaml` pero comentada hasta cargar la clave (ver abajo). Antes de ejecutarlo:

1. Crear/verificar Play Console y registrar la app `com.matiasmoranc.truco`.
2. Crear o reutilizar una clave de **carga** para Android, conservar una copia segura y subirla a Codemagic → Code signing identities → Android keystores con referencia `truco_android_upload`. No usar ni subir a Google Play el certificado debug del APK de prueba.
3. En el grupo `truco_android`, guardar `GOOGLE_SERVICES_JSON_BASE64` como secreto. El JSON debe ser de Firebase `truco-6553d`, paquete `com.matiasmoranc.truco`, con cliente OAuth web. Guardar también `ANDROID_VERSION_CODE`: entero positivo mayor que cualquier versionCode ya cargado. Elegir explícitamente cada número; el contador no se comparte con iOS.
4. Ejecutar el workflow desde main. Requiere Android SDK y JDK 21; el proyecto generado usa API 36. Revisar el AAB en artefactos.
5. Subir el AAB a pruebas internas y activar Play App Signing. En Firebase registrar SHA-1 y SHA-256 de **App signing key certificate** que muestra Play Console, además de la clave de carga si se prueba por otra vía. Descargar de nuevo el JSON si cambia. La firma usada al instalar desde Play difiere de la clave de carga; sin estas huellas puede fallar Google.
6. Probar una instalación desde Play. Después iniciar prueba cerrada si la cuenta lo requiere. Ver publication/PUBLICACION.md.

### Subida automática a la prueba interna

Una sola vez, para que Codemagic pueda subir el AAB:

1. Google Cloud Console, proyecto `truco-6553d` → APIs y servicios → Biblioteca → habilitar **Google Play Android Developer API**.
2. IAM y administración → Cuentas de servicio → **Crear cuenta de servicio** (por ejemplo `codemagic-play`), sin roles de Google Cloud. En la cuenta creada: Claves → Agregar clave → JSON. Se descarga un archivo.
3. Play Console → **Usuarios y permisos** → Invitar a un usuario nuevo → el correo de la cuenta de servicio (termina en `iam.gserviceaccount.com`). En **Permisos de la app**, agregar Truco Uruguayo con **Publicar apps en segmentos de prueba** (y ver información de la app). Enviar la invitación.
4. Codemagic → app truco → Environment variables → grupo `truco_android` → variable `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` con **todo el contenido** del JSON, marcada como **Secret**.
5. Borrar el JSON descargado de la PC.
6. En `codemagic.yaml`, descomentar el bloque `publishing:` del workflow `android-play`. Sin la clave cargada, ese bloque hace fallar la build antes de compilar.

Los permisos nuevos de Play Console pueden tardar en activarse. Si la primera subida falla por permisos, esperar y volver a ejecutar. El número de versión lo pone Codemagic (`PROJECT_BUILD_NUMBER`) y siempre crece.

El preparador rechaza credenciales faltantes, versión inválida, proyecto/paquete Firebase incorrectos y falta de cliente Google antes de modificar archivos. Nunca imprime las contraseñas ni las escribe en Gradle: se leen de las variables de firma que entrega Codemagic. No hubo una build firmada Android en el entorno de esta auditoría.

## Verificaciones antes de enviar iOS

El workflow ejecuta las pruebas y verifica el paquete sin anuncios antes de firmar. prepare-ios.py configura cifrado estándar exento y limpia los metadatos publicitarios. Revisar los manifests y el reporte de privacidad de Capacitor, Firebase y Google Sign-In en el IPA real. No se incluye Google Mobile Ads ni UMP.

El proyecto permite iPad: hacen falta pruebas de orientación y capturas de iPad si se conserva ese soporte. No se ha limitado a iPhone ni se han creado capturas artificiales.

## Funciones del juego vigentes (19/10/2026)

El juego incluye 1 vs 1, 2 vs 2, bot y aprendizaje. Consultar REGLAS.md para reparto, mano y pie, privacidad de cartas del compañero y créditos por equipo. Verificar estas modalidades en la build o intervención administrativa correspondiente; no asumir que una actualización de Hosting actualiza las apps instaladas.
