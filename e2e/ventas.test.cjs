/* Embudo premium: primera respuesta (speed-to-lead), alertas por etapa, valor ponderado, automatizaciones,
   lo que busca cada cliente y el matching con el inventario.
   Uso: NODE_PATH=$(npm root -g) node e2e/ventas.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const ORG = "11111111-1111-1111-1111-111111111111", AHORA = Date.now(), MIN = 60000, DIA = 864e5;
const iso = (t) => new Date(t).toISOString();
const OP = (id, nombre, o) => Object.assign({ id, org_id: ORG, contacto_id: "c" + id, etapa: "nuevo", proyecto: "torre", asignado_a: "ana@x.com", fuente: "whatsapp", valor_estimado: null,
  created_at: iso(AHORA - DIA), updated_at: iso(AHORA - 3600e3), etapa_desde: iso(AHORA - DIA), ultima_actividad_at: iso(AHORA - 3600e3), primera_respuesta_at: iso(AHORA - DIA + 12 * MIN),
  contacto: { id: "c" + id, nombre, telefono: "0991111111", telefono_norm: "593991111111" } }, o);
const OPS = () => [
  OP("o1", "Lucía Nueva", { created_at: iso(AHORA - 30 * MIN), etapa_desde: iso(AHORA - 30 * MIN), primera_respuesta_at: null, ultima_actividad_at: null }),
  OP("o2", "Pedro Quieto", { etapa: "cita", etapa_desde: iso(AHORA - 6 * DIA), ultima_actividad_at: iso(AHORA - 6 * DIA), created_at: iso(AHORA - 9 * DIA), valor_estimado: 100000 }),
  OP("o3", "Marta Activa", { etapa: "proforma", valor_estimado: 200000, contacto: { id: "co3", nombre: "Marta Activa", telefono: "0993333333", telefono_norm: "593993333333" } }),
  OP("o4", "Otro Asesor", { asignado_a: "beto@x.com", created_at: iso(AHORA - 5 * MIN), primera_respuesta_at: null, ultima_actividad_at: null })
];
const UNIDADES = [{ id: "u1", org_id: ORG, proyecto: "torre", codigo: "A-101", tipo: "departamento", dormitorios: 2, area_m2: 80, precio: 110000, estado: "disponible", fotos: [], publica: true, estado_at: iso(AHORA) }];
const VENTAS = { sla_minutos: 15, etapas: { nuevo: { probabilidad: 5, dias_alerta: 1 }, contactado: { probabilidad: 10, dias_alerta: 3 }, cita: { probabilidad: 30, dias_alerta: 4 }, proforma: { probabilidad: 50, dias_alerta: 7 }, reserva: { probabilidad: 85, dias_alerta: 15 } } };
const FX = (o) => Object.assign({ ventas: VENTAS, unidades: UNIDADES, tables: { crm_proyectos: [{ slug: "torre", nombre: "Torre Alba", activo: true }], crm_oportunidades: OPS(),
  crm_actividades: [] } }, o);
const llamadas = (page, nombre) => page.evaluate((nom) => window.__FX.calls.filter((c) => c.name === nom).map((c) => c.args), nombre);
const abrirLead = async (page, id) => { await page.locator('.lead[data-id="' + id + '"]').first().click({ position: { x: 12, y: 12 } }); await page.waitForSelector("#sheet:not([hidden]) .sh-body"); };

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Hoy: sin responder primero, alertas y registro automático del contacto */
    let { page, errores, ctx } = await abrirApp(browser, url, FX({ tables: { crm_proyectos: [{ slug: "torre", nombre: "Torre Alba", activo: true }], crm_oportunidades: OPS(),
      crm_actividades: [{ id: "t1", oportunidad_id: "o3", contenido: "Seguimiento", vence_at: iso(AHORA + DIA), tipo: "tarea" }] } }));
    const secs = await page.$$eval("#view .sec h2", (h) => h.map((x) => x.textContent));
    assert.match(secs[0], /^Sin responder \(2\)$/); ok("«Sin responder» va primero en Hoy (incluye los del equipo para el propietario)");
    const chip = await page.locator('.lead[data-id="o1"] .lead-chips .chip').first();
    assert.match(await chip.textContent(), /Sin responder · 30 min/); assert.match(await chip.getAttribute("class"), /red/); ok("30 min sin responder con meta de 15: alerta en rojo");
    assert.match(await page.locator('.lead[data-id="o4"] .lead-chips .chip').first().getAttribute("class"), /amber/); ok("5 min sin responder: aviso amarillo (todavía en meta)");
    assert.match(await page.textContent(".stats"), /2\s*Sin responder/); assert.match(await page.textContent("#view"), /meta: responder en 15 min/); ok("la cifra de sin responder y la meta, arriba");
    assert.match(await page.textContent("#view"), /Sin movimiento/); assert.match(await page.locator('.lead[data-id="o2"]').first().textContent(), /6 d sin actividad/); ok("un lead en «cita» 6 días quieto (alerta a los 4) aparece en «Sin movimiento»");
    assert.match(await page.locator('.lead[data-id="o2"]').first().textContent(), /Sin próxima tarea/); ok("y avisa que no tiene próxima tarea");
    await page.click('[data-action="vista"][data-v="embudo"]');
    assert.doesNotMatch(await page.locator('.lead[data-id="o3"]').textContent(), /Sin próxima tarea|sin actividad|Sin responder/); ok("un lead al día no muestra alertas");
    await page.locator('.lead[data-id="o1"] [data-action="contacto-directo"][data-t="whatsapp"]').click();
    await page.waitForFunction(() => window.__FX.escrituras.some((w) => w.tabla === "crm_actividades"));
    const ins = (await page.evaluate(() => window.__FX.escrituras.filter((w) => w.tabla === "crm_actividades")))[0].cadena[0];
    assert.equal(ins[0], "insert"); assert.deepEqual([ins[1][0].oportunidad_id, ins[1][0].tipo, ins[1][0].creado_por], ["o1", "whatsapp", "ana@x.com"]); ok("tocar WhatsApp registra el contacto solo (así se mide la primera respuesta)");

    /* 2. Embudo con valor y ponderado */
    const cita = await page.textContent("#col-cita .col-valor"), prof = await page.textContent("#col-proforma .col-valor");
    assert.match(cita, /\$\s?100\.000/); assert.match(cita, /≈ \$\s?30\.000 ponderado/); assert.match(prof, /≈ \$\s?100\.000 ponderado/); ok("cada columna muestra su valor y el ponderado por la probabilidad de la etapa");
    if (out) await page.screenshot({ path: out + "/ventas-embudo.png" });
    assert.deepEqual(errores, []); await ctx.close();

    /* 3. Ficha: tiempo de respuesta, lo que busca y unidades que calzan → proforma */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ sugeridas: [Object.assign({}, UNIDADES[0], { puntaje: 100 })] })));
    await page.click('[data-action="vista"][data-v="embudo"]'); await abrirLead(page, "o1");
    assert.match(await page.textContent("#sheet-panel"), /Sin responder hace 30 min · meta 15 min/); ok("la ficha dice cuánto lleva sin responder y la meta");
    assert.match(await page.textContent("#card-busqueda"), /Anota qué busca/);
    await page.click('[data-action="busq-editar"]'); await page.waitForSelector("#form-busqueda");
    assert.equal(await page.inputValue('#form-busqueda [name="proyecto"]'), "torre"); ok("el proyecto del lead viene sugerido");
    await page.click('#form-busqueda .chip-sel:has-text("Departamento")'); await page.click('#form-busqueda .chip-sel:has-text("Suite")');
    await page.fill('#form-busqueda [name="precio_max"]', "abc"); await page.click('#form-busqueda button[type="submit"]');
    assert.match(await page.textContent("#toast"), /presupuesto no es un número/); ok("valida el presupuesto");
    await page.fill('#form-busqueda [name="precio_max"]', "120.000"); await page.selectOption('#form-busqueda [name="dormitorios_min"]', "2"); await page.fill('#form-busqueda [name="notas"]', "Piso alto");
    await page.click('#form-busqueda button[type="submit"]'); await page.waitForSelector(".sug [data-action=\"sug-proforma\"]");
    assert.deepEqual((await llamadas(page, "guardar_busqueda"))[0], { p_op: "o1", p_datos: { tipos: ["departamento", "suite"], proyecto: "torre", dormitorios_min: 2, notas: "Piso alto", precio_min: null, precio_max: 120000 } }); ok("guarda tipo, presupuesto (120.000), dormitorios y notas");
    const busq = await page.textContent("#card-busqueda");
    assert.match(busq, /Departamento o Suite · 2\+ dorm\. · hasta \$\s?120\.000 · Torre Alba/); assert.match(busq, /Unidades que le calzan \(1\).*A-101.*Calza 100 %.*\$\s?110\.000/s); ok("resume lo que busca y muestra las unidades que le calzan");
    await page.click('[data-action="sug-proforma"]'); await page.waitForSelector(".cot-elegido");
    assert.match(await page.textContent(".cot-elegido"), /Lucía Nueva/); assert.deepEqual(await page.$$eval(".cot-chip b", (b) => b.map((x) => x.textContent)), ["A-101"]); ok("«Proforma» abre el cotizador con el cliente y la unidad ya elegidos");
    await page.click('.cot-cab [data-action="cerrar-modal"]');
    assert.deepEqual(errores, []); await ctx.close();

    /* 4. En la unidad: clientes que buscan algo así */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ interesados: [{ oportunidad_id: "o3", nombre: "Marta Activa", telefono_norm: "593993333333", etapa: "proforma", asignado_a: "ana@x.com", puntaje: 95 }] })));
    await page.click('[data-action="vista"][data-v="inventario"]'); await page.click('.unidad:has-text("A-101")'); await page.waitForSelector("#unidad-interesados .sug");
    const int = await page.textContent("#unidad-interesados");
    assert.match(int, /Marta Activa.*Calza 95 %.*Proforma/s); ok("la unidad muestra los clientes cuya búsqueda calza");
    const wa = new URL(await page.getAttribute('#unidad-interesados a.btn-wa', "href"));
    assert.equal(wa.pathname, "/593993333333"); assert.match(wa.searchParams.get("text"), /^Hola Marta, tengo una opción que encaja con lo que buscas: departamento A-101 en Torre Alba por \$\s?110\.000/); ok("«Avisar» abre WhatsApp con el mensaje listo");
    await page.click('[data-action="int-proforma"]'); await page.waitForSelector(".cot-elegido");
    assert.match(await page.textContent(".cot-elegido"), /Marta Activa/); ok("y se le hace la proforma en un toque");
    assert.deepEqual(errores, []); await ctx.close();

    /* 5. Ajustes → Embudo: meta de respuesta, probabilidades y tareas automáticas */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await page.click('[data-action="vista"][data-v="ajustes"]'); await page.click('[data-action="aj-sec"][data-s="embudo"]'); await page.waitForSelector("#form-embudo");
    assert.equal(await page.inputValue('#form-embudo [name="sla"]'), "15"); assert.equal(await page.inputValue('#form-embudo [name="p_cita"]'), "30"); ok("muestra la configuración actual");
    await page.fill('#form-embudo [name="p_cita"]', "150"); await page.click('#form-embudo button[type="submit"]'); assert.match(await page.textContent("#toast"), /probabilidad de «Cita» va de 0 a 100/); ok("valida las probabilidades");
    await page.fill('#form-embudo [name="p_cita"]', "35"); await page.fill('#form-embudo [name="sla"]', "10"); await page.fill('#form-embudo [name="d_proforma"]', "");
    await page.click('#form-embudo button[type="submit"]'); await page.waitForFunction(() => /Embudo guardado/.test(document.querySelector("#toast")?.textContent || ""));
    const g = (await llamadas(page, "guardar_config_ventas"))[0];
    assert.equal(g.p_sla, 10); assert.deepEqual(g.p_etapas.cita, { probabilidad: 35, dias_alerta: 4 }); assert.deepEqual(g.p_etapas.proforma, { probabilidad: 50, dias_alerta: null }); ok("guarda la meta, las probabilidades y permite quitar una alerta");
    assert.match(await page.textContent("#view"), /Aún no hay tareas automáticas/);
    await page.selectOption('#form-auto [name="etapa"]', "nuevo"); await page.selectOption('#form-auto [name="vence"]', "15"); await page.fill('#form-auto [name="titulo"]', "Contactar a {cliente} por WhatsApp");
    await page.click('#form-auto button[type="submit"]'); await page.waitForFunction(() => /Contactar a \{cliente\}/.test(document.querySelector("#view")?.textContent || ""));
    assert.deepEqual((await llamadas(page, "guardar_automatizacion"))[0], { p_org: ORG, p_id: null, p_etapa: "nuevo", p_titulo: "Contactar a {cliente} por WhatsApp", p_vence_min: 15, p_activa: true });
    assert.match(await page.textContent("#view"), /Al entrar a «Nuevo» · vence en 15 minutos/); ok("crea una tarea automática y la lista con su etapa y plazo");
    await page.click('[data-action="auto-activa"]'); await page.waitForFunction(() => /pausada/.test(document.querySelector("#view")?.textContent || ""));
    assert.equal((await llamadas(page, "guardar_automatizacion"))[1].p_activa, false); ok("se pausa");
    page.once("dialog", (d) => d.accept()); await page.click('[data-action="auto-borrar"]'); await page.waitForFunction(() => /Aún no hay tareas automáticas/.test(document.querySelector("#view")?.textContent || ""));
    assert.equal((await llamadas(page, "eliminar_automatizacion"))[0].p_id, "au1"); ok("se elimina");
    if (out) await page.screenshot({ path: out + "/ventas-ajustes.png", fullPage: true });
    assert.deepEqual(errores, []); await ctx.close();

    /* 6. Métricas de ventas */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ metVentas: { sla_minutos: 15, primera_respuesta: { respondidos: 10, mediana_min: 12, p90_min: 95, en_sla_pct: 80 }, sin_responder: 2,
      por_asesor: [{ email: "ana@x.com", respondidos: 6, mediana_min: 8 }], valor_abierto: 300000, valor_ponderado: 130000, con_tarea_pct: 60, estancados: 1 },
      rpc: { crm_metricas: { dias: 30, abiertas: 4, sin_asignar: 0, nuevos: 10, vendidos: 1, perdidos: 1, tareas_vencidas: 0, por_etapa: {}, por_fuente: [], por_asesor: [{ email: "ana@x.com", abiertas: 3, vendidos: 1 }], por_campana: [] } } })));
    await page.click('[data-action="vista"][data-v="metricas"]'); await page.waitForSelector(".stats");
    const t = await page.textContent("#view");
    assert.match(t, /Velocidad de respuesta.*12 min\s*Primera respuesta \(mediana\).*1,6 h\s*9 de cada 10.*80%\s*Respondidos en menos de 15 min.*2\s*Abiertos sin responder/s); ok("velocidad de respuesta: mediana, 9 de cada 10, % en meta y pendientes");
    assert.match(t, /Valor del embudo.*\$\s?300\.000\s*En negociación.*\$\s?130\.000\s*Ponderado por etapa.*60%\s*Con próxima tarea.*1\s*Estancados/s); ok("valor del embudo: en negociación, ponderado, % con próxima tarea y estancados");
    assert.match(await page.textContent(".tbl:last-of-type, #view"), /1\.ª respuesta/); assert.match(t, /Ana.*3.*1.*8 min/s); ok("tiempo de respuesta por asesor");
    assert.deepEqual(errores, []); await ctx.close();

    /* 7. Un agente no configura el embudo */
    ({ page, ctx } = await abrirApp(browser, url, FX({ rol: "agente" })));
    await page.click('[data-action="vista"][data-v="ajustes"]');
    assert.equal(await page.locator('[data-action="aj-sec"][data-s="embudo"]').count(), 0); ok("un agente no ve la pestaña Embudo"); await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Embudo premium: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
