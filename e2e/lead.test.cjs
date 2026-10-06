/* lead.js (el script que las inmobiliarias pegan en su web): captura de leads con su origen de campaña.
   Uso: NODE_PATH=$(npm root -g) node e2e/lead.test.cjs */
const assert = require("node:assert/strict");
const { servir, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

const HTML = `<!doctype html><meta charset=utf-8><title>Web de un cliente</title>
<form data-crm-captura data-crm-proyecto="Torre Alba" onsubmit="return false">
  <input name="nombre" value="Lucía Mora"><input name="telefono" value="0991111111"><input name="email" value="lucia@x.com"><input name="mensaje" value="Quiero visitar">
  <button type="submit">Enviar</button></form>
<script src="/embed/lead.js" data-url="https://fake.supabase.co" data-anon="anon-key" data-clave="pk_demo" defer></script>`;

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const enviados = [];
  await ctx.route("https://fake.supabase.co/**", async (r) => { enviados.push({ url: r.request().url(), headers: r.request().headers(), body: JSON.parse(r.request().postData() || "{}") }); await r.fulfill({ status: 200, contentType: "application/json", body: "true" }); });
  await ctx.route(url + "/cliente.html*", (r) => r.fulfill({ contentType: "text/html", body: HTML }));
  try {
    const page = await ctx.newPage();
    const errores = []; page.on("pageerror", (e) => errores.push(e.message));
    const enviar = async () => { await page.click("button"); await page.waitForTimeout(250); return enviados[enviados.length - 1]; };

    /* 1. Llega desde un anuncio de Instagram */
    await page.goto(url + "/cliente.html?utm_source=instagram&utm_medium=cpc&utm_campaign=Torre%20Alba%20Suites&fbclid=IwAR123");
    await page.evaluate(() => { document.cookie = "_fbp=fb.1.1700000000.555; path=/"; });
    let e = await enviar();
    assert.match(e.url, /\/rest\/v1\/rpc\/crm_registrar_lead$/); assert.equal(e.headers.apikey, "anon-key"); ok("envía el lead al CRM con la clave pública");
    assert.equal(e.body.p_clave, "pk_demo"); assert.equal(e.body.p_nombre, "Lucía Mora"); assert.equal(e.body.p_telefono, "0991111111"); assert.equal(e.body.p_correo, "lucia@x.com");
    assert.equal(e.body.p_proyecto, "torre-alba"); ok("campos del formulario: nombre, teléfono, correo (alias email) y proyecto");
    const a = e.body.p_atribucion;
    assert.equal(a.utm_source, "instagram"); assert.equal(a.utm_campaign, "Torre Alba Suites"); assert.equal(a.utm_medium, "cpc"); assert.equal(a.fbclid, "IwAR123"); ok("manda los parámetros de campaña de la URL");
    assert.match(a.fbc, /^fb\.1\.\d+\.IwAR123$/); assert.equal(a.fbp, "fb.1.1700000000.555"); ok("arma _fbc con el formato de Meta y lee la cookie _fbp");
    assert.match(a.pagina_origen, /\/cliente\.html$/); assert.ok(!("p_atribucion" in e.body.p_atribucion)); ok("registra la página de origen, sin la query");

    /* 2. Vuelve otro día sin parámetros: se recuerda el origen (30 días) */
    await page.goto(url + "/cliente.html");
    e = await enviar();
    assert.equal(e.body.p_atribucion.utm_campaign, "Torre Alba Suites"); assert.equal(e.body.p_atribucion.fbclid, "IwAR123"); ok("sin parámetros, usa el origen guardado");

    /* 3. Si hace clic en otro anuncio, manda el último */
    await page.goto(url + "/cliente.html?utm_source=google&gclid=EAIaIQ");
    e = await enviar();
    assert.equal(e.body.p_atribucion.utm_source, "google"); assert.equal(e.body.p_atribucion.gclid, "EAIaIQ"); assert.ok(!e.body.p_atribucion.utm_campaign); ok("un clic nuevo reemplaza al anterior (último clic)");

    /* 4. El origen vencido (31 días) no se usa */
    await page.evaluate(() => { const j = JSON.parse(localStorage.getItem("gpu_atrib")); j.t -= 31 * 864e5; localStorage.setItem("gpu_atrib", JSON.stringify(j)); });
    await page.goto(url + "/cliente.html");
    e = await enviar();
    assert.ok(!e.body.p_atribucion.utm_source && !e.body.p_atribucion.gclid); assert.match(e.body.p_atribucion.pagina_origen, /cliente\.html$/); ok("pasados 30 días, el origen guardado se descarta");

    /* 5. Tráfico directo: solo la página */
    await ctx.clearCookies(); await page.evaluate(() => localStorage.clear());
    await page.goto(url + "/cliente.html");
    e = await enviar();
    assert.deepEqual(Object.keys(e.body.p_atribucion), ["pagina_origen"]); ok("visita directa: solo se manda la página de origen");

    /* 6. Valores largos o raros se recortan; el campo trampa viaja vacío */
    await page.goto(url + "/cliente.html?utm_campaign=" + "x".repeat(400));
    e = await enviar();
    assert.equal(e.body.p_atribucion.utm_campaign.length, 150); assert.equal(e.body.p_trampa, null); ok("recorta valores largos y el campo trampa viaja vacío");

    /* 7. Sin almacenamiento (modo privado) sigue funcionando */
    const c2 = await browser.newContext();
    await c2.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("bloqueado"); } }); });
    await c2.route("https://fake.supabase.co/**", async (r) => { enviados.push({ body: JSON.parse(r.request().postData() || "{}") }); await r.fulfill({ status: 200, body: "true" }); });
    await c2.route(url + "/cliente.html*", (r) => r.fulfill({ contentType: "text/html", body: HTML }));
    const p2 = await c2.newPage(); const err2 = []; p2.on("pageerror", (x) => err2.push(x.message));
    await p2.goto(url + "/cliente.html?utm_source=facebook"); await p2.click("button"); await p2.waitForTimeout(250);
    assert.equal(enviados[enviados.length - 1].body.p_atribucion.utm_source, "facebook"); assert.deepEqual(err2, []); ok("con el almacenamiento bloqueado, el lead se envía igual");

    assert.deepEqual(errores, []); ok("sin errores en la consola");
  } finally { await browser.close(); server.close(); }
  console.log("Todas las pruebas de lead.js pasaron (" + n + ").");
})().catch((e) => { console.error(e); process.exit(1); });
