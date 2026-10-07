/* GPUnlock CRM · service worker.
   Objetivo: que la app se instale y abra al instante, y que sin internet muestre
   la pantalla (con aviso) en vez de un error del navegador. Los datos (Supabase)
   y la IA NUNCA se guardan en caché: son de otro origen y solo se piden en línea. */
var VERSION = "gpunlock-crm-v4";
var SHELL = [
  "/app/", "/app/app.css", "/app/js/app.js", "/app/js/importar.js", "/app/manifest.webmanifest",
  "/css/tokens.css", "/css/gp-tokens.css", "/js/config.js", "/js/tema.js", "/assets/brand/gp-mark.png",
  "/assets/fonts/outfit-latin-wght-normal.woff2", "/assets/fonts/work-sans-latin-wght-normal.woff2", "/assets/brand/gp-mark-white.png",
  "/app/icons/icon-192.png", "/app/icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Red primero (siempre el código más nuevo); caché solo si no hay conexión.
self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copia = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("/app/") : Response.error()); });
    })
  );
});
