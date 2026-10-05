# GPUnlock · Plataforma unificada (prototipo)

Un solo repositorio, un solo sitio de Netlify y un solo proyecto de Supabase
(`gpunlock-plataforma`) para todo. Es un prototipo con **datos ficticios**:
5 unidades por proyecto en el cotizador y precios inventados.

| Ruta | Qué es | Quién entra |
|---|---|---|
| `/` | Landing principal con todos los proyectos | Público |
| `/vertice/` `/prisma/` `/valle/` | Landings de cada proyecto | Público |
| `/admin/` | Panel de administración | Editor, administrador, marketing |
| `/cotizador/` | Cotizador interno y su historial | Todo el equipo (historial: no asesores) |
| `/marketing/` | Dashboard ejecutivo de marketing | Editor, administrador, marketing |

```
.
├── site/                  ← lo ÚNICO que publica Netlify
│   ├── index.html         landing principal
│   ├── js/gpunlock-config.js ← URL y anon key de Supabase (un solo lugar)
│   ├── css/  assets/      marca GPUnlock compartida (assets/brand/)
│   ├── vertice/ prisma/ valle/ cotizador/ marketing/ admin/
├── supabase/              SQL en orden 01 → 08 (no se publica)
├── scripts/               creación de cuentas (se ejecuta en tu PC)
├── logos gpu/             archivos originales de la marca
└── netlify.toml
```

## Marca

- Logos en `site/assets/brand/` (derivados de `logos gpu/`): `gp-logo-horizontal(.png|-white.png)`,
  `gp-logo-lockup(.png|-white.png)`, `gp-mark.png` (isotipo), favicons.
- Tipografía: Outfit (títulos) y Work Sans (texto), auto-alojadas en `site/assets/fonts/` (`site/css/gp-fonts.css`), sin depender de Google Fonts.
- Colores: naranja `#F2582B` → ámbar `#F08A30` (degradado), negro `#161616`, blanco.
  Los tokens están en `site/css/gp-tokens.css` (texto naranja sobre fondo claro: `--color-primary-text`, #C9421B, cumple contraste AA); el cotizador los toma de `site/cotizador/css/gp-theme.css`.

## Proyectos de demostración (ficticios)

| Proyecto | Ruta | Cotizador |
|---|---|---|
| Vértice (suites y locales) | `/vertice/` | 5 unidades |
| Prisma Suites & Lofts | `/prisma/` | 5 unidades |
| Valle Sereno (lotes) | `/valle/` | 5 lotes |
| Lumen (departamentos) | portafolio | 5 unidades |
| Colina Verde (casas) | solo cotizador | 5 unidades |

Las fotos y renders de los proyectos son material de relleno. Cámbialas por las tuyas.

## Roles

| | Editor | Administrador | Marketing | Asesor |
|---|:-:|:-:|:-:|:-:|
| Crear, editar, eliminar en el panel | ✓ | – | – | – |
| Cambiar disponibilidad de unidades | ✓ | ✓ | – | – |
| Ver todo y descargar tablas | ✓ | ✓ | ✓ | – |
| Historial de proformas y sus dashboards | ✓ | ✓ | ✓ | – |
| Editar dashboard de marketing | ✓ | – | ✓ | – |
| Usar el cotizador | ✓ | ✓ | ✓ | ✓ |
| Administrar usuarios y roles | ✓ | – | – | – |

Los permisos los hace cumplir la base de datos (RLS), no solo la interfaz.

**Cuenta actual:** una sola, la del editor `gabichopalomeque@gmail.com`. Desde
**Panel → Usuarios y roles** se pueden asignar más roles (y crear su cuenta en
Supabase → Authentication → Add user).

## Base de datos (Supabase `gpunlock-plataforma`)

Ya está instalada (esquema, políticas, datos de demostración y la cuenta del editor).
Para reconstruirla en otro proyecto, ejecuta en el SQL Editor, en orden:
`01_roles.sql` → `02_landings.sql` → `03_cotizador.sql` → `04_marketing.sql` →
`05_cambiar_estado.sql` → `06_politicas.sql` → `07_usuarios.sql` → `08_datos_demo.sql`.
Después cambia `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `site/js/gpunlock-config.js`.

Pendiente en el panel de Supabase (no se puede hacer por SQL):

1. **Authentication → Sign In / Providers → Email**: desactiva **Allow new users to sign up**.
2. **Authentication → URL Configuration**: pon tu dominio como Site URL y agrega
   `https://TU-DOMINIO/admin/` en Redirect URLs.
3. Cambia la contraseña inicial del editor en **Panel → Mi cuenta**.

## Publicar

1. Netlify → **Add new site → Import from GitHub** → este repositorio. Lee `netlify.toml`
   (carpeta publicada `site`, sin build).
2. El número de WhatsApp y el correo de contacto son valores de ejemplo
   (`593900000000`, `hola@gpunlock.example`): reemplázalos en `site/js/gpunlock-config.js`
   y en los `index.html` de cada landing.

## Uso diario

- **Cambiar disponibilidad:** Panel → Inventario → el proyecto → selector de estado.
- **Editar unidades, fotos y fichas (editor):** mismo lugar, botón del lápiz.
- **Precios, planos y configuración del cotizador (editor):** Panel → Cotizador → Configurar cotizador.
- **Dashboard del historial:** Panel → Historial y dashboard → pestaña Dashboard → Exportar a PDF
  (elige *Guardar como PDF* y activa *Gráficos de fondo*).
- **Dashboard de marketing:** `/marketing/`; el editor y marketing lo editan desde su panel.
  Trae cifras de ejemplo.

## Seguridad

- En el sitio solo va la **anon key** (pública por diseño). La **service_role key** solo en
  `scripts/.env`, en tu computadora (el archivo está en `.gitignore`).
- Si alguien deja el equipo: Panel → Usuarios y roles → quitar acceso, y en Supabase →
  Authentication → Users → eliminar su cuenta.
