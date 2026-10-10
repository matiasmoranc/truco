# App Android y iPhone (fase de pruebas)

La web continúa publicándose en GitHub Pages. Capacitor empaqueta el mismo juego y sus cartas originales; las cuentas, mesas y créditos usan el mismo Firebase. No se publicó ninguna app en las tiendas.

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

## iPhone (requiere una Mac con Xcode)

En Firebase agregá una app iOS con el mismo identificador. Descargá `GoogleService-Info.plist`.

```
npm ci
npm run mobile:build
npm run mobile:add:ios
npm run mobile:open:ios
```

En Xcode agregá `GoogleService-Info.plist` al target App, seleccioná tu equipo de Apple para firmar y habilitá la capacidad **Sign in with Apple** en el identificador de Apple y en Signing & Capabilities. Para Google agregá en Info → URL Types el `REVERSED_CLIENT_ID` del plist. No reemplaces el Service ID del login web.

Se usa Swift Package Manager con el proveedor Google; Apple usa el acceso nativo. La configuración `skipNativeAuth: true` entrega las credenciales a Firebase JavaScript para mantener una única sesión en el juego. No uses popup/redirect web dentro de la app.

## Seguir mejorando el juego

Después de cambiar el código:

```
npm run mobile:sync
```

Este comando reconstruye y copia el juego a los proyectos nativos existentes. Para comprobar solo el paquete: `npm run mobile:build`. Las cartas se copian sin recomprimir.

Antes de una beta: probar Google y Apple en dispositivos reales, restauración de cuenta, crear/unirse a mesa, desconexión, abandonar, cobro de créditos y revanchas. La compilación web no sustituye esas pruebas. La firma de release, iconos/splash definitivos, privacidad y publicación se preparan después.
