# GPUnlock CRM · Web principal

Página de ventas (`/`) y página de descarga de la app (`/descargar/`). HTML, CSS y JavaScript sin compilación, con la marca GPUnlock (`css/gp-tokens.css`: naranja #F2582B → ámbar #F08A30, negro #161616, Outfit + Work Sans auto-alojadas).

## Publicar en Netlify

Sitio nuevo en Netlify → *Import from GitHub* → este repositorio → **Base directory: `web`**. Lee `web/netlify.toml` (sin build). El sitio de demostración (`site/`) sigue con el `netlify.toml` de la raíz.

## Qué editar

| Qué | Dónde |
| --- | --- |
| Supabase (para leer precios de la tabla `planes`) y WhatsApp de ventas | `js/config.js` |
| Precios mostrados mientras no hay Supabase | `index.html`, atributos `data-mensual` y `data-anual` de cada `.plan` |
| Funciones aún no disponibles | atributo `data-pronto` en cada tarjeta de `#producto` (muestra «Muy pronto»; quítalo cuando la función esté lista) |
| Versión del APK de Android | `descargar/version.json` (`version`, `apk`, `sha256`, `fecha`). Con `apk: null` el botón muestra «Disponible muy pronto» |

Las rutas `/app/`, `/terminos/` y `/privacidad/` se agregan cuando se traiga la app de la base y los textos legales.
