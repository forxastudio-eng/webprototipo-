# GPUnlock CRM

CRM inmobiliario multiempresa con IA. Cada inmobiliaria tiene su espacio aislado, su equipo, sus leads y su plan. Se paga **por transferencia bancaria** y GPUnlock activa cada plan desde su consola. No hay pasarela de pagos.

Plan completo del producto: [`docs/PLAN_CRM_INMOBILIARIO_IA.md`](docs/PLAN_CRM_INMOBILIARIO_IA.md).

```
.
├── web/                  producto (lo publica el netlify.toml de la raíz)
│   ├── index.html        web principal (ventas)
│   ├── descargar/        descarga de la app (APK de Android; iPhone y computadora como app web)
│   ├── app/              la app (PWA) de las inmobiliarias
│   ├── consola/          consola del equipo de GPUnlock: pagos, empresas, ingresos
│   ├── embed/            lead.js (captura de leads) e inventario.js (disponibilidad en vivo) para la web de cada inmobiliaria
│   └── css/ js/ assets/  marca GPUnlock (tokens, fuentes, logos) y configuración pública
├── supabase/             base de datos (01 → 07), funciones de servidor y pruebas de SQL
├── e2e/                  pruebas de navegador (Playwright) con un Supabase simulado
├── demo/                 sitio de demostración anterior de GPUnlock (landings y su SQL)
├── site/                 landings del demo (se publican aparte: Base directory = site)
└── docs/                 plan de producto
```

## Puesta en marcha

1. **Base de datos.** En Supabase → SQL Editor pega y ejecuta **`supabase/instalar_todo.sql`** (las 7 migraciones en un solo archivo; se puede repetir sin problema). Si prefieres, ejecuta una por una `01_nucleo.sql`, `02_crm.sql`, `03_atribucion.sql`, `04_cobros.sql`, `05_marca.sql`, `06_avisos.sql` y `07_inventario.sql`. Funciona en un proyecto nuevo o en uno existente: no toca tablas de otros sistemas. Tras cambiar una migración, regenera el instalador con `supabase/generar_instalador.sh` (las pruebas avisan si está desactualizado).
2. **Autenticación.** Authentication → Providers → Email: deja activado *Confirm email*. En *URL Configuration* pon tu dominio como Site URL y agrega `https://TU-DOMINIO/app/` y `https://TU-DOMINIO/consola/` en Redirect URLs.
3. **Primer superadmin (tú).** Crea tu cuenta en Authentication → Add user (o regístrate en `/app/`) y luego, en el SQL Editor:
   ```sql
   insert into public.superadmins (user_id, email)
   select id, lower(email) from auth.users where lower(email) = 'tu-correo@dominio.com';
   ```
4. **Ajustes de cobro.** Entra a `/consola/` → *Ajustes de cobro*: días de gracia (y, si cobras desde la app, banco, cuenta, titular, RUC e IVA).
5. **Conectar la web.** Edita `web/js/config.js` con la Project URL y la clave `anon public` (Project Settings → API). Son valores públicos; nunca pongas aquí la `service_role`.
6. **Avisos por correo (recomendado).** Vencimientos, comprobante recibido y pago aprobado o rechazado: sigue `supabase/functions/cobros-avisos/README.md` (Resend + una programación cada 30 minutos).
7. **IA (opcional).** `cp supabase/.env.example supabase/.env`, completa `ANTHROPIC_API_KEY` y despliega:
   ```bash
   supabase secrets set --env-file supabase/.env --project-ref TU_REF
   supabase functions deploy crm-ia --project-ref TU_REF
   ```
8. **Publicar.** Netlify → sitio conectado a este repositorio. El `netlify.toml` de la raíz ya publica la carpeta `web/`, así que no hace falta configurar nada (también funciona con *Base directory = `web`*). El demo anterior (`site/`) se publica aparte con *Base directory = `site`*.

## Cómo se cobra

Por defecto (`PAGOS_EN_APP: false` en `web/js/config.js`) **nadie paga ni sube comprobantes dentro de la app**:

