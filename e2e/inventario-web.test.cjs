/* embed/inventario.js: disponibilidad en vivo en la web de la inmobiliaria.
   Uso: NODE_PATH=$(npm root -g) node e2e/inventario-web.test.cjs */
const assert = require("node:assert/strict");
const { servir, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

const U = (o) => Object.assign({ proyecto: "torre", proyecto_nombre: "Torre Alba", codigo: "A-1", tipo: "departamento", bloque: null, piso: null, area_m2: null, dormitorios: null, banos: null, parqueos: null, bodegas: null, precio: null, estado: "disponible", descripcion: null }, o);
const DATOS = { unidades: [
  U({ codigo: "A-10", piso: "10", fotos: ["org/u10/1.jpg"], area_m2: 85.5, dormitorios: 2, banos: 2.5, parqueos: 1, precio: 120000 }),
  U({ codigo: "A-2", piso: "2", area_m2: 60, dormitorios: 1, banos: 1, precio: 85000, descripcion: "<img src=x onerror=alert(1)>Vista al parque" }),
  U({ codigo: "A-3", piso: "3", tipo: "suite", dormitorios: 1, precio: null }),
  U({ codigo: "A-4", piso: "4", estado: "reservada", dormitorios: 3, precio: 150000 }),
  U({ codigo: "A-5", piso: "5", estado: "vendida", dormitorios: 3, precio: 160000 })
] };
const HTML = (extra = "") => `<!doctype html><meta charset=utf-8><title>Web de un cliente</title>
<div id="inv" data-crm-inventario data-proyecto="torre" ${extra}></div>
<form data-crm-captura onsubmit="return false"><input name="nombre"><input name="telefono"><input name="interes" id="interes"><button>Enviar</button></form>
<script src="/embed/inventario.js" data-url="https://fake.supabase.co" data-anon="anon-key" data-clave="pk_demo" defer></script>`;

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  try {
    async function abrir(html, respuesta, estado = 200) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      const llamadas = [];
      await ctx.route("https://fake.supabase.co/**", (r) => { llamadas.push({ url: r.request().url(), headers: r.request().headers(), body: JSON.parse(r.request().postData() || "{}") }); r.fulfill({ status: estado, contentType: "application/json", body: JSON.stringify(respuesta) }); });
      await ctx.route(url + "/cliente.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
      const page = await ctx.newPage(); const errores = []; page.on("pageerror", (e) => errores.push(e.message));
      await page.goto(url + "/cliente.html");
      return { ctx, page, llamadas, errores };
    }
    const dentro = (page, sel) => page.locator("#inv " + sel);   // Playwright atraviesa el Shadow DOM abierto

    /* 1. Pide solo lo público, con la clave de la empresa */
    let { ctx, page, llamadas, errores } = await abrir(HTML(), DATOS);
    await dentro(page, ".u").first().waitFor();
    assert.match(llamadas[0].url, /\/rest\/v1\/rpc\/inventario_publico$/); assert.equal(llamadas[0].headers.apikey, "anon-key");
    assert.deepEqual(llamadas[0].body, { p_clave: "pk_demo", p_proyecto: "torre" }); ok("llama a inventario_publico con la clave pública y el proyecto");

    /* 2. Por defecto solo disponibles, con orden natural (A-2 antes que A-10) */
    const codigos = async () => (await dentro(page, ".u h3 span:first-child").allTextContents());
    assert.deepEqual(await codigos(), ["A-2", "A-3", "A-10"]); ok("muestra solo las disponibles, en orden natural (A-2, A-3, A-10)");
    const t = await dentro(page, ".u").nth(2).textContent();
    assert.match(t, /Piso 10/); assert.match(t, /85,5 m²/); assert.match(t, /2 dorm\./); assert.match(t, /2,5 baños/); assert.match(t, /1 parqueo/); assert.match(t, /\$120\.000|\$\s?120,000|120\.000/); ok("ficha: piso, área, dormitorios, baños, parqueos y precio con formato");
    assert.match(await dentro(page, ".u").nth(1).textContent(), /Consultar precio/); ok("sin precio dice «Consultar precio»");
    assert.match(await dentro(page, ".u").nth(2).locator("img.foto").getAttribute("src"), /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/public\/inventario\/org\/u10\/1\.jpg$/);
    assert.equal(await dentro(page, ".u").nth(0).locator("img").count(), 0); ok("la portada de la unidad encabeza su tarjeta (solo si tiene foto)");
    assert.equal(await dentro(page, "img:not(.foto)").count(), 0); assert.match(await dentro(page, ".u").nth(0).textContent(), /<img src=x onerror=alert\(1\)>Vista al parque/); ok("el texto del CRM se muestra como texto, nunca como HTML");

    /* 3. Filtros */
    await dentro(page, "select").nth(2).selectOption("t");
    assert.deepEqual(await codigos(), ["A-2", "A-3", "A-4", "A-5", "A-10"]); ok("«Todas» muestra también las reservadas y vendidas");
    assert.equal(await dentro(page, ".chip.reservada").count(), 1); assert.equal(await dentro(page, ".chip.vendida").count(), 1); ok("cada una con su estado");
    assert.equal(await dentro(page, "button").count(), 3); ok("el botón «Me interesa» solo sale en las disponibles");
    await dentro(page, "select").nth(0).selectOption("suite"); assert.deepEqual(await codigos(), ["A-3"]); ok("filtra por tipo");
    await dentro(page, "select").nth(0).selectOption(""); await dentro(page, "select").nth(1).selectOption("3");
    assert.deepEqual(await codigos(), ["A-4", "A-5"]); ok("filtra por dormitorios");
    await dentro(page, "select").nth(0).selectOption("suite"); await dentro(page, "select").nth(1).selectOption("2"); assert.match(await dentro(page, ".vacio").textContent(), /No hay unidades con esos filtros/); ok("sin resultados lo dice");

    /* 4. «Me interesa» rellena el formulario de captura y emite un evento */
    await dentro(page, "select").nth(0).selectOption(""); await dentro(page, "select").nth(1).selectOption(""); await dentro(page, "select").nth(2).selectOption("d");
    await page.evaluate(() => { window.__ev = null; document.getElementById("inv").addEventListener("crm-inventario-interes", (e) => { window.__ev = e.detail; }); });
    await dentro(page, ".u").filter({ hasText: "A-10" }).locator("button").click();
    assert.equal(await page.inputValue("#interes"), "A-10 (Torre Alba)"); ok("rellena el campo «interes» del formulario con la unidad");
    assert.equal((await page.evaluate(() => window.__ev)).codigo, "A-10"); ok("emite el evento crm-inventario-interes con la unidad");
    assert.deepEqual(errores, []); await ctx.close();

    /* 5. Opciones: color, sin botón, todas las unidades; sin proyecto muestra el nombre */
    ({ ctx, page, llamadas } = await abrir(HTML('data-color="#FFE600" data-boton="" data-solo-disponibles="false"').replace('data-proyecto="torre" ', ""), DATOS));
    await dentro(page, ".u").first().waitFor();
    assert.equal(await dentro(page, ".u").count(), 5); assert.equal(await dentro(page, "button").count(), 0); ok("data-solo-disponibles=false y data-boton vacío");
    assert.equal(llamadas[0].body.p_proyecto, null); assert.match(await dentro(page, ".u h3").first().textContent(), /Torre Alba · A-2/); ok("sin data-proyecto pide todos y antepone el nombre del proyecto");
    await ctx.close();

    /* 6. Colores con contraste: un amarillo lleva texto oscuro; un azul oscuro, blanco */
    for (const [color, esperado] of [["#FFE600", "rgb(22, 22, 22)"], ["#1E4FD8", "rgb(255, 255, 255)"]]) {
      ({ ctx, page } = await abrir(HTML(`data-color="${color}"`), DATOS));
      await dentro(page, "button").first().waitFor();
      assert.equal(await dentro(page, "button").first().evaluate((b) => getComputedStyle(b).color), esperado); await ctx.close();
    }
    ok("el texto de los botones se adapta al color (amarillo → oscuro, azul → blanco)");

    /* 7. Errores y vacío: la web del cliente no se rompe */
    ({ ctx, page, errores } = await abrir(HTML(), { message: "Clave no válida" }, 400));
    await dentro(page, ".vacio").waitFor(); assert.match(await dentro(page, ".vacio").textContent(), /No pudimos cargar la disponibilidad/); assert.deepEqual(errores, []); ok("si falla el servidor muestra un aviso y no lanza errores");
    await ctx.close();
    ({ ctx, page } = await abrir(HTML(), { unidades: [] }));
    await dentro(page, ".vacio").waitFor(); assert.match(await dentro(page, ".vacio").textContent(), /no hay unidades para mostrar/); ok("sin unidades lo dice");
    await ctx.close();
    ({ ctx, page } = await abrir(HTML().replace('data-clave="pk_demo"', ""), DATOS)); await page.waitForTimeout(300);
    assert.equal(await page.locator("#inv .u").count(), 0); ok("sin clave configurada no hace nada"); await ctx.close();
  } finally { await browser.close(); server.close(); }
  console.log("Disponibilidad en la web del cliente: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
