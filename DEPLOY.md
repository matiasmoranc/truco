# Deploy desde GitHub Actions

El workflow **Deploy Firebase** publica el commit seleccionado de `main` con
**Actions → Deploy Firebase → Run workflow**. Por defecto publica funciones y
Hosting. La opción que incluye `database` también publica las reglas existentes.
No compila ni envía una nueva app a las tiendas: TestFlight usa Codemagic.

El workflow se ejecuta manualmente, prueba el juego y el contenido móvil antes
de obtener credenciales temporales y serializa despliegues. No usa una clave
privada JSON ni un token de sesión personal. Las versiones de las Actions están
fijadas a commits. Firebase CLI está fijado a 15.33.0.

## Configuración inicial en Google Cloud

Proyecto: `truco-6553d`. Se hace desde la consola web, sin instalar programas.

1. Crear una cuenta de servicio con ID `github-firebase-deploy` en IAM y
   administración → Cuentas de servicio. No crear claves.
2. Darle permisos de despliegue para los servicios utilizados en este proyecto:
   Firebase Hosting Admin (`roles/firebasehosting.admin`), Cloud Functions Admin
   (`roles/cloudfunctions.admin`), Cloud Run Admin (`roles/run.admin`), Cloud
   Scheduler Admin (`roles/cloudscheduler.admin`), Eventarc Admin
   (`roles/eventarc.admin`) y Service Usage Consumer
   (`roles/serviceusage.serviceUsageConsumer`). Para desplegar reglas de RTDB,
   agregar Firebase Realtime Database Admin (`roles/firebasedatabase.admin`).
   Revisar los permisos reportados por Firebase si el proyecto usa recursos o
   cuentas de compilación adicionales; no agregar Owner o Editor como solución.
3. Darle Service Account User (`roles/iam.serviceAccountUser`) sobre las cuentas
   usadas por las funciones y Cloud Build de este proyecto; incluye las cuentas
   de ejecución predeterminadas de App Engine y Compute cuando correspondan.
   Esto permite desplegar código que se ejecutará con sus permisos; restringir
   la asignación a las cuentas que realmente utiliza Firebase.
4. Habilitar IAM, Resource Manager, Service Account Credentials y Security Token
   Service APIs si no están habilitadas. Las APIs de Firebase/Functions/Run,
   Build, Artifact Registry, Scheduler y Eventarc utilizadas para desplegar
   también deben estar habilitadas por el administrador del proyecto.
5. En IAM → Workload Identity Federation crear un pool con ID `github-truco`
   y un proveedor OIDC con ID `github`. Issuer:
   `https://token.actions.githubusercontent.com`. Usar la audiencia predeterminada.
6. Mapear `google.subject = assertion.sub`,
   `attribute.repository_id = assertion.repository_id` y
   `attribute.repository_owner_id = assertion.repository_owner_id`.
7. Configurar esta condición del proveedor:

   ```text
   assertion.repository_owner_id == '83555127' && assertion.repository_id == '1393751553' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'matiasmoranc/truco/.github/workflows/firebase-deploy.yml@refs/heads/main'
   ```

8. En el pool, otorgar acceso a la cuenta
   `github-firebase-deploy@truco-6553d.iam.gserviceaccount.com` seleccionando las
   identidades con `attribute.repository_id = 1393751553`. Esto agrega
   Workload Identity User (`roles/iam.workloadIdentityUser`) a la cuenta de
   servicio para ese principal del pool. La condición del proveedor limita
   además el propietario, rama y workflow permitidos.
9. Copiar el nombre completo del proveedor:
   `projects/NUMERO_PROYECTO/locations/global/workloadIdentityPools/github-truco/providers/github`.
   Se usa el **número**, no el ID `truco-6553d`.

## Variable en GitHub

Settings → Secrets and variables → Actions → Variables → New repository variable:

- Nombre: `GCP_WORKLOAD_IDENTITY_PROVIDER`
- Valor: el nombre completo del proveedor del paso anterior.

No es un secreto: identifica la conexión, sin contener una clave privada.

## Primera ejecución

Elegir `main` y `functions,hosting` y ejecutar. Si un paso falla, revisar su
registro. El workflow falla antes de desplegar si falta configuración, falla
una prueba o Google no autoriza el acceso. No usa `--force` para borrar recursos.
El SDK AdMob sigue en modo de prueba; este deploy no activa anuncios reales.

Las credenciales temporales `gha-creds-*.json` se excluyen de Git y de Hosting.
La Action las elimina al terminar el job. No subirlas como artifacts.

Referencias:
- https://firebase.google.com/docs/cli
- https://github.com/google-github-actions/auth
- https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://firebase.google.com/docs/projects/iam/permissions
