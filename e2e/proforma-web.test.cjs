/* Proforma que ve el cliente (/proforma/?t=…): marca de la inmobiliaria, cifras, estados y «Impulsado por GPUnlock».
   Uso: NODE_PATH=$(npm root -g) node e2e/proforma-web.test.cjs */
const assert = require("node:assert/strict");
const { servir, chromium } = require("./lib.cjs");
const T = require("../web/js/tema.js");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const TOKEN = "ab".repeat(32);
const P = (o) => Object.assign({
  numero: "TA-0007", fecha: "2026-10-07T15:00:00Z", vigencia_hasta: "2099-10-22", vigente: true, empresa: "Andes Propiedades", logo_path: "org/logo-1.png", color_primario: "#1E4FD8", color_acento: null,
  mostrar_pie_gpunlock: false, proyecto: "Torre Alba", cliente_nombre: "Lucía Mora", asesor_nombre: "Gabo Agente", asesor_email: "gabo@andes.com", whatsapp: "593995555555",
  unidades: [{ codigo: "A-101", tipo: "departamento", bloque: "A", piso: "1", area_m2: 85.5, dormitorios: 2, banos: 2.5, parqueos: 1, precio: 120000, foto: "org/u1/1.jpg" }, { codigo: "P-01", tipo: "parqueo", precio: 8000 }],
  precio_lista: 128000, descuento: 3000, precio_final: 125000, forma_pago: "credito", entrada_pct: 30, entrada: 37500, reserva: 2500, cuotas_entrada: 12, cuota_entrada: 2916.67, saldo: 87500,
  tasa_anual: 9.5, plazo_anios: 20, cuota_mensual: 815.61, notas: "Incluye parqueo cubierto", condiciones: "Precios sujetos a cambio."
}, o);

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  const pedidosImg = [];
  async function abrir(respuesta, ruta, vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 } });
    const pedidos = [];
    await ctx.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.CRM_CONFIG={SUPABASE_URL:"https://fake.supabase.co",SUPABASE_ANON_KEY:"anon"};' }));
    await ctx.route("https://fake.supabase.co/rest/**", (r) => { pedidos.push(JSON.parse(r.request().postData())); r.fulfill({ contentType: "application/json", body: JSON.stringify(respuesta) }); });
    await ctx.route("https://fake.supabase.co/storage/**", (r) => { pedidosImg.push(r.request().url()); r.fulfill({ status: 404, body: "" }); });
    const page = await ctx.newPage(); const errores = []; page.on("pageerror", (e) => errores.push(e.message));
    await page.addInitScript(() => { window.__impresiones = 0; window.print = () => { window.__impresiones++; }; });
    await page.goto(url + (ruta || "/proforma/?t=" + TOKEN));
    return { ctx, page, pedidos, errores };
  }
  try {
    /* 1. Con la marca de la inmobiliaria */
    let { ctx, page, pedidos, errores } = await abrir(P());
    await page.waitForSelector(".cab");
    assert.deepEqual(pedidos[0], { p_token: TOKEN }); ok("pide solo esa proforma con su enlace privado");
    assert.equal(await page.title(), "Proforma TA-0007 · Andes Propiedades"); ok("título con número y empresa");
    assert.ok(pedidosImg.some((u) => /storage\/v1\/object\/public\/marcas\/org\/logo-1\.png$/.test(u))); assert.equal(await page.textContent(".empresa"), "Andes Propiedades"); ok("pide el logo de la inmobiliaria y, si no carga, muestra su nombre");
    const pal = T.paleta("#1E4FD8", null, "light");
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--m").trim()), pal.vars["--gp-orange-600"]); ok("toma el color de la inmobiliaria");
    const titulo = await page.$eval(".numero h1", (e) => getComputedStyle(e).color);
    assert.ok(T.ratio(titulo.match(/\d+/g).slice(0, 3).map(Number), [255, 255, 255]) >= 4.5); ok("el número de la proforma con su color y contraste AA");
    const txt = await page.textContent("#hoja");
    assert.match(txt, /Cliente\s*Lucía Mora/); assert.match(txt, /Proyecto\s*Torre Alba/); assert.match(txt, /Asesor\s*Gabo Agente/); assert.match(txt, /Válida hasta el 22 de octubre de 2099/); ok("cliente, proyecto, asesor y vigencia");
    assert.doesNotMatch(txt, /0991111111|lucia@/); ok("no muestra teléfono ni correo del cliente");
    assert.match(txt, /A-101.*Departamento.*Torre A · Piso 1.*85,5 m².*2 dorm\. · 2,5 baños · 1 parq\..*\$\s?120\.000,00/s); assert.match(txt, /P-01.*Parqueo/s); ok("tabla de unidades con detalle y precio");
    assert.match(txt, /Precio de lista\s*\$\s?128\.000,00/); assert.match(txt, /Descuento\s*− \$\s?3\.000,00/); assert.match(txt, /Precio final\s*\$\s?125\.000,00/); ok("precio de lista, descuento y precio final");
    assert.match(txt, /Reserva\s*\$\s?2\.500,00/); assert.match(txt, /12 cuotas mensuales de\s*\$\s?2\.916,67/); assert.match(txt, /Entrada total \(30 %\)\s*\$\s?37\.500,00/); assert.match(txt, /crédito hipotecario\s*\$\s?87\.500,00/); ok("plan de pagos: reserva, cuotas de entrada, entrada y saldo");
    assert.match(await page.textContent(".destacado"), /20 años al 9,5 % anual.*\$\s?815,61/s); ok("cuota mensual destacada");
    assert.match(txt, /Incluye parqueo cubierto/); assert.match(txt, /Precios sujetos a cambio\..*simulación/s); ok("notas, condiciones del proyecto y aviso legal");
    assert.ok(pedidosImg.some((u) => /public\/inventario\/org\/u1\/1\.jpg$/.test(u))); assert.equal(await page.locator(".foto").count(), 0); ok("pide la foto de la unidad y, si no carga, no deja un hueco");
    const sello = page.locator(".pie .impulsado");
    assert.match(await sello.textContent(), /Impulsado por\s*GPUnlock/); assert.match(await sello.locator("img").getAttribute("src"), /gp-mark\.png$/); ok("«Impulsado por GPUnlock» con su logo en la esquina, aunque la empresa ocultara el pie en la app");
    assert.equal(await page.$eval(".pie", (p) => getComputedStyle(p).justifyContent), "space-between"); ok("el sello queda a un lado del pie");
    assert.match(await page.getAttribute("#btn-wa", "href"), /^https:\/\/wa\.me\/593995555555\?text=Hola.*TA-0007/); ok("botón para escribir al asesor por WhatsApp");
    await page.click("#btn-pdf"); assert.equal(await page.evaluate(() => window.__impresiones), 1); ok("«Descargar PDF» abre la impresión (Guardar como PDF)");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("cabe en el celular");
    if (out) await page.screenshot({ path: out + "/proforma-celular.png", fullPage: true });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.isVisible("#acciones"), false); assert.equal(await page.isVisible(".impulsado"), true); ok("al imprimir se ocultan los botones y queda el sello");
    if (out) { await page.setViewportSize({ width: 794, height: 1123 }); await page.screenshot({ path: out + "/proforma-a4.png", fullPage: true }); }
    assert.deepEqual(errores, []); await ctx.close();

    /* 2. Variantes: sin logo, de contado, sin descuento, vencida, abre la impresión sola */
    ({ ctx, page } = await abrir(P({ logo_path: null, color_primario: null, forma_pago: "contado", cuota_mensual: null, tasa_anual: null, plazo_anios: null, descuento: 0, precio_lista: 125000, cuotas_entrada: 0, vigente: false, vigencia_hasta: "2026-01-01", whatsapp: null }), "/proforma/?t=" + TOKEN + "&imprimir=1"));
    await page.waitForSelector(".cab");
    assert.equal(await page.textContent(".empresa b"), "Andes Propiedades"); ok("sin logo muestra el nombre de la empresa");
    const t2 = await page.textContent("#hoja");
    assert.doesNotMatch(t2, /Precio de lista|Descuento/); assert.match(t2, /Saldo contra entrega/); assert.match(t2, /Saldo de la entrada \(a la firma\)\s*\$\s?35\.000,00/); assert.equal(await page.locator(".destacado").count(), 0); ok("de contado y sin descuento: sin cuota, saldo contra entrega y entrada a la firma");
    assert.match(await page.textContent(".chip"), /Venció el 1 de enero de 2026/); assert.equal(await page.isHidden("#btn-wa"), true); ok("vencida lo dice; sin WhatsApp no muestra el botón");
    await page.waitForFunction(() => window.__impresiones === 1); ok("con &imprimir=1 abre la impresión sola");
    await ctx.close();

    /* 3. Anulada, inexistente y enlace roto */
    ({ ctx, page } = await abrir({ anulada: true, numero: "TA-0007" })); await page.waitForSelector(".estado h1");
    assert.match(await page.textContent(".estado"), /TA-0007 anulada.*Pide a tu asesor/s); assert.equal(await page.isHidden("#acciones"), true); ok("anulada: lo dice y no ofrece descargar"); await ctx.close();
    ({ ctx, page } = await abrir(null)); await page.waitForSelector(".estado h1"); assert.match(await page.textContent(".estado h1"), /no encontrada/); ok("inexistente: lo dice"); await ctx.close();
    ({ ctx, page, pedidos } = await abrir(P(), "/proforma/?t=123")); await page.waitForSelector(".estado h1");
    assert.match(await page.textContent(".estado h1"), /Enlace no válido/); assert.equal(pedidos.length, 0); ok("un enlace mal formado ni siquiera consulta al servidor"); await ctx.close();
    ({ ctx, page } = await abrir(P(), "/proforma/?t=" + TOKEN, { width: 1280, height: 900 })); await page.waitForSelector(".cab");
    if (out) await page.screenshot({ path: out + "/proforma-escritorio.png", fullPage: true });
    await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Proforma para el cliente: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
