# cobros-avisos · correos del cobro

Envía por correo, con [Resend](https://resend.com), lo que la base deja preparado en `cobros_avisos`:

| Aviso | Para quién | Cuándo |
| --- | --- | --- |
| Prueba gratis termina / terminó | propietario | a 3 días del fin y al terminar |
| Plan vence | propietario | a 7, 3 y 1 día del vencimiento |
| Días de gracia / cuenta en solo lectura | propietario | al vencer y al terminar la gracia |
| Comprobante por revisar | GPUnlock (superadmins y `correo_cobros`) | cuando una empresa sube su comprobante |
| Pago aprobado / rechazado | propietario | cuando lo resuelves en la consola |

Los agentes y administradores nunca reciben avisos de cobro. Una empresa que ya renovó no recibe «tu plan vence».

## Puesta en marcha (una sola vez)

1. **Resend**: crea la cuenta, verifica tu dominio (registros DNS) y crea una API key. Sin dominio verificado solo puedes enviarte correos a ti.
2. **Secretos y despliegue** (con la CLI de Supabase):
   ```bash
   supabase secrets set --project-ref TU_REF \
     RESEND_API_KEY=re_xxx AVISOS_FROM="GPUnlock <avisos@tudominio.com>" \
     CRON_SECRET=$(openssl rand -hex 24) AVISOS_REPLY_TO=cobros@tudominio.com
   supabase functions deploy cobros-avisos --no-verify-jwt --project-ref TU_REF
   ```
   (`--no-verify-jwt` porque la función se protege con `CRON_SECRET`.) Anota el valor de `CRON_SECRET`.
3. **Programarla** en Supabase → SQL Editor (cada 30 minutos; activa antes las extensiones `pg_cron` y `pg_net` en Database → Extensions). Cambia `TU_REF` y `TU_CRON_SECRET`:
   ```sql
   select cron.schedule('avisos-cobro', '*/30 * * * *', $$
     select net.http_post(
       url := 'https://TU_REF.supabase.co/functions/v1/cobros-avisos',
       headers := jsonb_build_object('x-cron-secret', 'TU_CRON_SECRET', 'Content-Type', 'application/json'),
       body := '{}'::jsonb)
   $$);
   ```
4. **Probar**: `curl -X POST -H "x-cron-secret: TU_CRON_SECRET" https://TU_REF.supabase.co/functions/v1/cobros-avisos` devuelve `{"enviados":N,"fallidos":0}`.

Si un envío falla, el motivo queda en `cobros_avisos.error` y se reintenta en la siguiente ronda (máximo 5 veces; los avisos de más de 3 días ya no se envían).
