/* ==========================================================================
   VÉRTICE — Landing page interactions + datos de tipologías
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function () {
  /* ---------- CONFIG: reemplazar con datos reales antes de publicar ---------- */
  var WHATSAPP_NUMBER = "593900000000";

  /* ---------- Apertura robusta de WhatsApp ----------
     Abre WhatsApp en una pestaña nueva mediante un <a target="_blank"> real con
     clic simulado (más fiable ante bloqueadores de pop-ups que window.open()).
     Si por algún motivo el navegador no permite abrir la pestaña nueva, como
     último recurso se usa window.open() directo. */
  function openWhatsApp(url) {
    try {
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      try { window.open(url, "_blank", "noopener"); } catch (err2) { /* sin más opciones */ }
    }
  }

  /* =========================================================================
     DATOS DE TIPOLOGÍAS Y LOCALES — se cargan desde Supabase (tabla "units")
     para poder editarlos desde el panel de administración (/panel), sin
     tener que tocar código. ficha: imagen real de la ficha técnica del
     brochure (se abre en grande al click). thumb: miniatura usada en la
     tarjeta. Si Supabase no está disponible, las secciones quedan vacías
     en vez de romper el resto del sitio.
     ========================================================================= */
  var sb = (typeof supabase !== "undefined" && typeof SUPABASE_URL !== "undefined")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  var FALLBACK_PHOTO = "img/intro-building.jpg"; // se usa si una unidad nueva (creada desde el panel) aún no tiene foto propia

  function statusLabelFor(status) {
    return status === "vendido" ? "Vendido" : (status === "reservado" ? "Reservado" : "Disponible");
  }

  function unitCardHTML(u) {
    var statusLabel = statusLabelFor(u.status);
    var areaVal = (!u.area || u.area === "Consultar") ? "Consultar" : u.area + " m²";
    var tag = u.tag ? '<small>' + u.tag + '</small>' : "";
    var extra = u.extra ? '<li><svg class="icon"><use href="#i-tree"></use></svg> ' + u.extra + '</li>' : "";
    var thumb = u.thumb || FALLBACK_PHOTO;
    var ficha = u.ficha || thumb;
    return (
      '<div class="unit-card reveal is-visible" data-ficha="' + ficha + '" data-title="' + u.title + ' · ' + areaVal + '">' +
        '<div class="unit-card__img">' +
          '<img src="' + thumb + '" loading="lazy" alt="Ficha técnica ' + u.title + '" />' +
          '<span class="unit-card__zoom"><svg class="icon"><use href="#i-expand"></use></svg></span>' +
        '</div>' +
        '<div class="unit-card__body">' +
          '<div class="unit-card__top">' +
            '<h4>' + u.title + tag + '</h4>' +
            '<span class="area">' + areaVal + (u.area !== "Consultar" ? '<small>área útil</small>' : '') + '</span>' +
          '</div>' +
          '<span class="status status--' + u.status + '">' + statusLabel + '</span>' +
          '<ul class="unit-card__specs">' +
            '<li><svg class="icon"><use href="#i-bed"></use></svg> ' + (u.dorm || "Consultar dormitorios") + '</li>' +
            '<li><svg class="icon"><use href="#i-bath"></use></svg> ' + (u.banos || "Consultar baños") + '</li>' +
            '<li><svg class="icon"><use href="#i-sofa"></use></svg> Sala</li>' +
            '<li><svg class="icon"><use href="#i-kitchen"></use></svg> Cocina</li>' +
            '<li><svg class="icon"><use href="#i-laundry"></use></svg> Lavandería</li>' +
            extra +
          '</ul>' +
        '</div>' +
      '</div>'
    );
  }

  function localCardHTML(u) {
    var statusLabel = statusLabelFor(u.status);
    var areaVal = (!u.area || u.area === "Consultar") ? "Consultar" : u.area + " m²";
    var thumb = u.thumb || FALLBACK_PHOTO;
    var ficha = u.ficha || thumb;
    return (
      '<div class="local-card reveal is-visible" data-ficha="' + ficha + '" data-title="' + u.title + ' · ' + areaVal + '">' +
        '<img src="' + thumb + '" alt="' + u.title + '" />' +
        '<div class="local-card__body"><h4>' + u.title + '</h4><span class="area">' + areaVal + '</span><div><span class="status status--' + u.status + '">' + statusLabel + '</span></div></div>' +
      '</div>'
    );
  }

  if (sb) {
    sb.from("units").select("code, kind, grupo, title, tag, area, status, dorm, banos, extra, ficha, thumb").order("sort_order", { ascending: true }).then(function (res) {
      if (res.error) { console.error("No se pudo cargar tipologías/locales desde Supabase:", res.error); return; }
      var rows = res.data || [];
      var suites = rows.filter(function (u) { return u.kind === "suite"; });
      var locales = rows.filter(function (u) { return u.kind === "local"; });

      ["a", "b", "c"].forEach(function (key) {
        var container = document.getElementById("grid-" + key);
        if (!container) return;
        var items = suites.filter(function (u) { return u.grupo === key; });
        container.innerHTML = items.map(unitCardHTML).join("");
      });

      var localesContainer = document.getElementById("localesGrid");
      if (localesContainer) localesContainer.innerHTML = locales.map(localCardHTML).join("");

      /* Vuelve a correr el observer de "reveal" ahora que las tarjetas ya
         existen (los clics de la ficha ya funcionan solos: el listener de
         abajo está delegado en document, así que no hace falta re-atarlo) */
      observeReveal();
    }).catch(function (err) {
      console.error("No se pudo cargar tipologías/locales desde Supabase:", err);
    });
  }

  /* ---------- Header scroll state ---------- */
  var header = document.getElementById("header");
  function onScroll() {
    if (window.scrollY > 40) header.classList.add("is-scrolled");
    else header.classList.remove("is-scrolled");
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Mobile nav toggle ---------- */
  var navToggle = document.getElementById("navToggle");
  var nav = document.getElementById("nav");
  navToggle.addEventListener("click", function () {
    nav.classList.toggle("is-open");
    navToggle.classList.toggle("is-open");
  });
  nav.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("is-open");
      navToggle.classList.remove("is-open");
    });
  });

  /* ---------- Reveal on scroll ---------- */
  function observeReveal() {
    var revealEls = document.querySelectorAll(".reveal:not(.is-visible)");
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1 }
      );
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    }
  }
  observeReveal();

  /* ---------- Tabs (Tipologías) ---------- */
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
  var navMode = "gallery"; // "gallery" | "single"

  /* ---------- Bloqueo de scroll de fondo sin "saltos" ----------
     Usar solo document.body.style.overflow = "hidden" puede hacer que la página
     "salte"/se desplace al desaparecer la barra de scroll (cambia el ancho
     disponible y el layout se reacomoda). Para que la tarjeta/ficha aparezca
     centrada y estable, y el scroll de fondo quede realmente congelado en su
     lugar, fijamos el body en su posición de scroll actual; al cerrar, se
     restaura exactamente esa posición y el scroll sigue en la página normal. */
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

  function openGalleryAt(index) {
    navMode = "gallery";
    currentIndex = index;
    lightboxImg.src = galleryImgs[index].getAttribute("data-full") || galleryImgs[index].src;
    lightboxCaption.textContent = galleryImgs[index].getAttribute("alt") || "";
    lbPrev.classList.remove("is-hidden");
    lbNext.classList.remove("is-hidden");
    lightbox.classList.remove("is-ficha");
    lightbox.classList.add("is-open");
    lockScroll();
  }

  /* "Ficha" = unidades, locales y planos: se abren en una ventana fija
     (1500x800 máx.) en vez de a pantalla completa, con la X en la esquina
     superior izquierda de esa ventana. El fondo queda fijo (no se puede
     desplazar) mientras está abierta; al cerrarla, el scroll continúa
     normalmente en la página principal desde donde se quedó. */
  function openSingle(src, caption) {
    navMode = "single";
    lightboxImg.src = src;
    lightboxCaption.textContent = caption || "";
    lbPrev.classList.add("is-hidden");
    lbNext.classList.add("is-hidden");
    lightbox.classList.add("is-ficha");
    lightbox.classList.add("is-open");
    lockScroll();
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.classList.remove("is-ficha");
    unlockScroll();
  }

  function showRelative(delta) {
    if (navMode !== "gallery") return;
    currentIndex = (currentIndex + delta + galleryImgs.length) % galleryImgs.length;
    lightboxImg.src = galleryImgs[currentIndex].getAttribute("data-full") || galleryImgs[currentIndex].src;
    lightboxCaption.textContent = galleryImgs[currentIndex].getAttribute("alt") || "";
  }

  galleryImgs.forEach(function (img, index) {
    img.addEventListener("click", function () { openGalleryAt(index); });
  });

  // Delegated click for unit cards + local cards + plan cards (rendered dynamically)
  document.addEventListener("click", function (e) {
    var card = e.target.closest("[data-ficha]");
    if (card) {
      openSingle(card.getAttribute("data-ficha"), card.getAttribute("data-title") || "");
    }
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

  /* ---------- Contact form -> WhatsApp ---------- */
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

      var text = "Hola, soy " + name + ". Me interesa el proyecto Vértice";
      if (unit) text += " (interés: " + unit + ")";
      text += ". Teléfono: " + phone;
      if (email) text += ". Correo: " + email;
      if (message) text += ". Mensaje: " + message;

      var url = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text);
      openWhatsApp(url);

      formStatus.textContent = "¡Listo! Te llevamos a WhatsApp para enviar tu consulta.";
      formStatus.classList.add("is-visible");
    });
  }

  /* Nota: los enlaces fijos de WhatsApp (hero, teléfono de contacto, botón
     flotante) ya llevan su href="https://wa.me/..." y target="_top" escritos
     directamente en el HTML — son links normales, sin JS de por medio, para
     minimizar cualquier fricción con el sandbox de Wix. Solo el formulario de
     contacto necesita JS porque su mensaje se arma con los datos que escribe
     la persona. */

});
