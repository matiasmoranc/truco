# Publicidad: deshabilitada en la primera versión

La versión 1.0.0 se prepara sin anuncios, sin SDK AdMob y sin compras. TRUCO_ADS_MODE solo admite off. No hay botón Ver anuncio, contador de prueba ni opciones de privacidad publicitaria.

El código experimental rewarded-ads.js y las funciones del servidor se conservan como antecedentes para trabajo futuro, pero no se importan ni se incluyen en el paquete móvil. El interruptor rewardedAds/liveEnabled debe quedar en false en producción. No se debe activar publicidad por cambiar una variable: requerirá otra versión, revisión de la recompensa y políticas, integración del SDK y pruebas.
