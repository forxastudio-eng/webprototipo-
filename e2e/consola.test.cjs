/* Consola del equipo: acceso, aprobar y rechazar pagos, empresas, ingresos y datos de cobro.
   Uso: NODE_PATH=$(npm root -g) node e2e/consola.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const OPC = { ruta: "/consola/", esperar: "#consola:not([hidden]), #login:not([hidden]), #denegado:not([hidden])" };
const llamadas = (page, nombre) => page.evaluate((nom) => window.__FX.calls.filter((c) => c.name === nom).map((c) => c.args), nombre);

const PAGO = { id: "p1", org_id: "o1", empresa: "Inmobiliaria Andes", propietario: "ana@andes.com", plan_id: "profesional", plan: "Profesional", periodo: "mensual", referencia: "GPU-7F3K-2611",
  subtotal: 49, iva: 7.35, total: 56.35, estado: "en_revision", comprobante_path: "o1/p1-123.jpg", comprobante_subido_at: new Date(Date.now() - 3 * 3600000).toISOString(), created_at: new Date(Date.now() - 5 * 3600000).toISOString(), estado_empresa: "prueba", periodo_hasta: null };
const PENDIENTE = Object.assign({}, PAGO, { id: "p2", empresa: "Constructora Sol", referencia: "GPU-AAAA-0002", estado: "pendiente", comprobante_path: null, comprobante_subido_at: null });
const EMPRESAS = [
  { id: "o1", nombre: "Inmobiliaria Andes", plan_id: "inicial", plan: "Inicial", estado: "prueba", prueba_hasta: new Date(Date.now() + 5 * 86400000).toISOString(), periodo_hasta: null, propietario: "ana@andes.com", usuarios: 2, leads_mes: 40, ultimo_pago: null, pago_abierto: true },
  { id: "o2", nombre: "Constructora Sol", plan_id: "profesional", plan: "Profesional", estado: "gracia", prueba_hasta: null, periodo_hasta: new Date(Date.now() - 86400000).toISOString(), propietario: "luis@sol.com", usuarios: 5, leads_mes: 210, ultimo_pago: "2026-09-12", pago_abierto: false }
];
const FX = { sinSesion: true, pagosConsola: { en_revision: [PAGO], pendiente: [PENDIENTE] }, empresas: EMPRESAS,
  historial: [{ id: "h1", empresa: "Constructora Sol", plan_id: "profesional", periodo: "mensual", total: 56.35, fecha_transferencia: "2026-09-12", factura_numero: "001-001-000000100", cubre_hasta: "2026-10-12T00:00:00Z", created_at: "2026-09-12T10:00:00Z" }] };

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  try {
    /* 1. Entrar */
    let { page, errores } = await abrirApp(browser, url, FX, { width: 1280, height: 900 }, OPC);
    assert.equal(await page.isVisible("#login"), true); ok("sin sesión: pide correo y contraseña");
    await page.fill("#login-email", "yo@gpunlock.com"); await page.fill("#login-clave", "secreto-123");
    await page.click("#login-btn");
    await page.waitForSelector("#consola:not([hidden])");
    assert.equal(await page.evaluate(() => window.__FX.login.email), "yo@gpunlock.com"); ok("entra con correo y contraseña");

    /* 2. Pagos por revisar */
    assert.match(await page.textContent('#tabs [aria-current="page"]'), /Pagos por revisar.*1/s); ok("la pestaña muestra cuántos pagos hay por revisar");
    const t = await page.textContent("#vista");
    assert.match(t, /Inmobiliaria Andes/); assert.match(t, /GPU-7F3K-2611/); assert.match(t, /56,35/); assert.match(t, /ana@andes\.com/); ok("la tarjeta muestra empresa, referencia, total y propietario");
    assert.match(t, /Esperando su transferencia[\s\S]*Constructora Sol/); ok("también lista a quienes aún no suben comprobante");
    await page.evaluate(() => { window.__abiertos = []; window.open = (u) => { window.__abiertos.push(u); }; });
    await page.click('[data-a="ver"]');
    await page.waitForFunction(() => window.__abiertos.length === 1);
    const firma = await page.evaluate(() => ({ f: window.__FX.firmas[0], a: window.__abiertos[0] }));
    assert.equal(firma.f.bucket, "comprobantes"); assert.equal(firma.f.path, "o1/p1-123.jpg"); assert.ok(firma.f.seg <= 300); assert.match(firma.a, /firmado\/o1\/p1-123\.jpg/); ok("abre el comprobante con un enlace firmado de corta duración");

    /* 3. Aprobar */
    await page.click('[data-a="aprobar"][data-id="p1"]');
    assert.match(await page.textContent("#dlg"), /ya ves.*\$56,35.*GPU-7F3K-2611/s); ok("pide confirmar que ya ve el dinero, con monto y referencia");
    await page.fill('#dlg [name="factura"]', "001-001-000000123");
    await page.fill('#dlg [name="banco"]', "Pichincha");
    await page.click('#dlg [type="submit"]');
    await page.waitForFunction(() => /Plan activado hasta/.test(document.querySelector("#toast").textContent));
    const ap = (await llamadas(page, "aprobar_pago"))[0];
    assert.equal(ap.p_solicitud, "p1"); assert.equal(ap.p_factura, "001-001-000000123"); assert.equal(ap.p_banco, "Pichincha"); assert.match(ap.p_fecha, /^\d{4}-\d{2}-\d{2}$/); ok("aprueba con fecha, banco y factura");

    /* 4. Rechazar exige motivo (lo valida la base y se ve en el diálogo) */
    await page.click('[data-a="rechazar"][data-id="p1"]');
    await page.click('#dlg [type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#dlg .aviso").hidden);
    assert.match(await page.textContent("#dlg .aviso"), /Escribe el motivo/); ok("rechazar sin motivo: el error aparece en el diálogo");
    await page.fill('#dlg [name="motivo"]', "No vemos la transferencia en el banco");
    await page.click('#dlg [type="submit"]');
    await page.waitForFunction(() => /Pago rechazado/.test(document.querySelector("#toast").textContent));
    assert.equal((await llamadas(page, "rechazar_pago")).pop().p_motivo, "No vemos la transferencia en el banco"); ok("rechaza con motivo");

    /* 5. Empresas */
    await page.click('[data-a="vista"][data-v="empresas"]');
    const filas = await page.locator("tbody tr").count();
    assert.equal(filas, 2); assert.match(await page.textContent("tbody"), /Pago abierto/); assert.match(await page.textContent("tbody"), /En gracia/); ok("lista las empresas con su estado");
    await page.click('[data-a="pago-manual"][data-id="o2"]');
    await page.selectOption('#dlg [name="plan"]', "agencia"); await page.selectOption('#dlg [name="periodo"]', "anual");
    await page.fill('#dlg [name="total"]', "1483.5"); await page.fill('#dlg [name="factura"]', "F-9");
    await page.click('#dlg [type="submit"]');
    await page.waitForFunction(() => /Pago registrado/.test(document.querySelector("#toast").textContent));
    const pm = (await llamadas(page, "registrar_pago_manual"))[0];
    assert.deepEqual([pm.p_org, pm.p_plan, pm.p_periodo, pm.p_total, pm.p_factura], ["o2", "agencia", "anual", 1483.5, "F-9"]); ok("registra un pago manual con monto numérico");
    await page.click('[data-a="ajustar"][data-id="o1"]');
    await page.fill('#dlg [name="dias"]', "10");
    await page.click('#dlg [type="submit"]');
    await page.waitForFunction(() => /Ajuste guardado/.test(document.querySelector("#toast").textContent));
    const aj = (await llamadas(page, "consola_ajustar"))[0];
    assert.equal(aj.p_prueba_dias, 10); assert.equal(aj.p_plan, null); assert.equal(aj.p_estado, null); assert.equal(aj.p_periodo_hasta, null); ok("extiende la prueba sin tocar lo demás");

    /* 6. Ingresos */
    await page.click('[data-a="vista"][data-v="ingresos"]');
    assert.match(await page.textContent(".kpis"), /98,00/); assert.match(await page.textContent("#vista"), /2026-10/); assert.match(await page.textContent("#vista"), /001-001-000000100/); ok("ingresos del mes, gráfico por mes y pagos recientes");

    /* 7. Datos de cobro */
    await page.click('[data-a="vista"][data-v="cobro"]');
    assert.equal(await page.inputValue('[name="numero_cuenta"]'), "2100123456"); assert.equal(await page.inputValue('[name="iva"]'), "15");
    await page.fill('[name="iva"]', "12"); await page.fill('[name="gracia"]', "3");
    await page.click('#form-cobro [type="submit"]');
    await page.waitForFunction(() => /Datos de cobro guardados/.test(document.querySelector("#toast").textContent));
    const gc = (await llamadas(page, "guardar_datos_cobro")).pop();
    assert.equal(gc.p_iva, 12); assert.equal(gc.p_dias_gracia, 3); assert.equal(gc.p_numero_cuenta, "2100123456"); ok("guarda los datos de cobro (IVA y días de gracia numéricos)");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("sin desbordes horizontales");
    assert.deepEqual(errores, []); ok("sin errores en la consola");
    await page.context().close();

    /* 8. Quien no es del equipo no entra */
    ({ page, errores } = await abrirApp(browser, url, Object.assign({}, FX, { sinSesion: false, superadmin: false }), { width: 1280, height: 900 }, OPC));
    assert.equal(await page.isVisible("#denegado"), true); assert.equal(await page.isVisible("#consola"), false);
    assert.equal((await llamadas(page, "consola_pagos")).length, 0); ok("una cuenta que no es del equipo ve «Sin acceso» y no pide datos");
    await page.context().close();

    /* 9. Contraseña incorrecta */
    ({ page } = await abrirApp(browser, url, Object.assign({}, FX, { claveMala: true }), { width: 1280, height: 900 }, OPC));
    await page.fill("#login-email", "x@x.com"); await page.fill("#login-clave", "mala"); await page.click("#login-btn");
    await page.waitForFunction(() => !document.querySelector("#login-error").hidden);
    assert.match(await page.textContent("#login-error"), /incorrectos/); ok("contraseña incorrecta: mensaje claro");
    await page.context().close();

    /* 10. Celular */
    ({ page } = await abrirApp(browser, url, Object.assign({}, FX, { sinSesion: false }), { width: 390, height: 844 }, OPC));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("la consola cabe en un celular");
    await page.screenshot({ path: (process.env.CAPTURAS || "/tmp") + "/consola-celular.png", fullPage: true });
    await page.context().close();
  } finally { await browser.close(); server.close(); }
  console.log("Todas las pruebas de la consola pasaron (" + n + ").");
})().catch((e) => { console.error(e); process.exit(1); });
