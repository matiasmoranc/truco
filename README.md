# Truco

Primera versión de la mesa de truco para tres dispositivos: un teléfono como mesa y dos como jugadores. La mesa ve las cartas jugadas y el tanteador; la mano de cada jugador se guarda por separado y solo ese jugador puede leerla. El proyecto es una web estática y usa Firebase Realtime Database para sincronizar partidas.

## Probar la interfaz

Abrí `index.html` con un servidor estático y elegí **Explorar una demo**. La demo sirve para recorrer la mesa y jugar una mano ficticia en un solo dispositivo; no se sincroniza con otros teléfonos.

## Conectar partidas entre dispositivos

1. Creá un proyecto Firebase y agregá una aplicación web.
2. Habilitá **Authentication → Sign-in method → Anonymous**.
3. Creá una **Realtime Database** y copiá la configuración web del proyecto.
4. Abrí la app, elegí **Armar una mesa** y pegá la configuración cuando la solicite. Se guarda en el navegador de ese dispositivo.
5. En los otros dos dispositivos, abrí la misma web, elegí **Tengo un código**, seleccioná Jugador 1 o Jugador 2 e ingresá el código que aparece en la mesa.
6. Cuando estén los tres conectados, la mesa puede repartir.

Podés importar `firebase.database.rules.json` como reglas iniciales de Realtime Database. La autenticación anónima es necesaria. Estas reglas separan las cartas privadas y evitan que un usuario lea la mano de otro; el acceso a partidas públicas todavía permite que cualquier usuario autenticado modifique el estado. Son adecuadas para probar el juego, no para una partida competitiva o con premios.

## Alcance inicial

- Crear mesa con código y asignar los dos lugares de jugador.
- Sincronizar el estado en tiempo real.
- Repartir tres cartas a cada jugador y mantener sus manos privadas.
- Mostrar cartas jugadas, mazo, turno y tanteador en la vista de mesa.
- La lógica de esta primera entrega usa valores de carta provisionales y suma puntos por baza. Antes de completar el juego hay que acordar la variante de truco (por ejemplo, reglas uruguayas con muestra o argentinas), los cantos, el puntaje y cómo se resuelven empates.

## Privacidad y seguridad

La configuración web de Firebase se guarda en el almacenamiento local de cada navegador. No contiene la contraseña del proyecto. No subas credenciales de administrador ni claves privadas al repositorio. Para publicar el juego, endurecé las reglas de base de datos para limitar también quién puede modificar cada mesa.
