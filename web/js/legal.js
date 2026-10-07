/* GPUnlock CRM · Páginas legales (/terminos, /privacidad).
   Completa los datos de la empresa desde CRM_CONFIG.LEGAL (js/config.js): lo que falte se resalta para que no
   se publique a medias, y mientras LEGAL.revisado no sea true se muestra el aviso de borrador. */
(function () {
  "use strict";
  var L = (window.CRM_CONFIG && window.CRM_CONFIG.LEGAL) || {};
  document.querySelectorAll("[data-legal]").forEach(function (el) {
    var k = el.getAttribute("data-legal"), v = L[k];
    if (v) { el.textContent = v; return; }
    el.textContent = "[completar: " + (el.getAttribute("data-nombre") || k) + "]";
    el.classList.add("falta");
  });
  var aviso = document.getElementById("borrador");
  if (aviso) aviso.hidden = L.revisado === true;
  var f = document.getElementById("actualizado");
  if (f && L.actualizado) f.textContent = L.actualizado;
  var anio = document.getElementById("anio"); if (anio) anio.textContent = String(new Date().getFullYear());
})();
