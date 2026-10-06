/* ==========================================================================
   CRM INMOBILIARIO · Captura de leads para tu sitio web
   Pega en tu página (la app te da el código ya listo en Ajustes → Tu sitio web):

   <script src="https://TU-APP/embed/lead.js" data-url="https://xxxx.supabase.co"
           data-anon="TU_ANON_KEY" data-clave="pk_..." defer></script>

   Cada <form data-crm-captura data-crm-proyecto="mi-proyecto"> envía sus datos al CRM
   al enviarse, SIN cambiar lo que ya hacía el formulario. Si algo falla, el formulario
   sigue funcionando: nunca bloquea al visitante.
   Campos reconocidos (por name): nombre, telefono, correo, mensaje, interes.
   API manual: CRMInmobiliario.enviar({ nombre, telefono, correo, proyecto, interes, mensaje })
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
          p_trampa: d.trampa || null
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

  window.CRMInmobiliario = { enviar: enviar };
})();
