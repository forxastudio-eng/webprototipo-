// Redacta los correos del cobro. Es código puro (sin Deno ni red) para poder probarlo en Node:
//   node --experimental-strip-types e2e/avisos.test.mjs
export type Aviso = {
  id: number;
  tipo: "prueba_d3" | "prueba_d0" | "d7" | "d3" | "d0" | "gracia" | "vencida" | "comprobante" | "aprobado" | "rechazado";
  empresa: string;
  plan_nombre: string | null;
  periodo_hasta: string | null;
  prueba_hasta: string | null;
  dias_gracia: number;
  whatsapp_cobros: string;
  destinatarios: string[];
  solicitud: { referencia: string; plan: string; periodo: string; total: number; motivo: string | null } | null;
};
export type Contexto = { appUrl: string };
export type Correo = { asunto: string; texto: string; html: string };

const ZONA = "America/Guayaquil";
const DIA = 86400000;

export function escapar(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function fecha(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: ZONA }).format(new Date(iso));
}
export function dinero(n: number): string {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(Number(n) || 0);
}
function sumarDias(iso: string, dias: number): string { return new Date(new Date(iso).getTime() + dias * DIA).toISOString(); }
function diasHasta(iso: string, ahora = Date.now()): number { return Math.max(0, Math.ceil((new Date(iso).getTime() - ahora) / DIA)); }

type Pieza = { asunto: string; titulo: string; parrafos: string[]; boton?: { texto: string; url: string }; nota?: string };

