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
│   ├── embed/lead.js     script que las inmobiliarias pegan en su web para enviar leads al CRM
│   └── css/ js/ assets/  marca GPUnlock (tokens, fuentes, logos) y configuración pública
├── supabase/             base de datos (01 → 04), funciones de servidor y pruebas de SQL
├── e2e/                  pruebas de navegador (Playwright) con un Supabase simulado
├── demo/                 sitio de demostración anterior de GPUnlock (landings y su SQL)
├── site/                 landings del demo (se publican aparte: Base directory = site)
└── docs/                 plan de producto
```

## Puesta en marcha

1. **Base de datos.** En Supabase → SQL Editor pega y ejecuta **`supabase/instalar_todo.sql`** (las 4 migraciones en un solo archivo; se puede repetir sin problema). Si prefieres, ejecuta una por una `01_nucleo.sql`, `02_crm.sql`, `03_atribucion.sql` y `04_cobros.sql`. Funciona en un proyecto nuevo o en uno existente: no toca tablas de otros sistemas. Tras cambiar una migración, regenera el instalador con `supabase/generar_instalador.sh` (las pruebas avisan si está desactualizado).
2. **Autenticación.** Authentication → Providers → Email: deja activado *Confirm email*. En *URL Configuration* pon tu dominio como Site URL y agrega `https://TU-DOMINIO/app/` y `https://TU-DOMINIO/consola/` en Redirect URLs.
3. **Primer superadmin (tú).** Crea tu cuenta en Authentication → Add user (o regístrate en `/app/`) y luego, en el SQL Editor:
   ```sql
   insert into public.superadmins (user_id, email)
   select id, lower(email) from auth.users where lower(email) = 'tu-correo@dominio.com';
   ```
4. **Datos de cobro.** Entra a `/consola/` → *Datos de cobro*: banco, cuenta, titular, RUC, IVA y días de gracia. Los valores iniciales son de ejemplo.
5. **Conectar la web.** Edita `web/js/config.js` con la Project URL y la clave `anon public` (Project Settings → API). Son valores públicos; nunca pongas aquí la `service_role`.
6. **IA (opcional).** `cp supabase/.env.example supabase/.env`, completa `ANTHROPIC_API_KEY` y despliega:
   ```bash
   supabase secrets set --env-file supabase/.env --project-ref TU_REF
   supabase functions deploy crm-ia --project-ref TU_REF
   ```
7. **Publicar.** Netlify → sitio conectado a este repositorio. El `netlify.toml` de la raíz ya publica la carpeta `web/`, así que no hace falta configurar nada (también funciona con *Base directory = `web`*). El demo anterior (`site/`) se publica aparte con *Base directory = `site`*.

## Cómo se cobra

1. La inmobiliaria prueba 14 días gratis (sin tarjeta).
2. En *Ajustes → Plan y pagos* el propietario elige plan y periodo y la app le muestra el monto con IVA, tus datos bancarios y un código de referencia (`GPU-XXXX-0000`).
3. Transfiere y sube el comprobante (foto o PDF, hasta 5 MB). Mientras se revisa, sigue trabajando.
4. En `/consola/` ves la solicitud, abres el comprobante, confirmas el dinero en tu banco y pulsas **Aprobar**. Es la **única** forma de cambiar el plan, el estado o el vencimiento de una empresa (también `Registrar pago` y `Ajustar` para casos manuales). Todo queda en la auditoría.
5. El periodo se extiende sin quitar ni regalar días: continúa desde el vencimiento si ya estaba pagada o en gracia, y empieza al terminar la prueba si pagó antes de que acabara.
6. `cobros_actualizar_estados()` corre a diario (08:00 Ecuador, con `pg_cron`): activa → gracia → vencida, y deja listos los avisos de vencimiento en `cobros_avisos`.
7. Vencida = solo lectura. No se borra nada y **los leads de formularios web siguen entrando**.

## Pruebas

```bash
# SQL: permisos, aislamiento entre empresas, cobros, origen de leads (Postgres 14+; usa PGHOST/PGUSER/PGPASSWORD)
supabase/tests/run.sh

# Navegador: pantalla de pagos, consola y lead.js (con Supabase simulado)
cd e2e && npm install && npx playwright install chromium && npm test
```

GitHub Actions corre las dos en cada cambio (`.github/workflows/ci.yml`).

## Pendiente antes de vender

- **Términos del servicio y política de privacidad** (`/terminos/`, `/privacidad/`): revisados por un abogado (LOPDP de Ecuador). La web los enlaza pero aún no existen. Incluir el uso de cookies de campaña de `lead.js` y el procesamiento por IA fuera de Ecuador.
- **Envío de avisos de vencimiento por correo**: los avisos ya se generan en `cobros_avisos`; falta la función que los envía (proveedor de correo por decidir) y el correo al equipo cuando entra un comprobante.
- **Factura electrónica del SRI**: hoy se emite con tu sistema actual y el número se registra al aprobar.
- **IVA vigente**: el 15 % es un valor inicial; confírmalo con tu contador (se cambia en la consola).
- Precios, límites y nombre de los planes (tabla `planes`).
