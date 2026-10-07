// ============================================================================
// GPUnlock CRM · Avisos de cobro por correo (Supabase Edge Function)
//
// Envía los correos que deja preparados la base (tabla cobros_avisos, ver 06_avisos.sql):
// vencimientos y días de gracia, comprobante recibido (para GPUnlock), pago aprobado o rechazado.
// Cada aviso se envía una sola vez; si el proveedor falla se reintenta (hasta 5 veces).
// La llama un cron (ver README.md de esta carpeta) con el encabezado x-cron-secret.
//
// Secretos (supabase secrets set …):
//   RESEND_API_KEY   obligatorio (resend.com; el dominio de envío debe estar verificado)
//   AVISOS_FROM      obligatorio, ej. "GPUnlock <avisos@tudominio.com>"
//   CRON_SECRET      obligatorio, una clave larga al azar; la misma que usa el cron
//   APP_URL          opcional, por defecto https://gpunlock.netlify.app
//   AVISOS_REPLY_TO  opcional, a dónde responden las empresas (ej. cobros@tudominio.com)
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { redactar, type Aviso } from "./plantillas.ts";

const APP_URL = Deno.env.get("APP_URL") ?? "https://gpunlock.netlify.app";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

function iguales(a: string, b: string): boolean {   // comparación sin atajos por longitud de coincidencia
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  const secreto = Deno.env.get("CRON_SECRET") ?? "";
  if (secreto.length < 16 || !iguales(req.headers.get("x-cron-secret") ?? "", secreto)) return json({ error: "No autorizado" }, 401);

  const clave = Deno.env.get("RESEND_API_KEY"), desde = Deno.env.get("AVISOS_FROM");
  if (!clave || !desde) return json({ error: "Faltan RESEND_API_KEY o AVISOS_FROM" }, 500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("avisos_pendientes", { p_limite: 25 });
  if (error) return json({ error: error.message }, 500);

  let enviados = 0, fallidos = 0;
  for (const a of (data ?? []) as Aviso[]) {
    try {
      if (!a.destinatarios?.length) throw new Error("sin destinatarios");
      const c = redactar(a, { appUrl: APP_URL });
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + clave, "Content-Type": "application/json" },
        body: JSON.stringify({ from: desde, to: a.destinatarios, subject: c.asunto, html: c.html, text: c.texto, reply_to: Deno.env.get("AVISOS_REPLY_TO") || undefined }),
      });
      if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text()).slice(0, 200));
      await sb.rpc("avisos_marcar", { p_id: a.id, p_ok: true });
      enviados++;
    } catch (e) {
      fallidos++;
      await sb.rpc("avisos_marcar", { p_id: a.id, p_ok: false, p_error: String((e as Error).message ?? e) });
    }
  }
  return json({ enviados, fallidos });
});
