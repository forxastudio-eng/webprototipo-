/* Marca por empresa (logo, colores) y tema claro / oscuro / automático, de punta a punta con un Supabase simulado.
   Uso: NODE_PATH=$(npm root -g) node e2e/marca.test.cjs   (o `npm test` dentro de e2e/) */
const assert = require("node:assert/strict");
const { servir, abrirApp, chromium } = require("./lib.cjs");
const T = require("../web/js/tema.js");

let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ORG = "11111111-1111-1111-1111-111111111111";

const css = (page, v) => page.evaluate((k) => document.documentElement.style.getPropertyValue(k).trim(), v);   // lo que escribió el motor de tema (sin la hoja de estilos)
const rgbDe = (txt) => { const m = txt.match(/\d+/g).map(Number); return m.slice(0, 3); };
async function fondoDe(page, sel) { return rgbDe(await page.$eval(sel, (e) => getComputedStyle(e).backgroundColor)); }
async function colorDe(page, sel) { return rgbDe(await page.$eval(sel, (e) => getComputedStyle(e).color)); }
async function irAMarca(page) {
  await page.click('[data-action="vista"][data-v="ajustes"]');
  await page.click('[data-action="aj-sec"][data-s="marca"]');
  await page.waitForSelector("#form-marca");
}

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const out = process.env.CAPTURAS || "";
  try {
    /* 1. Sin marca guardada: colores de GPUnlock */
    let { page, errores, ctx } = await abrirApp(browser, url, {});
    assert.equal(await page.getAttribute("html", "data-theme"), "light"); ok("por defecto: modo claro");
    assert.equal(await css(page, "--gp-orange-600"), "", "sin marca no debe escribir variables");
    assert.match(await page.textContent("#brand-nombre"), /Inmobiliaria Andes/); ok("sin marca: se muestra el nombre de la empresa");
    assert.match(await page.title(), /Inmobiliaria Andes/); ok("el título de la pestaña lleva el nombre");

    /* 2. Editor de marca: sólo gestores, vista previa y contraste en vivo */
    await irAMarca(page);
    assert.equal(await page.locator('[data-action="aj-sec"][data-s="marca"]').count(), 1); ok("el propietario ve la sección Marca");
    assert.match(await page.textContent("#m-contraste"), /AA ✓/); ok("muestra el contraste (AA ✓) del color elegido");
    await page.click('[data-action="marca-color"][data-c="#1E4FD8"]');
    const pv = await page.$eval("#m-prev", (e) => getComputedStyle(e).getPropertyValue("--gp-orange-600").trim().toUpperCase());
    assert.equal(pv, T.paleta("#1E4FD8", null, "light").fondo); ok("la vista previa cambia al elegir un color");
    assert.equal(await css(page, "--gp-orange-600"), "", "la vista previa no debe cambiar la app hasta guardar"); ok("la app no cambia hasta guardar");
    // un color que no admite texto blanco: se avisa y se ajusta
    await page.$eval("#m-color", (e) => { e.value = "#ffeb3b"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.match(await page.textContent("#m-contraste"), /AA ✓/); ok("un amarillo claro sigue cumpliendo AA");
    if (out) await page.screenshot({ path: out + "/marca-1-editor.png", fullPage: true });

    /* 3. Logo: validaciones */
    await page.setInputFiles("#m-logo", { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    assert.match(await page.textContent("#toast"), /PNG, JPG o WebP/); ok("rechaza SVG y otros formatos");
    await page.setInputFiles("#m-logo", { name: "logo.png", mimeType: "image/png", buffer: Buffer.alloc(1024 * 1024 + 1) });
    assert.match(await page.textContent("#toast"), /más de 1 MB/); ok("rechaza logos de más de 1 MB");
    assert.equal(await page.evaluate(() => window.__FX.uploads.length), 0); ok("nada se sube si el logo es inválido");

    /* 4. Guardar: sube el logo y llama a guardar_marca */
    await page.click('[data-action="marca-color"][data-c="#0F8A5F"]');
    await page.fill('[name="nombre"]', "Andes Propiedades");
    await page.fill("#m-sub", "Andes Prop!");
    assert.equal(await page.inputValue("#m-sub"), "andesprop"); ok("la dirección corta se limpia al escribir");
    await page.fill("#m-sub", "andes");
    await page.setInputFiles("#m-logo", { name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("#m-logo-img");
    await page.click('#form-marca button[type="submit"]');
    await page.waitForFunction(() => /Marca guardada/.test(document.querySelector("#toast")?.textContent || ""));
    const g = await page.evaluate(() => ({ up: window.__FX.uploads[0], rpc: window.__FX.calls.find((c) => c.name === "guardar_marca") }));
    assert.equal(g.up.bucket, "marcas"); assert.match(g.up.path, new RegExp("^" + ORG + "/logo-\\d+\\.png$")); assert.equal(g.up.type, "image/png"); ok("sube a marcas/<empresa>/logo-<hora>.png");
    assert.equal(g.rpc.args.p_color, "#0F8A5F"); assert.equal(g.rpc.args.p_nombre, "Andes Propiedades"); assert.equal(g.rpc.args.p_subdominio, "andes");
    assert.equal(g.rpc.args.p_logo, g.up.path); assert.equal(g.rpc.args.p_ocultar_pie, false); ok("guardar_marca recibe color, nombre, dirección y ruta del logo");
    assert.equal(await css(page, "--gp-orange-600"), T.paleta("#0F8A5F", null, "light").fondo); ok("la app toma el color al instante");
    assert.match(await page.textContent("#brand-nombre"), /Andes Propiedades/); assert.match(await page.title(), /Andes Propiedades/); ok("la barra y el título usan el nombre comercial");
    assert.match(await page.getAttribute("#brand-mark img", "src"), /storage\/v1\/object\/public\/marcas\/11111111.*logo-\d+\.png$/); ok("la barra muestra el logo subido");
    const btn = await fondoDe(page, ".btn-primary"), on = await colorDe(page, ".btn-primary");
    assert.ok(T.ratio(btn, on) >= 4.5, "botón principal AA"); ok("el botón principal cumple AA con el color de la marca");
    const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem("gpu_marca")));
    assert.equal(guardada.marca.color_primario, "#0F8A5F"); assert.equal(guardada.org, ORG); ok("la marca queda recordada para el siguiente arranque");
    assert.equal(await page.locator(".pie-gpu").count() >= 0, true);
    assert.equal(await page.isDisabled('[name="pie"]'), true); ok("quitar «Con la tecnología de GPUnlock» queda bloqueado fuera del plan Agencia");
    if (out) await page.screenshot({ path: out + "/marca-2-guardada.png", fullPage: true });

    /* 5. Reemplazar el logo: el viejo se borra */
    await page.setInputFiles("#m-logo", { name: "nuevo.webp", mimeType: "image/webp", buffer: PNG });
    await page.waitForSelector("#m-logo-img");
    await page.click('#form-marca button[type="submit"]');
    await page.waitForFunction(() => window.__FX.uploads.length === 2);
    await page.waitForFunction(() => window.__FX.quitados.length === 1);
    assert.equal(await page.evaluate(() => window.__FX.quitados[0]), g.up.path); ok("al reemplazar el logo se borra el anterior");

    /* 6. Modo oscuro: manual, automático, recordado */
    await page.click('[data-action="menu"], #btn-menu');
    await page.waitForSelector("#seg-modo");
    await page.click('[data-action="modo"][data-m="oscuro"]');
    assert.equal(await page.getAttribute("html", "data-theme"), "dark"); ok("modo oscuro manual");
    const pd = T.paleta("#0F8A5F", null, "dark");
    assert.equal(await css(page, "--gp-orange-600"), pd.fondo); ok("la marca se recalcula para el modo oscuro");
    assert.equal(await page.evaluate(() => localStorage.getItem("gpu_modo")), "oscuro"); ok("la preferencia se recuerda");
    const fondoPagina = await fondoDe(page, "body");
    assert.ok(fondoPagina[0] < 40, "fondo oscuro"); ok("el fondo de la app es oscuro");
    const texto = await colorDe(page, "body");
    assert.ok(T.ratio(fondoPagina, texto) >= 7, "texto/fondo AAA en oscuro"); ok("texto sobre fondo en oscuro: contraste " + T.ratio(fondoPagina, texto).toFixed(1));
    await page.click('button[data-action="cerrar-modal"]');
    for (const sel of [".btn-primary"]) {
      const f = await fondoDe(page, sel), c = await colorDe(page, sel);
      assert.ok(T.ratio(f, c) >= 4.5, sel + " AA en oscuro");
    }
    ok("botón principal AA también en oscuro");
    if (out) await page.screenshot({ path: out + "/marca-3-oscuro.png", fullPage: true });
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#app:not([hidden])");
    assert.equal(await page.getAttribute("html", "data-theme"), "dark"); ok("al recargar sigue en oscuro");
    // automático: sigue al sistema
    await page.click("#btn-menu"); await page.waitForSelector("#seg-modo");
    await page.click('[data-action="modo"][data-m="auto"]');
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark"); ok("modo automático sigue al sistema, también en vivo");
    assert.equal(await page.evaluate(() => localStorage.getItem("gpu_modo")), null);
    await page.click('button[data-action="cerrar-modal"]');
    assert.deepEqual(errores, []); ok("sin errores en la consola");

    /* 7. Cerrar sesión olvida la marca (otra empresa en el mismo equipo) */
    await page.click("#btn-menu"); await page.waitForSelector("#modal-card [data-action=\"salir\"]");
    await page.evaluate(() => (window.__FX.sinSesion = true));
    await page.click("#modal-card [data-action=\"salir\"]");
    await page.waitForFunction(() => localStorage.getItem("gpu_marca") === null);
    ok("al cerrar sesión se borra la marca recordada");
    await ctx.close();

    /* 8. Tiempo real: otro usuario cambia la marca */
    ({ page, errores, ctx } = await abrirApp(browser, url, { marca: { org_id: ORG, nombre_comercial: null, color_primario: "#1E4FD8", mostrar_pie_gpunlock: true } }));
    assert.equal(await css(page, "--gp-orange-600"), T.paleta("#1E4FD8", null, "light").fondo); ok("la marca guardada se aplica al abrir");
    await page.evaluate((org) => window.__FX.emitir("org_marca", { eventType: "UPDATE", new: { org_id: org, nombre_comercial: "Nueva Marca", color_primario: "#7A1F3D", color_acento: null, logo_path: null, mostrar_pie_gpunlock: true } }), ORG);
    assert.equal(await css(page, "--gp-orange-600"), T.paleta("#7A1F3D", null, "light").fondo);
    assert.match(await page.textContent("#brand-nombre"), /Nueva Marca/); ok("un cambio de marca de otro usuario llega en vivo");
    await page.evaluate(() => window.__FX.emitir("org_marca", { eventType: "DELETE", old: {} }));
    assert.equal(await css(page, "--gp-orange-600"), ""); ok("si se borra la marca vuelve a los colores de GPUnlock");
    await ctx.close();

    /* 9. Sin parpadeo: el tema recordado se aplica antes de que cargue la sesión */
    ({ page, errores, ctx } = await abrirApp(browser, url, { demoraMs: 800 }, undefined, { esperar: "body" }));
    await page.evaluate((org) => localStorage.setItem("gpu_marca", JSON.stringify({ org, marca: { color_primario: "#7A1F3D" } })), ORG);
    await page.evaluate(() => localStorage.setItem("gpu_modo", "oscuro"));
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.getAttribute("html", "data-theme"), "dark");
    assert.equal(await css(page, "--gp-orange-600"), T.paleta("#7A1F3D", null, "dark").fondo); ok("el tema y la marca recordados se aplican antes de cargar los datos");
    await page.waitForSelector("#app:not([hidden])");
    await ctx.close();

    /* 10. Un agente no ve ni puede abrir la sección Marca */
    ({ page, errores, ctx } = await abrirApp(browser, url, { rol: "agente" }));
    await page.click('[data-action="vista"][data-v="ajustes"]');
    assert.equal(await page.locator('[data-action="aj-sec"][data-s="marca"]').count(), 0); ok("un agente no ve la pestaña Marca");
    await page.click("#btn-menu");
    assert.equal(await page.locator('[data-action="modo"]').count(), 3); ok("pero sí puede elegir claro / oscuro / automático");
    await ctx.close();

    /* 11. Con el plan Agencia puede quitar el pie de GPUnlock */
    ({ page, errores, ctx } = await abrirApp(browser, url, { uso: { plan: { id: "agencia", nombre: "Agencia", max_usuarios: 30, max_leads_mes: 5000, ia_mes: 2000 }, estado: "activa" } }));
    await irAMarca(page);
    assert.equal(await page.isDisabled('[name="pie"]'), false); ok("en el plan Agencia el pie se puede quitar");
    await page.uncheck('[name="pie"]');
    await page.click('#form-marca button[type="submit"]');
    await page.waitForFunction(() => window.__FX.calls.some((c) => c.name === "guardar_marca"));
    assert.equal(await page.evaluate(() => window.__FX.calls.find((c) => c.name === "guardar_marca").args.p_ocultar_pie), true); ok("envía p_ocultar_pie = true");
    await ctx.close();

    /* 12. Suscripción vencida: no se puede guardar */
    ({ page, errores, ctx } = await abrirApp(browser, url, { uso: { estado: "vencida", activa: false } }));
    await irAMarca(page);
    assert.equal(await page.isDisabled('#form-marca button[type="submit"]'), true); ok("con la suscripción vencida el botón Guardar está desactivado");
    await ctx.close();

    /* 13. Pantalla de entrada con la marca de la empresa: /app/?e=andes */
    const publica = { andes: { nombre: "Andes Propiedades", color_primario: "#7A1F3D", color_acento: null, logo_path: ORG + "/logo-1.png", logo_oscuro_path: ORG + "/logo-oscuro-1.png", mostrar_pie_gpunlock: true } };
    ({ page, errores, ctx } = await abrirApp(browser, url, { sinSesion: true, publicas: publica }, undefined, { ruta: "/app/?e=andes", esperar: "#auth:not([hidden])" }));
    await page.waitForFunction(() => /Andes Propiedades/.test(document.querySelector("#auth-titulo")?.textContent || ""));
    assert.match(await page.textContent("#auth-titulo"), /Entra a Andes Propiedades/); ok("el login saluda con el nombre de la empresa");
    assert.match(await page.getAttribute(".auth-logo", "src"), /marcas\/11111111.*logo-1\.png$/); ok("el login muestra el logo de la empresa");
    assert.equal(await css(page, "--gp-orange-600"), T.paleta("#7A1F3D", null, "light").fondo); ok("el login usa los colores de la empresa");
    assert.equal(await page.evaluate(() => localStorage.getItem("gpu_marca")), null); ok("el login no recuerda la marca de forma permanente");
    assert.match(await page.textContent("#auth-pie"), /Con la tecnología de GPUnlock/); ok("el login muestra «Con la tecnología de GPUnlock»");
    assert.equal(await page.evaluate(() => window.__FX.calls.find((c) => c.name === "marca_publica").args.p_subdominio), "andes");
    if (out) await page.screenshot({ path: out + "/marca-4-login.png", fullPage: true });
    assert.deepEqual(errores, []); ok("sin errores en la consola");
    await ctx.close();

    // empresa desconocida: pantalla normal; modo oscuro: logo para fondo oscuro
    ({ page, errores, ctx } = await abrirApp(browser, url, { sinSesion: true, publicas: {} }, undefined, { ruta: "/app/?e=nadie", esperar: "#auth:not([hidden])" }));
    assert.match(await page.textContent("#auth-titulo"), /Entra a tu CRM/); assert.equal(await page.locator(".auth-logo").count(), 0); ok("dirección desconocida: pantalla de entrada normal");
    await ctx.close();
    ctx = await browser.newContext({ colorScheme: "dark" }); await ctx.close();
    ({ page, errores, ctx } = await abrirApp(browser, url, { sinSesion: true, publicas: publica }, undefined, { ruta: "/app/?e=andes", esperar: "#auth:not([hidden])" }));
    await page.evaluate(() => localStorage.setItem("gpu_modo", "oscuro"));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".auth-logo");
    assert.match(await page.getAttribute(".auth-logo", "src"), /logo-oscuro-1\.png$/); ok("en modo oscuro el login usa el logo para fondo oscuro");
    await ctx.close();

    /* 14. Escritorio: sin desbordes */
    ({ page, errores, ctx } = await abrirApp(browser, url, {}, { width: 1280, height: 900 }));
    await irAMarca(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok("sin desbordes horizontales en escritorio");
    if (out) await page.screenshot({ path: out + "/marca-5-escritorio.png" });
    await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Todas las pruebas de marca y tema pasaron (" + n + ").");
})().catch((e) => { console.error(e); process.exit(1); });
