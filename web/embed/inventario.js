/* ==========================================================================
   GPUnlock CRM · Disponibilidad en vivo para tu sitio web
   Pega en tu página (la app te da el código ya listo en Ajustes → Tu sitio web):

   <div data-crm-inventario data-proyecto="mi-proyecto"></div>
   <script src="https://TU-APP/embed/inventario.js" data-url="https://xxxx.supabase.co"
           data-anon="TU_ANON_KEY" data-clave="pk_..." defer></script>

   Muestra las unidades del proyecto (o de todos si no pones data-proyecto) con su precio y su
   estado actual, con filtros por tipo y dormitorios. Solo aparece lo que marcaste como público
   en el CRM; las unidades bloqueadas no se muestran.

   Opciones del <div>:  data-proyecto="slug" · data-color="#F2582B" (color de los botones y chips)
                        data-solo-disponibles="false" (muestra también reservadas y vendidas)
                        data-boton="Me interesa" (texto del botón; data-boton="" lo oculta)
   «Me interesa»: si la página tiene un formulario <form data-crm-captura> con un campo «interes»,
   lo rellena con la unidad y baja hasta el formulario; además emite el evento
   «crm-inventario-interes» en el <div> (detail = la unidad) por si quieres hacer algo propio.
   Se dibuja dentro de un Shadow DOM: los estilos de tu sitio no lo rompen ni él rompe los tuyos.
   ========================================================================== */
