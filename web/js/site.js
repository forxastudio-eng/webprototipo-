/* GPUnlock CRM · Web principal: navegación, apariciones, precios y demo de marca. */
(function () {
  "use strict";
  var CFG = window.CRM_CONFIG || {};
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ nav --- */
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("is-scrolled", window.scrollY > 8); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("menu-movil");
  function setMenu(open) {
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    toggle.querySelector("use").setAttribute("href", open ? "#i-x" : "#i-menu");
    if (open) nav.classList.add("is-scrolled"); else onScroll();
  }
  if (toggle && menu) {
    toggle.addEventListener("click", function () { setMenu(menu.hidden); });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) { setMenu(false); toggle.focus(); }
    });
    window.addEventListener("resize", function () { if (window.innerWidth >= 1000) setMenu(false); });
  }

  /* ----------------------------------------------------- apariciones --- */
  var items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------- precios --- */
  var periodo = "mensual";
  function dinero(n) {
    var entero = Math.round(n * 100) % 100 === 0;
    return "$" + n.toLocaleString("es-EC", { minimumFractionDigits: entero ? 0 : 2, maximumFractionDigits: 2 });
  }
  function pintarPrecios() {
    document.querySelectorAll(".plan").forEach(function (plan) {
      var m = Number(plan.dataset.mensual), a = Number(plan.dataset.anual);
      var b = plan.querySelector(".price b"), s = plan.querySelector(".price span"), nota = plan.querySelector(".price-note");
      if (periodo === "anual" && a) {
        b.textContent = dinero(a); s.textContent = "/ año";
        nota.textContent = "Equivale a " + dinero(a / 12) + " al mes";
      } else {
        b.textContent = dinero(m); s.textContent = "/ mes";
        nota.innerHTML = "&nbsp;";
      }
    });
  }
  document.querySelectorAll(".billing button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      periodo = btn.dataset.periodo;
      document.querySelectorAll(".billing button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      pintarPrecios();
    });
  });

  /* Precios reales desde la tabla `planes` cuando la configuración ya tiene un proyecto. */
  var url = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  if (url && url.indexOf("TU-PROYECTO") === -1 && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY !== "TU_ANON_KEY") {
    fetch(url + "/rest/v1/planes?select=id,nombre,descripcion,precio_mensual,precio_anual,caracteristicas&activo=eq.true&order=orden", {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY }
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (planes) {
      (planes || []).forEach(function (p) {
        var el = document.querySelector('.plan[data-plan="' + p.id + '"]');
        if (!el) return;
        el.dataset.mensual = p.precio_mensual;
        el.dataset.anual = p.precio_anual || "";
        if (p.nombre) el.querySelector("h3").textContent = p.nombre;
        if (p.descripcion) el.querySelector(".desc").textContent = p.descripcion;
        if (Array.isArray(p.caracteristicas) && p.caracteristicas.length) {
          var ul = el.querySelector("ul"), modelo = ul.querySelector("li");
          ul.innerHTML = "";
          p.caracteristicas.forEach(function (txt) {
            var li = modelo.cloneNode(true);
            li.lastChild.textContent = String(txt);
            ul.appendChild(li);
          });
        }
      });
      pintarPrecios();
    }).catch(function () { /* se quedan los precios del HTML */ });
  }

  /* ------------------------------------------------- demo de marca --- */
  function hexRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbHex(c) { return "#" + c.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"); }).join("").toUpperCase(); }
  function lum(c) {
    var s = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mezclar(c, con, t) { return c.map(function (v, i) { return v + (con[i] - v) * t; }); }
  var BLANCO = [255, 255, 255], TINTA = [22, 22, 22];

  /* Oscurece de a poco hasta que el color se lea como texto sobre blanco (AA 4.5:1). */
  function paraTexto(c) {
    var x = c.slice(), n = 0;
    while (ratio(x, BLANCO) < 4.5 && n < 40) { x = mezclar(x, [0, 0, 0], 0.06); n++; }
    return x;
  }
  /* Elige texto blanco o negro sobre el color; si ninguno llega a 4.5:1, ajusta el color. */
  function sobreColor(c) {
    var fondo = c.slice(), n = 0;
    while (Math.max(ratio(fondo, BLANCO), ratio(fondo, TINTA)) < 4.5 && n < 40) {
      fondo = lum(fondo) > 0.18 ? mezclar(fondo, [255, 255, 255], 0.06) : mezclar(fondo, [0, 0, 0], 0.06); n++;
    }
    var texto = ratio(fondo, BLANCO) >= ratio(fondo, TINTA) ? BLANCO : TINTA;
    return { fondo: fondo, texto: texto, ajustado: n > 0, r: ratio(fondo, texto) };
  }

  var root = document.documentElement;
  var aa = document.getElementById("demo-aa-txt");
  function aplicarColor(hex) {
    var c = hexRgb(hex), s = sobreColor(c), t = paraTexto(c);
    root.style.setProperty("--demo-primary", rgbHex(s.fondo));
    root.style.setProperty("--demo-on-primary", rgbHex(s.texto));
    root.style.setProperty("--demo-primary-text", rgbHex(t));
    root.style.setProperty("--demo-primary-soft", rgbHex(mezclar(c, BLANCO, 0.9)));
    root.style.setProperty("--demo-surface", rgbHex(mezclar(c, BLANCO, 0.965)));
    if (aa) {
      var txt = "Texto " + (s.texto === BLANCO ? "blanco" : "negro") + " sobre tu color: " + s.r.toFixed(1).replace(".", ",") + ":1.";
      if (s.ajustado) txt += " Ajustamos un poco el tono para que se lea bien.";
      else if (ratio(c, BLANCO) < 4.5) txt += " Para textos y enlaces usamos un tono más oscuro.";
      aa.textContent = txt;
    }
  }

  var nombre = document.getElementById("demo-nombre");
  function iniciales(v) {
    var p = v.trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "G").charAt(0) + (p[1] || "").charAt(0)).toUpperCase();
  }
  function aplicarNombre() {
    var v = nombre.value.trim() || "Tu inmobiliaria";
    document.getElementById("demo-name").textContent = v;
    document.getElementById("demo-ini").textContent = iniciales(v);
    var org = document.querySelector(".app-org");
    if (org) { org.lastChild.textContent = v; org.querySelector("span").textContent = iniciales(v); }
  }
  if (nombre) nombre.addEventListener("input", aplicarNombre);

  var swatches = document.querySelectorAll(".swatch[data-color]");
  var picker = document.getElementById("demo-color");
  function marcar(btn) { swatches.forEach(function (s) { s.setAttribute("aria-pressed", String(s === btn)); }); }
  swatches.forEach(function (btn) {
    btn.addEventListener("click", function () { marcar(btn); if (picker) picker.value = btn.dataset.color.toLowerCase(); aplicarColor(btn.dataset.color); });
  });
  if (picker) picker.addEventListener("input", function () { marcar(null); aplicarColor(picker.value); });
  aplicarColor("#F2582B");

  /* -------------------------------------------------------- ventas --- */
  var wa = String(CFG.VENTAS_WHATSAPP || "").replace(/\D/g, "");
  document.querySelectorAll("[data-ventas]").forEach(function (a) {
    if (!wa) return;
    a.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Hola, quiero conocer GPUnlock CRM para mi inmobiliaria.");
    a.target = "_blank"; a.rel = "noopener";
  });

  var anio = document.getElementById("anio");
  if (anio) anio.textContent = String(new Date().getFullYear());
})();