1. La inmobiliaria prueba 14 días gratis (sin tarjeta).
2. En *Ajustes → Mi plan* ve su plan, su vencimiento y los planes; cada botón abre tu WhatsApp (`VENTAS_WHATSAPP`) con el mensaje ya escrito.
3. Acuerdan el pago contigo y te pagan por fuera. En `/consola/` → *Empresas* pulsas **Activar plan**: eliges plan y periodo (el monto es opcional) y listo. Esa y **Ajustar** son las únicas formas de cambiar plan, estado o vencimiento. Todo queda en la auditoría.
4. El periodo se extiende sin quitar ni regalar días: continúa desde el vencimiento si ya estaba pagada o en gracia, y empieza al terminar la prueba si pagó antes de que acabara.
5. `cobros_actualizar_estados()` corre a diario (08:00 Ecuador, con `pg_cron`): activa → gracia → vencida, y deja listos los avisos de vencimiento en `cobros_avisos`.
6. Vencida = solo lectura. No se borra nada y **los leads de formularios web siguen entrando**.

Si algún día quieres cobrar desde la app, pon `PAGOS_EN_APP: true`: vuelve el flujo de transferencia con monto + IVA, referencia (`GPU-XXXX-0000`), datos bancarios y subida de comprobante, que apruebas en la pestaña *Pagos por revisar* de la consola. Ese código sigue en el repositorio y probado.

## Pruebas

```bash
# SQL: permisos, aislamiento entre empresas, cobros, origen de leads (Postgres 14+; usa PGHOST/PGUSER/PGPASSWORD)
supabase/tests/run.sh

# Navegador: pantalla de pagos, consola y lead.js (con Supabase simulado)
cd e2e && npm install && npx playwright install chromium && npm test
```

GitHub Actions corre las dos en cada cambio (`.github/workflows/ci.yml`).

## Inventario
Pestaña **Inventario** de la app: todo el equipo ve las unidades (departamentos, casas, lotes, locales…) con precio y estado. Propietario y administrador crean, editan, eliminan e **importan desde Excel (.xlsx) o CSV** (el archivo se lee en el navegador; se reconocen los títulos habituales, se muestra una vista previa con los errores por fila y solo se envían las filas válidas). Los agentes reservan o liberan; vender o bloquear es de un administrador. Reservar o vender para un lead lo mueve a *Reserva* o *Vendido* con el precio de la unidad, y todo cambio queda en el historial (quién, cuándo, para qué lead).

Para mostrar la disponibilidad en la web de la inmobiliaria: **Ajustes → Tu sitio web** da un `<div data-crm-inventario>` y el script `embed/inventario.js`. Solo sale lo marcado como visible (y los precios solo si el proyecto lo permite, en **Ajustes → Proyectos**). El cotizador y las proformas vienen en la siguiente etapa.

## Marca de cada empresa
El propietario o un administrador entra a **Ajustes → Marca**: sube su logo (PNG, JPG o WebP, hasta 1 MB), elige un color (o toma uno sugerido del logo) y guarda. Todo su equipo ve la app con su marca al instante, sin recargar. Cada persona puede elegir **Automático / Claro / Oscuro** en su cuenta. Si la empresa define una *dirección corta* (por ejemplo `andes`), su equipo entra por `/app/?e=andes` y ve su logo y colores desde la pantalla de inicio de sesión. `web/js/tema.js` garantiza contraste AA con cualquier color; quitar «Con la tecnología de GPUnlock» es parte del plan Agencia.

## Pendiente antes de vender

- **Textos legales** (`/terminos/`, `/privacidad/`): ya existen como borrador. Completa tu razón social, RUC, domicilio, ciudad y correo de privacidad en `LEGAL` de `web/js/config.js`; que un abogado los revise (en especial plazos de exportación de datos y limitación de responsabilidad) y entonces pon `revisado: true`.
- **Avisos por correo**: despliega `cobros-avisos` (paso 6 de la puesta en marcha); sin eso los avisos quedan preparados pero no se envían.
- **Factura electrónica del SRI**: hoy se emite con tu sistema actual y el número se registra al aprobar.
- **IVA vigente**: el 15 % es un valor inicial; confírmalo con tu contador (se cambia en la consola).
- **WhatsApp de ventas** (`VENTAS_WHATSAPP` en `web/js/config.js`): hoy es un número de ejemplo y es a donde llegan los pedidos de plan.
- Precios, límites y nombre de los planes (tabla `planes`).
