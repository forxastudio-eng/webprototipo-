/* GPUnlock · Panel — arranque: sesión, rol, menú lateral y rutas (#/...). */
(function () {
  "use strict";
  var sb = FX.sb, icon = FX.icon, esc = FX.esc;
  var $ = function (id) { return document.getElementById(id); };

  var NAV = [
    { items: [{ r: "escritorio", t: "Escritorio", i: "home" }] },
    { g: "Sitio web", items: [
      { r: "portafolio", t: "Portafolio de proyectos", i: "globe" },
      { r: "slider", t: "Slider de Valle Sereno", i: "image" }
    ] },
    { g: "Inventario", items: [
      { r: "inventario/vertice", t: "Vértice", i: "building" },
      { r: "inventario/prisma", t: "Prisma", i: "building" },
      { r: "inventario/valle", t: "Valle Sereno", i: "map" },
      { r: "inventario/cot_unidades", t: "Unidades del cotizador", i: "grid" },
      { r: "inventario/cot_extra", t: "Parqueos, bodegas y lotes", i: "grid" }
    ] },
    { g: "Cotizador", items: [
      { href: "/cotizador/", t: "Abrir cotizador", i: "calc" },
      { href: "/cotizador/historial.html", t: "Historial y dashboard", i: "chart", perm: "historial" },
      { href: "/cotizador/admin.html", t: "Configurar cotizador", i: "edit", perm: "editar" }
    ] },
    { g: "Marketing", items: [
      { href: "/marketing/", t: "Dashboard de marketing", i: "megaphone" },
      { href: "/marketing/admin.html", t: "Editar dashboard", i: "edit", perm: "marketing" }
    ] },
    { g: "Datos", items: [
      { r: "exportar", t: "Descargar tablas", i: "download" },
      { r: "actividad", t: "Actividad", i: "activity" }
    ] },
    { g: "Cuenta", items: [
      { r: "usuarios", t: "Usuarios y roles", i: "users", perm: "usuarios" },
      { r: "cuenta", t: "Mi cuenta", i: "user" }
    ] }
  ];

  var ROUTES = {
    escritorio: { t: "Escritorio", fn: VIEWS.escritorio },
    portafolio: { t: "Portafolio de proyectos", g: "Sitio web", fn: VIEWS.portafolio },
    slider: { t: "Slider de Valle Sereno", g: "Sitio web", fn: VIEWS.slider },
    exportar: { t: "Descargar tablas", g: "Datos", fn: VIEWS.exportar },
    actividad: { t: "Actividad", g: "Datos", fn: VIEWS.actividad },
    usuarios: { t: "Usuarios y roles", g: "Cuenta", fn: VIEWS.usuarios, perm: "usuarios" },
    cuenta: { t: "Mi cuenta", g: "Cuenta", fn: VIEWS.cuenta }
  };

  /* ------------------------------------------------------------- menú */
  function buildNav() {
    $("side-nav").innerHTML = NAV.map(function (grp) {
      var items = grp.items.filter(function (it) {
        if (FX.state.soloCuenta) return it.r === "cuenta" || it.href === "/cotizador/";
        return !it.perm || FX.can(it.perm);
      });
      if (!items.length) return "";
      return '<div class="nav-group">' + (grp.g ? '<p class="nav-group-label">' + esc(grp.g) + "</p>" : "") +
        items.map(function (it) {
          var href = it.r ? "#/" + it.r : it.href;
          return '<a class="nav-link" href="' + href + '"' + (it.r ? ' data-route="' + it.r + '"' : "") + ">" + icon(it.i) + "<span>" + esc(it.t) + "</span>" +
            (it.href ? icon("ext", "ext") : "") + "</a>";
        }).join("") + "</div>";
    }).join("");
  }

  function setActive(route) {
    document.querySelectorAll(".nav-link").forEach(function (a) {
      if (a.dataset.route === route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  /* ------------------------------------------------------------ rutas */
  async function route() {
    var path = (location.hash || "#/escritorio").replace(/^#\//, "") || "escritorio";
    var parts = path.split("/");
    var view = $("view");
    var page = document.createElement("div");
    page.className = "page";
    view.innerHTML = "";
    view.appendChild(page);
    closeSide();

    if (FX.state.soloCuenta && parts[0] !== "cuenta") { location.replace("/cotizador/"); return; }
    var title, group, run;
    if (parts[0] === "inventario" && VIEWS.INV[parts[1]]) {
      title = VIEWS.INV[parts[1]].label; group = "Inventario";
      run = function () { return VIEWS.inventario(page, parts[1]); };
    } else {
      var r = ROUTES[parts[0]];
      if (!r || (r.perm && !FX.can(r.perm))) { location.hash = "#/escritorio"; return; }
      title = r.t; group = r.g;
      run = function () { return r.fn(page); };
    }
    $("page-title").textContent = title;
    $("crumbs").textContent = group ? "Panel / " + group : "Panel";
    document.title = title + " · Panel GPUnlock";
    setActive(path);
    try { await run(); }
    catch (e) { page.innerHTML = '<div class="panel empty">Ocurrió un error: ' + esc(FX.errMsg(e)) + "</div>"; console.error(e); }
    view.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------ menú móvil */
  function openSide() { $("side").classList.add("is-open"); $("scrim").hidden = false; }
  function closeSide() { $("side").classList.remove("is-open"); $("scrim").hidden = true; }

  /* ------------------------------------------------------------ sesión */
  function show(which) {
    $("boot").hidden = which !== "boot";
    $("auth").hidden = which !== "auth";
    $("app").hidden = which !== "app";
  }
  function loginMsg(text, isError) {
    $("login-error").hidden = !isError; $("login-info").hidden = !!isError;
    (isError ? $("login-error") : $("login-info")).textContent = text;
  }

  async function entrar(user) {
    FX.state.user = user;
    var r = await sb.rpc("mi_rol");
    FX.state.rol = r.error ? null : r.data;

    // Los asesores solo usan el cotizador; del panel solo pueden abrir "Mi cuenta"
    // para cambiar su contraseña.
    if (FX.state.rol === "asesor") {
      if (!/^#\/cuenta/.test(location.hash)) { location.replace("/cotizador/"); return; }
      FX.state.soloCuenta = true;
    } else if (!FX.can("panel")) {
      show("auth");
      loginMsg("Tu cuenta (" + user.email + ") no tiene un rol con acceso al panel. Pide al editor que te asigne uno.", true);
      await sb.auth.signOut();
      return;
    }
    $("role-badge").textContent = FX.ROLES[FX.state.rol].label;
    $("bar-email").textContent = user.email;
    buildNav();
    show("app");
    route();
  }

  async function boot() {
    $("bar-menu").innerHTML = icon("menu");
    $("side-close").innerHTML = icon("x");
    $("bar-menu").onclick = openSide;
    $("side-close").onclick = closeSide;
    $("scrim").onclick = closeSide;
    window.addEventListener("hashchange", function () { if (FX.state.user) route(); });

    var cfg = window.GPUNLOCK_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("PEGA_AQUI") !== -1) {
      show("auth");
      loginMsg("Falta configurar Supabase en /js/gpunlock-config.js (ver README).", true);
      return;
    }

    $("login-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = $("login-email").value.trim(), pass = $("login-password").value;
      if (!email || !pass) { loginMsg("Escribe tu correo y contraseña.", true); return; }
      $("login-btn").disabled = true;
      var res = await sb.auth.signInWithPassword({ email: email, password: pass });
      $("login-btn").disabled = false;
      if (res.error) { loginMsg("Correo o contraseña incorrectos.", true); return; }
      entrar(res.data.user);
    });

    $("logout-btn").onclick = async function () { await sb.auth.signOut(); location.hash = ""; location.reload(); };

    var s = await sb.auth.getSession();
    if (s.data && s.data.session) entrar(s.data.session.user);
    else show("auth");
  }

  boot();
})();
