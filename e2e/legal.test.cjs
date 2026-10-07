/* Páginas legales: existen, enlazadas desde la web, la app y /descargar, con los datos de la empresa tomados de config.js
   y sin publicar «a medias» (lo que falta se resalta y se avisa que es borrador).
   Uso: NODE_PATH=$(npm root -g) node e2e/legal.test.cjs */
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const { servir, chromium } = require("./lib.cjs");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const CONFIG = (legal) => 'window.CRM_CONFIG={SUPABASE_URL:"https://fake.supabase.co",SUPABASE_ANON_KEY:"anon",VENTAS_WHATSAPP:"593900000000"' + (legal ? ",LEGAL:" + JSON.stringify(legal) : "") + "};";

(async () => {
  const { server, url } = await servir();
  const browser = await chromium.launch();
  try {
    async function abrir(ruta, legal, viewport) {
      const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
      const page = await ctx.newPage(); const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errores.push(m.text()); });
      await page.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG(legal) }));
      await page.goto(url + ruta, { waitUntil: "load" });
      return { ctx, page, errores };
    }

    /* 1. Sin datos de la empresa: se ven los huecos y el aviso de borrador */
    for (const [ruta, titulo] of [["/terminos/", "Términos del servicio"], ["/privacidad/", "Política de privacidad"]]) {
      const { ctx, page, errores } = await abrir(ruta, null);
      assert.equal(await page.textContent("h1"), titulo); ok(ruta + " carga con su título");
      assert.ok(await page.isVisible("#borrador")); ok(ruta + ": muestra el aviso de borrador pendiente de revisión legal");
      const faltan = await page.$$eval(".falta", (e) => e.map((x) => x.textContent));
      assert.ok(faltan.some((t) => /RUC/.test(t)) && faltan.some((t) => /domicilio/.test(t)), ruta + " debe resaltar los datos que faltan");
      ok(ruta + ": los datos que faltan se resaltan como «[completar: …]»");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); ok(ruta + ": sin desbordes en el celular");
      assert.equal(await page.locator("h2").count() >= 10, true); ok(ruta + ": tiene todas sus secciones");
      assert.deepEqual(errores, []); await ctx.close();
    }

    /* 2. Con los datos completos y revisado: sin huecos ni borrador */
    const L = { razon_social: "GPUnlock S.A.S.", ruc: "1790012345001", domicilio: "Av. Amazonas N35-17, Quito", ciudad: "Quito", correo_privacidad: "privacidad@gpunlock.com", actualizado: "1 de diciembre de 2026", revisado: true };
    for (const ruta of ["/terminos/", "/privacidad/"]) {
      const { ctx, page, errores } = await abrir(ruta, L, { width: 1280, height: 900 });
      const txt = await page.textContent("main");
      assert.match(txt, /GPUnlock S\.A\.S\./); assert.match(txt, /1790012345001/); assert.match(txt, /Quito/); assert.match(txt, /privacidad@gpunlock\.com/); ok(ruta + ": usa los datos de config.js");
      assert.equal(await page.locator(".falta").count(), 0); ok(ruta + ": sin huecos");
      assert.equal(await page.isVisible("#borrador"), false); ok(ruta + ": con revisado=true no muestra el aviso de borrador");
      assert.equal(await page.textContent("#actualizado"), "1 de diciembre de 2026"); ok(ruta + ": fecha de actualización");
      assert.deepEqual(errores, []); await ctx.close();
    }

    /* 3. Contenido que el producto realmente necesita decir */
    const web = (f) => fs.readFileSync(path.join(__dirname, "..", "web", f), "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const t = web("terminos/index.html"), p = web("privacidad/index.html");
    for (const [re, que] of [[/transferencia bancaria/, "pago por transferencia"], [/confirmamos el pago/, "activación al confirmar el pago"], [/No se realizan pagos ni se suben comprobantes/, "sin pagos en la app"], [/días de gracia/, "días de gracia"], [/solo lectura/, "solo lectura"], [/IVA/, "IVA"], [/inteligencia artificial/i, "IA"], [/leads que lleguen por el formulario/, "los leads de la web siguen entrando"]])
      assert.match(t, re, "términos: " + que);
    ok("los términos explican que el pago se acuerda con GPUnlock, la activación, gracia, solo lectura, IVA e IA");
    for (const [re, que] of [[/LOPDP|Protección de Datos Personales/, "ley aplicable"], [/encargado/, "rol de encargado"], [/Supabase/, "Supabase"], [/Netlify/, "Netlify"], [/Anthropic/, "Anthropic"], [/acceso, rectificación, eliminación, oposición, portabilidad/, "derechos"], [/Superintendencia/, "autoridad"], [/30 días/, "script de atribución"], [/fbclid/, "origen de leads"]])
      assert.match(p, re, "privacidad: " + que);
    ok("la privacidad nombra la ley, el rol de encargado, los proveedores, los derechos y los datos de campañas");

    /* 4. Enlaces: la web, /descargar y el registro de la app apuntan a páginas que existen */
    for (const [ruta, esperar] of [["/", 2], ["/descargar/", 2]]) {
      const { ctx, page } = await abrir(ruta, null);
      const hrefs = await page.$$eval('a[href="/terminos/"], a[href="/privacidad/"]', (a) => a.map((x) => x.getAttribute("href")));
      assert.ok(hrefs.includes("/terminos/") && hrefs.includes("/privacidad/"), ruta + " enlaza ambas páginas");
      for (const h of ["/terminos/", "/privacidad/"]) { const r = await page.request.get(url + h); assert.equal(r.status(), 200, h); }
      await ctx.close();
    }
    ok("la web principal y /descargar enlazan a /terminos/ y /privacidad/ (y responden 200)");
    const app = fs.readFileSync(path.join(__dirname, "..", "web/app/index.html"), "utf8");
    assert.match(app, /id="signup-form"[\s\S]*href="\/terminos\/"[\s\S]*href="\/privacidad\/"/); ok("el registro de la app avisa que se aceptan los términos y la privacidad, con enlaces");
  } finally { await browser.close(); server.close(); }
  console.log("Páginas legales: OK (" + n + ")");
})().catch((e) => { console.error(e); process.exit(1); });
