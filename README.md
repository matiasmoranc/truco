# Truco Uruguayo — primera versión sin anuncios

Juego gratuito de truco uruguayo con muestra, partidas entre dos personas, práctica contra el bot, chat, estadísticas y créditos virtuales gratuitos. No hay publicidad, compras, suscripciones ni premios con valor monetario.

Web: https://trucouruguayo.uy/

## Preparación

Node 22+, npm ci, npm test y npm run mobile:build. La build solo acepta TRUCO_ADS_MODE=off (valor predeterminado). npm run mobile:verify:no-ads verifica dependencias, paquete y configuración.

Los workflows iOS y Android de Codemagic fijan off; no generan publicaciones públicas automáticamente. Para proyectos nativos existentes, npm run mobile:sync elimina la integración AdMob y limpia sus metadatos. Generar una build nueva: actualizar la web no modifica una app instalada.

Ver MOBILE.md y publication/LANZAMIENTO-SIN-ANUNCIOS.md para firmas, pruebas reales, fichas y requisitos pendientes de las tiendas.
