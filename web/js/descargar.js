/* GPUnlock CRM · /descargar: detecta el dispositivo, muestra la última versión del APK
   (descargar/version.json) y comparte el enlace para abrirlo en el celular. */
(function () {
  "use strict";

  /* Empresa opcional (?e=miempresa): la app abre con su marca en el inicio de sesión. */
  var empresa = (new URLSearchParams(location.search).get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  var appUrl = "/app/" + (empresa ? "?e=" + empresa : "");
  document.querySelectorAll("[data-app-link]").forEach(function (a) { a.href = appUrl; });

  /* Dispositivo: el suyo va primero y marcado. */
  var ua = navigator.userAgent || "";
  var tipo = /android/i.test(ua) ? "android"
    : (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) ? "iphone"
    : "computadora";
  var mio = document.querySelector('[data-dispositivo="' + tipo + '"]');
  var lista = document.getElementById("devices");
  if (mio && lista && !location.hash) { mio.classList.add("is-mine"); lista.insertBefore(mio, lista.firstElementChild); }
  else if (mio) mio.classList.add("is-mine");

  /* Última versión del APK. */
  var btn = document.getElementById("btn-apk");
  var info = document.getElementById("apk-info");
  var hash = document.getElementById("apk-hash");
  function sinApk() {
    btn.querySelector("span").textContent = "Disponible muy pronto";
    btn.setAttribute("aria-disabled", "true");
    btn.removeAttribute("href");
    info.innerHTML = 'Mientras tanto, <a href="' + appUrl + '" style="text-decoration:underline">abre la versión web</a> en Chrome y toca <b>Instalar</b>.';
  }
  fetch("/descargar/version.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (v) {
      var a = v && v.android;
      if (!a || !a.apk || !a.version) return sinApk();
      btn.href = a.apk;
      btn.setAttribute("download", "");
      btn.removeAttribute("aria-disabled");
      btn.querySelector("span").textContent = "Descargar para Android";
      info.textContent = "Versión " + a.version + (a.fecha ? " · " + a.fecha : "");
      if (a.sha256) hash.textContent = "Huella SHA-256: " + a.sha256;
    })
    .catch(sinApk);

  /* Compartir el enlace al celular. */
  var link = location.origin + "/descargar/" + (empresa ? "?e=" + empresa : "");
  var code = document.getElementById("share-url");
  if (code) code.textContent = link.replace(/^https?:\/\//, "");
  var wa = document.getElementById("btn-wa");
  if (wa) wa.href = "https://wa.me/?text=" + encodeURIComponent("Instala GPUnlock CRM en tu celular: " + link);
  var copiar = document.getElementById("btn-copiar");
  if (copiar) copiar.addEventListener("click", function () {
    var lbl = copiar.querySelector("span");
    var listo = function () { lbl.textContent = "¡Copiado!"; setTimeout(function () { lbl.textContent = "Copiar enlace"; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(listo, function () { lbl.textContent = "Cópialo a mano"; });
    else lbl.textContent = "Cópialo a mano";
  });

  var anio = document.getElementById("anio");
  if (anio) anio.textContent = String(new Date().getFullYear());
})();
