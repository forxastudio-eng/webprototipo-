/* GPUnlock · Landing principal: proyectos desde Supabase (tabla "projects").
   Si Supabase aún no está configurado, muestra la lista base de respaldo para
   que el sitio nunca quede vacío. */
(function () {
  "use strict";

  var CFG = window.GPUNLOCK_CONFIG || {};
  var FALLBACK = [
    { name: "Vértice", url: "/vertice/", tagline: "Suites, departamentos y locales comerciales sobre la avenida Principal.", cover_url: "/assets/covers/vertice.jpg", ubicacion: "Ciudad Alta", tipo: "Suites y locales" },
    { name: "Prisma Suites & Lofts", url: "/prisma/", tagline: "Suites, lofts y espacios comerciales sobre la avenida del Parque.", cover_url: "/assets/covers/prisma.jpg", ubicacion: "Ciudad Alta", tipo: "Suites, lofts y locales" },
    { name: "Valle Sereno", url: "/valle/", tagline: "Lotes y desarrollo residencial en Valle Alto.", cover_url: "/assets/covers/valle-sereno.jpg", ubicacion: "Valle Alto", tipo: "Lotes" },
    { name: "Lumen", url: "/#contacto", tagline: "Edificio residencial de departamentos y suites.", cover_url: "/assets/covers/lumen.jpg", ubicacion: "Ciudad Alta", tipo: "Departamentos" }
  ];

  var grid = document.getElementById("grid");
  var filtersEl = document.getElementById("filters");
  var projects = [];
  var activeFilter = "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isExternal(url) { return /^https?:\/\//i.test(url || ""); }
  function coverSrc(u) {
    if (!u) return "";
    return (isExternal(u) || u.charAt(0) === "/") ? u : "/" + u;
  }
  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join("");
  }

  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';

  function render() {
    var list = projects.filter(function (p) { return !activeFilter || p.ubicacion === activeFilter; });
    if (!list.length) {
      grid.innerHTML = '<div class="state">No hay proyectos publicados en esta ubicación por ahora.</div>';
      return;
    }
    grid.innerHTML = list.map(function (p) {
      var ext = isExternal(p.url);
      var media = p.cover_url
        ? '<img src="' + esc(coverSrc(p.cover_url)) + '" alt="" loading="lazy" width="800" height="600">'
        : '<div class="ph">' + esc(initials(p.name)) + "</div>";
      var chips = [p.ubicacion ? '<span class="chip">' + esc(p.ubicacion) + "</span>" : "",
                   p.tipo ? '<span class="chip chip-muted">' + esc(p.tipo) + "</span>" : ""].join("");
      return '<a class="card" href="' + esc(p.url) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" +
        '<div class="card-media">' + media + "</div>" +
        '<div class="card-body">' +
          "<h3>" + esc(p.name) + "</h3>" +
          (p.tagline ? '<p class="card-tagline">' + esc(p.tagline) + "</p>" : "") +
          (chips ? '<div class="card-meta">' + chips + "</div>" : "") +
          '<span class="card-cta">' + (ext ? "Visitar sitio" : "Ver proyecto") + ARROW + "</span>" +
        "</div></a>";
    }).join("");
  }

  function renderFilters() {
    var places = projects.map(function (p) { return p.ubicacion; }).filter(Boolean);
    places = places.filter(function (v, i) { return places.indexOf(v) === i; });
    if (places.length < 2) { filtersEl.innerHTML = ""; return; }
    var opts = [""].concat(places);
    filtersEl.innerHTML = opts.map(function (v) {
      return '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (v === activeFilter) + '">' + (v ? esc(v) : "Todos") + "</button>";
    }).join("");
    filtersEl.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        activeFilter = b.getAttribute("data-v");
        renderFilters();
        render();
      });
    });
  }

  function fillContactSelect() {
    var sel = document.getElementById("c-proyecto");
    projects.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.name; o.textContent = p.name;
      sel.appendChild(o);
    });
  }

  function done(list) {
    projects = list;
    renderFilters();
    render();
    fillContactSelect();
  }

  var configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY.indexOf("PEGA_AQUI") === -1 && window.supabase;
  if (!configured) {
    done(FALLBACK);
  } else {
    var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    sb.from("projects").select("*").eq("visible", true).order("sort_order", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        done(res.data && res.data.length ? res.data : FALLBACK);
      })
      .catch(function (err) {
        console.warn("No se pudieron cargar los proyectos; uso la lista base.", err);
        done(FALLBACK);
      });
  }

  /* Formulario → WhatsApp */
  var WA = CFG.WHATSAPP || "593900000000";
  document.getElementById("contact-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var nombre = document.getElementById("c-nombre").value.trim();
    var proyecto = document.getElementById("c-proyecto").value;
    var mensaje = document.getElementById("c-mensaje").value.trim();
    var err = document.getElementById("c-error");
    if (!nombre) { err.textContent = "Escribe tu nombre para continuar."; document.getElementById("c-nombre").focus(); return; }
    err.textContent = "";
    var text = "Hola GPUnlock, soy " + nombre + "." +
      (proyecto ? " Me interesa " + proyecto + "." : "") +
      (mensaje ? " " + mensaje : "");
    window.open("https://wa.me/" + WA + "?text=" + encodeURIComponent(text), "_blank", "noopener");
  });

  /* Header con borde al hacer scroll */
  var top = document.getElementById("top");
  function onScroll() { top.classList.toggle("is-scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  document.getElementById("year").textContent = new Date().getFullYear();
})();
