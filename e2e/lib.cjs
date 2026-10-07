/* Ayudas comunes: servidor estático de web/, navegador y servidor simulado de Supabase. */
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const WEB = path.join(__dirname, "..", "web");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

function servir() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(WEB, p);
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("no"); }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok({ server: s, url: "http://localhost:" + s.address().port }));
  });
}

/* Abre la app con el Supabase simulado. `fx` (JSON) sobrescribe el estado por defecto de fake-supabase.js. */
async function abrirApp(browser, base, fx, viewport, opts) {
  opts = Object.assign({ ruta: "/app/", esperar: "#app:not([hidden])", sinConfig: false, pagosEnApp: false, wa: "593911222333" }, opts || {});
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 }, reducedMotion: "reduce", acceptDownloads: false });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errores.push(m.text()); });
  const config = opts.sinConfig ? 'window.CRM_CONFIG={SUPABASE_URL:"https://TU-PROYECTO.supabase.co",SUPABASE_ANON_KEY:"TU_ANON_KEY"};' : 'window.CRM_CONFIG={SUPABASE_URL:"https://fake.supabase.co",SUPABASE_ANON_KEY:"anon",APP_NAME:"GPUnlock CRM",VENTAS_WHATSAPP:"' + opts.wa + '",PAGOS_EN_APP:' + opts.pagosEnApp + '};';
  await page.route("**/js/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: config }));
  await page.route("**/supabase.js", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "fake-supabase.js"), "utf8") }));
  await page.addInitScript((f) => { window.__FX = Object.assign({ calls: [], uploads: [] }, f); }, fx);
  await page.goto(base + opts.ruta, { waitUntil: "load" });
  await page.waitForSelector(opts.esperar, { timeout: 8000 });
  return { ctx, page, errores };
}
module.exports = { servir, abrirApp, chromium };
