/* «Mi plan» cuando el pago se acuerda directamente con GPUnlock (PAGOS_EN_APP = false, el modo por defecto):
   sin pagar ni subir comprobantes en la app; el plan se pide por WhatsApp y GPUnlock lo activa desde la consola.
   Uso: NODE_PATH=$(npm root -g) node e2e/plan.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const DIA = 86400000;
const irAPlan = async (page) => { await page.click('[data-action="vista"][data-v="ajustes"]'); await page.click('[data-action="aj-sec"][data-s="plan"]'); await page.waitForSelector(".plans"); };

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  try {
    /* 1. Propietario en prueba: planes con WhatsApp, sin flujo de pago */
    let { page, errores, ctx } = await abrirApp(browser, url, {});
    await page.click('[data-action="vista"][data-v="ajustes"]');
    assert.match(await page.textContent('[data-action="aj-sec"][data-s="plan"]'), /^Mi plan$/); ok("la pestaña se llama «Mi plan»");
    await irAPlan(page);
    assert.equal(await page.locator('[data-action="pagar"]').count(), 0); ok("no hay botones de pago");
    assert.equal(await page.locator("#pago-en-curso, #comp-archivo").count(), 0); ok("no hay referencia ni subida de comprobantes");
    const hrefs = await page.$$eval(".plan a.btn", (a) => a.map((x) => x.getAttribute("href")));
    assert.equal(hrefs.length, 3); ok("cada plan tiene su botón de WhatsApp");
    const u = new URL(hrefs[1]);
    assert.equal(u.origin + u.pathname, "https://wa.me/593911222333"); assert.match(u.searchParams.get("text"), /plan Profesional.*Inmobiliaria Andes/); ok("el mensaje ya dice el plan y la empresa");
    assert.match(await page.textContent(".plans"), /\$49.*mes.*impuestos/s); ok("sigue mostrando los precios (+ impuestos)");
    assert.match(await page.textContent("#vista, main, body"), /pago se acuerda directamente con GPUnlock/); ok("explica cómo se paga");
    assert.doesNotMatch(await page.textContent("body"), /transferencia|Banco Pichincha|2100123456|GPU-/); ok("no menciona transferencias ni datos bancarios");
    const consultas = await page.evaluate(() => window.__FX.calls.map((c) => c.name));
    assert.ok(!consultas.includes("solicitar_pago")); ok("no se pide ningún pago a la base");
    assert.deepEqual(errores, []); await ctx.close();

    /* 2. En gracia: pide «Renueva», no «Paga» */
    ({ page, errores, ctx } = await abrirApp(browser, url, { uso: { estado: "gracia", plan: { id: "profesional", nombre: "Profesional", max_usuarios: 8, max_leads_mes: 1000, ia_mes: 400 },
      periodo_hasta: new Date(Date.now() - 2 * DIA).toISOString(), gracia_hasta: new Date(Date.now() + 3 * DIA).toISOString(),
      solicitud: { id: "s9", plan_id: "inicial", periodo: "mensual", referencia: "GPU-OLD-0001", estado: "en_revision", total: 1 } } }));
    await irAPlan(page);
    assert.match(await page.textContent(".banner.warn"), /Renueva antes del/); ok("en gracia el aviso dice «Renueva antes del…»");
    assert.doesNotMatch(await page.textContent("body"), /revisando tu (pago|transferencia)|GPU-OLD-0001/); ok("aunque exista una solicitud vieja, no se muestra «en revisión»");
    assert.match(await page.textContent(".plan.actual"), /Renovar Profesional por WhatsApp/); ok("el plan actual ofrece renovar por WhatsApp");
    await ctx.close();

    /* 3. Un agente ve su plan y los precios, pero no el botón de pedir */
    ({ page, errores, ctx } = await abrirApp(browser, url, { rol: "agente" }));
    await irAPlan(page);
    assert.equal(await page.locator(".plan a.btn").count(), 0); ok("un agente no ve botones para pedir un plan");
    assert.match(await page.textContent("body"), /pídele al propietario/); ok("le indica que lo pida el propietario");
    await ctx.close();

    /* 4. Vencida: solo lectura y el propietario puede escribir a ventas */
    ({ page, errores, ctx } = await abrirApp(browser, url, { uso: { estado: "vencida", activa: false, periodo_hasta: new Date(Date.now() - 20 * DIA).toISOString() } }));
    await irAPlan(page);
    assert.match(await page.textContent(".banner.bad"), /solo lectura.*siguen guardando leads/s); ok("vencida: solo lectura y los leads de la web siguen entrando");
    assert.equal(await page.locator(".plan a.btn").count(), 3); ok("vencida: puede pedir su plan por WhatsApp");
    assert.deepEqual(errores, []); await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Mi plan sin pagos en la app: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