(function () {
  "use strict";
  var tag = document.currentScript || document.querySelector("script[data-clave][src*='inventario.js']");
  if (!tag) return;
  var URL_ = (tag.getAttribute("data-url") || "").replace(/\/+$/, ""), ANON = tag.getAttribute("data-anon") || "", CLAVE = tag.getAttribute("data-clave") || "";
  if (!URL_ || !ANON || !CLAVE) return;

  var TIPOS = { departamento: "Departamento", suite: "Suite", loft: "Loft", casa: "Casa", lote: "Lote", local: "Local", oficina: "Oficina", parqueo: "Parqueo", bodega: "Bodega", otro: "Otro" };
  var ESTADOS = { disponible: "Disponible", reservada: "Reservada", vendida: "Vendida" };
  var NF = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var NA = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });

  /* Texto sobre el color de la marca con contraste suficiente (blanco o casi negro). */
  function lum(h) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function colores(h) {
    h = /^#[0-9a-f]{6}$/i.test(h || "") ? h : "#F2582B";
    var l = lum(h), conBlanco = 1.05 / (l + 0.05), conNegro = (l + 0.05) / 0.06;
    return { fondo: h, texto: conBlanco >= conNegro ? "#FFFFFF" : "#161616" };
  }
  var CSS = ":host{display:block;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#161616}*{box-sizing:border-box}" +
    ".bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}.bar label{display:grid;gap:2px;font-size:12px;color:#555}" +
    "select{font:inherit;padding:8px 10px;border:1px solid #cfcfcf;border-radius:10px;background:#fff;color:#161616;min-height:40px}" +
    ".lista{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}" +
    ".u{border:1px solid #e3e3e3;border-radius:14px;padding:14px;background:#fff;display:grid;gap:6px;align-content:start}" +
    ".u h3{margin:0;font-size:17px;display:flex;justify-content:space-between;gap:8px;align-items:center}" +
    ".u small{color:#555}.precio{font-size:19px;font-weight:700}" +
    ".chip{font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap}" +
    ".chip.disponible{background:#E3F4EA;color:#14653A}.chip.reservada{background:#FFF1D1;color:#7A4B00}.chip.vendida{background:#ECECEC;color:#444}" +
    "button{font:inherit;font-weight:600;border:0;border-radius:99px;padding:10px 16px;min-height:44px;cursor:pointer;background:var(--c);color:var(--t)}" +
    "button:focus-visible,select:focus-visible{outline:3px solid var(--c);outline-offset:2px}" +
    ".vacio{padding:24px;text-align:center;color:#555;border:1px dashed #cfcfcf;border-radius:14px}.pie{margin-top:10px;font-size:12px;color:#777}";

  function natural(a, b) { return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" }); }
  function el(t, cls, txt) { var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function montar(host) {
    var proyecto = (host.getAttribute("data-proyecto") || "").toLowerCase(), c = colores(host.getAttribute("data-color"));
    var textoBoton = host.hasAttribute("data-boton") ? host.getAttribute("data-boton") : "Me interesa";
    var soloDisp = host.getAttribute("data-solo-disponibles") !== "false";
    var raiz = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var estilo = el("style", "", CSS); raiz.appendChild(estilo);
    var cont = el("div"); cont.style.setProperty("--c", c.fondo); cont.style.setProperty("--t", c.texto); raiz.appendChild(cont);
    cont.appendChild(el("div", "vacio", "Cargando disponibilidad…"));
    host.setAttribute("aria-busy", "true");

    fetch(URL_ + "/rest/v1/rpc/inventario_publico", {
      method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ p_clave: CLAVE, p_proyecto: proyecto || null })
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (j) {
      host.removeAttribute("aria-busy");
      pintar((j && j.unidades) || []);
    }).catch(function () {
      host.removeAttribute("aria-busy");
      cont.textContent = ""; cont.appendChild(el("div", "vacio", "No pudimos cargar la disponibilidad. Inténtalo de nuevo en unos minutos."));
    });

    function pintar(todas) {
      var f = { tipo: "", dorm: "", disp: soloDisp };
      cont.textContent = "";
      var tipos = Object.keys(TIPOS).filter(function (t) { return todas.some(function (u) { return u.tipo === t; }); });
      var dorms = todas.map(function (u) { return u.dormitorios; }).filter(function (d, i, a) { return d != null && a.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
      var bar = el("div", "bar");
      function sel(etq, opciones, alCambiar, inicial) {
        var l = el("label"), s = el("select");
        l.appendChild(el("span", "", etq)); l.appendChild(s);
        opciones.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; s.appendChild(op); });
        if (inicial != null) s.value = inicial;
        s.addEventListener("change", function () { alCambiar(s.value); lista(); });
        bar.appendChild(l);
      }
      if (tipos.length > 1) sel("Tipo", [["", "Todos"]].concat(tipos.map(function (t) { return [t, TIPOS[t]]; })), function (v) { f.tipo = v; });
      if (dorms.length > 1) sel("Dormitorios", [["", "Todos"]].concat(dorms.map(function (d) { return [String(d), d + (d === 1 ? " dormitorio" : " dormitorios")]; })), function (v) { f.dorm = v; });
      if (todas.some(function (u) { return u.estado !== "disponible"; })) sel("Mostrar", [["d", "Solo disponibles"], ["t", "Todas"]], function (v) { f.disp = v === "d"; }, soloDisp ? "d" : "t");
      if (bar.children.length) cont.appendChild(bar);
      var caja = el("div"); cont.appendChild(caja);

      function lista() {
        caja.textContent = "";
        var us = todas.filter(function (u) {
          return (!f.tipo || u.tipo === f.tipo) && (f.dorm === "" || String(u.dormitorios) === f.dorm) && (!f.disp || u.estado === "disponible");
        }).sort(function (a, b) { return natural(a.proyecto_nombre, b.proyecto_nombre) || natural(a.bloque || "", b.bloque || "") || natural(a.piso || "", b.piso || "") || natural(a.codigo, b.codigo); });
        if (!us.length) { caja.appendChild(el("div", "vacio", todas.length ? "No hay unidades con esos filtros." : "Por ahora no hay unidades para mostrar.")); return; }
        var g = el("div", "lista");
        us.forEach(function (u) {
          var t = el("article", "u"), h = el("h3");
          h.appendChild(el("span", "", (proyecto ? "" : u.proyecto_nombre + " · ") + u.codigo));
          h.appendChild(el("span", "chip " + u.estado, ESTADOS[u.estado] || u.estado)); t.appendChild(h);
          var det = [TIPOS[u.tipo] || u.tipo, u.bloque ? "Torre/Bloque " + u.bloque : "", u.piso ? "Piso " + u.piso : ""].filter(Boolean).join(" · ");
          t.appendChild(el("small", "", det));
          var car = [u.area_m2 != null ? NA.format(u.area_m2) + " m²" : "", u.dormitorios != null ? u.dormitorios + " dorm." : "", u.banos != null ? NA.format(u.banos) + " baños" : "",
            u.parqueos ? u.parqueos + " parqueo" + (u.parqueos > 1 ? "s" : "") : "", u.bodegas ? u.bodegas + " bodega" + (u.bodegas > 1 ? "s" : "") : ""].filter(Boolean).join(" · ");
          if (car) t.appendChild(el("span", "", car));
          if (u.descripcion) t.appendChild(el("small", "", u.descripcion));
          t.appendChild(el("span", "precio", u.precio != null ? NF.format(u.precio) : "Consultar precio"));
          if (textoBoton && u.estado === "disponible") {
            var b = el("button", "", textoBoton); b.type = "button";
            b.addEventListener("click", function () { interes(host, u); });
            t.appendChild(b);
          }
          g.appendChild(t);
        });
        caja.appendChild(g);
      }
      lista();
    }
  }

  /* «Me interesa»: rellena el formulario de captura de la página y avisa con un evento. */
  function interes(host, u) {
    var texto = u.codigo + (u.proyecto_nombre ? " (" + u.proyecto_nombre + ")" : "");
    try { host.dispatchEvent(new CustomEvent("crm-inventario-interes", { bubbles: true, composed: true, detail: u })); } catch (e) { /* navegador antiguo */ }
    var form = document.querySelector("form[data-crm-captura]");
    if (!form) return;
    var campo = form.querySelector('[name="interes"],[name="interest"],[name="unidad"],[name="unit"]');
    if (campo) campo.value = texto;
    var primero = form.querySelector("input:not([type=hidden]),textarea,select");
    try { form.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { form.scrollIntoView(); }
    if (primero) setTimeout(function () { try { primero.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }, 400);
  }

  function iniciar() { Array.prototype.forEach.call(document.querySelectorAll("[data-crm-inventario]"), function (h) { if (!h.__crmInv) { h.__crmInv = true; montar(h); } }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
  window.GPUnlockInventario = { actualizar: iniciar };
})();
