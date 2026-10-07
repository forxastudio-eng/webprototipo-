/* Importar la cartera de clientes desde Excel o CSV (también exportaciones de Kommo, Pipedrive o HubSpot).
   Uso: NODE_PATH=$(npm root -g) node e2e/cartera.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
const { xlsx } = require("./xlsx-fixture.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const FX = (o) => Object.assign({ tables: { crm_proyectos: [{ slug: "torre-alba", nombre: "Torre Alba", activo: true }], crm_oportunidades: [] },
  rpc: { crm_equipo: [{ email: "ana@x.com", nombre: "Ana", rol: "propietario" }, { email: "gabo@x.com", nombre: "Gabo Ruiz", rol: "agente" }] } }, o);
const llamadas = (page, nombre) => page.evaluate((nom) => window.__FX.calls.filter((c) => c.name === nom).map((c) => c.args), nombre);

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Exportación de Kommo en CSV */
    let { page, errores, ctx } = await abrirApp(browser, url, FX());
    await page.click('[data-action="vista"][data-v="embudo"]'); await page.click('[data-action="importar-leads"]'); await page.waitForSelector("#imp-archivo");
    assert.match(await page.textContent("#modal-card"), /Importar cartera de clientes.*Kommo, Pipedrive o HubSpot/s); ok("el embudo ofrece importar la cartera (Kommo, Pipedrive, HubSpot o Excel propio)");
    const csv = "Contacto principal;Teléfono móvil;Correo electrónico;Etapa;Usuario responsable;Presupuesto;Nombre del lead\n" +
      "Lucía Mora;099 123 4567;lucia@x.com;Visita agendada;Gabo Ruiz;120.000;Lead #1\n" +
      "Pedro Paz;;pedro@x.com;Ganado;;;Lead #2\n" +
      "Marta;0981111111;;En el limbo;Alguien;;Lead #3\n" +
      "Sin Datos;;;Nuevo;;;Lead #4\n";
    await page.setInputFiles("#imp-archivo", { name: "kommo.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForSelector("[data-imp-map]");
    const mapa = await page.$$eval("[data-imp-map]", (s) => Object.fromEntries(s.map((x) => [x.dataset.impMap, x.options[x.selectedIndex].textContent])));
    assert.equal(mapa.nombre, "Contacto principal"); assert.equal(mapa.telefono, "Teléfono móvil"); assert.equal(mapa.etapa, "Etapa"); assert.equal(mapa.asignado, "Usuario responsable"); assert.equal(mapa.valor, "Presupuesto"); ok("reconoce las columnas de Kommo solas");
    const res = await page.textContent("#modal-card .card");
    assert.match(res, /3 clientes listos.*1 con errores/s); assert.match(res, /Fila 5: Falta el teléfono o el correo/); assert.match(res, /etapa que no reconocimos/); assert.match(res, /asesor que no está en tu equipo/); ok("vista previa: listos, errores por fila y avisos");
    await page.selectOption("#imp-proyecto", "torre-alba"); await page.selectOption("#imp-fuente", "referido"); await page.selectOption("#imp-asignado", "__repartir__");
    if (out) await page.screenshot({ path: out + "/cartera-1.png", fullPage: true });
    await page.click('[data-action="imp-confirmar"]'); await page.waitForSelector('[data-action="imp-deshacer"]');
    const imp = (await llamadas(page, "importar_leads"))[0];
    assert.equal(imp.p_archivo, "kommo.csv"); assert.deepEqual(imp.p_defectos, { proyecto: "torre-alba", fuente: "referido", asignado: "__repartir__" });
    assert.deepEqual(imp.p_filas[0], { fila: 2, nombre: "Lucía Mora", telefono: "099 123 4567", correo: "lucia@x.com", etapa: "cita", asignado: "gabo@x.com", valor: 120000 });
    assert.deepEqual(imp.p_filas[1], { fila: 3, nombre: "Pedro Paz", correo: "pedro@x.com", etapa: "vendido" }); assert.equal(imp.p_filas.length, 3); ok("envía solo las filas válidas, normalizadas, con proyecto, fuente y reparto por defecto");
    assert.match(await page.textContent("#modal-card"), /2 leads importados.*1 ya estaba en tu CRM.*no se duplicaron.*deshacerlo durante 7 días/s); ok("resultado claro: importados, ya existentes y cómo deshacer");
    page.once("dialog", (d) => d.accept()); await page.click('[data-action="imp-deshacer"]');
    await page.waitForFunction(() => /Importación deshecha: 2 leads borrados/.test(document.querySelector("#toast")?.textContent || ""));
    assert.deepEqual((await llamadas(page, "deshacer_importacion"))[0], { p_id: "imp-1" }); ok("se puede deshacer en un toque");
    assert.deepEqual(errores, []); await ctx.close();

    /* 2. HubSpot en Excel: nombre y apellido por separado; plantilla descargable */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await page.click('[data-action="vista"][data-v="embudo"]'); await page.click('[data-action="importar-leads"]');
    const [descarga] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="imp-plantilla"]')]);
    assert.equal(descarga.suggestedFilename(), "plantilla-cartera.csv"); ok("la plantilla de cartera se descarga");
    const libro = xlsx([["First Name", "Last Name", "Phone Number", "Email", "Lifecycle Stage", "Contact owner"], ["Ana", "Ríos", "0997777777", "ana.rios@x.com", "Customer", "ana@x.com"]]);
    await page.setInputFiles("#imp-archivo", { name: "hubspot.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: libro });
    await page.waitForSelector("[data-imp-map]"); await page.click('[data-action="imp-confirmar"]'); await page.waitForSelector('[data-action="imp-deshacer"]');
    assert.deepEqual((await llamadas(page, "importar_leads"))[0].p_filas[0], { fila: 2, nombre: "Ana Ríos", telefono: "0997777777", correo: "ana.rios@x.com", etapa: "vendido", asignado: "ana@x.com" }); ok("HubSpot en Excel: une nombre y apellido, «Customer» → vendido");
    assert.deepEqual((await llamadas(page, "importar_leads"))[0].p_defectos, { proyecto: null, fuente: "cartera", asignado: null }); ok("por defecto: sin proyecto, fuente «cartera» y sin asignar");
    assert.deepEqual(errores, []); await ctx.close();

    /* 3. El servidor rechaza: errores en el diálogo; un agente no importa */
    ({ page, ctx } = await abrirApp(browser, url, FX({ respImportarLeads: { ok: false, total_errores: 1, errores: [{ fila: 2, error: "El proyecto no existe" }] } })));
    await page.click('[data-action="vista"][data-v="embudo"]'); await page.click('[data-action="importar-leads"]');
    await page.setInputFiles("#imp-archivo", { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("nombre;telefono\nAna;0991234567\n") });
    await page.waitForSelector("[data-imp-map]"); await page.click('[data-action="imp-confirmar"]');
    await page.waitForFunction(() => /El servidor encontró problemas: fila 2 \(El proyecto no existe\)/.test(document.querySelector("#modal-card")?.textContent || "")); ok("si el servidor rechaza, lo explica sin cerrar el diálogo");
    await ctx.close();
    ({ page, ctx } = await abrirApp(browser, url, FX({ rol: "agente" })));
    await page.click('[data-action="vista"][data-v="embudo"]');
    assert.equal(await page.locator('[data-action="importar-leads"]').count(), 0); ok("un agente no ve «Importar cartera»"); await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Importar cartera: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
