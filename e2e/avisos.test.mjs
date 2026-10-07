/* Correos del cobro (supabase/functions/cobros-avisos/plantillas.ts): texto correcto por tipo, fechas en Ecuador, sin inyección de HTML.
   Uso: node --experimental-strip-types e2e/avisos.test.mjs */
import assert from "node:assert/strict";
import { redactar, escapar, fecha, dinero } from "../supabase/functions/cobros-avisos/plantillas.ts";

let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const ctx = { appUrl: "https://gpunlock.netlify.app/" };
const base = { id: 1, empresa: "Inmobiliaria Andes", plan_nombre: "Profesional", periodo_hasta: "2026-11-15T13:00:00Z", prueba_hasta: "2026-10-20T13:00:00Z", dias_gracia: 5, whatsapp_cobros: "+593 99 911 1222", destinatarios: ["a@x.com"], solicitud: null };
const AHORA = Date.parse("2026-11-10T13:00:00Z");
const r = (o) => redactar({ ...base, ...o }, ctx, AHORA);

assert.equal(fecha("2026-11-15T03:00:00Z"), "14 de noviembre de 2026"); ok("las fechas se muestran en hora de Ecuador (UTC-5)");
assert.match(dinero(56.35), /^\$\s?56,35$/); ok("dinero en dólares con coma decimal");
assert.equal(escapar(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;"); ok("escapa HTML");

let c = r({ tipo: "d7" });
assert.match(c.asunto, /Tu plan Profesional vence el 15 de noviembre de 2026/); assert.match(c.texto, /vence en 5 días/); assert.match(c.html, /href="https:\/\/gpunlock\.netlify\.app\/app\/"/); ok("d7: asunto, días restantes y enlace a la app (sin doble barra)");
assert.match(c.texto, /wa\.me\/593999111222/); ok("incluye WhatsApp de cobros con solo dígitos");
c = r({ tipo: "d3", periodo_hasta: "2026-11-11T13:00:00Z" });
assert.match(c.texto, /vence en 1 día\b/); ok("singular: «1 día»");
c = r({ tipo: "d0" }); assert.match(c.texto, /5 días de gracia/); ok("d0: avisa los días de gracia");
c = r({ tipo: "gracia", periodo_hasta: "2026-11-09T13:00:00Z" });
assert.match(c.asunto, /paga antes del 14 de noviembre de 2026/); ok("gracia: fecha límite = vencimiento + días de gracia");
c = r({ tipo: "vencida" }); assert.match(c.texto, /solo lectura/); assert.match(c.texto, /leads de tu sitio web se siguen guardando/); ok("vencida: solo lectura y los leads siguen entrando");
c = r({ tipo: "prueba_d3", prueba_hasta: "2026-11-12T13:00:00Z" }); assert.match(c.asunto, /termina en 2 días/); ok("prueba: días restantes");
c = r({ tipo: "prueba_d0" }); assert.match(c.asunto, /terminó/); ok("prueba terminada");
const sol = { referencia: "GPU-7F3K-2611", plan: "Profesional", periodo: "anual", total: 563.5, motivo: null };
c = r({ tipo: "comprobante", solicitud: sol, destinatarios: ["super@gpunlock.com"] });
assert.match(c.asunto, /Comprobante por revisar · Inmobiliaria Andes · GPU-7F3K-2611/); assert.match(c.texto, /\$\s?563,50/); assert.match(c.html, /gpunlock\.netlify\.app\/consola\//); ok("comprobante: para GPUnlock, con referencia, monto y enlace a la consola");
c = r({ tipo: "aprobado", solicitud: sol }); assert.match(c.texto, /vigente hasta el 15 de noviembre de 2026/); assert.match(c.asunto, /Pago confirmado/); ok("aprobado: plan activo y vigencia");
c = r({ tipo: "rechazado", solicitud: { ...sol, motivo: "No vemos la transferencia en el banco" } });
assert.match(c.texto, /Motivo: No vemos la transferencia en el banco/); ok("rechazado: muestra el motivo");
c = r({ tipo: "rechazado", solicitud: { ...sol, motivo: "<script>alert(1)</script>" }, empresa: "A & B <b>" });
assert.ok(!c.html.includes("<script>") && !c.html.includes("<b>")); assert.match(c.html, /&lt;script&gt;/); assert.match(c.html, /A &amp; B &lt;b&gt;/); ok("el motivo y el nombre de la empresa no inyectan HTML");
c = r({ tipo: "d7", whatsapp_cobros: "" }); assert.ok(!c.texto.includes("wa.me")); ok("sin WhatsApp configurado no inventa el enlace");
for (const t of ["prueba_d3", "prueba_d0", "d7", "d3", "d0", "gracia", "vencida", "comprobante", "aprobado", "rechazado"]) {
  const x = r({ tipo: t, solicitud: sol });
  assert.ok(x.asunto.length > 5 && x.asunto.length < 90 && x.texto.length > 40 && x.html.startsWith("<!doctype html>"), t);
}
ok("todos los tipos generan asunto, texto y HTML válidos");
console.log("Correos de cobro: OK (" + n + ")");
