/* Inventario en la app: lista y filtros, ficha, reservar/vender con lead, alta y edición, importación Excel/CSV, permisos por rol.
   Uso: NODE_PATH=$(npm root -g) node e2e/inventario.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
const { xlsx } = require("./xlsx-fixture.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

const ORG = "11111111-1111-1111-1111-111111111111";
const AHORA = Date.now();
const U = (o) => Object.assign({ id: "x", org_id: ORG, proyecto: "torre", codigo: "A-1", tipo: "departamento", bloque: null, piso: null, area_m2: null, dormitorios: null, banos: null, parqueos: null, bodegas: null, precio: null, estado: "disponible", descripcion: null, publica: true, estado_at: new Date(AHORA - 3 * 3600000).toISOString() }, o);
const UNIDADES = () => [
  U({ id: "u10", codigo: "A-10", piso: "10", bloque: "A", area_m2: 85.5, dormitorios: 2, banos: 2.5, parqueos: 1, precio: 120000 }),
  U({ id: "u2", codigo: "A-2", piso: "2", bloque: "A", area_m2: 60, dormitorios: 1, banos: 1, precio: 85000, descripcion: "Vista al parque" }),
  U({ id: "u3", codigo: "S-3", tipo: "suite", piso: "3", area_m2: 40, dormitorios: 1, precio: 70000 }),
  U({ id: "u4", codigo: "A-4", piso: "4", estado: "reservada", precio: 150000 }),
  U({ id: "u5", codigo: "A-5", piso: "5", estado: "vendida", precio: 160000 }),
  U({ id: "v1", proyecto: "valle", codigo: "L-1", tipo: "lote", area_m2: 300, precio: 45000 })
];
const PROYECTOS = [{ slug: "torre", nombre: "Torre Alba", activo: true, precios_publicos: true }, { slug: "valle", nombre: "Valle Verde", activo: true, precios_publicos: true }];
const OP = (id, nombre, o) => Object.assign({ id, org_id: ORG, etapa: "cita", proyecto: "torre", asignado_a: "ana@x.com", fuente: "whatsapp", created_at: new Date(AHORA - 864e5).toISOString(), updated_at: new Date(AHORA - 3600e3).toISOString(), contacto: { id: "c" + id, nombre, telefono: "0991111111", telefono_norm: "593991111111" } }, o);
const OPS = [OP("o1", "Cliente Uno"), OP("o2", "Cliente Dos", { proyecto: "valle" })];
const FX = (o) => Object.assign({ unidades: UNIDADES(), tables: { crm_proyectos: PROYECTOS, crm_oportunidades: OPS } }, o);

const irInv = async (page) => { await page.click('[data-action="vista"][data-v="inventario"]'); await page.waitForSelector("#inv-q, .empty"); };
const codigos = (page) => page.$$eval(".unidad .u-top b", (e) => e.map((x) => x.textContent));
const llamadas = (page, nombre) => page.evaluate((nom) => window.__FX.calls.filter((c) => c.name === nom).map((c) => c.args), nombre);

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Lista, filtros y búsqueda */
    let { page, errores, ctx } = await abrirApp(browser, url, FX());
    assert.equal(await page.locator("#tabbar .tab").count(), 6); assert.match(await page.textContent("#tabbar"), /Inventario/); ok("la barra tiene la pestaña Inventario");
    await irInv(page);
    assert.deepEqual(await codigos(page), ["S-3", "A-2", "A-10", "L-1"]); ok("por defecto muestra las disponibles, por proyecto, torre y piso en orden natural (A-2 antes que A-10)");
    const seg = await page.$$eval(".inv-seg button", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    assert.deepEqual(seg, ["Disponibles 4", "Reservadas 1", "Vendidas 1", "Todas 6"]); ok("los contadores por estado");
    const card = await page.locator(".unidad", { hasText: "A-10" }).textContent();
    assert.match(card, /Torre Alba/); assert.match(card, /Piso 10/); assert.match(card, /85,5 m²/); assert.match(card, /2 dorm\./); assert.match(card, /2,5 baños/); assert.match(card, /1 parq\./); assert.match(card, /\$\s?120\.000|120\.000/); assert.match(card, /Disponible/); ok("la tarjeta resume proyecto, piso, medidas y precio");
    await page.click('[data-action="inv-estado"][data-e="reservada"]'); assert.deepEqual(await codigos(page), ["A-4"]); ok("filtra por reservadas");
    await page.click('[data-action="inv-estado"][data-e=""]'); assert.equal((await codigos(page)).length, 6); ok("«Todas» las muestra");
    await page.selectOption("#inv-proyecto", "valle"); assert.deepEqual(await codigos(page), ["L-1"]); ok("filtra por proyecto");
    await page.selectOption("#inv-proyecto", ""); await page.selectOption("#inv-tipo", "suite"); assert.deepEqual(await codigos(page), ["S-3"]); ok("filtra por tipo");
    await page.selectOption("#inv-tipo", ""); await page.fill("#inv-q", "a-1"); await page.waitForFunction(() => document.querySelectorAll(".unidad").length === 1);
    assert.deepEqual(await codigos(page), ["A-10"]); assert.equal(await page.evaluate(() => document.activeElement.id), "inv-q"); ok("busca por código sin perder el foco del buscador");
    await page.fill("#inv-q", "zzz"); await page.waitForSelector(".empty"); assert.match(await page.textContent(".empty"), /No hay unidades con esos filtros/); ok("sin resultados lo dice");
    await page.fill("#inv-q", "");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("la barra de 6 pestañas y la lista caben en el celular");
    if (out) { await page.waitForSelector(".unidad"); await page.screenshot({ path: out + "/inventario-1-lista.png", fullPage: true }); }
    assert.deepEqual(errores, []); await ctx.close();

    /* 2. Ficha, historial y reservar para un lead */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ historialUnidades: [
      { id: 1, unidad_id: "u10", estado_antes: null, estado_despues: "disponible", por: "ana@x.com", nota: "Unidad creada", created_at: new Date(AHORA - 5 * 864e5).toISOString() },
      { id: 2, unidad_id: "u10", estado_antes: "disponible", estado_despues: "disponible", precio_antes: 110000, precio_despues: 120000, por: "ana@x.com", created_at: new Date(AHORA - 2 * 864e5).toISOString() }] })));
    await irInv(page);
    await page.click('.unidad:has-text("A-10")'); await page.waitForSelector("#unidad-hist .item");
    const ficha = await page.textContent("#modal-card");
    assert.match(ficha, /A-10/); assert.match(ficha, /Torre Alba/); assert.match(ficha, /85,5 m²/); assert.match(ficha, /\$\s?120\.000,00|120\.000,00/); assert.match(ficha, /Visible/); ok("la ficha muestra todos los datos");
    assert.match(await page.textContent("#unidad-hist"), /Unidad creada/); assert.match(await page.textContent("#unidad-hist"), /Precio .*110\.000.*120\.000/s); ok("el historial muestra el alta y el cambio de precio");
    assert.deepEqual(await page.$$eval('[data-action="unidad-estado"]', (b) => b.map((x) => x.dataset.e)), ["reservada", "vendida", "no_disponible"]); ok("el propietario puede reservar, vender o bloquear");
    const leads = await page.$$eval("#u-lead option", (o) => o.map((x) => x.textContent));
    assert.match(leads[1], /Cliente Uno/); assert.match(leads[2], /Cliente Dos/); ok("los leads aparecen con los del mismo proyecto primero");
    await page.selectOption("#u-lead", "o1"); await page.fill("#u-nota", "Dejó $500 de señal");
    await page.click('[data-action="unidad-estado"][data-e="reservada"]');
    await page.waitForFunction(() => /Unidad reservada y lead actualizado/.test(document.querySelector("#toast")?.textContent || ""));
    assert.deepEqual((await llamadas(page, "cambiar_estado_unidad"))[0], { p_unidad: "u10", p_estado: "reservada", p_oportunidad: "o1", p_nota: "Dejó $500 de señal" }); ok("envía unidad, estado, lead y nota");
    await page.click('[data-action="inv-estado"][data-e="reservada"]'); assert.deepEqual(await codigos(page), ["A-4", "A-10"]); ok("la unidad pasa a reservadas en la lista");
    await page.click('.unidad:has-text("A-10")'); await page.waitForSelector("#unidad-hist .item");
    assert.match(await page.textContent("#unidad-hist"), /Disponible → Reservada.*Dejó \$500/s); assert.deepEqual(await page.$$eval('[data-action="unidad-estado"]', (b) => b.map((x) => x.dataset.e)), ["disponible", "vendida", "no_disponible"]); ok("la ficha ahora ofrece liberar y muestra el movimiento");
    assert.deepEqual(errores, []); await ctx.close();

    /* 3. Un agente solo reserva y libera */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ rol: "agente" })));
    await irInv(page);
    assert.equal(await page.locator('[data-action="unidad-nueva"], [data-action="importar"]').count(), 0); ok("un agente no ve «Unidad» ni «Importar»");
    await page.click('.unidad:has-text("A-2")'); await page.waitForSelector("#unidad-hist");
    assert.deepEqual(await page.$$eval('[data-action="unidad-estado"]', (b) => b.map((x) => x.dataset.e)), ["reservada"]); assert.equal(await page.locator('[data-action="unidad-editar"], [data-action="unidad-eliminar"]').count(), 0); ok("solo puede reservar; no edita ni elimina");
    await page.click('button[data-action="cerrar-modal"]'); await page.click('[data-action="inv-estado"][data-e="vendida"]'); await page.click('.unidad:has-text("A-5")');
    assert.equal(await page.locator('[data-action="unidad-estado"]').count(), 0); assert.match(await page.textContent("#modal-card"), /Solo un administrador/); ok("una unidad vendida solo la cambia un administrador");
    await ctx.close();
    ({ page, ctx } = await abrirApp(browser, url, FX({ rol: "lector" })));
    await irInv(page); await page.click('.unidad:has-text("A-2")'); await page.waitForSelector("#unidad-hist");
    assert.equal(await page.locator('[data-action="unidad-estado"]').count(), 0); ok("un lector solo mira"); await ctx.close();

    /* 4. Alta y edición */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await irInv(page); await page.click('[data-action="unidad-nueva"]'); await page.waitForSelector("#form-unidad");
    await page.click('#form-unidad button[type="submit"]'); assert.match(await page.textContent("#toast"), /Escribe el código/); ok("el código es obligatorio");
    await page.fill('#form-unidad [name="codigo"]', "B-201"); await page.fill('#form-unidad [name="precio"]', "caro"); await page.click('#form-unidad button[type="submit"]');
    assert.match(await page.textContent("#toast"), /precio no es un número/); ok("un precio inválido se avisa antes de enviar");
    await page.selectOption('#form-unidad [name="tipo"]', "suite"); await page.fill('#form-unidad [name="piso"]', "2"); await page.fill('#form-unidad [name="area_m2"]', "85,5");
    await page.fill('#form-unidad [name="precio"]', "98.500"); await page.fill('#form-unidad [name="banos"]', "1,5"); await page.uncheck('#form-unidad [name="publica"]');
    await page.click('#form-unidad button[type="submit"]'); await page.waitForFunction(() => !document.querySelector("#form-unidad"));
    const g = (await llamadas(page, "guardar_unidad"))[0];
    assert.equal(g.p_org, ORG); assert.equal(g.p_id, null);
    assert.deepEqual(g.p_datos, { proyecto: "torre", codigo: "B-201", tipo: "suite", estado: "disponible", bloque: "", piso: "2", descripcion: "", publica: false, area_m2: 85.5, precio: 98500, dormitorios: null, banos: 1.5, parqueos: null, bodegas: null }); ok("crea la unidad: coma decimal, miles con punto, vacíos como null y «no mostrar en la web»");
    assert.ok((await codigos(page)).includes("B-201")); ok("aparece en la lista");
    await page.click('[data-action="unidad-nueva"]'); await page.fill('#form-unidad [name="codigo"]', "b-201"); await page.click('#form-unidad button[type="submit"]');
    await page.waitForFunction(() => /Ya existe una unidad/.test(document.querySelector("#toast")?.textContent || "")); ok("un código repetido muestra el error del servidor"); await page.click('button[data-action="cerrar-modal"]');
    await page.click('.unidad:has-text("A-2")'); await page.waitForSelector("#unidad-hist"); await page.click('[data-action="unidad-editar"]'); await page.fill('#form-unidad [name="precio"]', "90000"); await page.click('#form-unidad button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector("#form-unidad"));
    const e = (await llamadas(page, "guardar_unidad")).pop(); assert.equal(e.p_id, "u2"); assert.equal(e.p_datos.precio, 90000); assert.equal(e.p_datos.codigo, "A-2"); ok("edita una unidad existente");
    await page.click('.unidad:has-text("A-2")'); await page.waitForSelector("#unidad-hist"); page.once("dialog", (d) => d.accept()); await page.click('[data-action="unidad-eliminar"]');
    await page.waitForFunction(() => !document.querySelector(".unidad .u-top b") || ![...document.querySelectorAll(".unidad .u-top b")].some((b) => b.textContent === "A-2"));
    assert.equal((await llamadas(page, "eliminar_unidad"))[0].p_unidad, "u2"); ok("elimina una unidad con confirmación");
    assert.deepEqual(errores, []); await ctx.close();

    /* 5. Importar desde CSV */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await irInv(page); await page.click('[data-action="importar"]'); await page.waitForSelector("#imp-archivo");
    const csv = "Proyecto;Unidad;Tipo;Piso;Área (m²);Precio de venta;Estado\nTorre Alba;C-1;Depto;1;70,5;98.000;Libre\nValle Verde;C-2;terreno;;300;45.000;vendido\nOtro;C-3;casa;;;;\nTorre Alba;;suite;;;;\nTorre Alba;C-1;casa;;;;\n";
    await page.setInputFiles("#imp-archivo", { name: "inventario.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForSelector("[data-imp-map]");
    const mapa = await page.$$eval("[data-imp-map]", (s) => Object.fromEntries(s.map((x) => [x.dataset.impMap, x.options[x.selectedIndex].textContent])));
    assert.equal(mapa.proyecto, "Proyecto"); assert.equal(mapa.codigo, "Unidad"); assert.equal(mapa.area_m2, "Área (m²)"); assert.equal(mapa.precio, "Precio de venta"); assert.equal(mapa.dormitorios, "— no viene en el archivo —"); ok("reconoce las columnas por su título");
    const resumen = await page.textContent("#modal-card .card");
    assert.match(resumen, /2 unidades listas/); assert.match(resumen, /3 con errores/); assert.match(resumen, /Fila 4: .*proyecto «Otro» no existe/s); assert.match(resumen, /Fila 5: Falta el código/); assert.match(resumen, /Fila 6: .*repetido/); ok("vista previa: 2 listas y 3 con errores, cada una con su fila y motivo");
    assert.equal(await page.textContent('[data-action="imp-confirmar"]'), "Importar 2"); ok("el botón dice cuántas se importan");
    await page.click('[data-action="imp-confirmar"]'); await page.waitForFunction(() => /Importación lista/.test(document.querySelector("#toast")?.textContent || ""));
    const imp = (await llamadas(page, "importar_unidades"))[0];
    assert.equal(imp.p_org, ORG); assert.equal(imp.p_actualizar_estado, false); assert.equal(imp.p_filas.length, 2);
    assert.deepEqual(imp.p_filas[0], { fila: 2, codigo: "C-1", proyecto: "torre", tipo: "departamento", piso: "1", area_m2: 70.5, precio: 98000, estado: "disponible" }); ok("envía solo las filas válidas, ya normalizadas");
    assert.match(await page.textContent("#toast"), /2 nuevas y 0 actualizadas/); await page.click('[data-action="inv-estado"][data-e=""]'); assert.ok((await codigos(page)).includes("C-1")); ok("avisa el resultado y refresca la lista");
    assert.deepEqual(errores, []); await ctx.close();

    /* 6. Importar desde Excel, con proyecto elegido y estado actualizable */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await irInv(page); await page.click('[data-action="importar"]');
    const libro = xlsx([["Lote", "Mz", "Superficie", "Valor", "Disponibilidad"], ["L-1", "A", 300, 46000, "Reservado"], ["L-2", "A", 280.5, 41000, "Disponible"]]);
    await page.setInputFiles("#imp-archivo", { name: "lotes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: libro });
    await page.waitForSelector("[data-imp-map]");
    assert.match(await page.textContent("#modal-card .card"), /2 unidades listas/); ok("lee un archivo .xlsx de verdad");
    await page.selectOption("#imp-proyecto", "valle"); await page.check("#imp-estado"); await page.click('[data-action="imp-confirmar"]');
    await page.waitForFunction(() => /Importación lista/.test(document.querySelector("#toast")?.textContent || ""));
    const imp2 = (await llamadas(page, "importar_unidades"))[0];
    assert.deepEqual(imp2.p_filas.map((f) => [f.proyecto, f.codigo, f.bloque, f.area_m2, f.precio, f.estado]), [["valle", "L-1", "A", 300, 46000, "reservada"], ["valle", "L-2", "A", 280.5, 41000, "disponible"]]);
    assert.equal(imp2.p_actualizar_estado, true); ok("usa el proyecto elegido, entiende «Reservado» y manda la opción de actualizar estados");
    assert.match(await page.textContent("#toast"), /1 nuevas y 1 actualizadas/); ok("L-1 ya existía y se actualiza"); await ctx.close();

    /* 7. Archivos y respuestas malas */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ respImportar: { ok: false, total_errores: 1, errores: [{ fila: 2, error: "El precio está fuera del rango permitido" }] } })));
    await irInv(page); await page.click('[data-action="importar"]');
    await page.setInputFiles("#imp-archivo", { name: "viejo.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
    await page.waitForFunction(() => /\.xls antiguos/.test(document.querySelector("#modal-card")?.textContent || "")); ok("un .xls antiguo explica qué hacer");
    await page.setInputFiles("#imp-archivo", { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("codigo;proyecto\nA-9;torre\n") });
    await page.waitForSelector("[data-imp-map]"); await page.click('[data-action="imp-confirmar"]');
    await page.waitForFunction(() => /El servidor encontró problemas: fila 2 \(El precio está fuera/.test(document.querySelector("#modal-card")?.textContent || "")); ok("si el servidor rechaza, se muestran sus errores en el diálogo y no se cierra");
    await page.selectOption('[data-imp-map="codigo"]', "-1"); assert.equal(await page.isDisabled('[data-action="imp-confirmar"]'), true); ok("sin columna de código no se puede importar");
    await ctx.close();

    /* 8. Vacío, sin proyectos y suscripción vencida */
    ({ page, ctx } = await abrirApp(browser, url, FX({ unidades: [] })));
    await irInv(page); assert.match(await page.textContent("#view"), /Tu inventario está vacío/); assert.equal(await page.locator('[data-action="importar"]').count(), 1); ok("inventario vacío: invita a agregar o importar"); await ctx.close();
    ({ page, ctx } = await abrirApp(browser, url, FX({ tables: { crm_proyectos: [], crm_oportunidades: [] } })));
    await irInv(page); assert.match(await page.textContent("#view"), /Crea el primero en.*Proyectos/); ok("sin proyectos explica dónde crearlos"); await ctx.close();
    ({ page, ctx } = await abrirApp(browser, url, FX({ uso: { estado: "vencida", activa: false } })));
    await irInv(page); assert.equal(await page.isDisabled('[data-action="unidad-nueva"]'), true); assert.equal(await page.isDisabled('[data-action="importar"]'), true);
    await page.click('.unidad:has-text("A-10")'); await page.waitForSelector("#unidad-hist"); assert.equal(await page.locator('[data-action="unidad-estado"], [data-action="unidad-editar"]').count(), 0);
    assert.match(await page.textContent("#modal-card"), /solo de lectura/); ok("con la suscripción vencida el inventario se ve pero no se cambia"); await ctx.close();

    /* 9. Tiempo real y Ajustes */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await irInv(page); assert.equal((await codigos(page)).length, 4);
    await page.evaluate(() => { window.__FX.tables.crm_unidades.push({ id: "n9", org_id: "11111111-1111-1111-1111-111111111111", proyecto: "torre", codigo: "Z-9", tipo: "casa", estado: "disponible", publica: true, estado_at: new Date().toISOString() }); window.__FX.emitir("crm_unidades", { eventType: "INSERT" }); });
    await page.waitForFunction(() => document.querySelectorAll(".unidad").length === 5); ok("una unidad nueva de otro usuario aparece en vivo");
    await page.click('[data-action="vista"][data-v="ajustes"]'); await page.click('[data-action="aj-sec"][data-s="proyectos"]');
    await page.click('[data-action="proy-precios"][data-s="torre"]'); await page.waitForFunction(() => /precios ya no se muestran/.test(document.querySelector("#toast")?.textContent || ""));
    const w = await page.evaluate(() => window.__FX.escrituras.filter((x) => x.tabla === "crm_proyectos"));
    assert.deepEqual(w[0].cadena[0], ["update", [{ precios_publicos: false }]]); ok("el interruptor de precios en la web actualiza el proyecto");
    await page.click('[data-action="aj-sec"][data-s="integracion"]');
    const snip = await page.textContent("#snip-inv"); assert.match(snip, /data-crm-inventario data-proyecto="torre"/); assert.match(snip, /\/embed\/inventario\.js/); assert.match(snip, /data-clave="pk_demo"/); ok("«Tu sitio web» da el código para mostrar la disponibilidad");
    assert.deepEqual(errores, []); await ctx.close();

    /* 10. Escritorio */
    ({ page, ctx } = await abrirApp(browser, url, FX(), { width: 1280, height: 900 }));
    await irInv(page); await page.waitForSelector(".unidad");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("escritorio: sin desbordes");
    if (out) await page.screenshot({ path: out + "/inventario-2-escritorio.png" });
    await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Inventario en la app: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
