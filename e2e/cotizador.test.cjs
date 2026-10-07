/* Cotizador en la app: buscar al cliente (o escribir uno nuevo, sin duplicar), elegir unidades, condiciones en vivo, emitir y compartir.
   Uso: NODE_PATH=$(npm root -g) node e2e/cotizador.test.cjs */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
const C = require("../web/app/js/cotizar.js");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

const ORG = "11111111-1111-1111-1111-111111111111", AHORA = Date.now();
const U = (o) => Object.assign({ org_id: ORG, proyecto: "torre", tipo: "departamento", bloque: null, piso: null, area_m2: null, dormitorios: null, banos: null, parqueos: null, bodegas: null, estado: "disponible", descripcion: null, publica: true, fotos: [], estado_at: new Date(AHORA).toISOString() }, o);
const UNIDADES = () => [
  U({ id: "u10", codigo: "A-10", piso: "10", area_m2: 85.5, dormitorios: 2, banos: 2, precio: 120000, fotos: [ORG + "/u10/1.jpg"] }),
  U({ id: "p1", codigo: "P-01", tipo: "parqueo", precio: 8000 }),
  U({ id: "u2", codigo: "A-2", piso: "2", precio: 95000 }),
  U({ id: "u4", codigo: "A-4", estado: "reservada", precio: 150000 }),
  U({ id: "u5", codigo: "A-5", precio: null }),
  U({ id: "v1", proyecto: "valle", codigo: "L-1", tipo: "lote", precio: 45000 })
];
const PROYECTOS = [{ slug: "torre", nombre: "Torre Alba", activo: true, precios_publicos: true }, { slug: "valle", nombre: "Valle Verde", activo: true, precios_publicos: true }];
const OP = (id, nombre, tel, o) => Object.assign({ id, org_id: ORG, etapa: "cita", proyecto: "torre", asignado_a: "ana@x.com", fuente: "whatsapp", created_at: new Date(AHORA - 864e5).toISOString(), updated_at: new Date(AHORA - 3600e3).toISOString(),
  contacto: { id: "c" + id, nombre, telefono: tel, telefono_norm: "593" + tel.slice(1), correo: nombre.split(" ")[0].toLowerCase() + "@x.com" } }, o);