function pieza(a: Aviso, c: Contexto, ahora: number): Pieza {
  const app = c.appUrl.replace(/\/$/, "") + "/app/";
  const plan = a.plan_nombre ?? "tu plan";
  const renovar = { texto: "Ver planes y pagar", url: app };
  const wa = a.whatsapp_cobros ? `Si tienes dudas, escríbenos por WhatsApp: https://wa.me/${a.whatsapp_cobros.replace(/\D/g, "")}.` : "";
  const ayuda = "Entra a la app → Ajustes → Plan y pagos, elige tu plan y haz la transferencia con tu código de referencia." + (wa ? " " + wa : "");
  switch (a.tipo) {
    case "prueba_d3": {
      const n = diasHasta(a.prueba_hasta!, ahora);
      return { asunto: `Tu prueba gratis de GPUnlock termina ${n <= 1 ? "mañana" : "en " + n + " días"}`, titulo: "Tu prueba gratis está por terminar",
        parrafos: [`La prueba de ${a.empresa} termina el ${fecha(a.prueba_hasta)}.`, "Para seguir usando el CRM sin interrupciones, elige un plan antes de esa fecha. No pierdes nada de lo que ya cargaste.", ayuda], boton: renovar };
    }
    case "prueba_d0":
      return { asunto: "Tu prueba gratis de GPUnlock terminó", titulo: "Terminó tu prueba gratis",
        parrafos: [`La prueba de ${a.empresa} terminó el ${fecha(a.prueba_hasta)}.`, "Tus datos siguen guardados y los leads que lleguen desde tu sitio web se siguen registrando. Para volver a trabajar con el equipo, elige un plan.", ayuda], boton: renovar };
    case "d7":
    case "d3": {
      const n = diasHasta(a.periodo_hasta!, ahora);
      return { asunto: `Tu plan ${plan} vence el ${fecha(a.periodo_hasta)}`, titulo: `Tu plan vence en ${n} ${n === 1 ? "día" : "días"}`,
        parrafos: [`El plan ${plan} de ${a.empresa} vence el ${fecha(a.periodo_hasta)}.`, "Renueva con tiempo para que tu equipo no pierda el acceso.", ayuda], boton: { texto: "Renovar mi plan", url: app } };
    }
    case "d0":
      return { asunto: `Tu plan ${plan} vence hoy o mañana`, titulo: "Tu plan vence en las próximas 24 horas",
        parrafos: [`El plan ${plan} de ${a.empresa} vence el ${fecha(a.periodo_hasta)}.`, `Si no lo renuevas, tendrás ${a.dias_gracia} días de gracia antes de que la cuenta pase a solo lectura.`, ayuda], boton: { texto: "Renovar mi plan", url: app } };
    case "gracia": {
      const limite = sumarDias(a.periodo_hasta!, a.dias_gracia);
      return { asunto: `Tu plan venció: paga antes del ${fecha(limite)}`, titulo: "Tu plan venció, estás en días de gracia",
        parrafos: [`El plan de ${a.empresa} venció el ${fecha(a.periodo_hasta)}. Puedes seguir trabajando con normalidad hasta el ${fecha(limite)}.`, "Después de esa fecha la cuenta pasa a solo lectura (tus leads de la web se siguen guardando).", ayuda], boton: { texto: "Pagar ahora", url: app } };
    }
    case "vencida":
      return { asunto: "Tu cuenta de GPUnlock quedó en solo lectura", titulo: "Tu cuenta está en solo lectura",
        parrafos: [`La suscripción de ${a.empresa} venció el ${fecha(a.periodo_hasta)} y terminaron los días de gracia.`, "Puedes consultar tu información, pero no crear ni editar. Los leads de tu sitio web se siguen guardando. Al pagar, todo se reactiva de inmediato.", ayuda], boton: { texto: "Reactivar mi cuenta", url: app } };
    case "comprobante": {
      const s = a.solicitud!;
      return { asunto: `Comprobante por revisar · ${a.empresa} · ${s.referencia}`, titulo: "Hay un comprobante por revisar",
        parrafos: [`${a.empresa} subió el comprobante de ${s.referencia}: plan ${s.plan} ${s.periodo}, ${dinero(s.total)} con impuestos.`, "Verifica la transferencia en tu banco y apruébala o recházala desde la consola."],
        boton: { texto: "Abrir la consola", url: c.appUrl.replace(/\/$/, "") + "/consola/" } };
    }
    case "aprobado": {
      const s = a.solicitud;
      return { asunto: `Pago confirmado · tu plan ${plan} está activo`, titulo: "¡Pago confirmado!",
        parrafos: [`Recibimos tu transferencia${s ? " " + s.referencia : ""} y activamos el plan ${plan} de ${a.empresa}${a.periodo_hasta ? ", vigente hasta el " + fecha(a.periodo_hasta) : ""}.`, "Gracias por confiar en GPUnlock. Tu factura te llegará por separado."], boton: { texto: "Abrir mi CRM", url: app } };
    }
    case "rechazado": {
      const s = a.solicitud;
      return { asunto: "No pudimos confirmar tu pago", titulo: "No pudimos confirmar tu pago",
        parrafos: [`Revisamos tu comprobante${s ? " de " + s.referencia : ""} y no pudimos confirmar la transferencia.`, "Motivo: " + (s?.motivo || "no indicado"), "Puedes subir otro comprobante o pedir un nuevo pago desde Ajustes → Plan y pagos." + (wa ? " " + wa : "")],
        boton: { texto: "Revisar mi pago", url: app } };
    }
  }
}

export function redactar(a: Aviso, c: Contexto, ahora = Date.now()): Correo {
  const p = pieza(a, c, ahora);
  const texto = [p.titulo, "", ...p.parrafos, ...(p.boton ? ["", p.boton.texto + ": " + p.boton.url] : []), "", "— GPUnlock CRM"].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#FAF6F3;font-family:Arial,Helvetica,sans-serif;color:#161616">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #EADFD8">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:700;color:#161616"><span style="color:#B93A14">GPU</span>nlock <span style="color:#6B6B6B;font-weight:400">CRM</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;line-height:1.3;font-weight:700">${escapar(p.titulo)}</td></tr>
<tr><td style="padding:12px 28px 4px;font-size:15px;line-height:1.6;color:#2B2B2B">${p.parrafos.map((x) => `<p style="margin:0 0 12px">${escapar(x)}</p>`).join("")}</td></tr>
${p.boton ? `<tr><td style="padding:8px 28px 24px"><a href="${escapar(p.boton.url)}" style="display:inline-block;background:#B93A14;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:12px">${escapar(p.boton.texto)}</a></td></tr>` : ""}
<tr><td style="padding:16px 28px 24px;border-top:1px solid #EADFD8;font-size:12px;color:#6B6B6B">Recibes este correo porque eres parte de ${escapar(a.empresa)} en GPUnlock CRM.</td></tr>
</table></td></tr></table></body></html>`;
  return { asunto: p.asunto, texto, html };
}
