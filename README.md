# Truco

Primera versión de la mesa de truco para tres dispositivos: un teléfono como mesa y dos como jugadores. La mesa ve las cartas jugadas y el tanteador; la mano de cada jugador se guarda por separado y solo ese jugador puede leerla. El proyecto es una web estática y usa Firebase Realtime Database para sincronizar partidas.

## Probar la interfaz

Abrí `index.html` con un servidor estático y elegí **Explorar una demo**. La demo sirve para recorrer la mesa y jugar una mano ficticia en un solo dispositivo; no se sincroniza con otros teléfonos.

## Conectar partidas entre dispositivos

1. Habilitá **Authentication → Sign-in method → Anonymous** en Firebase.
2. La configuración web ya está cargada en `firebase-config.js`. No pegues claves de cuenta de servicio ni credenciales privadas.
3. Una persona crea una mesa y elige su lugar: mesa, Jugador 1 o Jugador 2.
4. En los demás dispositivos, abrí la misma web, tocá **Ver mesas abiertas** y elegí un puesto libre.
5. Cuando la mesa y ambos jugadores estén conectados, la mesa puede repartir.

`firebase.json` deja preparado el despliegue del sitio y las reglas con Firebase CLI (`firebase deploy --only hosting,database`). También podés importar `firebase.database.rules.json` desde Firebase Console. La regla de lectura en `rooms` permite que usuarios autenticados vean la lista de mesas abiertas; las manos se mantienen separadas y cada jugador solo puede leer la suya. El acceso a partidas públicas todavía permite que cualquier usuario autenticado modifique el estado. Son reglas para probar el juego, no para una partida competitiva o con premios.

## Alcance inicial

- Crear mesas y elegir un puesto libre desde la lista en vivo.
- Sincronizar el estado en tiempo real.
- Repartir tres cartas a cada jugador y mantener sus manos privadas.
- Mostrar cartas jugadas, mazo, turno y tanteador en la vista de mesa.
- La lógica de esta primera entrega usa valores de carta provisionales y suma puntos por baza. Antes de completar el juego hay que acordar la variante de truco (por ejemplo, reglas uruguayas con muestra o argentinas), los cantos, el puntaje y cómo se resuelven empates.

## Privacidad y seguridad

La configuración web de Firebase no es una contraseña y puede incluirse en el sitio. No subas credenciales de administrador ni claves privadas al repositorio. Para publicar el juego, endurecé las reglas de base de datos para limitar también quién puede modificar cada mesa.