const OPS = () => [OP("o1", "Lucía Mora", "0991111111"), OP("o2", "Pedro Paz", "0992222222", { proyecto: "valle", updated_at: new Date(AHORA - 7200e3).toISOString() }), OP("o3", "Sin Dueño", "0993333333", { asignado_a: null })];
const CFG = [{ org_id: ORG, proyecto: "torre", prefijo: "TA", entrada_pct: 30, reserva_tipo: "monto", reserva_valor: 2500, cuotas_entrada: 12, tasa_anual: 9.5, plazo_anios: 20, descuento_max_pct: 5, vigencia_dias: 15, whatsapp: null, condiciones: null }];
const FX = (o) => Object.assign({ unidades: UNIDADES(), cfgCot: CFG.slice(), tables: { crm_proyectos: PROYECTOS, crm_oportunidades: OPS() } }, o);
const llamadas = (page, nombre) => page.evaluate((nom) => window.__FX.calls.filter((c) => c.name === nom).map((c) => c.args), nombre);
const linea = async (page, etiqueta) => page.$$eval(".cot-l, .cot-cuota", (ls, et) => { const l = ls.find((x) => x.querySelector("span").textContent.startsWith(et)); return l ? l.querySelector("b").textContent : null; }, etiqueta);
const usd = (v) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);
async function abrirCot(page) {
  await page.click('[data-action="vista"][data-v="inventario"]'); await page.waitForSelector('[data-action="nueva-proforma"]');
  await page.click('[data-action="nueva-proforma"]'); await page.waitForSelector("#cot-buscar");
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Buscar al cliente por nombre o teléfono, elegir unidades y ver las cifras en vivo */
    let { page, errores, ctx } = await abrirApp(browser, url, FX());
    await abrirCot(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), "cot-buscar"); ok("se abre con el buscador de clientes listo para escribir");
    assert.match(await page.textContent("#cot-resultados"), /Recientes.*Lucía Mora.*Pedro Paz/s); ok("sin escribir muestra los clientes recientes");
    await page.fill("#cot-buscar", "0992"); assert.match(await page.textContent("#cot-resultados"), /Pedro Paz/); assert.doesNotMatch(await page.textContent("#cot-resultados"), /Lucía/); ok("busca por teléfono");
    await page.fill("#cot-buscar", "lucia"); assert.match(await page.textContent("#cot-resultados"), /Lucía Mora.*Torre Alba.*Cita/s); ok("busca por nombre sin importar tildes y muestra proyecto y etapa");
    assert.match(await page.textContent("#cot-pie"), /Elige o escribe el cliente/); assert.equal(await page.isDisabled('[data-action="cot-emitir"]'), true); ok("el botón dice qué falta");
    await page.click('[data-action="cot-lead"][data-id="o1"]');
    assert.match(await page.textContent(".cot-elegido"), /Lucía Mora.*0991111111.*lucía@x\.com/s); ok("al elegirlo se ven sus datos");
    assert.match(await page.textContent("#cot-pie"), /Elige al menos una unidad/);
    assert.equal(await page.locator('.cot-uni[data-id="u4"]').count(), 0); assert.equal(await page.isDisabled('.cot-uni[data-id="u5"]'), true); ok("solo ofrece unidades disponibles; sin precio aparece deshabilitada");
    assert.equal(await page.locator('.cot-uni[data-id="u10"] img').count(), 1); ok("las unidades con foto la muestran");
    await page.click('.cot-uni[data-id="u10"]'); await page.fill("#cot-buscar-u", "p-0"); await page.waitForFunction(() => document.querySelectorAll(".cot-uni").length === 1);
    assert.equal(await page.evaluate(() => document.activeElement.id), "cot-buscar-u"); await page.click('.cot-uni[data-id="p1"]'); ok("agrega una segunda unidad (parqueo) buscándola, sin perder el foco");
    assert.deepEqual(await page.$$eval(".cot-chip b", (b) => b.map((x) => x.textContent)), ["A-10", "P-01"]); ok("las elegidas quedan arriba como etiquetas");
    let k = C.calcular({ precioLista: 128000, descuento: 0, forma: "credito", entradaPct: 30, reserva: 2500, cuotas: 12, tasa: 9.5, plazo: 20 });
    assert.equal(await linea(page, "Precio final"), usd(k.precioFinal)); assert.equal(await linea(page, "Reserva"), usd(2500)); assert.equal(await page.inputValue("#cot-reserva"), "2500"); ok("precio final y reserva sugerida (monto fijo del proyecto)");
    assert.equal(await linea(page, "Cuota mensual estimada"), usd(k.cuotaMensual)); assert.equal(await linea(page, "12 cuotas de entrada de"), usd(k.cuotaEntrada)); ok("cuota mensual y cuotas de la entrada calculadas en vivo");
    await page.fill("#cot-descuento", "3000");
    k = C.calcular({ precioLista: 128000, descuento: 3000, forma: "credito", entradaPct: 30, reserva: 2500, cuotas: 12, tasa: 9.5, plazo: 20 });
    assert.equal(await linea(page, "Descuento"), "− " + usd(3000)); assert.equal(await linea(page, "Cuota mensual estimada"), usd(k.cuotaMensual)); ok("el descuento recalcula todo al escribir");
    await page.click('[data-action="cot-desc-modo"]'); assert.equal(await page.inputValue("#cot-descuento"), "2,34"); assert.equal(await page.textContent(".cot-unidad"), "%"); ok("cambiar a % convierte el valor (3.000 = 2,34 %)");
    await page.click('[data-action="cot-desc-modo"]'); await page.fill("#cot-descuento", "3000");
    await page.fill("#cot-tasa", "8"); await page.fill("#cot-plazo", "25");
    k = C.calcular({ precioLista: 128000, descuento: 3000, forma: "credito", entradaPct: 30, reserva: 2500, cuotas: 12, tasa: 8, plazo: 25 });
    assert.equal(await linea(page, "Cuota mensual estimada"), usd(k.cuotaMensual)); ok("tasa y plazo cambian la cuota");
    await page.fill("#cot-plazo", "45"); assert.match(await page.textContent("#cot-pie"), /El plazo va de 1 a 30 años/); assert.equal(await page.isDisabled('[data-action="cot-emitir"]'), true); ok("valores fuera de rango se avisan y no dejan emitir");
    await page.fill("#cot-plazo", "25"); await page.fill("#cot-notas", "Incluye parqueo cubierto");
    if (out) await page.screenshot({ path: out + "/cotizador-1.png", fullPage: true });
    await page.click('[data-action="cot-emitir"]'); await page.waitForSelector(".cot-ok");
    const e = (await llamadas(page, "crear_cotizacion"))[0];
    assert.equal(e.p_org, ORG);
    assert.deepEqual(e.p_datos, { proyecto: "torre", unidades: ["u10", "p1"], descuento: 3000, forma_pago: "credito", entrada_pct: 30, reserva: 2500, cuotas_entrada: 12, tasa_anual: 8, plazo_anios: 25, notas: "Incluye parqueo cubierto", oportunidad_id: "o1" }); ok("envía al servidor el lead, las unidades y las condiciones");
    assert.match(await page.textContent(".cot-ok"), /Proforma TA-0001 lista.*Lucía Mora.*Torre Alba/s); ok("pantalla de éxito con número y cliente");
    const wa = await page.getAttribute(".cot-ok .btn-wa", "href"), w = new URL(wa);
    assert.equal(w.origin + w.pathname, "https://wa.me/593991111111"); assert.match(w.searchParams.get("text"), /^Hola Lucía, te comparto la proforma TA-0001 de Torre Alba \(A-10, P-01\).*\/proforma\/\?t=(ab){32}/s); ok("WhatsApp al teléfono del cliente con mensaje y enlace");
    assert.match(await page.getAttribute('.cot-ok a[href*="/proforma/"]', "href"), /\/proforma\/\?t=(ab){32}&imprimir=1$/); ok("«Ver y descargar PDF» abre la proforma lista para imprimir");
    await page.click('button[data-action="cerrar-modal"]'); await page.click('[data-action="inv-sub"][data-s="proformas"]'); await page.waitForSelector(".cot-item");
    assert.match(await page.textContent(".cot-item"), /TA-0001.*Vigente.*Lucía Mora.*A-10, P-01/s); ok("la proforma aparece en la lista de proformas");
    await page.click(".cot-item"); assert.match(await page.textContent("#modal-card"), /Proforma TA-0001.*Reenviar por WhatsApp.*Copiar enlace/s); ok("su ficha permite reenviarla y copiar el enlace");
    await page.click('[data-action="cot-anular"]'); await page.fill('#form-anular [name="motivo"]', "Pidió otra unidad"); await page.click('#form-anular button[type="submit"]');
    await page.waitForFunction(() => /Proforma anulada/.test(document.querySelector("#toast")?.textContent || ""));
    assert.deepEqual((await llamadas(page, "anular_cotizacion"))[0], { p_id: "q1", p_motivo: "Pidió otra unidad" }); ok("se anula con un motivo");
    assert.deepEqual(errores, []); await ctx.close();

    /* 2. Cliente nuevo: datos del buscador, aviso de duplicado y alta */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await abrirCot(page);
    await page.fill("#cot-buscar", "Marta Ríos"); assert.match(await page.textContent("#cot-resultados"), /Nadie coincide/);
    await page.click('#cot-resultados [data-action="cot-nuevo"]');
    assert.equal(await page.inputValue("#cot-n-nombre"), "Marta Ríos"); assert.equal(await page.evaluate(() => document.activeElement.id), "cot-n-telefono"); ok("«Crear cliente nuevo» usa lo escrito como nombre y pasa al teléfono");
    await page.fill("#cot-n-telefono", "099 222 2222"); await page.waitForSelector(".cot-dup");
    assert.match(await page.textContent(".cot-dup"), /Ya tienes a Pedro Paz con este teléfono/); ok("avisa si ese teléfono ya es de un cliente");
    await page.fill("#cot-n-telefono", "0995555555"); assert.equal(await page.locator(".cot-dup").count(), 0); ok("con un teléfono nuevo el aviso desaparece");
    await page.fill("#cot-n-correo", "marta@x.com"); await page.click('.cot-uni[data-id="u2"]');
    await page.click('[data-action="cot-forma"][data-f="contado"]');
    assert.equal(await page.locator("#cot-tasa").count(), 0); assert.equal(await linea(page, "Cuota mensual estimada"), null); assert.match(await page.textContent("#cot-resumen"), /Saldo contra entrega/); ok("de contado: sin tasa, sin cuota y con saldo contra entrega");
    await page.click('[data-action="cot-emitir"]'); await page.waitForSelector(".cot-ok");
    const e2 = (await llamadas(page, "crear_cotizacion"))[0];
    assert.deepEqual(e2.p_datos.cliente, { nombre: "Marta Ríos", telefono: "0995555555", correo: "marta@x.com" }); assert.equal(e2.p_datos.oportunidad_id, undefined); assert.equal(e2.p_datos.forma_pago, "contado"); ok("un cliente nuevo viaja con sus datos para crearlo como lead");
    assert.match(await page.textContent(".cot-ok"), /De contado/); ok("el éxito indica que es de contado");
    await page.click('[data-action="cot-otra"]'); await page.waitForSelector(".cot-elegido"); assert.match(await page.textContent(".cot-elegido"), /Marta Ríos/); ok("«Hacer otra» arranca otra proforma para el mismo cliente");
    await page.click('button[data-action="cerrar-modal"]'); assert.deepEqual(errores, []); await ctx.close();

    /* 3. Desde la unidad y desde la ficha del lead */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await page.click('[data-action="vista"][data-v="inventario"]'); await page.click('.unidad:has-text("L-1")');
    await page.click('[data-action="cotizar-unidad"]'); await page.waitForSelector("#cot-buscar");
    assert.equal(await page.inputValue("#cot-proyecto"), "valle"); assert.deepEqual(await page.$$eval(".cot-chip b", (b) => b.map((x) => x.textContent)), ["L-1"]); ok("desde la ficha de una unidad: proyecto y unidad ya elegidos");
    await page.click('button[data-action="cerrar-modal"]');
    await page.click('[data-action="vista"][data-v="embudo"]'); await page.locator('.lead[data-id="o1"]').click({ position: { x: 12, y: 12 } }); await page.waitForSelector('[data-action="proforma-lead"]');
    await page.click('[data-action="proforma-lead"]'); await page.waitForSelector(".cot-elegido");
    assert.match(await page.textContent(".cot-elegido"), /Lucía Mora/); assert.equal(await page.inputValue("#cot-proyecto"), "torre"); ok("desde la ficha del lead: cliente y proyecto ya elegidos");
    await page.click('.cot-uni[data-id="u2"]'); await page.click('[data-action="cot-emitir"]'); await page.waitForSelector(".cot-ok"); await page.click('.cot-ok button[data-action="cerrar-modal"]');
    await page.waitForFunction(() => /TA-0001/.test(document.querySelector("#sheet-panel")?.textContent || ""));
    assert.match(await page.textContent("#sheet-panel"), /Proformas.*TA-0001.*A-2/s); ok("la proforma aparece en la ficha del lead");
    assert.deepEqual(errores, []); await ctx.close();

    /* 4. Un agente: tope de descuento y lead sin dueño */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX({ rol: "agente" })));
    await abrirCot(page); await page.fill("#cot-buscar", "sin dueño"); await page.click('[data-action="cot-lead"][data-id="o3"]');
    assert.match(await page.textContent(".cot-elegido"), /al emitir la proforma pasará a ser tuyo/); ok("un lead sin asesor avisa que pasará a ser del agente");
    await page.click('.cot-uni[data-id="u10"]');
    assert.match(await page.textContent("#cot-desc-ayuda"), /Máximo para ti: 5 % \(\$\s?6\.000,00\)/); ok("el agente ve su descuento máximo en dinero");
    await page.fill("#cot-descuento", "7000"); assert.match(await page.textContent("#cot-pie"), /Tu descuento máximo es 5 %/); assert.equal(await page.isDisabled('[data-action="cot-emitir"]'), true); ok("pasarse del tope bloquea la emisión con el motivo");
    await page.fill("#cot-descuento", "5000"); await page.click('[data-action="cot-emitir"]'); await page.waitForSelector(".cot-ok");
    const orden = await page.evaluate(() => window.__FX.calls.map((c) => c.name).filter((x) => x === "crm_tomar_lead" || x === "crear_cotizacion"));
    assert.deepEqual(orden, ["crm_tomar_lead", "crear_cotizacion"]); ok("toma el lead y luego emite la proforma");
    await ctx.close();
    ({ page, ctx } = await abrirApp(browser, url, FX({ rol: "lector" })));
    await page.click('[data-action="vista"][data-v="inventario"]'); await page.waitForSelector(".unidad");
    assert.equal(await page.locator('[data-action="nueva-proforma"]').count(), 0); ok("un lector no hace proformas"); await ctx.close();

    /* 5. Configuración del cotizador por proyecto */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await page.click('[data-action="vista"][data-v="ajustes"]'); await page.click('[data-action="aj-sec"][data-s="proyectos"]');
    await page.click('[data-action="cfg-cot"][data-s="torre"]'); await page.waitForSelector("#form-cfg-cot");
    assert.equal(await page.inputValue('#form-cfg-cot [name="prefijo"]'), "TA"); assert.equal(await page.inputValue('#form-cfg-cot [name="tasa_anual"]'), "9,5"); ok("muestra la configuración actual");
    await page.fill('#form-cfg-cot [name="prefijo"]', "ta 1"); await page.click('#form-cfg-cot button[type="submit"]'); assert.match(await page.textContent("#toast"), /prefijo usa de 1 a 6/); ok("valida el prefijo");
    await page.fill('#form-cfg-cot [name="prefijo"]', "alba"); await page.fill('#form-cfg-cot [name="entrada_pct"]', "20"); await page.selectOption('#form-cfg-cot [name="reserva_tipo"]', "porcentaje");
    await page.fill('#form-cfg-cot [name="reserva_valor"]', "2,5"); await page.fill('#form-cfg-cot [name="whatsapp"]', "0995555555"); await page.fill('#form-cfg-cot [name="condiciones"]', "Precios sujetos a cambio.");
    await page.click('#form-cfg-cot button[type="submit"]'); await page.waitForFunction(() => /Cotizador guardado/.test(document.querySelector("#toast")?.textContent || ""));
    const g = (await llamadas(page, "guardar_config_cotizador"))[0];
    assert.equal(g.p_proyecto, "torre"); assert.equal(g.p_datos.prefijo, "ALBA"); assert.equal(g.p_datos.entrada_pct, 20); assert.equal(g.p_datos.reserva_valor, 2.5); assert.equal(g.p_datos.reserva_tipo, "porcentaje"); assert.equal(g.p_datos.condiciones, "Precios sujetos a cambio."); ok("guarda la configuración (prefijo en mayúsculas, coma decimal)");
    assert.deepEqual(errores, []); await ctx.close();

    /* 6. Fotos de una unidad */
    ({ page, errores, ctx } = await abrirApp(browser, url, FX()));
    await page.click('[data-action="vista"][data-v="inventario"]'); await page.click('.unidad:has-text("A-2")'); await page.waitForSelector("#u-fotos");
    await page.setInputFiles("#u-fotos-input", [{ name: "sala.png", mimeType: "image/png", buffer: PNG }, { name: "cocina.png", mimeType: "image/png", buffer: PNG }]);
    await page.waitForFunction(() => /2 fotos agregadas/.test(document.querySelector("#toast")?.textContent || ""));
    const up = await page.evaluate(() => window.__FX.uploads);
    assert.equal(up.length, 2); assert.equal(up[0].bucket, "inventario"); assert.match(up[0].path, new RegExp("^" + ORG + "/u2/\\d+-0\\.jpg$")); assert.equal(up[0].type, "image/jpeg"); ok("achica y sube las fotos como JPG a inventario/<empresa>/<unidad>/");
    assert.equal((await llamadas(page, "guardar_fotos_unidad"))[0].p_fotos.length, 2); assert.equal(await page.locator("#u-fotos figure").count(), 2); ok("las guarda y se ven en la ficha (la primera es la portada)");
    const segunda = await page.getAttribute('#u-fotos [data-action="foto-portada"]', "data-f");
    await page.click('#u-fotos [data-action="foto-portada"]'); await page.waitForFunction(() => /Portada actualizada/.test(document.querySelector("#toast")?.textContent || ""));
    assert.equal((await llamadas(page, "guardar_fotos_unidad"))[1].p_fotos[0], segunda); ok("se elige otra foto como portada");
    page.once("dialog", (d) => d.accept()); await page.click('#u-fotos [data-action="foto-quitar"]'); await page.waitForFunction(() => /Foto quitada/.test(document.querySelector("#toast")?.textContent || ""));
    assert.equal((await llamadas(page, "guardar_fotos_unidad"))[2].p_fotos.length, 1); ok("se quita una foto");
    await page.setInputFiles("#u-fotos-input", { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    await page.waitForFunction(() => /Solo fotos JPG, PNG o WebP/.test(document.querySelector("#toast")?.textContent || "")); ok("rechaza archivos que no son fotos");
    assert.deepEqual(errores, []); await ctx.close();

    /* 7. Celular y escritorio sin desbordes */
    for (const vp of [{ width: 360, height: 760 }, { width: 1280, height: 900 }]) {
      ({ page, ctx } = await abrirApp(browser, url, FX(), vp));
      await abrirCot(page); await page.click('[data-action="cot-lead"][data-id="o1"]'); await page.click('.cot-uni[data-id="u10"]');
      assert.equal(await page.$eval("#modal-card", (m) => m.scrollWidth <= m.clientWidth + 1), true);
      assert.equal(await page.isVisible('[data-action="cot-emitir"]'), true);
      if (out) await page.screenshot({ path: out + "/cotizador-" + vp.width + ".png" });
      await ctx.close();
    }
    ok("el cotizador cabe en un celular de 360 px y en escritorio, con el botón de emitir siempre a la vista");
  } finally { await browser.close(); server.close(); }
  console.log("Cotizador: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
