# Truco

Primera versión de la mesa de truco para tres dispositivos: un teléfono como mesa y dos como jugadores. La mesa ve las cartas jugadas y el tanteador; la mano de cada jugador se guarda por separado y solo ese jugador puede leerla. El proyecto es una web estática y usa Firebase Realtime Database para sincronizar partidas.

## Preparación para las tiendas

La web pública está en https://trucouruguayo.uy/. Las apps usan Capacitor y el mismo Firebase. El acceso requiere Google o Apple; no se crean nuevas cuentas anónimas para jugar. Las partidas con créditos son arbitradas por Cloud Functions y no por el navegador.

- [MOBILE.md](MOBILE.md): builds iOS y Android, firma y pruebas.
- [publication/PUBLICACION.md](publication/PUBLICACION.md): requisitos y orden de envío a ambas tiendas.
- [publication/FICHAS.md](publication/FICHAS.md): textos preparados y acceso de revisores.
- [publication/PRIVACIDAD-TIENDAS.md](publication/PRIVACIDAD-TIENDAS.md): inventario de datos para completar formularios.
- [publication/REPORTE-2026-10-14.md](publication/REPORTE-2026-10-14.md): revisión de preparación y pendientes.
- [CREDITOS.md](CREDITOS.md), [ANUNCIOS.md](ANUNCIOS.md): economía y anuncios actualmente en prueba.

## Ejecutar y verificar

Usá Node.js 22: `npm ci`, `npm test` y `npm run mobile:build`.
Para abrir la web localmente usá un servidor estático y un dominio autorizado en Firebase Authentication. Las sesiones reales necesitan conexión y un proveedor configurado. No pegues claves privadas de cuentas de servicio en la web ni en GitHub.

El juego, soporte y privacidad también se empaquetan en las apps. Un deploy web no actualiza las apps instaladas: necesitás reconstruirlas y distribuir la nueva build. Ver DEPLOY.md para Firebase y MOBILE.md para las apps.

## Reglas implementadas

- Truco uruguayo a dos jugadores, con tres cartas por jugador y una muestra visible por mano.
- Piezas de la muestra (2, 4, 5, caballo y sota), alcahuete cuando la muestra es una pieza, matas y orden de cartas.
- Envido, real envido, falta envido, flor, con flor envido, contra flor al resto, truco, retruco y vale cuatro.
- Tanteador configurable antes de abrir la mesa: 10, 20, 30, 40, 50 o 60. Los tantos se muestran como palitos en grupos de cinco.
- La mano se define por dos de tres bazas; los empates se resuelven dando ventaja a quien ganó primero o a la mano cuando todas quedan pardas.

Las reglas se contrastaron con las descripciones publicadas por [Ludoteka](https://www.ludoteka.com/juegos/truco-uruguayo/reglas) y [ConectaGames](https://www.conectagames.com/rules/truco_uy?lang=ES). Hay variantes de mesa para los cantos y el tanteador de falta; esta versión toma la falta como los tantos que le faltan al puntero para llegar al objetivo elegido.

## Privacidad y seguridad

La configuración web de Firebase no es una contraseña y puede incluirse en el sitio. No subas credenciales de administrador ni claves privadas al repositorio. Para publicar el juego, endurecé las reglas de base de datos para limitar también quién puede modificar cada mesa.

## Modo de 2 celulares

Al crear la mesa, elegí **2 celulares · mesa en cada pantalla** y tu puesto de jugador. El otro teléfono se une al lugar libre. Quien creó la mesa inicia la partida y su teléfono coordina el reparto y el cierre de las manos automáticamente, por lo que debe permanecer conectado. Ambos ven el mazo, la muestra, las cartas jugadas y los puntos, además de su propia mano. El modo de tres dispositivos sigue disponible.
