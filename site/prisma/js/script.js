/* ==========================================================================
   PRISMA — Interacciones de la landing + datos de unidades (Supabase)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function () {
  var WHATSAPP_NUMBER = "593900000000"; /* mismo número que Vértice */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function openWhatsApp(url) {
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.style.display = "none";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err) {
      try { window.open(url, "_blank", "noopener"); } catch (err2) {}
    }
  }

  /* =========================================================================
     UNIDADES — se leen de la tabla "prisma_units" en Supabase (proyecto
     compartido con Vértice), para poder editarlas desde /panel sin tocar código.
     ========================================================================= */
  var sb = (typeof supabase !== "undefined" && typeof SUPABASE_URL !== "undefined")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  var FALLBACK_PHOTO = "img/exterior/frontal.jpg";

  function statusLabelFor(s) {
    return s === "vendido" ? "Vendido" : (s === "reservado" ? "Reservado" : "Disponible");
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function unitCardHTML(u) {
    var areaVal = (!u.area || u.area === "Consultar") ? "Consultar" : u.area + " m²";
    var tag = u.tag ? '<small>' + esc(u.tag) + '</small>' : "";
    var extra = u.extra ? '<li><svg class="icon"><use href="#i-tree"></use></svg> ' + esc(u.extra) + '</li>' : "";
    var thumb = esc(u.thumb || FALLBACK_PHOTO);
    var ficha = esc(u.ficha || u.thumb || FALLBACK_PHOTO);
    return (
      '<article class="unit-card" data-ficha="' + ficha + '" data-title="' + esc(u.title) + ' · ' + esc(areaVal) + '">' +
        '<div class="unit-card__img">' +
          '<img src="' + thumb + '" loading="lazy" alt="' + esc(u.title) + '" />' +
          '<span class="unit-card__zoom"><svg class="icon"><use href="#i-expand"></use></svg></span>' +
        '</div>' +
        '<div class="unit-card__body">' +
          '<div class="unit-card__top">' +
            '<h4>' + esc(u.title) + tag + '</h4>' +
            '<span class="area">' + esc(areaVal) + (u.area !== "Consultar" ? '<small>área útil</small>' : '') + '</span>' +
          '</div>' +
          '<span class="status status--' + esc(u.status) + '">' + statusLabelFor(u.status) + '</span>' +
          '<ul class="unit-card__specs">' +
            '<li><svg class="icon"><use href="#i-bed"></use></svg> ' + esc(u.dorm || "1") + ' dorm.</li>' +
            '<li><svg class="icon"><use href="#i-bath"></use></svg> ' + esc(u.banos || "1") + ' baño(s)</li>' +
            '<li><svg class="icon"><use href="#i-sofa"></use></svg> Sala</li>' +
            '<li><svg class="icon"><use href="#i-kitchen"></use></svg> Cocina</li>' +
            extra +
          '</ul>' +
        '</div>' +
      '</article>'
    );
  }

  function localCardHTML(u) {
    var areaVal = (!u.area || u.area === "Consultar") ? "Consultar" : u.area + " m²";
    var thumb = esc(u.thumb || FALLBACK_PHOTO);
    var ficha = esc(u.ficha || u.thumb || FALLBACK_PHOTO);
    return (
      '<article class="local-card" data-ficha="' + ficha + '" data-title="' + esc(u.title) + ' · ' + esc(areaVal) + '">' +
        '<img src="' + thumb + '" loading="lazy" alt="' + esc(u.title) + '" />' +
        '<div class="local-card__body">' +
          '<h4>' + esc(u.title) + '</h4>' +
          '<span class="area">' + esc(areaVal) + '</span>' +
          '<span class="status status--' + esc(u.status) + '">' + statusLabelFor(u.status) + '</span>' +
        '</div>' +
      '</article>'
    );
  }

  if (sb) {
    sb.from("prisma_units")
      .select("code, kind, grupo, title, tag, area, status, dorm, banos, extra, ficha, thumb")
      .order("sort_order", { ascending: true })
      .then(function (res) {
        if (res.error) { console.error("No se pudieron cargar las unidades:", res.error); return; }
        var rows = res.data || [];
        var suites = rows.filter(function (u) { return u.kind === "suite"; });
        var lofts = rows.filter(function (u) { return u.kind === "loft"; });
        var comerciales = rows.filter(function (u) { return u.kind === "local" || u.kind === "isla"; });

        var gs = document.getElementById("grid-suites");
        if (gs) gs.innerHTML = suites.map(unitCardHTML).join("");
        var gl = document.getElementById("grid-lofts");
        if (gl) gl.innerHTML = lofts.map(unitCardHTML).join("");
        var lc = document.getElementById("localesGrid");
        if (lc) lc.innerHTML = comerciales.map(localCardHTML).join("");

        var cs = document.getElementById("countSuites"); if (cs) cs.textContent = suites.length;
        var cl = document.getElementById("countLofts"); if (cl) cl.textContent = lofts.length;
        var cc = document.getElementById("countLocales"); if (cc) cc.textContent = comerciales.length;
      })
      .catch(function (err) { console.error("No se pudieron cargar las unidades:", err); });
  }

  /* ---------- Header ---------- */
  var header = document.getElementById("header");
  var progressBar = document.getElementById("progressBar");

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    header.classList.toggle("is-scrolled", y > 40);
    var docH = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = (docH > 0 ? (y / docH) * 100 : 0) + "%";
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Menú móvil ---------- */
  var navToggle = document.getElementById("navToggle");
  var nav = document.getElementById("nav");
  navToggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    navToggle.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("is-open");
      navToggle.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ---------- Reveal en scroll (reveal + stagger) ---------- */
  function observeReveal() {
    var els = document.querySelectorAll(".reveal:not(.is-visible), .stagger:not(.is-visible)");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }
  observeReveal();

  /* ---------- Contadores del hero ---------- */
  function runCounters() {
    var nums = document.querySelectorAll("[data-count]");
    nums.forEach(function (el) {
      var target = parseInt(el.getAttribute("data-count"), 10) || 0;
      if (reduceMotion) { el.textContent = target; return; }
      var dur = 1400, start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  setTimeout(runCounters, 1000);

  /* ---------- Parallax suave en imágenes marcadas ---------- */
  var parallaxEls = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
  if (parallaxEls.length && !reduceMotion) {
    var ticking = false;
    function updateParallax() {
      parallaxEls.forEach(function (el) {
        var wrap = el.parentElement;
        var rect = wrap.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        var progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
        el.style.transform = "translateY(" + (progress * -26).toFixed(2) + "px)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { requestAnimationFrame(updateParallax); ticking = true; }
    }, { passive: true });
    updateParallax();
  }

  /* ---------- Tabs ---------- */
  var tabButtons = document.querySelectorAll(".tab-btn");
  var tabPanels = document.querySelectorAll(".tab-panel");
  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-tab");
      tabButtons.forEach(function (b) { b.classList.remove("is-active"); });
      tabPanels.forEach(function (p) { p.classList.remove("is-active"); });
      btn.classList.add("is-active");
      document.getElementById(target).classList.add("is-active");
    });
  });

  /* =========================================================================
     LIGHTBOX — modo galería (con navegación) y modo ficha (imagen única)
     ========================================================================= */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxCaption = document.getElementById("lightboxCaption");
  var lbPrev = document.getElementById("lightboxPrev");
  var lbNext = document.getElementById("lightboxNext");
  var lbClose = document.getElementById("lightboxClose");

  var galleryImgs = Array.prototype.slice.call(document.querySelectorAll("[data-lightbox]"));
  var currentIndex = 0;
  var navMode = "gallery";
  var scrollLockY = 0;

  function lockScroll() {
    scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollLockY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  function unlockScroll() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollLockY);
  }

  function openGalleryAt(i) {
    navMode = "gallery"; currentIndex = i;
    lightboxImg.src = galleryImgs[i].getAttribute("data-full") || galleryImgs[i].src;
    lightboxCaption.textContent = galleryImgs[i].getAttribute("alt") || "";
    lbPrev.classList.remove("is-hidden"); lbNext.classList.remove("is-hidden");
    lightbox.classList.remove("is-ficha"); lightbox.classList.add("is-open");
    lockScroll();
  }
  function openSingle(src, caption) {
    navMode = "single";
    lightboxImg.src = src;
    lightboxCaption.textContent = caption || "";
    lbPrev.classList.add("is-hidden"); lbNext.classList.add("is-hidden");
    lightbox.classList.add("is-ficha"); lightbox.classList.add("is-open");
    lockScroll();
  }
  function closeLightbox() {
    lightbox.classList.remove("is-open"); lightbox.classList.remove("is-ficha");
    unlockScroll();
  }
  function showRelative(d) {
    if (navMode !== "gallery") return;
    currentIndex = (currentIndex + d + galleryImgs.length) % galleryImgs.length;
    lightboxImg.src = galleryImgs[currentIndex].getAttribute("data-full") || galleryImgs[currentIndex].src;
    lightboxCaption.textContent = galleryImgs[currentIndex].getAttribute("alt") || "";
  }

  galleryImgs.forEach(function (img, i) {
    img.addEventListener("click", function () { openGalleryAt(i); });
  });

  document.addEventListener("click", function (e) {
    var card = e.target.closest("[data-ficha]");
    if (card) openSingle(card.getAttribute("data-ficha"), card.getAttribute("data-title") || "");
  });

  if (lbClose) lbClose.addEventListener("click", closeLightbox);
  if (lbPrev) lbPrev.addEventListener("click", function () { showRelative(-1); });
  if (lbNext) lbNext.addEventListener("click", function () { showRelative(1); });
  lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("is-open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowRight") showRelative(1);
    if (e.key === "ArrowLeft") showRelative(-1);
  });

  /* ---------- Formulario -> WhatsApp ---------- */
  var form = document.getElementById("contactForm");
  var formStatus = document.getElementById("formStatus");

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.querySelector("#name").value.trim();
      var phone = form.querySelector("#phone").value.trim();
      var email = form.querySelector("#email").value.trim();
      var unit = form.querySelector("#unit").value;
      var message = form.querySelector("#message").value.trim();

      if (!name || !phone) {
        formStatus.textContent = "Por favor completa al menos tu nombre y teléfono.";
        formStatus.classList.add("is-visible");
        return;
      }

      var text = "Hola, soy " + name + ". Me interesa el proyecto Prisma";
      if (unit) text += " (interés: " + unit + ")";
      text += ". Teléfono: " + phone;
      if (email) text += ". Correo: " + email;
      if (message) text += ". Mensaje: " + message;

      openWhatsApp("https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text));
      formStatus.textContent = "¡Listo! Te llevamos a WhatsApp para enviar tu consulta.";
      formStatus.classList.add("is-visible");
    });
  }

  /* Los enlaces fijos de WhatsApp (hero, banda, contacto, flotante) son
     <a href="https://wa.me/...?text=..."> normales en el HTML. Solo el
     formulario necesita JS, porque arma el mensaje con lo que escribe la persona. */
});
