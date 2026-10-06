/* Pantalla «Plan y pagos» (cobro por transferencia), de punta a punta con un Supabase simulado.
   Uso: NODE_PATH=$(npm root -g) node e2e/pagos.test.cjs   (o `npm test` dentro de e2e/) */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");

const DIA = 86400000;
async function irAPlan(page) {
  await page.click('[data-action="vista"][data-v="ajustes"]');
  await page.click('[data-action="aj-sec"][data-s="plan"]');
  await page.waitForSelector(".plans");
}
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Prueba gratis: elegir plan → ver monto, referencia y datos bancarios */
    let { page, errores } = await abrirApp(browser, url, {});
    await irAPlan(page);
    assert.match(await page.textContent(".banner"), /Prueba gratis/); ok("banner de prueba gratis");
    assert.equal(await page.locator(".plan").count(), 3); ok("muestra los 3 planes");
    assert.match(await page.textContent(".plan.actual, .plan:nth-child(1) .precio"), /\$19/); ok("precio del plan inicial sin decimales");
    await page.click('[data-action="intervalo"][data-i="anual"]');
    assert.match(await page.textContent(".plan:nth-child(2) .precio"), /\$490.*año.*impuestos/s); ok("precio anual con «+ impuestos»");
    await page.click('[data-action="pagar"][data-p="profesional"]');
    await page.waitForSelector("#pago-en-curso");
    const tarjeta = await page.textContent("#pago-en-curso");
    assert.match(tarjeta, /Falta tu transferencia/); assert.match(tarjeta, /\$490,00/); assert.match(tarjeta, /\$73,50/); assert.match(tarjeta, /\$563,50/);
    assert.match(await page.textContent("#ref-pago"), /^GPU-7F3K-2611$/); ok("monto con IVA (490 + 73,50 = 563,50) y referencia");
    assert.match(tarjeta, /Banco Pichincha/); assert.match(tarjeta, /2100123456/); assert.match(tarjeta, /GPUnlock S\.A\./); ok("datos bancarios visibles");
    assert.match(await page.getAttribute('#pago-en-curso a[href*="wa.me"]', "href"), /wa\.me\/593999111222/); ok("enlace de WhatsApp de cobros");
    const llamada = await page.evaluate(() => window.__FX.calls.find((c) => c.name === "solicitar_pago"));
    assert.deepEqual([llamada.args.p_plan, llamada.args.p_periodo], ["profesional", "anual"]); ok("pide el plan y el periodo elegidos");
    if (out) await page.screenshot({ path: out + "/pago-1-instrucciones.png", fullPage: true });

    /* 2. Archivos inválidos */
    await page.click('[data-action="comp-enviar"]');
    assert.match(await page.textContent("#toast"), /Elige primero/); ok("sin archivo: avisa");
    await page.setInputFiles("#comp-archivo", { name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
    await page.click('[data-action="comp-enviar"]');
    assert.match(await page.textContent("#toast"), /foto.*o un PDF/); ok("rechaza tipos que no son foto ni PDF");
    await page.setInputFiles("#comp-archivo", { name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await page.click('[data-action="comp-enviar"]');
    assert.match(await page.textContent("#toast"), /más de 5 MB/); ok("rechaza archivos de más de 5 MB");
    assert.equal(await page.evaluate(() => window.__FX.uploads.length), 0); ok("nada se sube si el archivo es inválido");

    /* 3. Subir el comprobante */
    await page.setInputFiles("#comp-archivo", { name: "transferencia.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpg") });
    await page.click('[data-action="comp-enviar"]');
    await page.waitForFunction(() => document.querySelector("#pago-en-curso")?.textContent.includes("En revisión"));
    const sube = await page.evaluate(() => ({ up: window.__FX.uploads[0], rpc: window.__FX.calls.find((c) => c.name === "subir_comprobante") }));
    assert.equal(sube.up.bucket, "comprobantes"); assert.match(sube.up.path, /^11111111-1111-1111-1111-111111111111\/sol-1-\d+\.jpg$/); assert.equal(sube.up.type, "image/jpeg");
    assert.equal(sube.rpc.args.p_path, sube.up.path); ok("sube a comprobantes/<empresa>/<solicitud>-<hora>.jpg y avisa a la base");
    assert.match(await page.textContent(".banner"), /revisando tu transferencia/); ok("banner «estamos revisando tu transferencia»");
    assert.equal(await page.locator('[data-action="pagar"][disabled]').count(), 3); ok("con un pago en revisión no se puede pedir otro");
    assert.equal(await page.locator('[data-action="cancelar-solicitud"]').count(), 0); ok("en revisión ya no se puede cancelar");
    if (out) await page.screenshot({ path: out + "/pago-2-en-revision.png", fullPage: true });
    assert.deepEqual(errores, []); ok("sin errores en la consola");
    await page.context().close();

    /* 4. Cancelar una solicitud sin comprobante */
    ({ page, errores } = await abrirApp(browser, url, {}));
    await irAPlan(page);
    await page.click('[data-action="pagar"][data-p="agencia"]');
    await page.waitForSelector("#pago-en-curso");
    page.once("dialog", (d) => d.accept());
    await page.click('[data-action="cancelar-solicitud"]');
    await page.waitForFunction(() => !document.querySelector("#pago-en-curso"));
    ok("cancelar la solicitud quita la tarjeta de pago");
    assert.deepEqual(errores, []);
    await page.context().close();

    /* 5. Días de gracia */
    ({ page, errores } = await abrirApp(browser, url, { uso: { estado: "gracia", plan: { id: "profesional", nombre: "Profesional", max_usuarios: 8, max_leads_mes: 1000, ia_mes: 400 }, periodo_hasta: new Date(Date.now() - 2 * DIA).toISOString(), gracia_hasta: new Date(Date.now() + 3 * DIA).toISOString() } }));
    await irAPlan(page);
    assert.match(await page.textContent(".banner.warn"), /Tu suscripción venció.*Paga antes del/s); ok("gracia: aviso con la fecha límite");
    assert.match(await page.textContent(".card"), /Venció: días de gracia/); ok("gracia: estado en la tarjeta del plan");
    assert.match(await page.textContent(".plan.actual"), /Renovar Profesional/); ok("el plan actual ofrece «Renovar»");
    assert.deepEqual(errores, []);
    await page.context().close();

    /* 6. Vencida: solo lectura, y un pago rechazado muestra el motivo */
    ({ page, errores } = await abrirApp(browser, url, { uso: { estado: "vencida", activa: false, periodo_hasta: new Date(Date.now() - 20 * DIA).toISOString(),
      solicitud: { id: "s0", plan_id: "inicial", periodo: "mensual", referencia: "GPU-AAAA-0001", estado: "rechazada", motivo_rechazo: "No vemos la transferencia en el banco" } } }));
    await irAPlan(page);
    assert.match(await page.textContent(".banner.bad"), /vencida.*solo lectura.*siguen guardando leads/s); ok("vencida: solo lectura, pero los leads de la web siguen entrando");
    assert.match(await page.textContent("#pago-rechazado"), /No pudimos confirmar.*GPU-AAAA-0001.*No vemos la transferencia/s); ok("pago rechazado: muestra la referencia y el motivo");
    assert.equal(await page.locator('[data-action="pagar"]:not([disabled])').count(), 3); ok("después de un rechazo puede elegir plan otra vez");
    if (out) await page.screenshot({ path: out + "/pago-3-rechazado.png", fullPage: true });
    await page.context().close();

    /* 7. Un agente no contrata ni ve datos de pago */
    ({ page, errores } = await abrirApp(browser, url, { rol: "agente", uso: { solicitud: { id: "s1", plan_id: "profesional", periodo: "mensual", referencia: "GPU-ZZZZ-9999", subtotal: 49, iva: 7.35, total: 56.35, estado: "en_revision" } } }));
    await irAPlan(page);
    assert.equal(await page.locator('[data-action="pagar"]').count(), 0); ok("un agente no ve botones para contratar");
    assert.doesNotMatch(await page.textContent("#vista, main, body"), /GPU-ZZZZ-9999|2100123456/); ok("un agente no ve la referencia ni la cuenta bancaria");
    assert.match(await page.textContent("body"), /Solo el propietario puede contratar/); ok("explica quién puede contratar");
    await page.context().close();

    /* 8. Si la base rechaza el pedido, la persona ve el motivo */
    ({ page, errores } = await abrirApp(browser, url, { errorAlPedir: "Tu equipo tiene 3 personas y el plan Inicial permite hasta 2." }));
    await irAPlan(page);
    await page.click('[data-action="pagar"][data-p="inicial"]');
    await page.waitForFunction(() => /Tu equipo tiene 3 personas/.test(document.querySelector("#toast")?.textContent || ""));
    ok("los errores de la base se muestran tal cual");
    await page.context().close();

    /* 9. Escritorio: la pantalla se ve bien en ancho */
    ({ page, errores } = await abrirApp(browser, url, {}, { width: 1280, height: 900 }));
    await irAPlan(page);
    await page.click('[data-action="pagar"][data-p="profesional"]');
    await page.waitForSelector("#pago-en-curso");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("sin desbordes horizontales en escritorio");
    if (out) await page.screenshot({ path: out + "/pago-4-escritorio.png" });
    await page.context().close();
  } finally { await browser.close(); server.close(); }
  console.log("Todas las pruebas de la pantalla de pagos pasaron (" + n + ").");
})().catch((e) => { console.error(e); process.exit(1); });
