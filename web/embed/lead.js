/* ==========================================================================
   GPUnlock CRM · Captura de leads para tu sitio web
   Pega en tu página (la app te da el código ya listo en Ajustes → Tu sitio web):

   <script src="https://TU-APP/embed/lead.js" data-url="https://xxxx.supabase.co"
           data-anon="TU_ANON_KEY" data-clave="pk_..." defer></script>

   Cada <form data-crm-captura data-crm-proyecto="mi-proyecto"> envía sus datos al CRM
   al enviarse, SIN cambiar lo que ya hacía el formulario. Si algo falla, el formulario
   sigue funcionando: nunca bloquea al visitante.
   Campos reconocidos (por name): nombre, telefono, correo, mensaje, interes.
   API manual: GPUnlockCRM.enviar({ nombre, telefono, correo, proyecto, interes, mensaje })
   (también disponible como CRMInmobiliario, por compatibilidad).

   Origen del lead: guarda 30 días en el navegador los parámetros de campaña de la URL
   (utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, ttclid) y las
   cookies de Meta (_fbp, _fbc) y los envía junto al lead. Así el CRM sabe qué anuncio lo trajo.
   No guarda datos personales. Menciónalo en la política de privacidad de tu sitio.
   ========================================================================== */
(function () {
  "use strict";
  var tag = document.currentScript || document.querySelector("script[data-clave][src*='lead.js']");
  if (!tag) return;
  var URL_ = (tag.getAttribute("data-url") || "").replace(/\/+$/, "");
  var ANON = tag.getAttribute("data-anon") || "";
  var CLAVE = tag.getAttribute("data-clave") || "";
  var PROYECTO_DEF = tag.getAttribute("data-proyecto") || "";
  if (!URL_ || !ANON || !CLAVE) return;

  var ALIAS = {
    nombre: ["nombre", "name", "nombres", "fullname", "full_name"],
    telefono: ["telefono", "phone", "tel", "celular", "whatsapp", "movil"],
    correo: ["correo", "email", "mail"],
    mensaje: ["mensaje", "message", "comentario", "comentarios"],
    interes: ["interes", "interest", "unit", "unidad", "lote", "tipologia"]
  };

  /* ------------------------------------------------------------ origen del lead */
  var PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ttclid"];
  var LS = "gpu_atrib", VIGENCIA = 30 * 864e5;
  function guardada() {
    try { var j = JSON.parse(localStorage.getItem(LS) || "null"); if (j && j.t && Date.now() - j.t < VIGENCIA && j.d) return j.d; } catch (e) { /* sin almacenamiento */ }
    return null;
  }
  function cookie(n) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)"));
    try { return m ? decodeURIComponent(m[1]) : ""; } catch (e) { return ""; }
  }
  /* Si la URL trae parámetros de campaña, mandan (último clic); si no, se usa lo guardado. */
  function atribucion() {
    var d = {}, hay = false;
    try {
      var q = new URLSearchParams(location.search);
      PARAMS.forEach(function (k) { var v = q.get(k); if (v) { d[k] = String(v).slice(0, 150); hay = true; } });
    } catch (e) { /* navegador antiguo */ }
    if (hay) {
      d.pagina_origen = location.origin + location.pathname;
      if (d.fbclid && !cookie("_fbc")) d.fbc = "fb.1." + Date.now() + "." + d.fbclid;   // formato que espera Meta
      try { localStorage.setItem(LS, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* sin almacenamiento */ }
    } else {
      d = guardada() || { pagina_origen: location.origin + location.pathname };
    }
    var fbp = cookie("_fbp"), fbc = cookie("_fbc");
    if (fbp) d.fbp = fbp.slice(0, 100);
    if (fbc) d.fbc = fbc.slice(0, 150);
    return d;
  }

  function slug(v) {
    if (!v) return "";
    return String(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  function enviar(d) {
    try {
      if (!d || !d.nombre || !d.telefono) return Promise.resolve(false);
      return fetch(URL_ + "/rest/v1/rpc/crm_registrar_lead", {
        method: "POST",
        keepalive: true,                       // sigue aunque la página cambie (p. ej. a WhatsApp)
        headers: { "Content-Type": "application/json", apikey: ANON, Authorization: "Bearer " + ANON },
        body: JSON.stringify({
          p_clave: CLAVE,
          p_nombre: d.nombre,
          p_telefono: d.telefono,
          p_correo: d.correo || null,
          p_proyecto: slug(d.proyecto || PROYECTO_DEF) || null,
          p_interes: d.interes || null,
          p_mensaje: d.mensaje || null,
          p_origen: slug(d.origen || d.proyecto || PROYECTO_DEF || location.hostname) || null,
          p_trampa: d.trampa || null,
          p_atribucion: atribucion()
        })
      }).then(function (r) { return r.ok; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function campo(form, clave) {
    var nombres = ALIAS[clave];
    for (var i = 0; i < nombres.length; i++) {
      var el = form.querySelector('[name="' + nombres[i] + '"]');
      if (el && "value" in el && String(el.value).trim()) return String(el.value).trim();
    }
    return "";
  }

  function enganchar(form) {
    if (form.__crm) return;
    form.__crm = true;
    // Campo trampa para robots (invisible para personas).
    var t = document.createElement("input");
    t.type = "text"; t.name = "crm_web_trampa"; t.tabIndex = -1; t.autocomplete = "off"; t.setAttribute("aria-hidden", "true");
    t.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0";
    form.appendChild(t);
    form.addEventListener("submit", function () {
      enviar({
        nombre: campo(form, "nombre"), telefono: campo(form, "telefono"), correo: campo(form, "correo"),
        mensaje: campo(form, "mensaje"), interes: campo(form, "interes"),
        proyecto: form.getAttribute("data-crm-proyecto") || "", trampa: t.value
      });
    }, true);
  }

  function iniciar() { Array.prototype.forEach.call(document.querySelectorAll("form[data-crm-captura]"), enganchar); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  window.GPUnlockCRM = window.CRMInmobiliario = { enviar: enviar };
})();
