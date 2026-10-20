# Truco Uruguayo — primera versión sin anuncios

Juego gratuito de truco uruguayo con muestra, partidas entre dos personas o cuatro en equipos, práctica contra el bot, chat, estadísticas y créditos virtuales gratuitos. No hay publicidad, compras, suscripciones ni premios con valor monetario.

Web: https://trucouruguayo.uy/

## Preparación

Node 22+, npm ci, npm test y npm run mobile:build. La build solo acepta TRUCO_ADS_MODE=off (valor predeterminado). npm run mobile:verify:no-ads verifica dependencias, paquete y configuración.

Los workflows iOS y Android de Codemagic fijan off; no generan publicaciones públicas automáticamente. Para proyectos nativos existentes, npm run mobile:sync elimina la integración AdMob y limpia sus metadatos. Generar una build nueva: actualizar la web no modifica una app instalada.

Ver MOBILE.md y publication/LANZAMIENTO-SIN-ANUNCIOS.md para firmas, pruebas reales, fichas y requisitos pendientes de las tiendas.

## Juego actual

Ver [REGLAS.md](REGLAS.md) para reparto sin sorteo, mano y pie, flor opcional, vista del compañero e indicaciones. Las páginas públicas son reglas.html, privacidad.html, soporte.html y eliminar-cuenta.html.

## Modalidades y reglas vigentes (19/10/2026)

- Mesas de 1 vs 1 y de 2 vs 2 (cuatro personas), públicas o con clave. El candado verde abierto identifica las públicas; el rojo cerrado, las privadas. En una mesa de cuatro se elige equipo desde los lugares Entrar del lobby. Los compañeros se sientan enfrentados. La espera muestra nombres y cartas boca abajo de quienes entraron y los lugares que faltan.
- La partida empieza al completarse la mesa, sin elegir cartas ni sorteo inicial. El creador es mano en el primer reparto; en cada nuevo reparto rota quien reparte y la mano es quien sigue a su derecha. En práctica y contra el bot tampoco hay selección inicial.
- En cuatro, responde a los cantos el primer jugador activo del equipo contrario en el orden desde la mano; si se fue al mazo, responde su compañero. El pie es el último jugador de su equipo en ese orden al repartir y permanece fijo hasta el siguiente reparto. Mientras juega su compañero, puede enviar Vení, Jugá o Gritá. No sustituyen una jugada ni un canto y no cambian el turno.
- Las cartas del compañero se muestran durante tres segundos al comenzar la partida de cuatro. Tocarlas permite volver a ver las que conserva durante tres segundos, con animación al mostrarlas y ocultarlas. Ese acceso se entrega por el canal privado del equipo; no se publica la mano del rival.
- Tener flor no obliga a cantarla para poder tirar. Si querés declararla, hacelo antes de tu primera carta: después de jugar ya no podés reclamar esa flor. La flor declarada anula el envido. Los tantos de los compañeros no se suman: se compara el mejor valor individual y los empates siguen el orden desde la mano.
- En cuatro, irse al mazo retira a ese jugador de la mano; su compañero puede continuar. Si se van ambos, gana el rival. Abandonar la partida hace perder al equipo. La revancha requiere la confirmación y saldo suficiente de los cuatro.
- El mazo queda entre jugadores, a la derecha de quien reparte; la muestra queda debajo, perpendicular, con su parte superior hacia el centro. Se puede mover la muestra hasta 10 píxeles en cualquier dirección, también en 1 vs 1 y práctica. En 1 vs 1 las cartas jugadas quedan del lado opuesto al mazo.
- Los avisos de cantos e indicaciones duran hasta cinco segundos y se limpian al cambiar de ronda o reparto. El anotador conserva el marcador y permite consultar las manos anteriores.
- Todos aportan la misma cantidad de créditos virtuales. En 1 vs 1 el ganador recibe el pozo de dos aportes; en 2 vs 2 cada ganador recibe la mitad del pozo de cuatro aportes. La práctica no usa créditos. Sin compras, retiros ni premios canjeables.
