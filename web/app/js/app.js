/* ==========================================================================
   GPUnlock CRM — aplicación (PWA multiempresa).
   La seguridad real la hace la base de datos (RLS, supabase/*.sql): cada empresa
   solo ve lo suyo y cada rol solo hace lo que le toca; aquí solo se decide qué
   mostrar. La IA (supabase/functions/crm-ia) devuelve sugerencias; nada se guarda
   sin que la persona lo confirme, salvo el resumen/calificación de la tarjeta.
   Los pagos son por transferencia bancaria: la app nunca toca datos de tarjeta. El propietario
   sube su comprobante y solo el equipo de GPUnlock (consola) activa el plan (supabase/04_cobros.sql).
   ========================================================================== */
(function () {
  "use strict";

  var CFG = window.CRM_CONFIG || {};
  var CONFIGURADO = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CFG.SUPABASE_URL || "") && !!CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY !== "TU_ANON_KEY";
  var sb = CONFIGURADO ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  var FN = CFG.SUPABASE_URL + "/functions/v1/";

  /* ------------------------------------------------------------ catálogos */
  var ETAPAS = [
    { id: "nuevo", t: "Nuevo" }, { id: "contactado", t: "Contactado" }, { id: "cita", t: "Cita" },
    { id: "proforma", t: "Proforma" }, { id: "reserva", t: "Reserva" },
    { id: "vendido", t: "Vendido" }, { id: "perdido", t: "Perdido" }
  ];
  var FUENTES = {
    formulario_web: "Formulario web", whatsapp: "WhatsApp", llamada: "Llamada", facebook: "Facebook",
    instagram: "Instagram", tiktok: "TikTok", google: "Google", marketplace: "Marketplace",
    portal: "Portal inmobiliario", feria: "Feria", cartera: "Cartera del asesor", co_broker: "Asesor externo",
    referido: "Referido", oficina: "Oficina", otro: "Otro"
  };
  var PROYECTOS = {};   // slug → nombre; se llena con los proyectos de la empresa
  var ROLES = {
    propietario: ["Propietario", "Todo, incluida la facturación."],
    administrador: ["Administrador", "Gestiona leads, equipo y ajustes. No factura."],
    agente: ["Agente", "Trabaja sus leads y los que no tienen dueño."],
    lector: ["Lector", "Solo ve la información."]
  };
  var TIPOS = {
    nota: ["Nota", "✎"], llamada: ["Llamada", "☎"], whatsapp: ["WhatsApp", "💬"], correo: ["Correo", "✉"],
    visita: ["Visita", "⌂"], tarea: ["Tarea", "☑"], cambio_etapa: ["Etapa", "⇢"], sistema: ["Sistema", "•"], ia: ["IA", "✦"]
  };
  var OBJETIVOS = {
    primer_contacto: "Primer contacto", seguimiento: "Seguimiento", agendar_cita: "Agendar cita",
    enviar_proforma: "Acompañar proforma", reactivar: "Reactivar cliente", cierre: "Cierre / reserva"
  };
  var MOTIVOS_PERDIDA = ["Compró en otro lado", "Precio", "No responde", "Cambió de planes", "No califica / financiamiento", "Otro"];
  var CERRADAS = ["vendido", "perdido"];

  /* -------------------------------------------------------------- estado */
  var S = {
    user: null, email: "", rol: null,
    org: null, orgs: [], uso: null, planes: [], proyectos: [], invitaciones: [], cobro: {}, pagos: [], marca: null, mDraft: null,
    ajSec: "equipo", intervalo: "mensual",
    unidades: null, invF: { q: "", proyecto: "", estado: "disponible", tipo: "" }, invMax: 60, imp: null, invSub: "unidades",
    cot: null, cotCfg: null, cotizaciones: null, cotQ: "",
    ops: [], tareas: [], equipo: [],
    vista: "hoy",
    f: { q: "", proyecto: "", quien: "todos" },
    chat: [], iaOcupada: false,
    metDias: 30, metricas: null,
    det: null,             // lead abierto: { op, contacto, acts }
    modoAct: "nota",       // pestaña activa al registrar: nota | tarea
    prop: null,            // propuesta de la IA para una nota dictada
    cargando: false
  };

  /* ----------------------------------------------------------- utilidades */
  function $(id) { return document.getElementById(id); }
  function norm(t) { return String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var P = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    funnel: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    send: '<path d="m4 12 16-8-6 16-2-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    building: '<path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M15 9h3a1 1 0 0 1 1 1v11"/><path d="M3 21h18M9 7h2M9 11h2M9 15h2"/>'
  };
  function icon(n, cls) { return '<svg class="icon ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || "") + "</svg>"; }

  function toast(msg, error) {
    var t = $("toast");
    t.textContent = msg; t.className = "toast" + (error ? " error" : ""); t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, error ? 5200 : 2800);
  }

  function ms(iso) { return iso ? new Date(iso).getTime() : 0; }
  function hace(iso) {
    var m = Math.round((Date.now() - ms(iso)) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return "hace " + m + " min";
    var h = Math.round(m / 60);
    if (h < 24) return "hace " + h + " h";
    var d = Math.round(h / 24);
    if (d < 31) return "hace " + d + (d === 1 ? " día" : " días");
    return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
  }
  function diasSin(iso) { return Math.floor((Date.now() - ms(iso)) / 86400000); }
  function inicioDia(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function cuando(iso) {
    if (!iso) return { txt: "Sin fecha", vencida: false };
    var dif = Math.round((inicioDia(iso) - inicioDia(new Date())) / 86400000);
    var hora = new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
    if (dif < 0) return { txt: "Vencida " + (dif === -1 ? "ayer" : "hace " + -dif + " días"), vencida: true };
    if (dif === 0) return { txt: "Hoy " + hora, vencida: ms(iso) < Date.now() };
    if (dif === 1) return { txt: "Mañana", vencida: false };
    return { txt: new Date(iso).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short" }), vencida: false };
  }
  function dinero2(n) { return n == null || n === "" ? "" : new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
  function precioTxt(n) { return Number(n) % 1 === 0 ? dinero(n) : dinero2(n); }
  function fechaLarga(iso) { return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }); }
  function dinero(n) { return n == null || n === "" ? "" : new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }
  function etapaTxt(id) { var e = ETAPAS.filter(function (x) { return x.id === id; })[0]; return e ? e.t : id; }
  function proyTxt(id) { return id ? (PROYECTOS[id] || id) : "Sin proyecto"; }
  function nombreDe(email) {
    if (!email) return "Sin asignar";
    var e = S.equipo.filter(function (x) { return x.email === email; })[0];
    if (e && e.nombre) return e.nombre;
    return email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function abierta(o) { return CERRADAS.indexOf(o.etapa) === -1; }
  function activa() { return !!(S.uso && S.uso.activa); }
  function puedeEscribir() { return activa() && ["propietario", "administrador", "agente"].indexOf(S.rol) !== -1; }
  function esGestor() { return S.rol === "propietario" || S.rol === "administrador"; }
  function esPropietario() { return S.rol === "propietario"; }
  function esMia(o) { return o.asignado_a === S.email; }
  function puedeGestionar(o) { return activa() && (esGestor() || (S.rol === "agente" && esMia(o))); }
  function puedeRecibir(p) { return p.rol !== "lector"; }
  function opPorId(id) { return S.ops.filter(function (o) { return o.id === id; })[0]; }
  function telHref(c) { return c && c.telefono_norm ? "tel:+" + c.telefono_norm : ""; }
  function waHref(c, texto) { return c && c.telefono_norm ? "https://wa.me/" + c.telefono_norm + (texto ? "?text=" + encodeURIComponent(texto) : "") : ""; }

  function online() { return navigator.onLine !== false; }
  function mensajeError(e) {
    var m = (e && (e.message || e.error_description)) || "Algo salió mal";
    if (e && e.code === "23505") return "Eso ya existe (teléfono, correo o nombre repetido).";
    if (/row-level security|permission denied/i.test(m)) return activa() ? "Tu rol no permite esta acción." : "Tu suscripción no está activa: la cuenta está en solo lectura.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sin conexión. Inténtalo de nuevo.";
    return m;
  }

  /* Conserva lo que la persona está escribiendo cuando la pantalla se repinta
     (por ejemplo, al llegar un lead nuevo en tiempo real). */
  /* Casillas, ocultos, archivos (el navegador no deja asignarles valor) y colores (los guarda el borrador de marca). */
  var SIN_SNAP = { checkbox: 1, hidden: 1, file: 1, color: 1 };
  function claveCampo(el) { return (el.form && el.form.id || "") + "|" + (el.id || el.name || ""); }
  function snap(root) {
    var s = {};
    root.querySelectorAll("input,textarea").forEach(function (el) {
      if (SIN_SNAP[el.type] || claveCampo(el).slice(-1) === "|") return;
      s[claveCampo(el)] = el.value;
    });
    var d = root.querySelector("details"); s["@open"] = d ? d.open : false;
    var a = document.activeElement;
    if (a && root.contains(a) && a.id) { s["@focus"] = a.id; try { s["@sel"] = [a.selectionStart, a.selectionEnd]; } catch (e) { /* sin selección */ } }
    return s;
  }
  function restore(root, s) {
    root.querySelectorAll("input,textarea").forEach(function (el) {
      var k = claveCampo(el);
      if (!SIN_SNAP[el.type] && k in s && el.value !== s[k]) el.value = s[k];
    });
    var d = root.querySelector("details"); if (d && s["@open"]) d.open = true;
    if (s["@focus"]) {
      var f = document.getElementById(s["@focus"]);
      if (f) { f.focus(); if (s["@sel"] && f.setSelectionRange) { try { f.setSelectionRange(s["@sel"][0], s["@sel"][1]); } catch (e) { /* tipo sin selección */ } } }
    }
  }
  function autorDe(email) {
    if (!email || email === "sistema") return "Sistema";
    if (email === "web") return "Formulario web";
    return nombreDe(email);
  }

  /* ------------------------------------------------------------ servidor */
  async function upd(tabla, id, patch) {
    var r = await sb.from(tabla).update(patch).eq("id", id).select("id");
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw new Error("Tu rol no permite esta acción.");
  }

  async function llamarFn(nombre, payload, noDisponible) {
    var s = (await sb.auth.getSession()).data.session;
    if (!s) throw new Error("Tu sesión venció. Vuelve a entrar.");
    payload.org_id = S.org.id;
    var r = await fetch(FN + nombre, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token, apikey: CFG.SUPABASE_ANON_KEY },
      body: JSON.stringify(payload)
    });
    var j = {};
    try { j = await r.json(); } catch (e) { /* respuesta vacía */ }
    if (!r.ok || !j.ok) throw new Error(j.error || (r.status === 404 ? noDisponible : "No se pudo completar la solicitud."));
    return j;
  }
  function llamarIA(payload) { return llamarFn("crm-ia", payload, "La IA aún no está instalada en el servidor."); }

  var OP_SELECT = "*, contacto:crm_contactos(id,nombre,telefono,telefono_norm,correo)";
  async function cargar(silencioso) {
    if (S.cargando) return;
    S.cargando = true;
    if (!silencioso) $("btn-refresh").classList.add("girando");
    try {
      var r = await Promise.all([
        sb.from("crm_oportunidades").select(OP_SELECT).eq("org_id", S.org.id).order("updated_at", { ascending: false }).limit(1000),
        sb.from("crm_actividades").select("id,oportunidad_id,contenido,vence_at").eq("org_id", S.org.id).eq("tipo", "tarea").is("hecha_at", null)
          .order("vence_at", { ascending: true, nullsFirst: false }).limit(300)
      ]);
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      S.ops = r[0].data || [];
      S.tareas = r[1].data || [];
      if (S.det) { var fresh = opPorId(S.det.op.id); if (fresh) S.det.op = fresh; }
      render();
      if (S.det) pintarHoja();
    } catch (e) {
      if (!silencioso) toast(mensajeError(e), true);
    } finally {
      S.cargando = false;
      $("btn-refresh").classList.remove("girando");
    }
  }

  var recargar = (function () {
    var t;
    return function () { clearTimeout(t); t = setTimeout(function () { cargar(true); if (S.det) cargarDetalle(S.det.op.id, true); }, 600); };
  })();

  /* --------------------------------------------------------- acceso / boot */
  function mostrar(que) {
    $("boot").hidden = true;
    $("auth").hidden = que !== "login";
    $("onboard").hidden = que !== "onboard";
    $("app").hidden = que !== "app";
  }
  function msg(id, txt) { var n = $(id); if (n) { n.textContent = txt || ""; n.hidden = !txt; } }
  function loginMsg(id, txt) { msg(id === "login-error" ? "auth-error" : "auth-info", txt); }

  var authNombre = "";   // nombre de la empresa cuando se entra por su enlace /app/?e=…
  function elegirAuth(modo) {
    var reg = modo === "signup";
    $("login-form").hidden = reg; $("signup-form").hidden = !reg;
    $("tab-login").setAttribute("aria-selected", String(!reg)); $("tab-signup").setAttribute("aria-selected", String(reg));
    $("auth-titulo").textContent = reg ? "Crea tu cuenta" : (authNombre ? "Entra a " + authNombre : "Entra a tu CRM");
    msg("auth-error", ""); msg("auth-info", "");
  }

  async function cargarEmpresa() {
    var o = S.org.id;
    var r = await Promise.all([
      sb.rpc("crm_equipo", { p_org: o }),
      sb.from("crm_proyectos").select("slug,nombre,activo").eq("org_id", o).order("nombre"),
      sb.rpc("uso_org", { p_org: o }),
      esGestor() ? sb.from("invitaciones").select("id,email,rol,created_at").eq("org_id", o).order("created_at") : Promise.resolve({ data: [] }),
      sb.from("planes").select("*").order("orden"),
      sb.from("organizaciones").select("id,nombre,clave_publica,reparto,plan_id,estado").eq("id", o).maybeSingle(),
      pagosEnApp() ? sb.from("datos_cobro").select("*").maybeSingle() : Promise.resolve({ data: {} }),
      pagosEnApp() && esPropietario() ? sb.from("pagos_suscripcion").select("id,plan_id,periodo,total,fecha_transferencia,factura_numero,cubre_hasta")
        .eq("org_id", o).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
      sb.from("org_marca").select("*").eq("org_id", o).maybeSingle()
    ]);
    if (r[2].error) throw r[2].error;
    S.equipo = r[0].data || [];
    S.proyectos = r[1].data || [];
    PROYECTOS = {}; S.proyectos.forEach(function (p) { PROYECTOS[p.slug] = p.nombre; });
    S.uso = r[2].data;
    S.invitaciones = r[3].data || [];
    S.planes = r[4].data || [];
    if (r[5].data) S.org = Object.assign(S.org, r[5].data);
    S.cobro = r[6].data || {};
    S.pagos = r[7].data || [];
    aplicarMarcaEmpresa(r[8].data || null);
  }

  async function entrar(user) {
    S.user = user; S.email = (user.email || "").toLowerCase();
    var nombre = user.user_metadata && user.user_metadata.nombre;
    await sb.rpc("aceptar_invitaciones", { p_nombre_usuario: nombre || null });   // si lo invitaron, entra a ese equipo
    var r = await sb.from("miembros").select("rol,nombre,org:organizaciones(id,nombre,clave_publica,reparto,plan_id,estado)")
      .eq("user_id", user.id).order("created_at");
    if (r.error) throw r.error;
    S.orgs = (r.data || []).filter(function (m) { return m.org; });
    if (!S.orgs.length) { mostrar("onboard"); $("onboard-nombre").focus(); return; }
    var pref = null; try { pref = localStorage.getItem("crm_org"); } catch (e) { /* sin almacenamiento */ }
    var m = S.orgs.filter(function (x) { return x.org.id === pref; })[0] || S.orgs[0];
    S.org = m.org; S.rol = m.rol;
    try { localStorage.setItem("crm_org", S.org.id); } catch (e) { /* sin almacenamiento */ }
    if (S.rol === "agente") S.f.quien = "mios";
    await cargarEmpresa();
    mostrar("app");
    pintarIconos();
    await cargar(true);
    suscribir();
    var q = new URLSearchParams(location.search);
    if (q.get("nuevo") === "1" && puedeEscribir()) abrirNuevo();
  }

  function pintarIconos() {
    $("btn-refresh").innerHTML = icon("refresh");
    $("btn-menu").innerHTML = icon("user");
    $("fab").innerHTML = icon("plus");
  }

  var canal = null;
  function suscribir() {
    if (canal) return;
    var filtro = "org_id=eq." + S.org.id;
    canal = sb.channel("crm-" + S.org.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_oportunidades", filter: filtro }, function (p) {
        if (p.eventType === "INSERT") toast("Entró un nuevo lead");
        recargar();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_actividades", filter: filtro }, recargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_unidades", filter: filtro }, recargarInv)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cotizaciones", filter: filtro }, function () { if (S.cotizaciones !== null) cargarCotizaciones(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "org_marca", filter: filtro }, function (p) {
        aplicarMarcaEmpresa(p.eventType === "DELETE" ? null : (p.new && p.new.org_id ? p.new : null));
        toast("La marca de tu empresa se actualizó");
        if (S.vista === "ajustes" && S.ajSec === "marca") { S.mDraft = null; render(); }
      })
      .subscribe();
  }

  /* ---------------------------------------------------------- navegación */
  var TABS = [
    { id: "hoy", t: "Hoy", i: "home" }, { id: "embudo", t: "Embudo", i: "funnel" }, { id: "inventario", t: "Inventario", i: "building" },
    { id: "ia", t: "Asistente", i: "sparkle" }, { id: "metricas", t: "Métricas", i: "chart" },
    { id: "ajustes", t: "Ajustes", i: "gear" }
  ];
  var TITULOS = { hoy: "Hoy", embudo: "Embudo", inventario: "Inventario", ia: "Asistente IA", metricas: "Métricas", ajustes: "Ajustes" };

  function conteos() {
    var abiertas = S.ops.filter(abierta);
    var sin = abiertas.filter(function (o) { return !o.asignado_a; }).length;
    var venc = S.tareas.filter(function (t) { return t.vence_at && ms(t.vence_at) < Date.now(); }).length;
    return { abiertas: abiertas.length, sin: sin, venc: venc };
  }

  function render() {
    var c = conteos();
    $("top-title").textContent = TITULOS[S.vista];
    $("tabbar").innerHTML = TABS.map(function (t) {
      var b = t.id === "hoy" && c.sin + c.venc ? '<span class="badge">' + (c.sin + c.venc) + "</span>" : "";
      return '<button class="tab" data-action="vista" data-v="' + t.id + '"' + (S.vista === t.id ? ' aria-current="page"' : "") + ">" +
        icon(t.i) + "<span>" + t.t + "</span>" + b + "</button>";
    }).join("");
    $("fab").hidden = !(puedeEscribir() && (S.vista === "hoy" || S.vista === "embudo"));
    var v = $("view"), ss = snap(v), sc = v.querySelector(".board"), x = sc ? sc.scrollLeft : 0;
    var banner = S.vista === "ajustes" && S.ajSec === "plan" ? "" : bannerSuscripcion();
    if (S.vista === "hoy") v.innerHTML = banner + vistaHoy(c);
    else if (S.vista === "embudo") v.innerHTML = banner + vistaEmbudo();
    else if (S.vista === "inventario") v.innerHTML = banner + vistaInventario();
    else if (S.vista === "ia") v.innerHTML = banner + vistaIA();
    else if (S.vista === "ajustes") v.innerHTML = banner + vistaAjustes();
    else v.innerHTML = banner + vistaMetricas();
    restore(v, ss);
    var n = v.querySelector(".board"); if (n) n.scrollLeft = x;
    if (S.vista === "metricas" && !S.metricas) cargarMetricas();
    if (S.vista === "inventario" && S.unidades === null) cargarInventario();
    if (S.vista === "ajustes" && S.ajSec === "marca" && esGestor()) pintarPreviewMarca();
  }

  function cambiarVista(v) {
    S.vista = v;
    render();
    window.scrollTo(0, 0);
    if (v === "ia") { var ta = $("ia-input"); if (ta && window.innerWidth > 900) ta.focus(); }
  }

  /* ------------------------------------------------------------ tarjetas */
  function badgeEtapa(o) {
    var cls = o.etapa === "vendido" ? "green" : o.etapa === "perdido" ? "red" : "";
    return '<span class="chip ' + cls + '">' + esc(etapaTxt(o.etapa)) + "</span>";
  }
  function cardLead(o, opts) {
    opts = opts || {};
    var c = o.contacto || {};
    var tel = telHref(c), wa = waHref(c);
    var acciones = "";
    if (!o.asignado_a && abierta(o) && puedeEscribir())
      acciones += '<button class="btn btn-primary btn-sm" data-action="tomar" data-id="' + esc(o.id) + '">Tomar lead</button>';
    if (wa) acciones += '<a class="btn btn-sm btn-wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + icon("chat", "icon-sm") + " WhatsApp</a>";
    if (tel) acciones += '<a class="btn btn-sm" href="' + esc(tel) + '">' + icon("phone", "icon-sm") + " Llamar</a>";
    if (opts.avanzar && abierta(o) && puedeGestionar(o)) {
      var i = ETAPAS.map(function (e) { return e.id; }).indexOf(o.etapa);
      if (i >= 0 && i < 4) acciones += '<button class="btn btn-sm" data-action="avanzar" data-id="' + esc(o.id) + '">→ ' + esc(ETAPAS[i + 1].t) + "</button>";
    }
    return '<div class="card lead" role="button" tabindex="0" data-action="abrir" data-id="' + esc(o.id) + '">' +
      '<div class="lead-top"><span class="dot ' + esc(o.calificacion || "") + '" title="' + esc(o.calificacion || "sin calificar") + '"></span>' +
      '<span class="lead-name">' + esc(c.nombre || "Sin nombre") + "</span>" + (opts.sinEtapa ? "" : badgeEtapa(o)) + "</div>" +
      '<div class="lead-sub"><span>' + esc(proyTxt(o.proyecto)) + (o.unidad_interes ? " · " + esc(o.unidad_interes) : "") + "</span>" +
      "<span>" + esc(FUENTES[o.fuente] || o.fuente) + "</span><span>" + esc(hace(o.updated_at)) + "</span>" +
      (opts.asesor ? "<span>" + esc(nombreDe(o.asignado_a)) + "</span>" : "") + "</div>" +
      (acciones ? '<div class="lead-actions">' + acciones + "</div>" : "") + "</div>";
  }

  /* ---------------------------------------------------------------- Hoy */
  function vistaHoy(c) {
    var abiertas = S.ops.filter(abierta);
    var sin = abiertas.filter(function (o) { return !o.asignado_a; });
    var nuevos24 = S.ops.filter(function (o) { return Date.now() - ms(o.created_at) < 86400000; }).length;
    var tareas = S.tareas.slice(0, 40);
    var estancados = abiertas.filter(function (o) { return o.asignado_a && (esGestor() || esMia(o)) && diasSin(o.updated_at) >= 3; })
      .sort(function (a, b) { return ms(a.updated_at) - ms(b.updated_at); }).slice(0, 8);

    var h = '<div class="stats">' +
      '<div class="stat"><b>' + c.abiertas + "</b><span>Leads abiertos</span></div>" +
      '<div class="stat' + (c.sin ? " alert" : "") + '"><b>' + c.sin + "</b><span>Sin asignar</span></div>" +
      '<div class="stat' + (c.venc ? " alert" : "") + '"><b>' + c.venc + "</b><span>Tareas vencidas</span></div>" +
      '<div class="stat good"><b>' + nuevos24 + "</b><span>Nuevos en 24 h</span></div></div>";

    if (sin.length) {
      h += '<div class="sec"><h2>Sin asignar (' + sin.length + ")</h2></div><div class=\"list\">" +
        sin.slice(0, 15).map(function (o) { return cardLead(o); }).join("") + "</div>";
    }
    h += '<div class="sec"><h2>' + (esGestor() ? "Tareas pendientes" : "Mis tareas") + "</h2></div>";
    if (!tareas.length) h += '<div class="empty">No tienes tareas pendientes. Abre un lead para crear una.</div>';
    else h += '<div class="list">' + tareas.map(function (t) {
      var op = opPorId(t.oportunidad_id), cu = cuando(t.vence_at);
      return '<div class="card task' + (cu.vencida ? " vencida" : "") + '">' +
        '<input type="checkbox" aria-label="Marcar como hecha" data-action="tarea-hecha" data-id="' + esc(t.id) + '">' +
        '<div class="task-body" data-action="abrir" data-id="' + esc(t.oportunidad_id) + '"><b>' + esc(t.contenido) + "</b>" +
        '<small class="cuando">' + esc(cu.txt) + "</small> <small>· " + esc(op && op.contacto ? op.contacto.nombre : "") + "</small></div></div>";
    }).join("") + "</div>";

    if (estancados.length) {
      h += '<div class="sec"><h2>Sin movimiento (3+ días)</h2></div><div class="list">' +
        estancados.map(function (o) { return cardLead(o, { asesor: esGestor() }); }).join("") + "</div>";
    }
    if (!S.ops.length) h += '<div class="empty" style="margin-top:14px">Aún no hay leads. Los del formulario web aparecerán aquí solos' + (puedeEscribir() ? ", o crea uno con el botón +" : "") + ".</div>";
    return h;
  }

  /* -------------------------------------------------------------- Embudo */
  function filtrar() {
    var q = S.f.q.trim().toLowerCase();
    return S.ops.filter(function (o) {
      var c = o.contacto || {};
      if (S.f.proyecto && (o.proyecto || "") !== S.f.proyecto) return false;
      if (S.f.quien === "mios" && !esMia(o)) return false;
      if (S.f.quien === "sin" && o.asignado_a) return false;
      if (q) {
        var blob = [c.nombre, c.telefono, c.correo, o.unidad_interes, proyTxt(o.proyecto)].join(" ").toLowerCase();
        if (blob.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function vistaEmbudo() {
    var proys = {};
    Object.keys(PROYECTOS).forEach(function (k) { proys[k] = PROYECTOS[k]; });
    S.ops.forEach(function (o) { if (o.proyecto && !proys[o.proyecto]) proys[o.proyecto] = o.proyecto; });
    var lista = filtrar();
    var h = '<div class="filters"><input class="inp" type="search" id="f-q" placeholder="Buscar nombre, teléfono, proyecto…" value="' + esc(S.f.q) + '" aria-label="Buscar">' +
      '<select class="inp" id="f-proyecto" aria-label="Proyecto"><option value="">Todos los proyectos</option>' +
      Object.keys(proys).map(function (k) { return '<option value="' + esc(k) + '"' + (S.f.proyecto === k ? " selected" : "") + ">" + esc(proys[k]) + "</option>"; }).join("") + "</select>" +
      '<select class="inp" id="f-quien" aria-label="Responsable">' +
      [["todos", "Todos"], ["mios", "Solo míos"], ["sin", "Sin asignar"]].map(function (p) { return '<option value="' + p[0] + '"' + (S.f.quien === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select></div>";
    if (S.f.q.trim()) {
      h += '<div class="sec"><h2>Resultados (' + lista.length + ")</h2></div>" +
        (lista.length ? '<div class="list">' + lista.slice(0, 50).map(function (o) { return cardLead(o, { asesor: esGestor() }); }).join("") + "</div>" : '<div class="empty">Nada coincide con tu búsqueda.</div>');
      return h;
    }
    h += '<div class="jump">' + ETAPAS.map(function (e) {
      return '<button data-action="ir-col" data-e="' + e.id + '">' + esc(e.t) + "<b>" + lista.filter(function (o) { return o.etapa === e.id; }).length + "</b></button>";
    }).join("") + "</div>";
    h += '<div class="board">' + ETAPAS.map(function (e) {
      var items = lista.filter(function (o) { return o.etapa === e.id; });
      var total = items.length;
      if (CERRADAS.indexOf(e.id) !== -1) items = items.slice(0, 25);
      return '<section class="col" id="col-' + e.id + '" aria-label="' + esc(e.t) + '"><div class="col-head"><span>' + esc(e.t) + '</span><span class="n">' + total + "</span></div>" +
        (items.length ? items.map(function (o) { return cardLead(o, { sinEtapa: true, avanzar: true, asesor: esGestor() }); }).join("") : '<div class="col-empty">Sin leads</div>') +
        (total > items.length ? '<div class="col-empty">+' + (total - items.length) + " más (usa la búsqueda)</div>" : "") + "</section>";
    }).join("") + "</div>";
    return h;
  }

  /* ----------------------------------------------------------- Asistente */
  var SUGERENCIAS = [
    "¿A quién debo llamar hoy?", "¿Qué leads calientes llevan días sin seguimiento?",
    "Resume cómo va mi embudo esta semana", "¿Qué leads están más cerca de cerrar?"
  ];
  function vistaIA() {
    var h = '<div class="chat">';
    if (!S.chat.length) {
      h += '<div class="card"><h3>' + icon("sparkle", "icon-sm") + " Pregúntale a tu embudo</h3>" +
        '<p class="muted" style="margin:0 0 10px">Responde solo con los leads que tú puedes ver. Prueba con:</p>' +
        '<div class="suggest">' + SUGERENCIAS.map(function (s) { return '<button data-action="sugerencia" data-q="' + esc(s) + '">' + esc(s) + "</button>"; }).join("") + "</div></div>";
    }
    S.chat.forEach(function (m) {
      h += '<div class="msg ' + m.de + '">' + esc(m.txt);
      if (m.ops && m.ops.length) {
        h += '<div class="links">' + m.ops.map(function (id) { var o = opPorId(id); return o ? cardLead(o, { asesor: esGestor() }) : ""; }).join("") + "</div>";
      }
      h += "</div>";
    });
    if (S.iaOcupada) h += '<div class="msg ia"><span class="typing"><i></i><i></i><i></i></span></div>';
    h += "</div>" +
      '<form class="composer" id="ia-form"><textarea class="inp" id="ia-input" rows="1" placeholder="Escribe tu pregunta…" aria-label="Pregunta"></textarea>' +
      '<button type="button" class="icon-btn mic" id="ia-mic" data-action="dictar" data-target="ia-input" aria-label="Dictar">' + icon("mic") + "</button>" +
      '<button class="btn btn-primary" type="submit"' + (S.iaOcupada ? " disabled" : "") + ' aria-label="Enviar">' + icon("send") + "</button></form>";
    return h;
  }
  async function preguntar(q) {
    q = (q || "").trim();
    if (!q || S.iaOcupada) return;
    S.chat.push({ de: "yo", txt: q });
    S.iaOcupada = true; render();
    try {
      var r = await llamarIA({ accion: "consulta", pregunta: q });
      S.chat.push({ de: "ia", txt: r.respuesta, ops: r.oportunidades });
    } catch (e) {
      S.chat.push({ de: "ia", txt: "⚠ " + mensajeError(e) });
    }
    S.iaOcupada = false; render();
    window.scrollTo(0, document.body.scrollHeight);
  }

  /* ------------------------------------------------------------- Métricas */
  async function cargarMetricas() {
    try {
      var r = await sb.rpc("crm_metricas", { p_org: S.org.id, p_dias: S.metDias });
      if (r.error) throw r.error;
      S.metricas = r.data;
      if (S.vista === "metricas") render();
    } catch (e) { toast(mensajeError(e), true); }
  }
  function vistaMetricas() {
    var m = S.metricas;
    var h = '<div class="row" style="margin-bottom:10px"><div class="seg" style="flex:1">' +
      [7, 30, 90].map(function (d) { return '<button data-action="periodo" data-d="' + d + '" class="' + (S.metDias === d ? "on" : "") + '">' + d + " días</button>"; }).join("") + "</div></div>";
    if (!m) return h + '<div class="empty"><span class="spin dark"></span></div>';
    var conv = m.nuevos ? Math.round((m.vendidos / m.nuevos) * 100) : 0;
    h += '<div class="stats">' +
      '<div class="stat"><b>' + m.nuevos + "</b><span>Leads nuevos</span></div>" +
      '<div class="stat good"><b>' + m.vendidos + "</b><span>Vendidos</span></div>" +
      '<div class="stat"><b>' + conv + "%</b><span>Conversión lead → venta</span></div>" +
      '<div class="stat"><b>' + m.perdidos + "</b><span>Perdidos</span></div>" +
      '<div class="stat"><b>' + m.abiertas + "</b><span>Abiertos ahora</span></div>" +
      '<div class="stat' + (m.sin_asignar ? " alert" : "") + '"><b>' + m.sin_asignar + "</b><span>Sin asignar</span></div>" +
      '<div class="stat' + (m.tareas_vencidas ? " alert" : "") + '"><b>' + m.tareas_vencidas + "</b><span>Tareas vencidas</span></div></div>";
    var max = Math.max.apply(null, ETAPAS.map(function (e) { return m.por_etapa[e.id] || 0; }).concat([1]));
    h += '<div class="sec"><h2>Embudo actual</h2></div><div class="card bars">' + ETAPAS.map(function (e) {
      var n = m.por_etapa[e.id] || 0;
      return '<div class="bar"><span>' + esc(e.t) + '</span><div class="track"><div class="fill" style="width:' + Math.round((n / max) * 100) + '%"></div></div><b>' + n + "</b></div>";
    }).join("") + "</div>";
    if (m.por_fuente.length) {
      h += '<div class="sec"><h2>Por fuente (' + m.dias + ' días)</h2></div><div class="card"><table class="tbl"><thead><tr><th>Fuente</th><th>Leads</th><th>Ventas</th></tr></thead><tbody>' +
        m.por_fuente.map(function (f) { return "<tr><td>" + esc(FUENTES[f.fuente] || f.fuente) + "</td><td>" + f.leads + "</td><td>" + f.vendidos + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    if (m.por_campana && m.por_campana.length) {
      h += '<div class="sec"><h2>Por campaña (' + m.dias + ' días)</h2></div><div class="card"><table class="tbl"><thead><tr><th>Campaña</th><th>Leads</th><th>Ventas</th></tr></thead><tbody>' +
        m.por_campana.map(function (c) { return "<tr><td>" + esc(c.campana) + '<br><small class="muted">' + esc(FUENTES[c.fuente] || c.fuente || "") + "</small></td><td>" + c.leads + "</td><td>" + c.vendidos + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    if (m.por_asesor.length && S.rol !== "agente") {
      h += '<div class="sec"><h2>Por asesor</h2></div><div class="card"><table class="tbl"><thead><tr><th>Asesor</th><th>Abiertos</th><th>Ventas</th></tr></thead><tbody>' +
        m.por_asesor.map(function (a) { return "<tr><td>" + esc(nombreDe(a.email)) + "</td><td>" + a.abiertas + "</td><td>" + a.vendidos + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    return h;
  }

  /* ------------------------------------------------------- Detalle del lead */
  async function abrirHoja(id) {
    var op = opPorId(id);
    if (!op) return;
    S.det = { op: op, contacto: op.contacto || {}, acts: [] };
    S.prop = null; S.modoAct = "nota";
    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    try { history.pushState({ hoja: id }, ""); } catch (e) { /* sin historial */ }
    pintarHoja();
    cargarDetalle(id);
  }
  async function cargarDetalle(id, silencioso) {
    var r = await Promise.all([
      sb.from("crm_contactos").select("*").eq("id", S.det ? S.det.op.contacto_id : "").maybeSingle(),
      sb.from("crm_actividades").select("*").eq("oportunidad_id", id).order("created_at", { ascending: false }).limit(100),
      sb.from("crm_cotizaciones").select("id,numero,proyecto,oportunidad_id,cliente_nombre,cliente_telefono,unidades,precio_final,cuota_mensual,forma_pago,estado,vigencia_hasta,created_at,token,asesor_nombre,asesor_email")
        .eq("oportunidad_id", id).order("created_at", { ascending: false }).limit(30)
    ]);
    if (!S.det || S.det.op.id !== id) return;
    if (r[0].data) S.det.contacto = r[0].data;
    S.det.acts = r[1].data || [];
    S.det.cots = r[2].data || [];
    if (r[1].error && !silencioso) toast(mensajeError(r[1].error), true);
    pintarHoja();
  }
  function cerrarHoja(desdeHistorial) {
    if (!S.det) return;
    S.det = null; S.prop = null;
    $("sheet").hidden = true;
    document.body.style.overflow = "";
    if (!desdeHistorial && history.state && history.state.hoja) history.back();
    render();
  }

  function pintarHoja() {
    var d = S.det; if (!d) return;
    var o = d.op, c = d.contacto, gest = puedeGestionar(o);
    var tel = telHref(c), wa = waHref(c);
    var panel = $("sheet-panel"), scroll = panel.scrollTop, ss = snap(panel);
    var h = '<div class="sh-head"><div class="sh-bar"><button class="icon-btn" data-action="cerrar-hoja" aria-label="Volver">' + icon("left") + "</button>" +
      "<h2>" + esc(c.nombre || "Lead") + "</h2></div>" +
      '<div class="sh-sub">' + (c.telefono ? "<span>" + esc(c.telefono) + "</span>" : "") + (c.correo ? "<span>" + esc(c.correo) + "</span>" : "") +
      "<span>" + esc(proyTxt(o.proyecto)) + (o.unidad_interes ? " · " + esc(o.unidad_interes) : "") + "</span></div></div>";
    h += '<div class="sh-body">';

    // Contacto rápido
    h += '<div class="quick">' +
      (tel ? '<a class="btn" href="' + esc(tel) + '">' + icon("phone") + "Llamar</a>" : '<span class="btn" aria-disabled="true" style="opacity:.5">' + icon("phone") + "Sin teléfono</span>") +
      (wa ? '<a class="btn btn-wa" href="' + esc(wa) + '" target="_blank" rel="noopener" data-action="wa-directo">' + icon("chat") + "WhatsApp</a>" : '<span class="btn" aria-disabled="true" style="opacity:.5">' + icon("chat") + "Sin WhatsApp</span>") +
      (c.correo ? '<a class="btn" href="mailto:' + esc(c.correo) + '">' + icon("mail") + "Correo</a>" : '<span class="btn" aria-disabled="true" style="opacity:.5">' + icon("mail") + "Sin correo</span>") + "</div>";

    // Responsable
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><small class="muted">Responsable</small><br><b>' + esc(nombreDe(o.asignado_a)) + "</b></div>";
    if (esGestor()) {
      h += '<select class="inp" id="asignar" style="max-width:220px" aria-label="Asignar a"><option value="">Sin asignar</option>' +
        S.equipo.filter(puedeRecibir).map(function (p) { return '<option value="' + esc(p.email) + '"' + (o.asignado_a === p.email ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select>";
    } else if (!o.asignado_a && puedeEscribir() && abierta(o)) {
      h += '<button class="btn btn-primary btn-sm" data-action="tomar" data-id="' + esc(o.id) + '">Tomar lead</button>';
    }
    h += "</div></div>";

    // Etapa
    h += '<div><div class="stages" role="group" aria-label="Etapa">' + ETAPAS.map(function (e) {
      return '<button class="stg ' + e.id + (o.etapa === e.id ? " on" : "") + '" data-action="etapa" data-e="' + e.id + '"' + (gest ? "" : " disabled") + ">" + esc(e.t) + "</button>";
    }).join("") + "</div>" +
      (o.etapa === "perdido" && o.motivo_perdida ? '<small class="muted">Motivo: ' + esc(o.motivo_perdida) + "</small>" : "") + "</div>";

    // IA
    h += '<div class="card ia-card"><h3>' + icon("sparkle", "icon-sm") + " Asistente IA" +
      (o.calificacion ? ' <span class="chip ' + (o.calificacion === "caliente" ? "red" : o.calificacion === "tibio" ? "amber" : "") + '">' + esc(o.calificacion) + "</span>" : "") + "</h3>";
    if (o.ia_resumen) {
      h += "<p>" + esc(o.ia_resumen) + "</p>" + (o.calificacion_motivo ? '<p class="muted"><small>' + esc(o.calificacion_motivo) + "</small></p>" : "") +
        (o.ia_siguiente_accion ? '<div class="ia-next">➜ ' + esc(o.ia_siguiente_accion) + "</div>" : "") +
        '<p class="muted"><small>Actualizado ' + esc(hace(o.ia_actualizado_at)) + "</small></p>";
    } else h += '<p class="muted">Pídele un resumen, la calificación del lead y qué hacer a continuación.</p>';
    if (puedeEscribir()) h += '<div class="row" style="margin-top:8px"><button class="btn btn-sm" data-action="ia-resumen">' + (o.ia_resumen ? "Actualizar análisis" : "Analizar con IA") + "</button>" +
      '<button class="btn btn-sm" data-action="ia-mensaje">Redactar mensaje</button></div>';
    h += "</div>";

    // Nueva actividad
    if (gest) {
      h += '<div class="card"><h3>Registrar</h3><div class="seg" id="seg-act" style="margin-bottom:10px"><button class="' + (S.modoAct === "tarea" ? "" : "on") + '" data-action="modo-act" data-m="nota">Nota</button><button class="' + (S.modoAct === "tarea" ? "on" : "") + '" data-action="modo-act" data-m="tarea">Tarea</button></div>' +
        '<form class="form" id="form-nota" data-form="nota"' + (S.modoAct === "tarea" ? " hidden" : "") + '><select class="inp" name="tipo" aria-label="Tipo">' +
        ["nota", "llamada", "whatsapp", "correo", "visita"].map(function (t) { return '<option value="' + t + '">' + TIPOS[t][0] + "</option>"; }).join("") + "</select>" +
        '<textarea class="inp" id="nota-texto" name="texto" placeholder="¿Qué pasó? Escribe o dicta (🎤) y la IA lo ordena y crea los pendientes." required></textarea>' +
        '<div class="row"><button type="button" class="icon-btn mic" data-action="dictar" data-target="nota-texto" aria-label="Dictar">' + icon("mic") + "</button>" +
        '<button type="button" class="btn btn-sm" data-action="ia-nota">✦ Ordenar con IA</button><span style="flex:1"></span><button class="btn btn-primary btn-sm" type="submit">Guardar</button></div></form>' +
        '<form class="form" id="form-tarea" data-form="tarea"' + (S.modoAct === "tarea" ? "" : " hidden") + '><input class="inp" name="titulo" placeholder="Ej. Llamar para confirmar la cita" required>' +
        '<div class="form2"><input class="inp" type="date" name="fecha" value="' + fechaInput(1) + '" required aria-label="Fecha"><input class="inp" type="time" name="hora" value="09:00" aria-label="Hora"></div>' +
        '<div class="row end"><button class="btn btn-primary btn-sm" type="submit">Crear tarea</button></div></form>';
      if (S.prop) h += propuestaHtml(S.prop);
      h += "</div>";
    }

    // Proformas
    var cots = d.cots || [];
    h += '<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Proformas</h3>' +
      (gest ? '<button class="btn btn-primary btn-sm" data-action="proforma-lead" data-id="' + esc(o.id) + '">' + icon("plus", "icon-sm") + " Nueva proforma</button>" : "") + "</div>" +
      (cots.length ? '<div class="cot-lista">' + cots.map(function (q) { return itemCot(q, false); }).join("") + "</div>"
        : '<p class="muted" style="margin:6px 0 0">' + (gest ? "Cotiza en segundos con los datos de este cliente y envíasela por WhatsApp." : "Sin proformas.") + "</p>") + "</div>";

    // Datos
    h += '<details class="card"><summary><b>Datos del lead</b></summary>' + (gest ? formDatos(o, c) : '<p class="muted">Solo lectura para tu rol.</p>') + "</details>";

    // Línea de tiempo
    h += '<div class="card"><h3>Historial</h3><div class="tl">' + (d.acts.length ? d.acts.map(itemTl).join("") : '<p class="muted" style="margin:0">Sin actividad todavía.</p>') + "</div></div>";
    h += "</div>";
    panel.innerHTML = h;
    restore(panel, ss);
    panel.scrollTop = scroll;
  }

  function fechaInput(dias) {
    var d = new Date(); d.setDate(d.getDate() + dias);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function venceDe(dias) { return new Date(fechaInput(dias) + "T09:00:00").toISOString(); }

  function itemTl(a) {
    var t = TIPOS[a.tipo] || TIPOS.nota, sis = a.tipo === "cambio_etapa" || a.tipo === "sistema";
    var extra = "";
    if (a.tipo === "tarea") {
      var cu = cuando(a.vence_at);
      extra = a.hecha_at ? '<br><small>✔ Hecha ' + esc(hace(a.hecha_at)) + "</small>" :
        '<br><label><input type="checkbox" data-action="tarea-hecha" data-id="' + esc(a.id) + '"> <small' + (cu.vencida ? ' style="color:var(--c-red-600);font-weight:700"' : "") + ">" + esc(cu.txt) + " · marcar hecha</small></label>";
    }
    return '<div class="tl-item' + (sis ? " sis" : "") + '"><div class="tl-ico" aria-hidden="true">' + t[1] + '</div><div class="tl-body"><p>' +
      (a.hecha_at ? "<s>" + esc(a.contenido) + "</s>" : esc(a.contenido)) + "</p><small>" + esc(t[0]) + " · " + esc(autorDe(a.creado_por)) + " · " + esc(hace(a.created_at)) + "</small>" + extra + "</div></div>";
  }

  function formDatos(o, c) {
    var proys = {}; Object.keys(PROYECTOS).forEach(function (k) { proys[k] = PROYECTOS[k]; });
    if (o.proyecto && !proys[o.proyecto]) proys[o.proyecto] = o.proyecto;
    return '<form class="form" id="form-datos" style="margin-top:10px">' +
      '<label class="fld"><span>Nombre</span><input name="nombre" value="' + esc(c.nombre) + '" required minlength="2" maxlength="120"></label>' +
      '<div class="form2"><label class="fld"><span>Teléfono</span><input name="telefono" type="tel" value="' + esc(c.telefono) + '"></label>' +
      '<label class="fld"><span>Correo</span><input name="correo" type="email" value="' + esc(c.correo) + '"></label></div>' +
      '<div class="form2"><label class="fld"><span>Proyecto</span><select name="proyecto"><option value="">—</option>' +
      Object.keys(proys).map(function (k) { return '<option value="' + esc(k) + '"' + (o.proyecto === k ? " selected" : "") + ">" + esc(proys[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Unidad de interés</span><input name="unidad_interes" value="' + esc(o.unidad_interes) + '" maxlength="120"></label></div>' +
      '<div class="form2"><label class="fld"><span>Fuente</span><select name="fuente">' +
      Object.keys(FUENTES).map(function (k) { return '<option value="' + k + '"' + (o.fuente === k ? " selected" : "") + ">" + esc(FUENTES[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Valor estimado (USD)</span><input name="valor_estimado" type="number" min="0" step="1" value="' + esc(o.valor_estimado == null ? "" : o.valor_estimado) + '"></label></div>' +
      '<label class="fld"><span>N.º de proforma o referencia</span><input name="proforma_numero" value="' + esc(o.proforma_numero) + '" placeholder="Ej. PRO-0007" maxlength="30"></label>' +
      '<div class="row end"><button class="btn btn-primary btn-sm" type="submit">Guardar datos</button></div></form>';
  }

  function propuestaHtml(p) {
    return '<div class="proposal" style="margin-top:12px"><b>✦ Propuesta de la IA — revísala antes de guardar</b>' +
      "<div><small class=\"muted\">" + esc(TIPOS[p.tipo][0]) + "</small><br>" + esc(p.nota) + "</div>" +
      (p.tareas.length ? "<div><small class=\"muted\">Tareas a crear</small><ul>" + p.tareas.map(function (t) { return "<li>" + esc(t.titulo) + " <small>(" + (t.dias === 0 ? "hoy" : t.dias === 1 ? "mañana" : "en " + t.dias + " días") + ")</small></li>"; }).join("") + "</ul></div>" : "") +
      (p.etapa_sugerida !== "ninguna" ? "<div><small class=\"muted\">Mover a etapa</small><br><b>" + esc(etapaTxt(p.etapa_sugerida)) + "</b>" + (p.motivo_perdida ? " · " + esc(p.motivo_perdida) : "") + "</div>" : "") +
      '<div class="row end"><button class="btn btn-sm" data-action="prop-descartar">Descartar</button><button class="btn btn-primary btn-sm" data-action="prop-guardar">Guardar todo</button></div></div>';
  }

  /* --------------------------------------------------------------- acciones */
  async function conBoton(btn, fn) {
    if (btn && btn.disabled) return;
    var txt = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin dark"></span>'; }
    try { return await fn(); }
    catch (e) { toast(mensajeError(e), true); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = txt; } }
  }

  async function guardarActividad(tipo, contenido, vence) {
    var d = S.det;
    var r = await sb.from("crm_actividades").insert({
      oportunidad_id: d.op.id, contacto_id: d.op.contacto_id, tipo: tipo, contenido: contenido,
      vence_at: vence || null, creado_por: S.email
    });
    if (r.error) throw r.error;
  }

  async function cambiarEtapa(id, etapa, motivo) {
    var o = opPorId(id); if (!o || o.etapa === etapa) return;
    var antes = { etapa: o.etapa, motivo: o.motivo_perdida };
    o.etapa = etapa; if (motivo) o.motivo_perdida = motivo;
    render(); if (S.det) pintarHoja();
    try {
      await upd("crm_oportunidades", id, motivo ? { etapa: etapa, motivo_perdida: motivo } : { etapa: etapa });
      if (S.det && S.det.op.id === id) cargarDetalle(id, true);
      toast("Etapa: " + etapaTxt(etapa));
    } catch (e) {
      o.etapa = antes.etapa; o.motivo_perdida = antes.motivo;
      render(); if (S.det) pintarHoja();
      toast(mensajeError(e), true);
    }
  }

  function pedirMotivoPerdida(id) {
    abrirModal('<h2>¿Por qué se perdió?</h2><div class="form">' +
      '<select class="inp" id="mp-sel" aria-label="Motivo">' + MOTIVOS_PERDIDA.map(function (m) { return "<option>" + esc(m) + "</option>"; }).join("") + "</select>" +
      '<input class="inp" id="mp-txt" placeholder="Detalle (opcional)" maxlength="150"></div>' +
      '<div class="row end"><button class="btn" data-action="cerrar-modal">Cancelar</button><button class="btn btn-primary" data-action="perdido-ok" data-id="' + esc(id) + '">Marcar como perdido</button></div>');
  }

  /* ----------------------------------------------------------------- modales */
  function abrirModal(html, clase) { $("modal-card").className = "modal-card" + (clase ? " " + clase : ""); $("modal-card").innerHTML = html; $("modal").hidden = false; var f = $("modal-card").querySelector("input,select,textarea"); if (f && window.innerWidth > 900) f.focus(); }
  function cerrarModal() { $("modal").hidden = true; $("modal-card").innerHTML = ""; $("modal-card").className = "modal-card"; S.cot = null; S.imp = null; }

  function abrirNuevo() {
    var proys = S.proyectos.filter(function (p) { return p.activo; }).map(function (p) { return p.slug; });
    abrirModal('<h2>Nuevo lead</h2><form class="form" id="form-nuevo">' +
      '<label class="fld"><span>Nombre *</span><input name="nombre" required minlength="2" maxlength="120" autocomplete="off"></label>' +
      '<div class="form2"><label class="fld"><span>Teléfono / WhatsApp</span><input name="telefono" type="tel" inputmode="tel" placeholder="09XXXXXXXX"></label>' +
      '<label class="fld"><span>Correo</span><input name="correo" type="email"></label></div>' +
      '<div class="form2"><label class="fld"><span>Proyecto</span><select name="proyecto"><option value="">—</option>' +
      proys.map(function (k) { return '<option value="' + k + '">' + esc(PROYECTOS[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Unidad de interés</span><input name="interes" maxlength="120" placeholder="Ej. Suite 102"></label></div>' +
      '<label class="fld"><span>¿De dónde llegó?</span><select name="fuente">' +
      Object.keys(FUENTES).map(function (k) { return '<option value="' + k + '"' + (k === "whatsapp" ? " selected" : "") + ">" + esc(FUENTES[k]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Nota</span><textarea name="nota" maxlength="1000" placeholder="Lo que conversaron, presupuesto, urgencia…"></textarea></label>' +
      (esGestor() ? '<label class="fld"><span>Asignar a</span><select name="asignado"><option value="">Sin asignar</option>' +
        S.equipo.filter(puedeRecibir).map(function (p) { return '<option value="' + esc(p.email) + '"' + (p.email === S.email ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" : "") +
      '<div class="row end"><button type="button" class="btn" data-action="cerrar-modal">Cancelar</button><button class="btn btn-primary" type="submit">Crear lead</button></div></form>');
  }

  function abrirMensaje() {
    var c = S.det.contacto;
    abrirModal('<h2>Redactar mensaje con IA</h2><div class="form">' +
      '<div class="seg" id="seg-canal"><button class="on" data-action="canal" data-c="whatsapp">WhatsApp</button><button data-action="canal" data-c="correo"' + (c.correo ? "" : " disabled") + ">Correo</button></div>" +
      '<select class="inp" id="msg-obj" aria-label="Objetivo">' + Object.keys(OBJETIVOS).map(function (k) { return '<option value="' + k + '"' + (k === "seguimiento" ? " selected" : "") + ">" + esc(OBJETIVOS[k]) + "</option>"; }).join("") + "</select>" +
      '<button class="btn btn-primary" data-action="msg-generar">✦ Generar borrador</button>' +
      '<div id="msg-out" hidden class="form"><input class="inp" id="msg-asunto" placeholder="Asunto" hidden><textarea class="inp" id="msg-texto" rows="7"></textarea>' +
      '<div class="row end"><button class="btn btn-sm" data-action="msg-copiar">Copiar</button><button class="btn btn-wa btn-sm" data-action="msg-enviar" id="msg-enviar">Abrir WhatsApp</button></div></div>' +
      '<p class="muted" style="margin:0"><small>Revisa y ajusta el texto antes de enviarlo. La IA no conoce precios ni disponibilidad: confírmalos tú.</small></p></div>');
    abrirMensaje.canal = "whatsapp";
  }

  function abrirCuenta() {
    var rol = (ROLES[S.rol] || [S.rol])[0];
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    abrirModal('<h2>Mi cuenta</h2><div class="card"><b>' + esc(S.email) + "</b><br><small class=\"muted\">" + esc(S.org.nombre) + " · " + esc(rol) + "</small></div>" +
      (instalada ? "" : '<div class="card"><h3>Instalar en tu celular</h3>' + (instalarEvento ?
        '<p class="muted" style="margin:0 0 8px">Ábrelo como una app, a pantalla completa.</p><button class="btn btn-primary btn-block" data-action="instalar">Instalar la app</button>' :
        '<p class="muted" style="margin:0">' + (ios ? "En Safari toca <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>." : "En el menú del navegador (⋮) elige <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.") + "</p>") + "</div>") +
      '<div class="card"><h3>Apariencia</h3><div class="seg" id="seg-modo" role="group" aria-label="Apariencia">' +
        [["auto", "Automático"], ["claro", "Claro"], ["oscuro", "Oscuro"]].map(function (x) {
          return '<button type="button" class="' + (GPUTema.modo() === x[0] ? "on" : "") + '" aria-pressed="' + (GPUTema.modo() === x[0]) + '" data-action="modo" data-m="' + x[0] + '">' + x[1] + "</button>";
        }).join("") + '</div><p class="muted" style="margin:8px 0 0"><small>Automático sigue el modo de tu teléfono o computadora.</small></p></div>' +
      '<div class="row end"><button class="btn" data-action="cerrar-modal">Cerrar</button><button class="btn btn-primary" data-action="salir">Cerrar sesión</button></div>' + pieGPU(S.marca));
  }

  /* ------------------------------------------------------ suscripción / banner */
  function diasPrueba() { return Math.max(0, Math.ceil((ms(S.uso.prueba_hasta) - Date.now()) / 86400000)); }
  function pagosEnApp() { return CFG.PAGOS_EN_APP === true; }
  /* WhatsApp de ventas con el mensaje ya escrito (cuando el pago se acuerda directamente con GPUnlock). */
  function waVentas(texto) {
    var n = String(CFG.VENTAS_WHATSAPP || "").replace(/\D/g, "");
    return "https://wa.me/" + n + "?text=" + encodeURIComponent(texto);
  }
  function textoContratar(plan) {
    return "Hola, quiero " + (plan ? "el plan " + plan : "contratar o renovar mi plan") + " de GPUnlock CRM para " + marcaNombre() + ".";
  }
  function bannerSuscripcion() {
    var u = S.uso; if (!u) return "";
    var revisando = pagosEnApp() && u.solicitud && u.solicitud.estado === "en_revision";
    var btnPlan = '<button class="btn btn-primary" data-action="ir-plan">' + (esPropietario() ? (revisando ? "Ver mi pago" : "Ver planes") : "Ver plan") + "</button>";
    var verbo = pagosEnApp() ? "Paga" : "Renueva";
    if (u.activa && u.estado === "prueba") {
      var d = diasPrueba();
      return '<div class="banner' + (d <= 3 ? " warn" : "") + '"><span>Prueba gratis: ' + (d === 0 ? "termina hoy" : "te quedan <b>" + d + (d === 1 ? " día" : " días") + "</b>") + "." + (revisando ? " Estamos revisando tu transferencia." : "") + "</span>" + btnPlan + "</div>";
    }
    if (u.estado === "gracia") {
      return '<div class="banner warn"><span><b>Tu suscripción venció.</b> ' + (revisando ? "Estamos revisando tu pago. " : "") +
        (u.gracia_hasta ? verbo + " antes del " + esc(fechaLarga(u.gracia_hasta)) + " para no quedar en solo lectura." : "") + "</span>" +
        (esPropietario() ? btnPlan : "<span>Avisa al propietario.</span>") + "</div>";
    }
    if (!u.activa) {
      var que = u.estado === "prueba" ? "Tu prueba gratis terminó" : u.estado === "cancelada" ? "Tu suscripción fue cancelada" : "Tu suscripción está vencida";
      return '<div class="banner bad"><span><b>' + que + ".</b> " + (revisando ? "Estamos revisando tu pago. " : "") + "La cuenta está en solo lectura; los formularios de tu web siguen guardando leads.</span>" +
        (esPropietario() ? btnPlan : "<span>Pídele al propietario que la renueve.</span>") + "</div>";
    }
    if (revisando && esPropietario()) {
      return '<div class="banner"><span>Estamos revisando tu transferencia. Activamos tu plan apenas la confirmemos.</span>' + btnPlan + "</div>";
    }
    var tope = [["leads_mes", "max_leads_mes", "leads de este mes"], ["usuarios", "max_usuarios", "usuarios"], ["ia_mes", "ia_mes", "consultas de IA de este mes"]]
      .filter(function (x) { return u[x[0]] >= u.plan[x[1]] * 0.9 && u.plan[x[1]] > 0; })[0];
    if (tope && esPropietario()) {
      var lleno = u[tope[0]] >= u.plan[tope[1]];
      return '<div class="banner ' + (lleno ? "bad" : "warn") + '"><span>' + (lleno ? "Llegaste al límite" : "Casi llegas al límite") + " de " + tope[2] + " de tu plan (" + u[tope[0]] + "/" + u.plan[tope[1]] + ").</span>" + btnPlan + "</div>";
    }
    return "";
  }

  /* -------------------------------------------------------------- Ajustes */
  function medidor(txt, usado, max) {
    var pct = max > 0 ? Math.min(100, Math.round((usado / max) * 100)) : 0;
    return '<div class="meter ' + (pct >= 100 ? "full" : pct >= 90 ? "high" : "") + '"><div class="meter-top"><span>' + esc(txt) + "</span><b>" + usado + " / " + max + '</b></div><div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div>';
  }
  function slugify(t) {
    return String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "proyecto";
  }

  function vistaAjustes() {
    var secs = [["equipo", "Equipo"], ["proyectos", "Proyectos"]].concat(esGestor() ? [["marca", "Marca"]] : [])
      .concat([["integracion", "Tu sitio web"], ["plan", pagosEnApp() ? "Plan y pagos" : "Mi plan"], ["empresa", "Empresa"]]);
    var h = '<div class="sub-tabs" role="tablist">' + secs.map(function (x) {
      return '<button role="tab" class="' + (S.ajSec === x[0] ? "on" : "") + '" data-action="aj-sec" data-s="' + x[0] + '">' + x[1] + "</button>";
    }).join("") + "</div>";
    if (S.ajSec === "equipo") return h + ajEquipo();
    if (S.ajSec === "proyectos") return h + ajProyectos();
    if (S.ajSec === "marca" && esGestor()) return h + ajMarca();
    if (S.ajSec === "integracion") return h + ajIntegracion();
    if (S.ajSec === "plan") return h + ajPlan();
    return h + ajEmpresa();
  }

  function ajEquipo() {
    var u = S.uso, max = u.plan.max_usuarios;
    var h = '<div class="card">' + medidor("Usuarios de tu plan " + u.plan.nombre, u.usuarios, max) +
      S.equipo.map(function (p) {
        var yo = p.user_id === S.user.id, acciones = "";
        if (esPropietario() && !yo && p.rol !== "propietario") {
          acciones += '<select class="inp" style="min-height:36px;padding:4px 8px;width:auto" data-rol-de="' + esc(p.user_id) + '" aria-label="Rol de ' + esc(p.nombre) + '">' +
            ["administrador", "agente", "lector"].map(function (r) { return '<option value="' + r + '"' + (p.rol === r ? " selected" : "") + ">" + ROLES[r][0] + "</option>"; }).join("") + "</select>";
        } else acciones += '<span class="chip">' + esc(ROLES[p.rol][0]) + "</span>";
        var puedeQuitar = p.rol !== "propietario" && (yo || esPropietario() || (S.rol === "administrador" && (p.rol === "agente" || p.rol === "lector")));
        if (puedeQuitar) acciones += '<button class="btn btn-sm" data-action="quitar" data-u="' + esc(p.user_id) + '" data-n="' + esc(p.nombre) + '">' + (yo ? "Salir" : "Quitar") + "</button>";
        return '<div class="person"><div><b>' + esc(p.nombre) + (yo ? " (tú)" : "") + "</b><small>" + esc(p.email) + '</small></div><div class="row">' + acciones + "</div></div>";
      }).join("") + "</div>";
    if (esGestor()) {
      if (S.invitaciones.length) {
        h += '<div class="sec"><h2>Invitaciones pendientes</h2></div><div class="card">' + S.invitaciones.map(function (i) {
          return '<div class="person"><div><b>' + esc(i.email) + "</b><small>" + esc(ROLES[i.rol][0]) + '</small></div><div class="row"><button class="btn btn-sm" data-action="cancelar-inv" data-id="' + esc(i.id) + '">Cancelar</button></div></div>';
        }).join("") + "</div>";
      }
      h += '<div class="sec"><h2>Invitar a una persona</h2></div><form class="card form" id="form-invitar">' +
        '<label class="fld"><span>Correo</span><input type="email" name="email" required inputmode="email" autocomplete="off"></label>' +
        '<label class="fld"><span>Rol</span><select name="rol">' +
        (esPropietario() ? '<option value="administrador">Administrador: gestiona leads, equipo y ajustes</option>' : "") +
        '<option value="agente" selected>Agente: trabaja sus leads</option><option value="lector">Lector: solo ve la información</option></select></label>' +
        '<button class="btn btn-primary" type="submit"' + (activa() ? "" : " disabled") + '>Invitar</button>' +
        '<p class="muted" style="margin:0"><small>La persona crea su cuenta en <b>' + esc(location.origin) + '/app/</b> con ese mismo correo y entra directo a tu equipo.</small></p></form>';
    }
    return h;
  }

  function ajProyectos() {
    var h = '<div class="card"><p class="muted" style="margin:0 0 8px">Tus proyectos o desarrollos. Se usan para ordenar los leads y para que la IA conozca tu oferta.</p>' +
      (S.proyectos.length ? S.proyectos.map(function (p) {
        return '<div class="person"><div><b>' + esc(p.nombre) + (p.activo ? "" : " (oculto)") + "</b><small>" + esc(p.slug) + "</small></div>" +
          (esGestor() ? '<div class="row"><button class="btn btn-sm" data-action="cfg-cot" data-s="' + esc(p.slug) + '">Cotizador</button><button class="btn btn-sm" data-action="proy-precios" data-s="' + esc(p.slug) + '" title="Si muestras u ocultas los precios en la disponibilidad de tu web">' + (p.precios_publicos === false ? "Precios ocultos en tu web" : "Precios visibles en tu web") + '</button><button class="btn btn-sm" data-action="proy-activo" data-s="' + esc(p.slug) + '">' + (p.activo ? "Ocultar" : "Mostrar") + '</button><button class="btn btn-sm" data-action="proy-borrar" data-s="' + esc(p.slug) + '" data-n="' + esc(p.nombre) + '">Eliminar</button></div>' : "") + "</div>";
      }).join("") : '<div class="empty">Aún no tienes proyectos.</div>') + "</div>";
    if (esGestor()) h += '<div class="sec"><h2>Nuevo proyecto</h2></div><form class="card form" id="form-proyecto"><label class="fld"><span>Nombre</span><input name="nombre" required maxlength="80" placeholder="Ej. Torres del Parque"></label><button class="btn btn-primary" type="submit"' + (activa() ? "" : " disabled") + ">Agregar proyecto</button></form>";
    return h;
  }

  function ajIntegracion() {
    var clave = S.org.clave_publica;
    var proy = S.proyectos[0] ? S.proyectos[0].slug : "mi-proyecto";
    var script = '<script src="' + location.origin + '/embed/lead.js"\n  data-url="' + CFG.SUPABASE_URL + '"\n  data-anon="' + CFG.SUPABASE_ANON_KEY + '"\n  data-clave="' + clave + '" defer><\/script>';
    var invSnippet = '<div data-crm-inventario data-proyecto="' + proy + '"></div>\n<script src="' + location.origin + '/embed/inventario.js"\n  data-url="' + CFG.SUPABASE_URL + '"\n  data-anon="' + CFG.SUPABASE_ANON_KEY + '"\n  data-clave="' + clave + '" defer><\/script>';
    var form = '<form data-crm-captura data-crm-proyecto="' + proy + '">\n  <input name="nombre" placeholder="Tu nombre" required>\n  <input name="telefono" placeholder="Teléfono" required>\n  <input name="correo" placeholder="Correo">\n  <textarea name="mensaje"></textarea>\n  <button>Enviar</button>\n</form>';
    return '<div class="card"><h3>Captura de leads desde tu web</h3>' +
      '<p class="muted" style="margin:0 0 10px">Pega este código en tu página (antes de <code>&lt;/body&gt;</code>). Cada formulario marcado con <code>data-crm-captura</code> enviará sus datos al CRM y seguirá funcionando como siempre.</p>' +
      '<span class="code" id="snip-script">' + esc(script) + '</span><div class="row end" style="margin-top:8px"><button class="btn btn-sm" data-action="copiar" data-t="snip-script">' + icon("copy", "icon-sm") + " Copiar</button></div></div>" +
      '<div class="card" style="margin-top:12px"><h3>Ejemplo de formulario</h3><p class="muted" style="margin:0 0 10px">Usa los nombres <code>nombre</code>, <code>telefono</code>, <code>correo</code>, <code>mensaje</code> e <code>interes</code>. El proyecto va en <code>data-crm-proyecto</code>.</p>' +
      '<span class="code" id="snip-form">' + esc(form) + '</span><div class="row end" style="margin-top:8px"><button class="btn btn-sm" data-action="copiar" data-t="snip-form">' + icon("copy", "icon-sm") + " Copiar</button></div></div>" +
      '<div class="card" style="margin-top:12px"><h3>Disponibilidad en vivo en tu web</h3><p class="muted" style="margin:0 0 10px">Muestra tus unidades con su precio y su estado actual (se actualiza solo). Pega el <code>&lt;div&gt;</code> donde quieras la lista y el script una vez, junto al de captura. Solo aparece lo que marcaste como visible; los precios se controlan por proyecto en <b>Proyectos</b>.</p>' +
      '<span class="code" id="snip-inv">' + esc(invSnippet) + '</span><div class="row end" style="margin-top:8px"><button class="btn btn-sm" data-action="copiar" data-t="snip-inv">' + icon("copy", "icon-sm") + " Copiar</button></div></div>" +
      '<div class="card" style="margin-top:12px"><h3>Tu clave pública</h3><span class="code" id="snip-clave">' + esc(clave) + '</span><p class="muted" style="margin:8px 0 0"><small>Identifica a tu empresa al enviar leads; puede estar en tu web. No da acceso a datos.</small></p></div>';
  }

  function ajPlan() {
    var u = S.uso, p = u.plan, sol = pagosEnApp() ? u.solicitud : null, h = bannerSuscripcion();
    var abierta = !!sol && (sol.estado === "pendiente" || sol.estado === "en_revision");
    var estadoTxt = u.estado === "activa" ? "Activa" : u.estado === "gracia" ? "Venció: días de gracia" : u.estado === "vencida" ? "Vencida" :
      u.estado === "cancelada" ? "Cancelada" : u.activa ? "En prueba gratis" : "Prueba terminada";
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><small class="muted">Plan actual</small><br><b style="font-size:1.2rem">' + esc(p.nombre) + '</b></div><span class="chip ' + (u.estado === "activa" ? "green" : u.estado === "gracia" ? "amber" : u.activa ? "" : "red") + '">' + estadoTxt + "</span></div>" +
      (u.estado === "prueba" && u.activa ? '<p class="muted" style="margin:6px 0 0">La prueba termina el ' + esc(fechaLarga(u.prueba_hasta)) + ".</p>" : "") +
      ((u.estado === "activa" || u.estado === "gracia") && u.periodo_hasta ? '<p class="muted" style="margin:6px 0 0">' + (u.estado === "activa" ? "Período vigente hasta el " : "Venció el ") + esc(fechaLarga(u.periodo_hasta)) + ".</p>" : "") +
      medidor("Usuarios", u.usuarios, p.max_usuarios) + medidor("Leads nuevos este mes", u.leads_mes, p.max_leads_mes) + medidor("Consultas de IA este mes", u.ia_mes, p.ia_mes) + "</div>";

    if (abierta && esPropietario()) h += tarjetaPago(sol);
    else if (abierta) h += '<div class="notice" style="margin-top:12px">Hay un pago en curso. El propietario lo está gestionando.</div>';
    if (sol && sol.estado === "rechazada") {
      h += '<div class="notice notice-error" id="pago-rechazado" role="alert" style="margin-top:12px"><b>No pudimos confirmar tu último pago</b> (referencia ' + esc(sol.referencia) + ").<br>" + esc(sol.motivo_rechazo || "") +
        "<br><small>Elige un plan para intentarlo de nuevo o escríbenos.</small></div>";
    }

    var anual = S.planes.some(function (x) { return x.precio_anual; });
    h += '<div class="sec"><h2>Planes</h2></div>';
    if (anual) h += '<div class="seg" style="margin-bottom:10px"><button class="' + (S.intervalo === "mensual" ? "on" : "") + '" data-action="intervalo" data-i="mensual">Mensual</button><button class="' + (S.intervalo === "anual" ? "on" : "") + '" data-action="intervalo" data-i="anual">Anual (2 meses gratis)</button></div>';
    h += '<div class="plans">' + S.planes.map(function (x) {
      var actual = x.id === p.id && (u.estado === "activa" || u.estado === "gracia");
      var anualOk = S.intervalo === "anual" && x.precio_anual;
      var precio = anualOk ? x.precio_anual : x.precio_mensual;
      var bloqueado = !!sol && sol.estado === "en_revision";
      var accion = !pagosEnApp() ? (!esPropietario() ? (actual ? '<span class="chip green">Tu plan actual</span>' : "") :
        '<a class="btn ' + (actual ? "" : "btn-primary ") + 'btn-block" target="_blank" rel="noopener" href="' + esc(waVentas(textoContratar(x.nombre))) + '">' + (actual ? "Renovar " : "Pedir ") + esc(x.nombre) + " por WhatsApp</a>" +
        (actual ? '<span class="chip green" style="justify-self:start">Tu plan actual</span>' : "")) :
        !esPropietario() ? (actual ? '<span class="chip green">Tu plan actual</span>' : "") :
        '<button class="btn ' + (actual ? "" : "btn-primary ") + 'btn-block" data-action="pagar" data-p="' + esc(x.id) + '"' + (bloqueado ? " disabled" : "") + ">" + (actual ? "Renovar " : "Elegir ") + esc(x.nombre) + "</button>" +
        (actual ? '<span class="chip green" style="justify-self:start">Tu plan actual</span>' : "");
      return '<div class="plan' + (actual ? " actual" : "") + '"><h3>' + esc(x.nombre) + (x.destacado ? ' <span class="chip">Popular</span>' : "") + '</h3><div class="precio">' + precioTxt(precio) + "<small> /" + (anualOk ? "año" : "mes") + " + impuestos</small></div>" +
        '<p class="muted" style="margin:0">' + esc(x.descripcion || "") + "</p><ul>" + (x.caracteristicas || []).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" + accion + "</div>";
    }).join("") + "</div>";
    if (!pagosEnApp()) h += '<p class="muted" style="margin-top:10px">El pago se acuerda directamente con GPUnlock. Al escribirnos por WhatsApp activamos tu plan apenas confirmemos el pago' + (esPropietario() ? "." : "; pídele al propietario que lo solicite.") + "</p>";
    else if (!esPropietario()) h += '<p class="muted" style="margin-top:10px">Solo el propietario puede contratar o cambiar el plan.</p>';
    else if (sol && sol.estado === "en_revision") h += '<p class="muted" style="margin-top:10px">Mientras revisamos tu transferencia no puedes pedir otro pago.</p>';

    if (pagosEnApp() && esPropietario() && S.pagos.length) {
      h += '<div class="sec"><h2>Historial de pagos</h2></div><div class="card hist">' + S.pagos.map(function (g) {
        var pl = S.planes.filter(function (x) { return x.id === g.plan_id; })[0];
        return '<div class="item"><span><b>' + dinero2(g.total) + "</b> · " + esc(pl ? pl.nombre : g.plan_id) + " " + esc(g.periodo) + '<br><small class="muted">Pagado el ' + esc(fechaLarga(g.fecha_transferencia + "T12:00:00")) +
          (g.factura_numero ? " · factura " + esc(g.factura_numero) : "") + '</small></span><span class="muted">Cubre hasta<br>' + esc(fechaLarga(g.cubre_hasta)) + "</span></div>";
      }).join("") + "</div>";
    }
    return h;
  }

  /* Instrucciones para pagar por transferencia: monto, referencia, cuenta y comprobante. */
  function tarjetaPago(sol) {
    var c = S.cobro || {}, pl = S.planes.filter(function (x) { return x.id === sol.plan_id; })[0];
    var revision = sol.estado === "en_revision";
    var h = '<div class="card" id="pago-en-curso" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h3>Pago del plan ' + esc(pl ? pl.nombre : sol.plan_id) + " · " + esc(sol.periodo) + "</h3>" +
      '<span class="chip ' + (revision ? "amber" : "gray") + '">' + (revision ? "En revisión" : "Falta tu transferencia") + "</span></div>" +
      '<dl class="kv" style="margin-top:10px"><dt>Subtotal</dt><dd>' + dinero2(sol.subtotal) + "</dd><dt>Impuesto</dt><dd>" + dinero2(sol.iva) + "</dd><dt>Total a transferir</dt><dd>" + dinero2(sol.total) + "</dd></dl>" +
      '<div class="ref-box" style="margin:12px 0"><div><small class="muted">Escribe este código en la descripción de la transferencia</small><br><b id="ref-pago">' + esc(sol.referencia) + '</b></div>' +
      '<button class="btn btn-sm" data-action="copiar" data-t="ref-pago">' + icon("copy", "icon-sm") + " Copiar</button></div>";
    if (c.numero_cuenta) {
      h += '<dl class="kv"><dt>Banco</dt><dd>' + esc(c.banco) + "</dd><dt>Cuenta</dt><dd>" + esc(c.tipo_cuenta) + " <span id=\"cta-num\">" + esc(c.numero_cuenta) + "</span> " +
        '<button class="link-btn" style="padding:0 4px" data-action="copiar" data-t="cta-num">Copiar</button></dd><dt>Titular</dt><dd>' + esc(c.titular) + "</dd>" +
        (c.identificacion ? "<dt>RUC / cédula</dt><dd>" + esc(c.identificacion) + "</dd>" : "") + "</dl>";
    } else {
      h += '<div class="notice">Los datos bancarios aún no están configurados. Escríbenos para darte la cuenta.</div>';
    }
    if (c.instrucciones) h += '<p class="muted" style="margin:10px 0 0"><small>' + esc(c.instrucciones) + "</small></p>";
    if (revision) {
      h += '<p style="margin:12px 0 0">Recibimos tu comprobante' + (sol.comprobante_subido_at ? " el " + esc(fechaLarga(sol.comprobante_subido_at)) : "") + ". Lo revisamos en horario de oficina y activamos tu plan; lo verás aquí. Mientras tanto sigues trabajando normal.</p>";
    } else {
      h += '<ol class="pasos" style="margin-top:12px"><li>Transfiere <b>' + dinero2(sol.total) + "</b> con el código <b>" + esc(sol.referencia) + "</b>.</li><li>Sube aquí la foto o el PDF del comprobante.</li><li>Activamos tu plan al confirmar el pago.</li></ol>";
    }
    h += '<div class="upload" style="margin-top:12px"><label class="fld"><span>' + (revision ? "¿Subiste el archivo equivocado? Envía otro" : "Comprobante de la transferencia (foto o PDF, máx. 5 MB)") + '</span>' +
      '<input type="file" id="comp-archivo" accept="image/jpeg,image/png,image/webp,application/pdf"></label>' +
      '<div class="row"><button class="btn btn-primary" data-action="comp-enviar" data-id="' + esc(sol.id) + '">' + (revision ? "Reemplazar comprobante" : "Enviar comprobante") + "</button>" +
      (!revision ? '<button class="link-btn" data-action="cancelar-solicitud" data-id="' + esc(sol.id) + '">Cancelar esta solicitud</button>' : "") + "</div></div>";
    if (c.whatsapp_cobros) {
      h += '<p class="muted" style="margin:12px 0 0"><small>¿Dudas con tu pago? <a href="https://wa.me/' + esc(c.whatsapp_cobros) + "?text=" + encodeURIComponent("Hola, consulta sobre mi pago " + sol.referencia) + '" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>.</small></p>';
    }
    return h + "</div>";
  }

  /* ------------------------------------------------------------------ Inventario */
  var TIPOS_UNIDAD = { departamento: "Departamento", suite: "Suite", loft: "Loft", casa: "Casa", lote: "Lote", local: "Local", oficina: "Oficina", parqueo: "Parqueo", bodega: "Bodega", otro: "Otro" };
  var ESTADOS_UNIDAD = { disponible: ["Disponible", "green"], reservada: ["Reservada", "amber"], vendida: ["Vendida", "gray"], no_disponible: ["No disponible", "red"] };
  var VERBO_ESTADO = { disponible: "Liberar (disponible)", reservada: "Reservar", vendida: "Marcar como vendida", no_disponible: "Bloquear (no disponible)" };
  function natural(a, b) { return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" }); }
  function ordenUnidad(a, b) { return natural(a.proyecto, b.proyecto) || natural(a.bloque || "", b.bloque || "") || natural(a.piso || "", b.piso || "") || natural(a.codigo, b.codigo); }
  function unidadPorId(id) { return (S.unidades || []).filter(function (u) { return u.id === id; })[0]; }
  function fmtNum(n) { return Number(n).toLocaleString("es-EC", { maximumFractionDigits: 1 }); }
  /* Qué estados puede poner esta persona a esta unidad (el servidor lo vuelve a comprobar). */
  function destinosUnidad(u) {
    if (!activa() || S.rol === "lector") return [];
    var todos = ["disponible", "reservada", "vendida", "no_disponible"].filter(function (e) { return e !== u.estado; });
    if (esGestor()) return todos;
    return u.estado === "disponible" || u.estado === "reservada" ? todos.filter(function (e) { return e === "disponible" || e === "reservada"; }) : [];
  }
  async function cargarInventario(silencioso) {
    try {
      var r = await sb.from("crm_unidades").select("*").eq("org_id", S.org.id).order("proyecto").order("codigo").limit(5000);
      if (r.error) throw r.error;
      S.unidades = (r.data || []).slice().sort(ordenUnidad);
    } catch (e) {
      if (!silencioso) toast(mensajeError(e), true);
      if (S.unidades === null) S.unidades = [];
    }
    if (S.vista === "inventario") render();
  }
  var recargarInv = (function () {
    var t; return function () { clearTimeout(t); t = setTimeout(function () { if (S.unidades !== null) cargarInventario(true); }, 500); };
  })();

  function vistaInventario() {
    var sub = '<div class="sub-tabs" role="tablist"><button role="tab" class="' + (S.invSub === "unidades" ? "on" : "") + '" data-action="inv-sub" data-s="unidades">Unidades</button>' +
      '<button role="tab" class="' + (S.invSub === "proformas" ? "on" : "") + '" data-action="inv-sub" data-s="proformas">Proformas</button></div>';
    var nueva = puedeEscribir() ? '<button class="btn btn-primary btn-sm" data-action="nueva-proforma">' + icon("plus", "icon-sm") + " Nueva proforma</button>" : "";
    if (S.invSub === "proformas") return sub + (nueva ? '<div class="row" style="margin-bottom:10px">' + nueva + "</div>" : "") + vistaProformas();
    return sub + vistaUnidades(nueva);
  }
  function vistaUnidades(nueva) {
    if (S.unidades === null) return '<div class="empty">Cargando inventario…</div>';
    var gest = esGestor();
    if (!S.proyectos.length) {
      return '<div class="empty">Aún no tienes proyectos. ' + (gest ? "Crea el primero en <b>Ajustes → Proyectos</b> y vuelve aquí para cargar sus unidades." : "Pídele a un administrador que cree los proyectos.") + "</div>";
    }
    var f = S.invF, q = norm(f.q);
    var base = S.unidades.filter(function (u) {
      return (!f.proyecto || u.proyecto === f.proyecto) && (!f.tipo || u.tipo === f.tipo) &&
        (!q || norm([u.codigo, u.bloque, u.piso, u.descripcion].join(" ")).indexOf(q) >= 0);
    });
    var n = { disponible: 0, reservada: 0, vendida: 0, no_disponible: 0 };
    base.forEach(function (u) { n[u.estado]++; });
    var lista = base.filter(function (u) { return !f.estado || u.estado === f.estado; });
    var tipos = Object.keys(TIPOS_UNIDAD).filter(function (t) { return S.unidades.some(function (u) { return u.tipo === t; }); });

    var h = "";
    if (gest || nueva) {
      h += '<div class="row" style="margin-bottom:10px">' + (nueva || "") + (gest ? '<button class="btn btn-sm" data-action="unidad-nueva"' + (activa() ? "" : " disabled") + ">" + icon("plus", "icon-sm") + " Unidad</button>" +
        '<button class="btn btn-sm" data-action="importar"' + (activa() ? "" : " disabled") + ">Importar Excel o CSV</button>" : "") + "</div>";
    }
    if (!S.unidades.length) {
      return h + '<div class="empty"><b>Tu inventario está vacío.</b><br>' + (gest ? "Agrega unidades una por una o impórtalas de golpe desde un Excel o CSV." : "Un administrador debe cargar las unidades.") + "</div>";
    }
    h += '<div class="inv-filtros"><input type="search" id="inv-q" placeholder="Buscar por código, torre o piso" value="' + esc(f.q) + '" aria-label="Buscar unidades" autocomplete="off">';
    if (S.proyectos.length > 1) {
      h += '<select id="inv-proyecto" aria-label="Proyecto"><option value="">Todos los proyectos</option>' +
        S.proyectos.map(function (p) { return '<option value="' + esc(p.slug) + '"' + (f.proyecto === p.slug ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select>";
    }
    if (tipos.length > 1) {
      h += '<select id="inv-tipo" aria-label="Tipo"><option value="">Todos los tipos</option>' +
        tipos.map(function (t) { return '<option value="' + t + '"' + (f.tipo === t ? " selected" : "") + ">" + TIPOS_UNIDAD[t] + "</option>"; }).join("") + "</select>";
    }
    h += "</div>";
    var segs = [["disponible", "Disponibles", n.disponible], ["reservada", "Reservadas", n.reservada], ["vendida", "Vendidas", n.vendida], ["", "Todas", base.length]];
    h += '<div class="seg inv-seg" role="group" aria-label="Estado">' + segs.map(function (s) {
      return '<button type="button" class="' + (f.estado === s[0] ? "on" : "") + '" aria-pressed="' + (f.estado === s[0]) + '" data-action="inv-estado" data-e="' + s[0] + '">' + s[1] + " <b>" + s[2] + "</b></button>";
    }).join("") + "</div>";
    if (!lista.length) return h + '<div class="empty" style="margin-top:12px">No hay unidades con esos filtros.</div>';
    h += '<div class="inv-lista">' + lista.slice(0, S.invMax).map(function (u) {
      var e = ESTADOS_UNIDAD[u.estado] || [u.estado, "gray"];
      var med = [u.area_m2 != null ? fmtNum(u.area_m2) + " m²" : "", u.dormitorios != null ? u.dormitorios + " dorm." : "", u.banos != null ? fmtNum(u.banos) + " baños" : "", u.parqueos ? u.parqueos + " parq." : ""].filter(Boolean).join(" · ");
      var ubic = [S.proyectos.length > 1 ? proyTxt(u.proyecto) : "", TIPOS_UNIDAD[u.tipo] || "", u.bloque ? "Torre " + u.bloque : "", u.piso ? "Piso " + u.piso : ""].filter(Boolean).join(" · ");
      return '<button type="button" class="card unidad' + (u.fotos && u.fotos[0] ? " con-foto" : "") + '" data-action="unidad" data-id="' + esc(u.id) + '">' + (u.fotos && u.fotos[0] ? '<img class="u-thumb" src="' + esc(urlFoto(u.fotos[0])) + '" alt="" loading="lazy">' : "") + '<span class="u-top"><b>' + esc(u.codigo) + '</b><span class="chip ' + e[1] + '">' + e[0] + "</span></span>" +
        '<small class="muted">' + esc(ubic) + "</small>" + (med ? "<span>" + esc(med) + "</span>" : "") +
        '<span class="u-precio">' + (u.precio != null ? precioTxt(u.precio) : '<span class="muted">Sin precio</span>') + "</span></button>";
    }).join("") + "</div>";
    if (lista.length > S.invMax) h += '<div class="row end" style="margin-top:10px"><button class="btn" data-action="inv-mas">Ver más (' + (lista.length - S.invMax) + " restantes)</button></div>";
    return h;
  }

  /* Ficha de una unidad: datos, cambio de estado (con el lead) e historial. */
  async function abrirUnidad(id) {
    var u = unidadPorId(id); if (!u) return;
    var e = ESTADOS_UNIDAD[u.estado] || [u.estado, "gray"], dest = destinosUnidad(u);
    var fila = function (k, v) { return v == null || v === "" ? "" : "<dt>" + k + "</dt><dd>" + esc(v) + "</dd>"; };
    var h = '<div class="row" style="justify-content:space-between"><h2 style="margin:0">' + esc(u.codigo) + '</h2><span class="chip ' + e[1] + '">' + e[0] + "</span></div>" +
      '<p class="muted" style="margin:2px 0 10px">' + esc(proyTxt(u.proyecto)) + " · en este estado " + esc(hace(u.estado_at)) + "</p>" +
      '<dl class="kv">' + fila("Tipo", TIPOS_UNIDAD[u.tipo]) + fila("Torre / bloque", u.bloque) + fila("Piso", u.piso) + fila("Área", u.area_m2 != null ? fmtNum(u.area_m2) + " m²" : "") +
      fila("Dormitorios", u.dormitorios) + fila("Baños", u.banos != null ? fmtNum(u.banos) : "") + fila("Parqueos", u.parqueos) + fila("Bodegas", u.bodegas) +
      fila("Precio", u.precio != null ? dinero2(u.precio) : "Sin precio") + (esGestor() ? fila("En tu web", u.publica ? "Visible" : "Oculta") : "") + fila("Descripción", u.descripcion) + "</dl>";
    var fotos = u.fotos || [], gf = esGestor() && activa();
    if (fotos.length || gf) {
      h += '<div class="u-galeria" id="u-fotos">' + fotos.map(function (f, i) {
        return '<figure><a href="' + esc(urlFoto(f)) + '" target="_blank" rel="noopener"><img src="' + esc(urlFoto(f)) + '" alt="Foto ' + (i + 1) + " de " + esc(u.codigo) + '" loading="lazy"></a>' +
          (i === 0 ? "<figcaption>Portada</figcaption>" : "") +
          (gf ? '<div class="u-foto-acc">' + (i ? '<button type="button" data-action="foto-portada" data-id="' + esc(u.id) + '" data-f="' + esc(f) + '">Portada</button>' : "") +
            '<button type="button" data-action="foto-quitar" data-id="' + esc(u.id) + '" data-f="' + esc(f) + '" aria-label="Quitar foto ' + (i + 1) + '">Quitar</button></div>' : "") + "</figure>";
      }).join("") + (gf && fotos.length < 8 ? '<label class="u-foto-nueva">' + icon("plus") + '<span>Agregar fotos</span><input type="file" id="u-fotos-input" data-id="' + esc(u.id) + '" accept="image/jpeg,image/png,image/webp" multiple hidden></label>' : "") + "</div>";
    }
    if (u.estado === "disponible" && u.precio != null && puedeEscribir()) {
      h += '<div class="row" style="margin-top:10px"><button class="btn btn-primary" data-action="cotizar-unidad" data-id="' + esc(u.id) + '">Hacer proforma con esta unidad</button></div>';
    }
    if (dest.length) {
      var leads = S.ops.filter(function (o) { return abierta(o) && puedeGestionar(o); })
        .sort(function (a, b) { return (b.proyecto === u.proyecto) - (a.proyecto === u.proyecto) || natural((a.contacto || {}).nombre || "", (b.contacto || {}).nombre || ""); }).slice(0, 200);
      h += '<div class="card" style="margin-top:12px"><h3>Cambiar estado</h3>' +
        '<label class="fld"><span>Para el lead (opcional)</span><select id="u-lead"><option value="">Sin lead</option>' +
        leads.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc((o.contacto || {}).nombre || "Lead") + " · " + esc(etapaTxt(o.etapa)) + "</option>"; }).join("") + "</select>" +
        '<small class="muted">Al reservar o vender para un lead, él pasa a «Reserva» o «Vendido» con el precio de la unidad.</small></label>' +
        '<label class="fld"><span>Nota (opcional)</span><input id="u-nota" maxlength="300" placeholder="Ej. dejó $500 de señal"></label>' +
        '<div class="row">' + dest.map(function (d) {
          return '<button class="btn ' + (d === "reservada" || d === "vendida" ? "btn-primary " : "") + 'btn-sm" data-action="unidad-estado" data-id="' + esc(u.id) + '" data-e="' + d + '">' + VERBO_ESTADO[d] + "</button>";
        }).join("") + "</div></div>";
    } else if (!activa()) h += '<p class="muted" style="margin-top:10px">Con la suscripción vencida el inventario es solo de lectura.</p>';
    else if (S.rol === "agente" && (u.estado === "vendida" || u.estado === "no_disponible")) h += '<p class="muted" style="margin-top:10px">Solo un administrador cambia una unidad vendida o bloqueada.</p>';
    h += '<div class="sec"><h2>Historial</h2></div><div class="hist" id="unidad-hist"><div class="muted">Cargando…</div></div>';
    h += '<div class="row end" style="margin-top:14px">' + (esGestor() && activa() ? '<button class="btn btn-sm" data-action="unidad-editar" data-id="' + esc(u.id) + '">Editar</button>' +
      '<button class="btn btn-sm" data-action="unidad-eliminar" data-id="' + esc(u.id) + '" data-c="' + esc(u.codigo) + '">Eliminar</button>' : "") +
      '<button class="btn" data-action="cerrar-modal">Cerrar</button></div>';
    abrirModal(h);
    try {
      var r = await sb.from("crm_unidades_historial").select("*").eq("unidad_id", id).order("created_at", { ascending: false }).limit(20);
      var cont = $("unidad-hist"); if (!cont || r.error) return;
      cont.innerHTML = (r.data || []).map(function (x) {
        var que = x.estado_antes == null ? "Unidad creada" : x.estado_antes !== x.estado_despues
          ? (ESTADOS_UNIDAD[x.estado_antes] || [x.estado_antes])[0] + " → " + (ESTADOS_UNIDAD[x.estado_despues] || [x.estado_despues])[0]
          : "Precio " + dinero2(x.precio_antes) + " → " + dinero2(x.precio_despues);
        var lead = x.oportunidad_id && opPorId(x.oportunidad_id) ? " · lead " + ((opPorId(x.oportunidad_id).contacto || {}).nombre || "") : "";
        return '<div class="item"><span><b>' + esc(que) + "</b>" + esc(lead) + (x.nota && x.nota !== "Unidad creada" ? '<br><small class="muted">' + esc(x.nota) + "</small>" : "") +
          '</span><span class="muted">' + esc(nombreDe(x.por)) + "<br>" + esc(hace(x.created_at)) + "</span></div>";
      }).join("") || '<div class="muted">Sin movimientos.</div>';
    } catch (er) { /* sin historial: no impide usar la ficha */ }
  }

  function abrirFormUnidad(id) {
    var u = id ? unidadPorId(id) : null, d = u || {};
    var proys = S.proyectos.filter(function (p) { return p.activo || p.slug === d.proyecto; });
    var sel = d.proyecto || S.invF.proyecto || (proys[0] && proys[0].slug) || "";
    function num(k, et, extra) { return '<label class="fld"><span>' + et + '</span><input name="' + k + '" inputmode="decimal" value="' + esc(d[k] == null ? "" : String(d[k]).replace(".", ",")) + '" ' + (extra || "") + "></label>"; }
    abrirModal('<h2>' + (u ? "Editar unidad" : "Nueva unidad") + '</h2><form class="form" id="form-unidad" data-id="' + esc(id || "") + '" novalidate>' +
      '<div class="form2"><label class="fld"><span>Proyecto *</span><select name="proyecto">' + proys.map(function (p) { return '<option value="' + esc(p.slug) + '"' + (p.slug === sel ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Código *</span><input name="codigo" required maxlength="40" value="' + esc(d.codigo || "") + '" placeholder="Ej. A-101" autocomplete="off"></label></div>' +
      '<div class="form2"><label class="fld"><span>Tipo</span><select name="tipo">' + Object.keys(TIPOS_UNIDAD).map(function (t) { return '<option value="' + t + '"' + ((d.tipo || "departamento") === t ? " selected" : "") + ">" + TIPOS_UNIDAD[t] + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>Estado</span><select name="estado">' + Object.keys(ESTADOS_UNIDAD).map(function (t) { return '<option value="' + t + '"' + ((d.estado || "disponible") === t ? " selected" : "") + ">" + ESTADOS_UNIDAD[t][0] + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="form2"><label class="fld"><span>Torre / bloque</span><input name="bloque" maxlength="40" value="' + esc(d.bloque || "") + '"></label><label class="fld"><span>Piso</span><input name="piso" maxlength="10" value="' + esc(d.piso || "") + '"></label></div>' +
      '<div class="form2">' + num("area_m2", "Área (m²)") + num("precio", "Precio (USD)") + "</div>" +
      '<div class="form2">' + num("dormitorios", "Dormitorios") + num("banos", "Baños") + "</div>" +
      '<div class="form2">' + num("parqueos", "Parqueos") + num("bodegas", "Bodegas") + "</div>" +
      '<label class="fld"><span>Descripción</span><textarea name="descripcion" maxlength="500" placeholder="Vista, acabados, orientación…">' + esc(d.descripcion || "") + "</textarea></label>" +
      '<label class="row" style="gap:8px"><input type="checkbox" name="publica"' + (d.publica === false ? "" : " checked") + '> <span>Mostrar en la disponibilidad de mi sitio web</span></label>' +
      '<div class="row end"><button type="button" class="btn" data-action="cerrar-modal">Cancelar</button><button class="btn btn-primary" type="submit">' + (u ? "Guardar cambios" : "Crear unidad") + "</button></div></form>");
  }
  async function guardarUnidad(f, btn) {
    var fd = new FormData(f), datos = { proyecto: fd.get("proyecto"), codigo: String(fd.get("codigo") || "").trim(), tipo: fd.get("tipo"), estado: fd.get("estado"),
      bloque: fd.get("bloque"), piso: fd.get("piso"), descripcion: fd.get("descripcion"), publica: fd.get("publica") === "on" };
    var malo = "";
    [["area_m2", "El área"], ["precio", "El precio"], ["dormitorios", "Los dormitorios"], ["banos", "Los baños"], ["parqueos", "Los parqueos"], ["bodegas", "Las bodegas"]].forEach(function (p) {
      var r = GPUImportar.numero(fd.get(p[0]));
      if (r.vacio) datos[p[0]] = null; else if (r.error || r.valor < 0) malo = malo || p[1] + " no es un número válido."; else datos[p[0]] = r.valor;
    });
    if (!datos.codigo) malo = "Escribe el código de la unidad.";
    if (malo) { toast(malo, true); return; }
    return conBoton(btn, async function () {
      var r = await sb.rpc("guardar_unidad", { p_org: S.org.id, p_id: f.dataset.id || null, p_datos: datos }); if (r.error) throw r.error;
      await cargarInventario(true); cerrarModal(); toast(f.dataset.id ? "Unidad actualizada" : "Unidad creada");
    });
  }
  async function cambiarEstadoUnidad(btn) {
    var id = btn.dataset.id, nuevo = btn.dataset.e, op = $("u-lead") && $("u-lead").value, nota = $("u-nota") && $("u-nota").value.trim();
    return conBoton(btn, async function () {
      var r = await sb.rpc("cambiar_estado_unidad", { p_unidad: id, p_estado: nuevo, p_oportunidad: op || null, p_nota: nota || null }); if (r.error) throw r.error;
      cerrarModal(); toast("Unidad " + (ESTADOS_UNIDAD[nuevo][0]).toLowerCase() + (op ? " y lead actualizado" : ""));
      await Promise.all([cargarInventario(true), op ? cargar(true) : Promise.resolve()]);
    });
  }

  /* ----------------------------------------------- Importar desde Excel o CSV */
  function abrirImportar() {
    S.imp = { paso: 1, archivo: null, nombre: "", columnas: [], filas: [], mapa: {}, proyecto: S.invF.proyecto || (S.proyectos[0] && S.proyectos[0].slug) || "", actualizarEstado: false, error: "", enviando: false };
    pintarImportar();
  }
  function conversionImp() {
    var I = S.imp;
    return GPUImportar.convertir(I.filas, I.mapa, { proyectos: S.proyectos, proyectoDefecto: I.mapa.proyecto >= 0 ? (I.proyecto || null) : I.proyecto });
  }
  function pintarImportar() {
    var I = S.imp; if (!I) return;
    var h = "<h2>Importar inventario</h2>";
    if (I.paso === 1) {
      h += '<p class="muted" style="margin:0 0 10px">Sube un Excel (.xlsx) o un CSV con una fila de títulos y una unidad por fila. El archivo se lee en tu equipo; solo se envía lo que confirmes.</p>' +
        '<label class="fld"><span>Archivo</span><input type="file" id="imp-archivo" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>' +
        (I.error ? '<div class="notice notice-error" role="alert">' + esc(I.error) + "</div>" : "") +
        '<p style="margin:10px 0 0"><button type="button" class="link-btn" data-action="imp-plantilla">Descargar plantilla de ejemplo (CSV)</button></p>' +
        '<p class="muted" style="margin:8px 0 0"><small>Si ya existe una unidad con el mismo código en el proyecto, se actualiza (sin borrar los datos que tu archivo no trae). Máximo 2.000 filas.</small></p>' +
        '<div class="row end" style="margin-top:12px"><button class="btn" data-action="cerrar-modal">Cancelar</button></div>';
    } else {
      var c = conversionImp(), I2 = I, cols = I.columnas;
      var opciones = function (campo) {
        return '<option value="-1">— no viene en el archivo —</option>' + cols.map(function (t, i) { return '<option value="' + i + '"' + (I2.mapa[campo] === i ? " selected" : "") + ">" + esc(t || "Columna " + (i + 1)) + "</option>"; }).join("");
      };
      h += '<p class="muted" style="margin:0 0 10px"><b>' + esc(I.nombre) + "</b> · " + I.filas.length + " filas. Revisa qué columna es cada dato.</p><div class=\"imp-mapa\">" +
        GPUImportar.CAMPOS.map(function (campo) {
          var obl = campo === "codigo" ? " *" : "";
          return '<label class="fld"><span>' + GPUImportar.ETIQUETAS[campo] + obl + '</span><select data-imp-map="' + campo + '">' + opciones(campo) + "</select></label>";
        }).join("") + "</div>";
      h += '<label class="fld" style="margin-top:8px"><span>Proyecto para las filas sin proyecto</span><select id="imp-proyecto">' +
        S.proyectos.map(function (p) { return '<option value="' + esc(p.slug) + '"' + (I.proyecto === p.slug ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
        '<label class="row" style="gap:8px;margin-top:8px"><input type="checkbox" id="imp-estado"' + (I.actualizarEstado ? " checked" : "") + '> <span>Actualizar también el estado de las unidades que ya existen</span></label>';
      h += '<div class="card" style="margin-top:12px"><b>' + c.filas.length + " " + (c.filas.length === 1 ? "unidad lista" : "unidades listas") + "</b>" + (c.errores.length ? ' · <b class="txt-rojo">' + c.errores.length + " con errores</b>" : "") +
        c.avisos.map(function (a) { return '<p class="muted" style="margin:6px 0 0">⚠ ' + esc(a) + "</p>"; }).join("") +
        (c.errores.length ? '<ul class="imp-errores">' + c.errores.slice(0, 8).map(function (e) { return "<li>Fila " + e.fila + ": " + esc(e.error) + "</li>"; }).join("") +
          (c.errores.length > 8 ? "<li>…y " + (c.errores.length - 8) + " más</li>" : "") + "</ul><p class=\"muted\" style=\"margin:6px 0 0\"><small>Las filas con error no se importan: corrígelas en tu archivo y vuelve a subirlo.</small></p>" : "") + "</div>";
      if (I.error) h += '<div class="notice notice-error" role="alert" style="margin-top:10px">' + esc(I.error) + "</div>";
      h += '<div class="row end" style="margin-top:12px"><button class="btn" data-action="imp-otro">Elegir otro archivo</button><button class="btn btn-primary" data-action="imp-confirmar"' + (c.filas.length && !I.enviando ? "" : " disabled") + ">Importar " + c.filas.length + "</button></div>";
    }
    abrirModal(h);
  }
  async function elegirArchivoImp(input) {
    var f = input.files && input.files[0]; if (!f || !S.imp) return;
    try {
      var r = await GPUImportar.leerArchivo(f);
      S.imp.nombre = f.name; S.imp.columnas = r.columnas; S.imp.filas = r.filas; S.imp.mapa = GPUImportar.sugerirMapa(r.columnas); S.imp.paso = 2; S.imp.error = "";
    } catch (e) { S.imp.error = e.message || "No pudimos leer el archivo."; S.imp.paso = 1; }
    pintarImportar();
  }
  async function confirmarImportar(btn) {
    var I = S.imp, c = conversionImp(); if (!c.filas.length) return;
    I.enviando = true; I.error = "";
    return conBoton(btn, async function () {
      var r = await sb.rpc("importar_unidades", { p_org: S.org.id, p_filas: c.filas, p_actualizar_estado: I.actualizarEstado });
      I.enviando = false;
      if (r.error) { I.error = mensajeError(r.error); pintarImportar(); return; }
      if (!r.data.ok) { I.error = "El servidor encontró problemas: " + r.data.errores.slice(0, 3).map(function (e) { return "fila " + e.fila + " (" + e.error + ")"; }).join("; "); pintarImportar(); return; }
      S.imp = null; cerrarModal(); await cargarInventario(true);
      toast("Importación lista: " + r.data.creadas + " nuevas y " + r.data.actualizadas + " actualizadas");
    });
  }
  function descargarTexto(nombre, texto, tipo) {
    var url = URL.createObjectURL(new Blob([texto], { type: tipo })), a = document.createElement("a");
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ------------------------------------------------------------------ Cotizador (proformas) */
  /* Una sola pantalla: cliente (buscar un lead o escribir uno nuevo) → proyecto y unidades → condiciones → resumen en vivo.
     Las cifras se ven al instante con GPUCotizar (la misma cuenta que hace el servidor al emitir). */
  function urlProforma(token, imprimir) { return location.origin + "/proforma/?t=" + token + (imprimir ? "&imprimir=1" : ""); }
  function urlFoto(path) { return path ? CFG.SUPABASE_URL + "/storage/v1/object/public/inventario/" + path : ""; }
  function soloDigitos(t) { return String(t || "").replace(/\D/g, ""); }
  function telNorm(t) { var d = soloDigitos(t); if (d.length === 10 && d[0] === "0") d = "593" + d.slice(1); return d; }
  function cfgDe(slug) { return Object.assign({}, GPUCotizar.DEFECTO, (S.cotCfg || {})[slug] || {}); }
  async function cargarCfgCot() {
    var r = await sb.from("crm_cotizador_config").select("*").eq("org_id", S.org.id);
    S.cotCfg = {}; (r.data || []).forEach(function (c) { S.cotCfg[c.proyecto] = c; });
  }
  function numCot(v) { var r = GPUImportar.numero(v); return r.vacio ? null : r.error ? NaN : r.valor; }

  /* Abre el cotizador. o: { op: id de lead, unidad: id de unidad } (ambos opcionales). */
  async function abrirCotizador(o) {
    o = o || {};
    if (!puedeEscribir()) { toast(activa() ? "Tu rol no permite hacer proformas." : "Con la suscripción vencida no se hacen proformas.", true); return; }
    abrirModal('<div class="empty">Preparando el cotizador…</div>', "grande");
    try {
      await Promise.all([S.unidades === null ? cargarInventario(true) : null, cargarCfgCot()]);
    } catch (e) { /* se reintenta al emitir */ }
    var u = o.unidad ? unidadPorId(o.unidad) : null, op = o.op ? opPorId(o.op) : null;
    var proy = (u && u.proyecto) || (op && op.proyecto && PROYECTOS[op.proyecto] ? op.proyecto : "") || S.invF.proyecto || (S.proyectos.filter(function (p) { return p.activo; })[0] || {}).slug || "";
    var cfg = cfgDe(proy);
    S.cot = { op: op ? op.id : null, nuevo: null, buscar: "", proyecto: proy, unidades: u && u.estado === "disponible" && u.precio != null ? [u.id] : [], buscarU: "",
      descModo: "monto", descuento: "", forma: "credito", entradaPct: String(cfg.entrada_pct), reserva: "", reservaTocada: false,
      cuotas: String(cfg.cuotas_entrada), tasa: String(cfg.tasa_anual), plazo: String(cfg.plazo_anios), notas: "", hecho: null };
    pintarCot();
    if (!op) { var b = $("cot-buscar"); if (b) b.focus(); }
  }
  function cotLead() { return S.cot && S.cot.op ? opPorId(S.cot.op) : null; }
  function unidadesCot() { return S.cot.unidades.map(unidadPorId).filter(Boolean); }

  /* Cifras y validación de lo que hay en pantalla. */
  function estadoCot() {
    var c = S.cot, cfg = cfgDe(c.proyecto), us = unidadesCot();
    var lista = GPUCotizar.r2(us.reduce(function (s, u) { return s + Number(u.precio || 0); }, 0));
    var dIn = numCot(c.descuento), desc = 0, err = "";
    if (dIn != null) {
      if (isNaN(dIn) || dIn < 0) err = "El descuento no es un número válido";
      else desc = GPUCotizar.r2(c.descModo === "pct" ? lista * dIn / 100 : dIn);
    }
    var maxDesc = GPUCotizar.r2(lista * Number(cfg.descuento_max_pct) / 100);
    if (!err && lista && desc >= lista) err = "El descuento no puede ser el precio completo";
    if (!err && S.rol === "agente" && desc > maxDesc) err = "Tu descuento máximo es " + fmtNum(cfg.descuento_max_pct) + " % (" + dinero2(maxDesc) + ")";
    var ent = numCot(c.entradaPct), cuotas = numCot(c.cuotas), tasa = numCot(c.tasa), plazo = numCot(c.plazo);
    if (!err && (ent == null || isNaN(ent) || ent < 0 || ent > 100)) err = "La entrada va de 0 % a 100 %";
    if (!err && (cuotas == null || isNaN(cuotas) || cuotas < 0 || cuotas > 120 || cuotas % 1)) err = "Las cuotas de la entrada van de 0 a 120";
    if (!err && c.forma === "credito" && (tasa == null || isNaN(tasa) || tasa < 0 || tasa > 30)) err = "La tasa va de 0 % a 30 %";
    if (!err && c.forma === "credito" && (plazo == null || isNaN(plazo) || plazo < 1 || plazo > 30 || plazo % 1)) err = "El plazo va de 1 a 30 años";
    var sugerida = GPUCotizar.reservaSugerida(cfg, GPUCotizar.r2(lista - desc));
    var res = c.reservaTocada ? numCot(c.reserva) : sugerida;
    if (!err && (res == null || isNaN(res) || res < 0)) err = "La reserva no es un número válido";
    var k = lista ? GPUCotizar.calcular({ precioLista: lista, descuento: desc, forma: c.forma, entradaPct: ent || 0, reserva: res || 0, cuotas: cuotas || 0, tasa: tasa || 0, plazo: plazo || 1 }) : null;
    var falta = "";
    if (!cotLead() && !c.nuevo) falta = "Elige o escribe el cliente";
    else if (c.nuevo && (c.nuevo.nombre.trim().length < 2)) falta = "Escribe el nombre del cliente";
    else if (c.nuevo && soloDigitos(c.nuevo.telefono).length < 9) falta = "Escribe el teléfono del cliente";
    else if (!us.length) falta = "Elige al menos una unidad";
    return { cfg: cfg, us: us, lista: lista, desc: desc, maxDesc: maxDesc, sugerida: sugerida, reserva: res, ent: ent, cuotas: cuotas, tasa: tasa, plazo: plazo, k: k, error: err, falta: falta || err };
  }

  function pintarCot() {
    var c = S.cot; if (!c) return;
    if (c.hecho) return pintarCotHecho();
    var h = '<div class="cot-cab"><h2>Nueva proforma</h2><button class="icon-btn" data-action="cerrar-modal" aria-label="Cerrar">' + icon("x") + "</button></div>" +
      '<section class="cot-sec" id="cot-cliente"></section><section class="cot-sec" id="cot-unidades"></section>' +
      '<section class="cot-sec" id="cot-condiciones"></section><section class="cot-sec" id="cot-resumen" aria-live="polite"></section>' +
      '<label class="fld cot-sec"><span>Nota para el cliente (opcional)</span><textarea id="cot-notas" maxlength="1000" placeholder="Ej. Incluye cocina equipada. Visita agendada para el sábado.">' + esc(c.notas) + "</textarea></label>" +
      '<div class="cot-pie" id="cot-pie"></div>';
    abrirModal(h, "grande");
    pintarCotCliente(); pintarCotUnidades(); pintarCotCondiciones(); pintarCotResumen();
  }

  function pintarCotCliente() {
    var c = S.cot, el = $("cot-cliente"); if (!el) return;
    var op = cotLead(), h = '<h3><span class="paso">1</span> Cliente</h3>';
    if (op) {
      var k = op.contacto || {}, tomar = !op.asignado_a && S.rol === "agente";
      h += '<div class="cot-elegido"><div><b>' + esc(k.nombre || "Lead") + '</b><small class="muted">' + esc([k.telefono, k.correo].filter(Boolean).join(" · ") || "Sin teléfono ni correo") + "</small>" +
        '<small class="muted">' + esc(proyTxt(op.proyecto)) + " · " + esc(etapaTxt(op.etapa)) + (op.asignado_a && op.asignado_a !== S.email ? " · " + esc(nombreDe(op.asignado_a)) : "") + "</small>" +
        (tomar ? '<small class="cot-aviso">Este lead no tiene asesor: al emitir la proforma pasará a ser tuyo.</small>' : "") +
        '</div><button class="btn btn-sm" data-action="cot-cambiar">Cambiar</button></div>';
    } else if (c.nuevo) {
      h += '<div class="form2"><label class="fld"><span>Nombre del cliente *</span><input id="cot-n-nombre" value="' + esc(c.nuevo.nombre) + '" maxlength="120" autocomplete="off"></label>' +
        '<label class="fld"><span>Teléfono / WhatsApp *</span><input id="cot-n-telefono" type="tel" inputmode="tel" value="' + esc(c.nuevo.telefono) + '" placeholder="09XXXXXXXX" autocomplete="off"></label></div>' +
        '<label class="fld"><span>Correo (opcional)</span><input id="cot-n-correo" type="email" value="' + esc(c.nuevo.correo) + '" autocomplete="off"></label>' +
        '<div id="cot-dup"></div><p class="muted" style="margin:0"><small>Se guarda como lead tuyo en el CRM. Si ya existe alguien con ese teléfono o correo, se usa su ficha (no se duplica).</small></p>' +
        '<button type="button" class="link-btn" data-action="cot-buscar-existente">← Buscar un cliente que ya está en el CRM</button>';
    } else {
      h += '<div class="cot-buscador"><input type="search" id="cot-buscar" value="' + esc(c.buscar) + '" placeholder="Busca por nombre, teléfono o correo" autocomplete="off" aria-label="Buscar cliente" aria-controls="cot-resultados"></div>' +
        '<div id="cot-resultados" class="cot-resultados" role="listbox" aria-label="Clientes"></div>' +
        '<button type="button" class="btn btn-sm" data-action="cot-nuevo">' + icon("plus", "icon-sm") + " Cliente nuevo</button>";
    }
    el.innerHTML = h;
    if (!op && !c.nuevo) pintarCotResultados();
    if (c.nuevo) pintarCotDuplicado();
  }
  function buscarLeads(q) {
    var t = norm(q).trim(), d = soloDigitos(q);
    var lista = S.ops.filter(function (o) {
      if (!t) return true;
      var k = o.contacto || {};
      return norm(k.nombre).indexOf(t) >= 0 || (d.length >= 4 && (soloDigitos(k.telefono).indexOf(d) >= 0 || String(k.telefono_norm || "").indexOf(d) >= 0)) || (t.indexOf("@") >= 0 || t.length >= 3) && norm(k.correo).indexOf(t) >= 0;
    });
    return lista.sort(function (a, b) { return abierta(b) - abierta(a) || ms(b.updated_at) - ms(a.updated_at); }).slice(0, 6);
  }
  function pintarCotResultados() {
    var el = $("cot-resultados"); if (!el) return;
    var q = S.cot.buscar, r = buscarLeads(q);
    if (!S.ops.length && !q) { el.innerHTML = '<p class="muted" style="margin:0">Aún no tienes leads. Escribe los datos de un cliente nuevo.</p>'; return; }
    el.innerHTML = (q ? "" : '<small class="muted">Recientes</small>') + r.map(function (o) {
      var k = o.contacto || {};
      return '<button type="button" class="cot-res" role="option" data-action="cot-lead" data-id="' + esc(o.id) + '"><b>' + esc(k.nombre || "Lead") + "</b><small>" +
        esc([k.telefono, proyTxt(o.proyecto), etapaTxt(o.etapa)].filter(Boolean).join(" · ")) + "</small></button>";
    }).join("") + (q && !r.length ? '<p class="muted" style="margin:0">Nadie coincide con «' + esc(q) + '». <button type="button" class="link-btn" data-action="cot-nuevo">Crear cliente nuevo con estos datos</button></p>' : "");
  }
  function pintarCotDuplicado() {
    var el = $("cot-dup"), n = S.cot.nuevo; if (!el || !n) return;
    var tel = telNorm(n.telefono), cor = norm(n.correo).trim();
    var ya = S.ops.filter(function (o) {
      var k = o.contacto || {};
      return (tel.length >= 9 && (k.telefono_norm === tel || telNorm(k.telefono) === tel)) || (cor.indexOf("@") > 0 && norm(k.correo) === cor);
    })[0];
    el.innerHTML = ya ? '<div class="cot-dup">Ya tienes a <b>' + esc((ya.contacto || {}).nombre) + "</b> con " + (tel && (ya.contacto || {}).telefono_norm === tel ? "este teléfono" : "este correo") +
      ' (' + esc(proyTxt(ya.proyecto)) + ' · ' + esc(etapaTxt(ya.etapa)) + ').<button type="button" class="btn btn-sm" data-action="cot-lead" data-id="' + esc(ya.id) + '">Usar su ficha</button></div>' : "";
  }

  function pintarCotUnidades() {
    var c = S.cot, el = $("cot-unidades"); if (!el) return;
    var proys = S.proyectos.filter(function (p) { return p.activo || p.slug === c.proyecto; });
    var h = '<h3><span class="paso">2</span> Proyecto y unidades</h3>';
    if (!proys.length) { el.innerHTML = h + '<div class="empty">Primero crea un proyecto y carga su inventario.</div>'; return; }
    if (proys.length > 1) h += '<label class="fld"><span>Proyecto</span><select id="cot-proyecto">' + proys.map(function (p) { return '<option value="' + esc(p.slug) + '"' + (p.slug === c.proyecto ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join("") + "</select></label>";
    var sel = unidadesCot();
    if (sel.length) {
      h += '<div class="cot-sel">' + sel.map(function (u) {
        return '<span class="cot-chip"><b>' + esc(u.codigo) + "</b> " + esc(TIPOS_UNIDAD[u.tipo] || "") + " · " + esc(precioTxt(u.precio)) +
          '<button type="button" data-action="cot-quitar-u" data-id="' + esc(u.id) + '" aria-label="Quitar ' + esc(u.codigo) + '">' + icon("x", "icon-sm") + "</button></span>";
      }).join("") + "</div>";
    }
    var disp = (S.unidades || []).filter(function (u) { return u.proyecto === c.proyecto && u.estado === "disponible" && c.unidades.indexOf(u.id) < 0; });
    var q = norm(c.buscarU).trim();
    var vis = disp.filter(function (u) { return !q || norm([u.codigo, u.bloque, u.piso, TIPOS_UNIDAD[u.tipo]].join(" ")).indexOf(q) >= 0; });
    if (!disp.length && !sel.length) {
      h += '<div class="empty">No hay unidades disponibles en este proyecto.' + (esGestor() ? " Cárgalas en <b>Inventario</b>." : "") + "</div>";
    } else if (disp.length) {
      h += '<input type="search" id="cot-buscar-u" class="cot-input" value="' + esc(c.buscarU) + '" placeholder="' + (sel.length ? "Agregar otra unidad (parqueo, bodega…)" : "Busca la unidad por código, torre o piso") + '" autocomplete="off" aria-label="Buscar unidad">' +
        '<div class="cot-unis">' + vis.slice(0, 24).map(function (u) {
          var sinPrecio = u.precio == null;
          return '<button type="button" class="cot-uni" data-action="cot-agregar-u" data-id="' + esc(u.id) + '"' + (sinPrecio ? ' disabled title="Sin precio en el inventario"' : "") + ">" +
            (u.fotos && u.fotos[0] ? '<img src="' + esc(urlFoto(u.fotos[0])) + '" alt="" loading="lazy">' : "") +
            "<b>" + esc(u.codigo) + "</b><small>" + esc([TIPOS_UNIDAD[u.tipo], u.piso ? "Piso " + u.piso : "", u.area_m2 != null ? fmtNum(u.area_m2) + " m²" : "", u.dormitorios != null ? u.dormitorios + " dorm." : ""].filter(Boolean).join(" · ")) + "</small>" +
            "<span>" + (sinPrecio ? "Sin precio" : esc(precioTxt(u.precio))) + "</span></button>";
        }).join("") + (vis.length > 24 ? '<p class="muted" style="margin:0"><small>Escribe para ver más (' + vis.length + " disponibles).</small></p>" : "") +
        (!vis.length ? '<p class="muted" style="margin:0">Ninguna unidad disponible coincide.</p>' : "") + "</div>";
    }
    el.innerHTML = h;
  }

  function pintarCotCondiciones() {
    var c = S.cot, el = $("cot-condiciones"); if (!el) return;
    var e = estadoCot(), cfg = e.cfg;
    var h = '<h3><span class="paso">3</span> Precio y forma de pago</h3>' +
      '<div class="seg" role="group" aria-label="Forma de pago" style="margin-bottom:10px"><button type="button" class="' + (c.forma === "credito" ? "on" : "") + '" aria-pressed="' + (c.forma === "credito") + '" data-action="cot-forma" data-f="credito">Crédito hipotecario</button>' +
      '<button type="button" class="' + (c.forma === "contado" ? "on" : "") + '" aria-pressed="' + (c.forma === "contado") + '" data-action="cot-forma" data-f="contado">Contado</button></div>' +
      '<div class="form2"><label class="fld"><span>Descuento</span><span class="cot-desc"><input id="cot-descuento" inputmode="decimal" value="' + esc(c.descuento) + '" placeholder="0" autocomplete="off">' +
      '<button type="button" class="cot-unidad" data-action="cot-desc-modo" aria-label="Cambiar entre monto y porcentaje">' + (c.descModo === "pct" ? "%" : "$") + "</button></span>" +
      '<small class="muted" id="cot-desc-ayuda">' + (S.rol === "agente" ? "Máximo para ti: " + fmtNum(cfg.descuento_max_pct) + " %" + (e.lista ? " (" + esc(dinero2(e.maxDesc)) + ")" : "") : "Sin tope para administradores") + "</small></label>" +
      '<label class="fld"><span>Entrada (%)</span><input id="cot-entrada" inputmode="decimal" value="' + esc(c.entradaPct) + '"></label></div>' +
      '<div class="form2"><label class="fld"><span>Reserva ($)</span><input id="cot-reserva" inputmode="decimal" value="' + esc(c.reservaTocada ? c.reserva : String(e.sugerida || "").replace(".", ",")) + '">' +
      '<small class="muted">' + (cfg.reserva_tipo === "monto" ? "Sugerida: " + esc(dinero2(cfg.reserva_valor)) : "Sugerida: " + fmtNum(cfg.reserva_valor) + " % del precio") + "</small></label>" +
      '<label class="fld"><span>Cuotas de la entrada</span><input id="cot-cuotas" inputmode="numeric" value="' + esc(c.cuotas) + '"><small class="muted">0 = el saldo de la entrada se paga a la firma</small></label></div>' +
      (c.forma === "credito" ? '<div class="form2"><label class="fld"><span>Tasa anual (%)</span><input id="cot-tasa" inputmode="decimal" value="' + esc(c.tasa) + '"></label>' +
        '<label class="fld"><span>Plazo (años)</span><input id="cot-plazo" inputmode="numeric" value="' + esc(c.plazo) + '"></label></div>' : "");
    el.innerHTML = h;
  }

  function pintarCotResumen() {
    var el = $("cot-resumen"), pie = $("cot-pie"); if (!el || !pie) return;
    var c = S.cot, e = estadoCot(), k = e.k;
    if (!k) el.innerHTML = '<h3><span class="paso">4</span> Resumen</h3><p class="muted" style="margin:0">Elige las unidades para ver el precio y la cuota.</p>';
    else {
      var resto = GPUCotizar.r2(k.entrada - k.reserva), l = function (a, b, cls) { return '<div class="cot-l' + (cls ? " " + cls : "") + '"><span>' + a + "</span><b>" + b + "</b></div>"; };
      el.innerHTML = '<h3><span class="paso">4</span> Resumen</h3><div class="cot-res-box">' +
        (e.desc ? l("Precio de lista", esc(dinero2(e.lista))) + l("Descuento", "− " + esc(dinero2(e.desc))) : "") +
        l("Precio final", esc(dinero2(k.precioFinal)), "fuerte") + l("Reserva", esc(dinero2(k.reserva))) +
        (resto > 0 ? l(e.cuotas > 0 ? e.cuotas + (e.cuotas === 1 ? " cuota" : " cuotas") + " de entrada de" : "Saldo de entrada a la firma", esc(dinero2(e.cuotas > 0 ? k.cuotaEntrada : resto))) : "") +
        l("Entrada total (" + fmtNum(e.ent || 0) + " %)", esc(dinero2(k.entrada))) +
        l(c.forma === "credito" ? "Saldo con crédito" : "Saldo contra entrega", esc(dinero2(k.saldo))) +
        (c.forma === "credito" && k.saldo > 0 ? '<div class="cot-cuota"><span>Cuota mensual estimada<br><small>' + esc(String(e.plazo)) + " años al " + esc(fmtNum(e.tasa || 0)) + " %</small></span><b>" + esc(dinero2(k.cuotaMensual)) + "</b></div>" : "") +
        "</div>" + '<p class="muted" style="margin:6px 0 0"><small>Válida ' + esc(String(e.cfg.vigencia_dias)) + " días. La cuota es una simulación; la aprueba la entidad financiera.</small></p>";
    }
    var ri = $("cot-reserva");
    if (ri && !c.reservaTocada && document.activeElement !== ri) ri.value = String(e.sugerida || "").replace(".", ",");
    var ayuda = $("cot-desc-ayuda");
    if (ayuda && S.rol === "agente") ayuda.textContent = "Máximo para ti: " + fmtNum(e.cfg.descuento_max_pct) + " %" + (e.lista ? " (" + dinero2(e.maxDesc) + ")" : "");
    pie.innerHTML = '<div><small class="muted">' + (k ? "Precio final" : "Total") + "</small><b>" + (k ? esc(dinero2(k.precioFinal)) : "—") + "</b>" +
      (e.falta ? '<small class="cot-falta">' + esc(e.falta) + "</small>" : "") + "</div>" +
      '<button class="btn btn-primary" data-action="cot-emitir"' + (e.falta || c.enviando ? " disabled" : "") + ">Emitir proforma</button>";
  }

  async function emitirCot(btn) {
    var c = S.cot, e = estadoCot(); if (e.falta) { toast(e.falta, true); return; }
    var op = cotLead();
    var datos = { proyecto: c.proyecto, unidades: c.unidades.slice(), descuento: e.desc, forma_pago: c.forma, entrada_pct: e.ent, reserva: e.reserva,
      cuotas_entrada: e.cuotas, tasa_anual: e.tasa, plazo_anios: e.plazo, notas: ($("cot-notas") || {}).value || c.notas || "" };
    if (op) datos.oportunidad_id = op.id;
    else datos.cliente = { nombre: c.nuevo.nombre.trim(), telefono: c.nuevo.telefono.trim(), correo: c.nuevo.correo.trim() };
    c.enviando = true;
    return conBoton(btn, async function () {
      try {
        if (op && !op.asignado_a && S.rol === "agente") { var t = await sb.rpc("crm_tomar_lead", { p_op: op.id }); if (t.error) throw t.error; }
        var r = await sb.rpc("crear_cotizacion", { p_org: S.org.id, p_datos: datos }); if (r.error) throw r.error;
        c.hecho = r.data; S.cotizaciones = null;
        pintarCot(); cargar(true); if (S.det) cargarDetalle(S.det.op.id, true);
      } finally { c.enviando = false; }
    });
  }
  function mensajeProforma(q) {
    var primero = ((q.cliente_nombre || "").split(" ")[0]) || "";
    return "Hola " + primero + ", te comparto la proforma " + q.numero + " de " + proyTxt(q.proyecto) + " (" + (q.unidades || []).map(function (u) { return u.codigo; }).join(", ") + "): " +
      dinero2(q.precio_final) + (q.cuota_mensual != null ? ", con una cuota estimada de " + dinero2(q.cuota_mensual) + " al mes" : "") + ".\n" + urlProforma(q.token) + "\nCualquier duda, aquí estoy.";
  }
  function waProforma(q) {
    var t = telNorm(q.cliente_telefono);
    return (t.length >= 9 ? "https://wa.me/" + t : "https://wa.me/") + "?text=" + encodeURIComponent(mensajeProforma(q));
  }
  function pintarCotHecho() {
    var q = S.cot.hecho;
    abrirModal('<div class="cot-ok"><div class="cot-ok-icono" aria-hidden="true">✓</div><h2>Proforma ' + esc(q.numero) + " lista</h2>" +
      '<p class="muted" style="margin:0">' + esc(q.cliente_nombre) + " · " + esc(proyTxt(q.proyecto)) + "</p>" +
      '<p class="cot-ok-total">' + esc(dinero2(q.precio_final)) + (q.cuota_mensual != null ? "<small>Cuota estimada " + esc(dinero2(q.cuota_mensual)) + " al mes</small>" : "<small>De contado</small>") + "</p>" +
      '<p class="muted" style="margin:0"><small>El lead pasó a «Proforma» y la guardamos en su historial.</small></p>' +
      '<div class="cot-ok-acciones"><a class="btn btn-wa" href="' + esc(waProforma(q)) + '" target="_blank" rel="noopener">' + icon("chat") + " Enviar por WhatsApp</a>" +
      '<a class="btn" href="' + esc(urlProforma(q.token, true)) + '" target="_blank" rel="noopener">Ver y descargar PDF</a>' +
      '<button class="btn" data-action="copiar-texto" data-t="' + esc(urlProforma(q.token)) + '">' + icon("copy", "icon-sm") + " Copiar enlace</button></div>" +
      '<div class="row end"><button class="btn" data-action="cot-otra">Hacer otra para este cliente</button><button class="btn btn-primary" data-action="cerrar-modal">Listo</button></div></div>', "grande");
  }

  /* ---------------------------------------------------------- Proformas: lista y ficha */
  async function cargarCotizaciones() {
    var r = await sb.from("crm_cotizaciones").select("id,numero,proyecto,oportunidad_id,cliente_nombre,cliente_telefono,unidades,precio_final,cuota_mensual,forma_pago,estado,vigencia_hasta,created_at,token,asesor_nombre,asesor_email")
      .eq("org_id", S.org.id).order("created_at", { ascending: false }).limit(300);
    S.cotizaciones = r.data || [];
    if (S.vista === "inventario") render();
    if (S.det) pintarHoja();
  }
  function vigente(q) { return q.estado === "emitida" && new Date(q.vigencia_hasta + "T23:59:59") >= new Date(); }
  function chipCot(q) { return q.estado === "anulada" ? '<span class="chip red">Anulada</span>' : vigente(q) ? '<span class="chip green">Vigente</span>' : '<span class="chip gray">Vencida</span>'; }
  function itemCot(q, conCliente) {
    return '<button type="button" class="cot-item" data-action="cot-ver" data-id="' + esc(q.id) + '"><span class="u-top"><b>' + esc(q.numero) + "</b>" + chipCot(q) + "</span>" +
      (conCliente ? "<span>" + esc(q.cliente_nombre) + "</span>" : "") +
      '<small class="muted">' + esc((q.unidades || []).map(function (u) { return u.codigo; }).join(", ")) + " · " + esc(hace(q.created_at)) + " · " + esc(q.asesor_nombre || "") + "</small>" +
      '<span class="u-precio">' + esc(dinero2(q.precio_final)) + (q.cuota_mensual != null ? ' <small class="muted">· ' + esc(dinero2(q.cuota_mensual)) + "/mes</small>" : "") + "</span></button>";
  }
  function vistaProformas() {
    if (S.cotizaciones == null) { cargarCotizaciones(); return '<div class="empty">Cargando proformas…</div>'; }
    var q = norm(S.cotQ).trim();
    var lista = S.cotizaciones.filter(function (x) { return !q || norm([x.numero, x.cliente_nombre, (x.unidades || []).map(function (u) { return u.codigo; }).join(" ")].join(" ")).indexOf(q) >= 0; });
    var h = '<div class="inv-filtros"><input type="search" id="cot-q" placeholder="Buscar por número, cliente o unidad" value="' + esc(S.cotQ) + '" aria-label="Buscar proformas" autocomplete="off"></div>';
    if (!S.cotizaciones.length) return h + '<div class="empty"><b>Aún no hay proformas.</b><br>Crea la primera con «Nueva proforma»: busca al cliente, elige la unidad y envíasela por WhatsApp.</div>';
    if (!lista.length) return h + '<div class="empty">Ninguna proforma coincide.</div>';
    return h + '<div class="inv-lista">' + lista.map(function (x) { return itemCot(x, true); }).join("") + "</div>";
  }
  function abrirFichaCot(id) {
    var q = (S.cotizaciones || []).concat((S.det && S.det.cots) || []).filter(function (x) { return x.id === id; })[0]; if (!q) return;
    var puedeAnular = q.estado === "emitida" && activa() && (esGestor() || (S.rol === "agente" && q.asesor_email === S.email));
    abrirModal('<div class="row" style="justify-content:space-between"><h2 style="margin:0">Proforma ' + esc(q.numero) + "</h2>" + chipCot(q) + "</div>" +
      '<dl class="kv"><dt>Cliente</dt><dd>' + esc(q.cliente_nombre) + "</dd><dt>Proyecto</dt><dd>" + esc(proyTxt(q.proyecto)) + "</dd><dt>Unidades</dt><dd>" + esc((q.unidades || []).map(function (u) { return u.codigo; }).join(", ")) + "</dd>" +
      "<dt>Precio final</dt><dd>" + esc(dinero2(q.precio_final)) + "</dd>" + (q.cuota_mensual != null ? "<dt>Cuota estimada</dt><dd>" + esc(dinero2(q.cuota_mensual)) + " al mes</dd>" : "<dt>Forma de pago</dt><dd>Contado</dd>") +
      "<dt>Emitida</dt><dd>" + esc(hace(q.created_at)) + " por " + esc(q.asesor_nombre || q.asesor_email || "") + "</dd><dt>Válida hasta</dt><dd>" + esc(fechaLarga(q.vigencia_hasta + "T12:00:00")) + "</dd></dl>" +
      (q.estado === "emitida" ? '<div class="cot-ok-acciones"><a class="btn btn-wa" href="' + esc(waProforma(q)) + '" target="_blank" rel="noopener">' + icon("chat") + " Reenviar por WhatsApp</a>" +
        '<a class="btn" href="' + esc(urlProforma(q.token, true)) + '" target="_blank" rel="noopener">Ver y descargar PDF</a>' +
        '<button class="btn" data-action="copiar-texto" data-t="' + esc(urlProforma(q.token)) + '">' + icon("copy", "icon-sm") + " Copiar enlace</button></div>" : "") +
      '<div class="row end">' + (opPorId(q.oportunidad_id) && !(S.det && S.det.op.id === q.oportunidad_id) ? '<button class="btn btn-sm" data-action="cot-ir-lead" data-id="' + esc(q.oportunidad_id) + '">Ir al lead</button>' : "") +
      (puedeAnular ? '<button class="btn btn-sm" data-action="cot-anular" data-id="' + esc(q.id) + '">Anular</button>' : "") + '<button class="btn" data-action="cerrar-modal">Cerrar</button></div>');
  }

  /* --------------------------------------------- Configuración del cotizador (por proyecto) */
  async function abrirConfigCot(slug) {
    await cargarCfgCot();
    var c = cfgDe(slug), p = S.proyectos.filter(function (x) { return x.slug === slug; })[0] || { nombre: slug };
    var pref = c.prefijo || slug.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase();
    function f(n, et, v, ayuda, extra) { return '<label class="fld"><span>' + et + '</span><input name="' + n + '" value="' + esc(v == null ? "" : String(v).replace(".", ",")) + '" ' + (extra || 'inputmode="decimal"') + ">" + (ayuda ? '<small class="muted">' + ayuda + "</small>" : "") + "</label>"; }
    abrirModal("<h2>Cotizador · " + esc(p.nombre) + '</h2><form class="form" id="form-cfg-cot" data-s="' + esc(slug) + '" novalidate>' +
      '<p class="muted" style="margin:0">Son los valores con los que arranca cada proforma. El asesor puede ajustarlos al cotizar (excepto el descuento máximo).</p>' +
      '<div class="form2">' + f("prefijo", "Prefijo del número", pref, "Ej. " + esc(pref) + "-0001", 'maxlength="6" autocapitalize="characters"') + f("vigencia_dias", "Vigencia (días)", c.vigencia_dias, "", 'inputmode="numeric"') + "</div>" +
      '<div class="form2">' + f("entrada_pct", "Entrada (%)", c.entrada_pct, "Incluye la reserva") + f("cuotas_entrada", "Cuotas de la entrada", c.cuotas_entrada, "0 = a la firma", 'inputmode="numeric"') + "</div>" +
      '<div class="form2"><label class="fld"><span>Reserva</span><select name="reserva_tipo"><option value="porcentaje"' + (c.reserva_tipo === "porcentaje" ? " selected" : "") + '>Porcentaje del precio</option><option value="monto"' + (c.reserva_tipo === "monto" ? " selected" : "") + ">Monto fijo</option></select></label>" +
      f("reserva_valor", "Valor de la reserva", c.reserva_valor, "En % o en $ según lo elegido") + "</div>" +
      '<div class="form2">' + f("tasa_anual", "Tasa del crédito (% anual)", c.tasa_anual) + f("plazo_anios", "Plazo del crédito (años)", c.plazo_anios, "", 'inputmode="numeric"') + "</div>" +
      '<div class="form2">' + f("descuento_max_pct", "Descuento máximo de un agente (%)", c.descuento_max_pct, "Los administradores no tienen tope") + f("whatsapp", "WhatsApp del proyecto (opcional)", c.whatsapp, "El cliente lo ve en su proforma", 'inputmode="tel"') + "</div>" +
      '<label class="fld"><span>Condiciones (salen al pie de la proforma)</span><textarea name="condiciones" maxlength="1500" placeholder="Ej. Precios sujetos a cambio sin previo aviso. La reserva no es reembolsable.">' + esc(c.condiciones || "") + "</textarea></label>" +
      '<div class="row end"><button type="button" class="btn" data-action="cerrar-modal">Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></div></form>');
  }
  async function guardarConfigCot(f, btn) {
    var fd = new FormData(f), d = { prefijo: String(fd.get("prefijo") || "").trim().toUpperCase(), reserva_tipo: fd.get("reserva_tipo"), whatsapp: fd.get("whatsapp"), condiciones: fd.get("condiciones") }, malo = "";
    [["vigencia_dias", "La vigencia"], ["entrada_pct", "La entrada"], ["cuotas_entrada", "Las cuotas"], ["reserva_valor", "La reserva"], ["tasa_anual", "La tasa"], ["plazo_anios", "El plazo"], ["descuento_max_pct", "El descuento máximo"]].forEach(function (p) {
      var v = numCot(fd.get(p[0])); if (v == null || isNaN(v)) malo = malo || p[1] + " no es un número válido."; else d[p[0]] = v;
    });
    if (!/^[A-Z0-9]{1,6}$/.test(d.prefijo)) malo = malo || "El prefijo usa de 1 a 6 letras o números, sin espacios.";
    if (malo) { toast(malo, true); return; }
    return conBoton(btn, async function () {
      var r = await sb.rpc("guardar_config_cotizador", { p_org: S.org.id, p_proyecto: f.dataset.s, p_datos: d }); if (r.error) throw r.error;
      (S.cotCfg = S.cotCfg || {})[f.dataset.s] = r.data; cerrarModal(); toast("Cotizador guardado");
    });
  }

  /* ------------------------------------------------------------ Fotos de una unidad */
  /* Se achican en el teléfono (máx. 1600 px, JPG) antes de subir: suben rápido y pesan poco en la web. */
  function achicarFoto(file) {
    return new Promise(function (ok, mal) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { b ? ok(b) : mal(new Error("No pudimos procesar la foto")); }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); mal(new Error("Esa imagen no se puede abrir")); };
      img.src = url;
    });
  }
  async function subirFotos(input) {
    var id = input.dataset.id, u = unidadPorId(id), files = [].slice.call(input.files || []); if (!u || !files.length) return;
    var actuales = (u.fotos || []).slice(), cupo = 8 - actuales.length;
    if (cupo <= 0) { toast("Ya tiene 8 fotos. Quita alguna para agregar otras.", true); return; }
    var malas = files.filter(function (f) { return !/^image\/(jpeg|png|webp)$/.test(f.type); });
    if (malas.length) { toast("Solo fotos JPG, PNG o WebP.", true); input.value = ""; return; }
    if (files.length > cupo) toast("Solo caben " + cupo + " fotos más; subimos las primeras.");
    var cont = $("u-fotos"); if (cont) cont.insertAdjacentHTML("beforeend", '<span class="u-subiendo"><span class="spin dark"></span> Subiendo…</span>');
    try {
      var nuevas = [];
      for (var i = 0; i < Math.min(files.length, cupo); i++) {
        var blob = await achicarFoto(files[i]);
        if (blob.size > 3 * 1024 * 1024) throw new Error("Una foto sigue pesando más de 3 MB después de achicarla.");
        var ruta = S.org.id + "/" + u.id + "/" + Date.now() + "-" + i + ".jpg";
        var up = await sb.storage.from("inventario").upload(ruta, blob, { contentType: "image/jpeg", upsert: false }); if (up.error) throw up.error;
        nuevas.push(ruta);
      }
      var r = await sb.rpc("guardar_fotos_unidad", { p_unidad: u.id, p_fotos: actuales.concat(nuevas) }); if (r.error) throw r.error;
      u.fotos = r.data || actuales.concat(nuevas); toast(nuevas.length === 1 ? "Foto agregada" : nuevas.length + " fotos agregadas");
      abrirUnidad(u.id); render();
    } catch (e) { toast(mensajeError(e), true); abrirUnidad(u.id); }
  }
  async function ordenarFotos(el, quitar) {
    var u = unidadPorId(el.dataset.id), f = el.dataset.f; if (!u) return;
    var lista = (u.fotos || []).filter(function (x) { return x !== f; });
    if (!quitar) lista.unshift(f);
    return conBoton(el, async function () {
      var r = await sb.rpc("guardar_fotos_unidad", { p_unidad: u.id, p_fotos: lista }); if (r.error) throw r.error;
      u.fotos = r.data || lista;
      if (quitar) sb.storage.from("inventario").remove([f]).then(function () {}, function () {});
      toast(quitar ? "Foto quitada" : "Portada actualizada"); abrirUnidad(u.id); render();
    });
  }

  /* ------------------------------------------------- Marca de la empresa (logo, colores, tema) */
  var PRESETS = ["#F2582B", "#1E4FD8", "#0F8A5F", "#7A1F3D", "#C9A227", "#161616"];
  var EXT_IMG = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  function urlMarca(path) { return path ? CFG.SUPABASE_URL + "/storage/v1/object/public/marcas/" + path : ""; }
  function marcaNombre() { return (S.marca && S.marca.nombre_comercial) || S.org.nombre; }
  function pieGPU(m) {
    return m && m.mostrar_pie_gpunlock === false ? "" : '<p class="muted pie-gpu" style="margin:10px 0 0;text-align:center"><small>Con la tecnología de <a href="https://gpunlock.netlify.app" target="_blank" rel="noopener">GPUnlock</a></small></p>';
  }
  /* Aplica la marca de la empresa: colores del tema, logo y nombre en la barra, título de la pestaña. */
  function aplicarMarcaEmpresa(m) {
    S.marca = m || null;
    GPUTema.aplicarMarca(S.marca, S.org && S.org.id);
    var img = document.querySelector("#brand-mark img");
    if (img) img.src = S.marca && S.marca.logo_path ? urlMarca(S.marca.logo_path) : "/assets/brand/gp-mark.png";
    $("brand-nombre").textContent = marcaNombre();
    document.title = marcaNombre() + " · CRM";
  }
  function iniciarDraft() {
    var m = S.marca || {};
    S.mDraft = { org: S.org.id, color: m.color_primario || PRESETS[0], acento: m.color_acento || "", logo: m.logo_path || null, logoOscuro: m.logo_oscuro_path || null,
      archivoLogo: null, archivoOscuro: null, urlLogo: "", urlOscuro: "", sugeridos: [] };
  }
  function ajMarca() {
    if (!S.mDraft || S.mDraft.org !== S.org.id) iniciarDraft();
    var d = S.mDraft, m = S.marca || {}, agencia = !!(S.uso && S.uso.plan && S.uso.plan.id === "agencia");
    function logoLinea(id, etiqueta, ayuda, url, quitar) {
      return '<div class="fld"><span>' + etiqueta + '</span><div class="file-line">' + (url ? '<img src="' + esc(url) + '" alt="Vista previa" id="' + id + '-img">' : "") +
        '<input type="file" id="' + id + '" accept="image/png,image/jpeg,image/webp">' + (url ? '<button type="button" class="link-btn" data-action="' + quitar + '">Quitar</button>' : "") + "</div><small class=\"muted\">" + ayuda + "</small></div>";
    }
    var urlLogo = d.urlLogo || urlMarca(d.logo), urlOsc = d.urlOscuro || urlMarca(d.logoOscuro);
    var presets = PRESETS.map(function (c) {
      return '<button type="button" style="--sw:' + c + '" data-action="marca-color" data-c="' + c + '" aria-pressed="' + (d.color.toUpperCase() === c) + '" aria-label="Color ' + c + '"></button>';
    }).join("");
    var sug = d.sugeridos.map(function (c) { return '<button type="button" style="--sw:' + c + '" data-action="marca-color" data-c="' + c + '" aria-pressed="' + (d.color.toUpperCase() === c) + '" aria-label="Color del logo ' + c + '"></button>'; }).join("");
    return '<form class="card form" id="form-marca" novalidate><h3>Marca de tu empresa</h3>' +
      '<p class="muted" style="margin:0">Sube tu logo y elige tu color: tu equipo verá la app con tu marca al instante, en modo claro y oscuro.</p>' +
      '<label class="fld"><span>Nombre comercial</span><input name="nombre" value="' + esc(m.nombre_comercial || "") + '" maxlength="60" placeholder="' + esc(S.org.nombre) + '"></label>' +
      '<label class="fld"><span>Dirección corta de acceso (opcional)</span><input name="subdominio" id="m-sub" value="' + esc(m.subdominio || "") + '" maxlength="40" placeholder="miinmobiliaria" autocapitalize="none" autocomplete="off">' +
      '<small class="muted" id="m-sub-ayuda">' + (m.subdominio ? "Tu equipo y tus clientes entran por " + esc(location.origin) + "/app/?e=" + esc(m.subdominio) : "Con ella, la pantalla de entrada muestra tu logo y tus colores.") + "</small></label>" +
      logoLinea("m-logo", "Logo (PNG, JPG o WebP, hasta 1 MB)", "Mejor con fondo transparente y horizontal.", urlLogo, "marca-logo-quitar") +
      logoLinea("m-logo-oscuro", "Logo para fondo oscuro (opcional)", "Se usa en la pantalla de entrada cuando el equipo prefiere el modo oscuro.", urlOsc, "marca-oscuro-quitar") +
      '<div class="fld"><span id="lbl-color">Color de tu marca</span><div class="swatches" role="group" aria-labelledby="lbl-color">' + presets +
      '<input type="color" id="m-color" value="' + esc(d.color.toLowerCase()) + '" aria-label="Elegir otro color" style="width:44px;height:40px;padding:2px;border-radius:12px"></div>' +
      '<div class="swatches" id="m-sug" style="margin-top:6px"' + (sug ? "" : " hidden") + '><small class="muted">Colores de tu logo:</small>' + sug + '</div>' +
      '<small id="m-contraste" aria-live="polite" class="muted"></small></div>' +
      '<div class="fld"><span>Color de acento (opcional)</span><div class="row"><input type="color" id="m-acento" value="' + esc((d.acento || "#F0C330").toLowerCase()) + '" aria-label="Color de acento" style="width:44px;height:40px;padding:2px;border-radius:12px">' +
      '<button type="button" class="link-btn" data-action="marca-acento-quitar">' + (d.acento ? "Usar el automático" : "Automático (recomendado)") + '</button></div></div>' +
      '<label class="row" style="gap:8px"><input type="checkbox" name="pie"' + (m.mostrar_pie_gpunlock === false ? "" : " checked") + (agencia ? "" : " disabled") + '> <span>Mostrar «Con la tecnología de GPUnlock»</span></label>' +
      (agencia ? "" : '<small class="muted" style="margin-top:-6px">Quitarlo es parte del plan Agencia.</small>') +
      '<div class="fld"><span>Así se verá</span><div class="marca-prev" id="m-prev"><div class="pv-top"><span class="brand-mark"><img id="pv-logo" src="' + esc(urlLogo || "/assets/brand/gp-mark.png") + '" alt=""></span><span id="pv-nombre">' + esc(marcaNombre()) + '</span></div>' +
      '<div class="pv-body"><div class="row"><button type="button" class="btn btn-primary btn-sm" tabindex="-1">Llamar</button><span class="chip">Caliente</span><a href="#" tabindex="-1" data-action="nada">Ver ficha</a></div>' +
      '<div class="banner" style="margin:0"><span>Aviso de ejemplo con tu color.</span></div></div></div></div>' +
      '<div class="row"><button class="btn btn-primary" type="submit"' + (activa() ? "" : " disabled") + '>Guardar marca</button><button type="button" class="link-btn" data-action="marca-restablecer">Volver a los colores de GPUnlock</button></div>' +
      (activa() ? "" : '<p class="muted" style="margin:0"><small>Con la suscripción vencida no se puede cambiar la marca.</small></p>') + "</form>";
  }
  /* Vista previa y aviso de contraste, calculados con el mismo motor que usa toda la app. */
  function pintarPreviewMarca() {
    var d = S.mDraft, pv = $("m-prev"); if (!d || !pv) return;
    var modo = GPUTema.modoEfectivo(), p = GPUTema.paleta(d.color, d.acento || null, modo);
    GPUTema.VARS.forEach(function (v) { pv.style.setProperty(v, p.vars[v]); });
    var nom = document.querySelector('#form-marca [name="nombre"]'); $("pv-nombre").textContent = (nom && nom.value.trim()) || S.org.nombre;
    var c = $("m-contraste");
    if (c) c.textContent = "Texto " + (p.textoSobreFondo === "#FFFFFF" ? "blanco" : "negro") + " sobre tu color: " + p.contrasteBoton.toFixed(1).replace(".", ",") + ":1 (AA " + (p.contrasteBoton >= 4.5 ? "✓" : "✗") + ")." +
      (p.ajustado ? " Ajustamos un poco el tono para que se lea bien." : "");
    document.querySelectorAll('#form-marca [data-action="marca-color"]').forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.c.toUpperCase() === d.color.toUpperCase())); });
  }
  function sugerirColores(file) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      try {
        var k = Math.min(64 / img.width, 64 / img.height, 1), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
        S.mDraft.sugeridos = GPUTema.coloresDeImagen(cx.getImageData(0, 0, w, h).data);
      } catch (e) { S.mDraft.sugeridos = []; }
      URL.revokeObjectURL(url);
      if (S.mDraft.sugeridos.length) { S.mDraft.color = S.mDraft.sugeridos[0]; toast("Tomamos el color de tu logo. Puedes cambiarlo."); }
      render();
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }
  function elegirLogo(input, oscuro) {
    var f = input.files && input.files[0]; if (!f) return;
    if (!EXT_IMG[f.type]) { input.value = ""; toast("El logo debe ser PNG, JPG o WebP.", true); return; }
    if (f.size > 1024 * 1024) { input.value = ""; toast("El logo pesa más de 1 MB. Reduce su tamaño y vuelve a subirlo.", true); return; }
    var d = S.mDraft;
    if (oscuro) { d.archivoOscuro = f; d.urlOscuro = URL.createObjectURL(f); render(); }
    else { d.archivoLogo = f; d.urlLogo = URL.createObjectURL(f); sugerirColores(f); }
  }
  async function guardarMarca(f, btn) {
    var d = S.mDraft, org = S.org.id, fd = Object.fromEntries(new FormData(f).entries());
    var agencia = !!(S.uso && S.uso.plan && S.uso.plan.id === "agencia");
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) { toast("Elige un color válido.", true); return; }
    return conBoton(btn, async function () {
      async function subir(file, prefijo) {
        var ruta = org + "/" + prefijo + "-" + Date.now() + "." + EXT_IMG[file.type];
        var up = await sb.storage.from("marcas").upload(ruta, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
        return ruta;
      }
      var antes = S.marca || {}, logo = d.logo, oscuro = d.logoOscuro;
      if (d.archivoLogo) logo = await subir(d.archivoLogo, "logo");
      if (d.archivoOscuro) oscuro = await subir(d.archivoOscuro, "logo-oscuro");
      var r = await sb.rpc("guardar_marca", { p_org: org, p_nombre: (fd.nombre || "").trim() || null, p_subdominio: (fd.subdominio || "").trim() || null,
        p_color: d.color.toUpperCase(), p_acento: d.acento ? d.acento.toUpperCase() : null, p_logo: logo || null, p_logo_oscuro: oscuro || null, p_ocultar_pie: agencia && !fd.pie });
      if (r.error) throw r.error;
      var viejos = [antes.logo_path !== logo ? antes.logo_path : null, antes.logo_oscuro_path !== oscuro ? antes.logo_oscuro_path : null].filter(Boolean);
      if (viejos.length) sb.storage.from("marcas").remove(viejos).then(function () {}, function () {});   // limpieza; si falla no importa
      S.mDraft = null; aplicarMarcaEmpresa(r.data); render();
      toast("Marca guardada. Tu equipo la verá al instante.");
    });
  }

  function ajEmpresa() {
    return '<form class="card form" id="form-empresa"><label class="fld"><span>Nombre de la inmobiliaria</span><input name="nombre" value="' + esc(S.org.nombre) + '" required maxlength="80"' + (esGestor() ? "" : " disabled") + "></label>" +
      '<label class="fld"><span>Reparto de leads nuevos</span><select name="reparto"' + (esGestor() ? "" : " disabled") + '><option value="ninguno"' + (S.org.reparto === "ninguno" ? " selected" : "") + '>Sin reparto: los agentes toman los leads</option><option value="rotativo"' + (S.org.reparto === "rotativo" ? " selected" : "") + ">Automático: al agente con menos leads abiertos</option></select></label>" +
      (esGestor() ? '<button class="btn btn-primary" type="submit"' + (activa() ? "" : " disabled") + ">Guardar</button>" : '<p class="muted" style="margin:0">Solo propietario y administradores pueden cambiar esto.</p>') + "</form>";
  }

  function abrirNuevaClave() {
    abrirModal('<h2>Crea tu nueva contraseña</h2><form class="form" id="form-clave"><label class="fld"><span>Nueva contraseña (mínimo 8 caracteres)</span><input type="password" name="clave" minlength="8" required autocomplete="new-password"></label><div class="row end"><button class="btn btn-primary" type="submit">Guardar contraseña</button></div></form>');
  }

  /* ----------------------------------------------------------------- dictado */
  var rec = null;
  function dictar(btn, targetId) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Tu navegador no dicta aquí. Usa el micrófono del teclado del celular.", true); return; }
    if (rec) { rec.stop(); return; }
    var ta = $(targetId); if (!ta) return;
    var base = ta.value ? ta.value.replace(/\s*$/, " ") : "";
    rec = new SR(); rec.lang = "es-EC"; rec.interimResults = true; rec.continuous = true;
    btn.classList.add("on");
    rec.onresult = function (ev) {
      var t = ""; for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      ta.value = base + t;
    };
    rec.onerror = function (ev) { if (ev.error === "not-allowed") toast("Permite el micrófono para dictar.", true); };
    rec.onend = function () { btn.classList.remove("on"); rec = null; };
    rec.start();
  }

  /* --------------------------------------------------------------- PWA / SW */
  var instalarEvento = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); instalarEvento = e; });
  window.addEventListener("appinstalled", function () { instalarEvento = null; toast("App instalada"); });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(function () {}); });
  }
  function estadoRed() { $("offline").hidden = online(); }
  window.addEventListener("online", function () { estadoRed(); if (S.user) cargar(true); });
  window.addEventListener("offline", estadoRed);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.user && online()) cargar(true); });
  window.addEventListener("popstate", function () { if (S.det && !(history.state && history.state.hoja)) cerrarHoja(true); });

  /* --------------------------------------------------- eventos (delegación) */
  var ACC = {
    "vista": function (el) { cambiarVista(el.dataset.v); },
    "abrir": function (el) { abrirHoja(el.dataset.id); },
    "cerrar-hoja": function () { cerrarHoja(); },
    "cerrar-modal": function () { cerrarModal(); },
    "sugerencia": function (el) { preguntar(el.dataset.q); },
    "ir-col": function (el) {
      var c = $("col-" + el.dataset.e); if (c) c.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    },
    "periodo": function (el) { S.metDias = +el.dataset.d; S.metricas = null; render(); },
    "tomar": function (el) {
      return conBoton(el, async function () {
        var r = await sb.rpc("crm_tomar_lead", { p_op: el.dataset.id }); if (r.error) throw r.error;
        var mio = opPorId(el.dataset.id); if (mio) mio.asignado_a = S.email;
        toast("Es tuyo. ¡A darle seguimiento!"); await cargar(true);
        if (!S.det || S.det.op.id !== el.dataset.id) abrirHoja(el.dataset.id); else cargarDetalle(el.dataset.id, true);
      });
    },
    "avanzar": function (el) {
      var o = opPorId(el.dataset.id); if (!o) return;
      var i = ETAPAS.map(function (e) { return e.id; }).indexOf(o.etapa);
      cambiarEtapa(o.id, ETAPAS[i + 1].id);
    },
    "etapa": function (el) {
      var id = S.det.op.id;
      if (el.dataset.e === "perdido") pedirMotivoPerdida(id); else cambiarEtapa(id, el.dataset.e);
    },
    "perdido-ok": function (el) {
      var motivo = $("mp-sel").value + ($("mp-txt").value.trim() ? " — " + $("mp-txt").value.trim() : "");
      cerrarModal(); cambiarEtapa(el.dataset.id, "perdido", motivo);
    },
    "tarea-hecha": function (el) {
      var id = el.dataset.id;
      return upd("crm_actividades", id, { hecha_at: new Date().toISOString() }).then(function () {
        S.tareas = S.tareas.filter(function (t) { return t.id !== id; });
        render(); if (S.det) cargarDetalle(S.det.op.id, true);
        toast("Tarea completada");
      }).catch(function (e) { el.checked = false; toast(mensajeError(e), true); });
    },
    "modo-act": function (el) {
      var m = el.dataset.m; S.modoAct = m;
      document.querySelectorAll("#seg-act button").forEach(function (b) { b.classList.toggle("on", b === el); });
      $("form-nota").hidden = m !== "nota"; $("form-tarea").hidden = m !== "tarea";
    },
    "dictar": function (el) { dictar(el, el.dataset.target); },
    "ia-resumen": function (el) {
      return conBoton(el, async function () {
        var r = await llamarIA({ accion: "resumen", oportunidad_id: S.det.op.id });
        var o = opPorId(S.det.op.id) || S.det.op;
        o.ia_resumen = r.resumen; o.ia_siguiente_accion = r.siguiente_accion; o.calificacion = r.calificacion;
        o.calificacion_motivo = r.motivo; o.ia_actualizado_at = r.ia_actualizado_at;
        S.det.op = o; pintarHoja(); render();
      });
    },
    "ia-nota": function (el) {
      var txt = $("nota-texto").value.trim();
      if (txt.length < 3) { toast("Escribe o dicta la nota primero", true); return; }
      return conBoton(el, async function () {
        var r = await llamarIA({ accion: "nota", oportunidad_id: S.det.op.id, texto: txt });
        S.prop = r; pintarHoja();
      });
    },
    "prop-descartar": function () { S.prop = null; pintarHoja(); },
    "prop-guardar": function (el) {
      var p = S.prop, id = S.det.op.id;
      return conBoton(el, async function () {
        await guardarActividad(p.tipo, p.nota);
        for (var i = 0; i < p.tareas.length; i++) await guardarActividad("tarea", p.tareas[i].titulo, venceDe(p.tareas[i].dias));
        S.prop = null;
        if (p.etapa_sugerida !== "ninguna") await cambiarEtapa(id, p.etapa_sugerida, p.motivo_perdida || undefined);
        await cargarDetalle(id, true); cargar(true);
        toast("Nota y pendientes guardados");
      });
    },
    "ia-mensaje": function () { abrirMensaje(); },
    "canal": function (el) {
      abrirMensaje.canal = el.dataset.c;
      document.querySelectorAll("#seg-canal button").forEach(function (b) { b.classList.toggle("on", b === el); });
      $("msg-asunto").hidden = el.dataset.c !== "correo";
      $("msg-enviar").textContent = el.dataset.c === "correo" ? "Abrir correo" : "Abrir WhatsApp";
      $("msg-enviar").className = "btn btn-sm " + (el.dataset.c === "correo" ? "btn-primary" : "btn-wa");
      $("msg-out").hidden = true;
    },
    "msg-generar": function (el) {
      return conBoton(el, async function () {
        var r = await llamarIA({ accion: "mensaje", oportunidad_id: S.det.op.id, canal: abrirMensaje.canal, objetivo: $("msg-obj").value });
        $("msg-out").hidden = false; $("msg-texto").value = r.mensaje; $("msg-asunto").value = r.asunto || "";
        $("msg-asunto").hidden = abrirMensaje.canal !== "correo";
      });
    },
    "msg-copiar": function () {
      var t = $("msg-texto").value;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copiado"); }, function () { $("msg-texto").select(); toast("Selecciona y copia el texto", true); });
    },
    "msg-enviar": function () {
      var t = $("msg-texto").value.trim(), c = S.det.contacto, correo = abrirMensaje.canal === "correo";
      if (!t) return;
      var url = correo ? "mailto:" + encodeURIComponent(c.correo || "") + "?subject=" + encodeURIComponent($("msg-asunto").value) + "&body=" + encodeURIComponent(t) : waHref(c, t);
      if (!url) { toast("Este contacto no tiene " + (correo ? "correo" : "teléfono"), true); return; }
      window.open(url, correo ? "_self" : "_blank", "noopener");
      guardarActividad(correo ? "correo" : "whatsapp", "Mensaje enviado: " + t).then(function () { cargarDetalle(S.det.op.id, true); }).catch(function () {});
      cerrarModal();
    },
    "instalar": function () {
      if (!instalarEvento) return;
      instalarEvento.prompt(); instalarEvento.userChoice.finally(function () { instalarEvento = null; cerrarModal(); });
    },
    "aj-sec": function (el) { if (el.dataset.s !== "marca") S.mDraft = null; S.ajSec = el.dataset.s; render(); },
    "inv-sub": function (el) { S.invSub = el.dataset.s; render(); },
    "nueva-proforma": function () { abrirCotizador({}); },
    "cotizar-unidad": function (el) { abrirCotizador({ unidad: el.dataset.id }); },
    "proforma-lead": function (el) { abrirCotizador({ op: el.dataset.id }); },
    "cot-lead": function (el) { S.cot.op = el.dataset.id; S.cot.nuevo = null; var o = opPorId(el.dataset.id);
      if (o && o.proyecto && PROYECTOS[o.proyecto] && !S.cot.unidades.length && o.proyecto !== S.cot.proyecto) { S.cot.proyecto = o.proyecto; pintarCotUnidades(); }
      pintarCotCliente(); pintarCotResumen(); },
    "cot-cambiar": function () { S.cot.op = null; S.cot.buscar = ""; pintarCotCliente(); pintarCotResumen(); var b = $("cot-buscar"); if (b) b.focus(); },
    "cot-nuevo": function () {
      var q = S.cot.buscar.trim(), esTel = /^[+\d\s()-]{6,}$/.test(q), esCorreo = q.indexOf("@") > 0;
      S.cot.nuevo = { nombre: esTel || esCorreo ? "" : q, telefono: esTel ? q : "", correo: esCorreo ? q : "" }; S.cot.op = null;
      pintarCotCliente(); pintarCotResumen(); var n = $(S.cot.nuevo.nombre ? "cot-n-telefono" : "cot-n-nombre"); if (n) n.focus();
    },
    "cot-buscar-existente": function () { S.cot.nuevo = null; pintarCotCliente(); pintarCotResumen(); var b = $("cot-buscar"); if (b) b.focus(); },
    "cot-agregar-u": function (el) {
      if (S.cot.unidades.length >= 10) { toast("Máximo 10 unidades por proforma", true); return; }
      S.cot.unidades.push(el.dataset.id); S.cot.buscarU = ""; pintarCotUnidades(); pintarCotCondiciones(); pintarCotResumen();
    },
    "cot-quitar-u": function (el) { S.cot.unidades = S.cot.unidades.filter(function (x) { return x !== el.dataset.id; }); pintarCotUnidades(); pintarCotCondiciones(); pintarCotResumen(); },
    "cot-forma": function (el) { S.cot.forma = el.dataset.f; pintarCotCondiciones(); pintarCotResumen(); },
    "cot-desc-modo": function () {
      var c = S.cot, e = estadoCot(), v = numCot(c.descuento);
      if (v != null && !isNaN(v) && e.lista) c.descuento = String(c.descModo === "pct" ? GPUCotizar.r2(e.lista * v / 100) : GPUCotizar.r2(v * 100 / e.lista)).replace(".", ",");
      c.descModo = c.descModo === "pct" ? "monto" : "pct"; pintarCotCondiciones(); pintarCotResumen();
    },
    "cot-emitir": function (el) { return emitirCot(el); },
    "cot-otra": function () { var q = S.cot.hecho; abrirCotizador({ op: q.oportunidad_id }); },
    "cot-ver": function (el) { abrirFichaCot(el.dataset.id); },
    "cot-ir-lead": function (el) { cerrarModal(); abrirHoja(el.dataset.id); },
    "cot-anular": function (el) {
      abrirModal('<h2>Anular proforma</h2><form class="form" id="form-anular" data-id="' + esc(el.dataset.id) + '"><p class="muted" style="margin:0">El enlace que tiene el cliente dirá que ya no es válida. Queda en el historial del lead.</p>' +
        '<label class="fld"><span>Motivo</span><input name="motivo" required minlength="3" maxlength="300" placeholder="Ej. El cliente pidió otra unidad"></label>' +
        '<div class="row end"><button type="button" class="btn" data-action="cerrar-modal">Cancelar</button><button class="btn btn-primary" type="submit">Anular proforma</button></div></form>');
    },
    "copiar-texto": function (el) {
      var t = el.dataset.t, listo = function () { toast("Enlace copiado"); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(listo, function () { window.prompt("Copia el enlace:", t); }); else window.prompt("Copia el enlace:", t);
    },
    "cfg-cot": function (el) { abrirConfigCot(el.dataset.s); },
    "foto-portada": function (el) { return ordenarFotos(el, false); },
    "foto-quitar": function (el) { if (window.confirm("¿Quitar esta foto?")) return ordenarFotos(el, true); },
    "inv-estado": function (el) { S.invF.estado = el.dataset.e; S.invMax = 60; render(); },
    "inv-mas": function () { S.invMax += 60; render(); },
    unidad: function (el) { abrirUnidad(el.dataset.id); },
    "unidad-nueva": function () { abrirFormUnidad(null); },
    "unidad-editar": function (el) { abrirFormUnidad(el.dataset.id); },
    "unidad-eliminar": function (el) {
      if (!window.confirm("¿Eliminar la unidad «" + el.dataset.c + "»? Se borra también su historial.")) return;
      return conBoton(el, async function () {
        var r = await sb.rpc("eliminar_unidad", { p_unidad: el.dataset.id }); if (r.error) throw r.error;
        cerrarModal(); await cargarInventario(true); toast("Unidad eliminada");
      });
    },
    "unidad-estado": function (el) { return cambiarEstadoUnidad(el); },
    importar: function () { abrirImportar(); },
    "imp-otro": function () { if (S.imp) { S.imp.paso = 1; S.imp.error = ""; pintarImportar(); } },
    "imp-plantilla": function () { descargarTexto("plantilla-inventario.csv", GPUImportar.plantillaCSV((S.proyectos[0] || {}).slug), "text/csv;charset=utf-8"); },
    "imp-confirmar": function (el) { return confirmarImportar(el); },
    "proy-precios": function (el) {
      var p = S.proyectos.filter(function (x) { return x.slug === el.dataset.s; })[0], nuevo = p.precios_publicos === false;
      return conBoton(el, async function () {
        var r = await sb.from("crm_proyectos").update({ precios_publicos: nuevo }).eq("org_id", S.org.id).eq("slug", el.dataset.s); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast(nuevo ? "Los precios se muestran en tu web" : "Los precios ya no se muestran en tu web");
      });
    },
    "marca-color": function (el) { S.mDraft.color = el.dataset.c; var c = $("m-color"); if (c) c.value = el.dataset.c.toLowerCase(); pintarPreviewMarca(); },
    "marca-acento-quitar": function () { S.mDraft.acento = ""; render(); },
    "marca-logo-quitar": function () { var d = S.mDraft; d.logo = null; d.archivoLogo = null; d.urlLogo = ""; d.sugeridos = []; render(); },
    "marca-oscuro-quitar": function () { var d = S.mDraft; d.logoOscuro = null; d.archivoOscuro = null; d.urlOscuro = ""; render(); },
    "marca-restablecer": function () { var d = S.mDraft; d.color = PRESETS[0]; d.acento = ""; d.sugeridos = []; render(); toast("Colores de GPUnlock. Pulsa «Guardar marca» para aplicarlos."); },
    "modo": function (el) {
      GPUTema.fijarModo(el.dataset.m);
      document.querySelectorAll('#seg-modo button').forEach(function (b) { b.classList.toggle("on", b.dataset.m === el.dataset.m); b.setAttribute("aria-pressed", String(b.dataset.m === el.dataset.m)); });
      pintarPreviewMarca();
    },
    "ir-plan": function () { S.vista = "ajustes"; S.ajSec = "plan"; render(); window.scrollTo(0, 0); },
    "intervalo": function (el) { S.intervalo = el.dataset.i; render(); },
    "copiar": function (el) {
      var n = $(el.dataset.t); if (!n) return;
      (navigator.clipboard ? navigator.clipboard.writeText(n.textContent) : Promise.reject()).then(function () { toast("Copiado"); }, function () {
        var r = document.createRange(); r.selectNodeContents(n); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Selecciona y copia el texto", true);
      });
    },
    "cancelar-inv": function (el) {
      return conBoton(el, async function () {
        var r = await sb.rpc("cancelar_invitacion", { p_id: el.dataset.id }); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast("Invitación cancelada");
      });
    },
    "quitar": function (el) {
      var yo = el.dataset.u === S.user.id;
      if (!window.confirm(yo ? "¿Salir de " + S.org.nombre + "?" : "¿Quitar a " + el.dataset.n + " del equipo? Sus leads abiertos quedarán sin asignar.")) return;
      return conBoton(el, async function () {
        var r = await sb.rpc("quitar_miembro", { p_org: S.org.id, p_user: el.dataset.u }); if (r.error) throw r.error;
        if (yo) { try { localStorage.removeItem("crm_org"); } catch (e) { /* nada */ } location.reload(); return; }
        await cargarEmpresa(); await cargar(true); render(); toast("Persona quitada del equipo");
      });
    },
    "proy-activo": function (el) {
      var p = S.proyectos.filter(function (x) { return x.slug === el.dataset.s; })[0];
      return conBoton(el, async function () {
        var r = await sb.from("crm_proyectos").update({ activo: !p.activo }).eq("org_id", S.org.id).eq("slug", p.slug); if (r.error) throw r.error;
        await cargarEmpresa(); render();
      });
    },
    "proy-borrar": function (el) {
      if (!window.confirm("¿Eliminar el proyecto «" + el.dataset.n + "»? Los leads que ya lo tienen conservarán su nombre interno.")) return;
      return conBoton(el, async function () {
        var r = await sb.from("crm_proyectos").delete().eq("org_id", S.org.id).eq("slug", el.dataset.s);
        if (r.error) throw (r.error.code === "23503" || /foreign key/i.test(r.error.message || "") ? new Error("Este proyecto tiene unidades en el inventario. Elimínalas primero o, si ya no lo usas, ocúltalo.") : r.error);
        await cargarEmpresa(); render(); toast("Proyecto eliminado");
      });
    },
    "pagar": function (el) {
      return conBoton(el, async function () {
        var r = await sb.rpc("solicitar_pago", { p_org: S.org.id, p_plan: el.dataset.p, p_periodo: S.intervalo }); if (r.error) throw r.error;
        await cargarEmpresa(); render();
        toast("Listo. Haz la transferencia y sube tu comprobante.");
        setTimeout(function () { var n = $("pago-en-curso"); if (n) n.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
      });
    },
    "comp-enviar": function (el) {
      var f = $("comp-archivo") && $("comp-archivo").files[0];
      if (!f) { toast("Elige primero la foto o el PDF del comprobante.", true); return; }
      var EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
      if (!EXT[f.type]) { toast("El comprobante debe ser una foto (JPG, PNG o WebP) o un PDF.", true); return; }
      if (f.size > 5 * 1024 * 1024) { toast("El archivo pesa más de 5 MB. Toma la foto con menos calidad o envía un PDF.", true); return; }
      return conBoton(el, async function () {
        var ruta = S.org.id + "/" + el.dataset.id + "-" + Date.now() + "." + EXT[f.type];
        var up = await sb.storage.from("comprobantes").upload(ruta, f, { contentType: f.type, upsert: false }); if (up.error) throw up.error;
        var r = await sb.rpc("subir_comprobante", { p_solicitud: el.dataset.id, p_path: ruta }); if (r.error) throw r.error;
        await cargarEmpresa(); render();
        toast("Comprobante enviado. Lo revisamos y activamos tu plan.");
      });
    },
    "cancelar-solicitud": function (el) {
      if (!window.confirm("¿Cancelar esta solicitud de pago? Puedes pedir otra cuando quieras.")) return;
      return conBoton(el, async function () {
        var r = await sb.rpc("cancelar_solicitud", { p_solicitud: el.dataset.id }); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast("Solicitud cancelada");
      });
    },
    "salir": async function () { await sb.auth.signOut(); GPUTema.olvidarMarca(); try { localStorage.removeItem("crm_org"); } catch (e) { /* nada */ } location.reload(); }
  };

  document.addEventListener("click", function (e) {
    if (e.target.closest("a[href]") && !e.target.closest("a[data-action]")) return;
    var el = e.target.closest("[data-action]");
    if (!el || !ACC[el.dataset.action]) return;
    if (el.tagName === "BUTTON" && el.type !== "submit") e.preventDefault();
    ACC[el.dataset.action](el, e);
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); ACC[e.target.dataset.action](e.target, e); }
    if (e.key === "Escape") { if (!$("modal").hidden) cerrarModal(); else if (S.det) cerrarHoja(); }
    if (e.key === "Enter" && !e.shiftKey && e.target.id === "ia-input") { e.preventDefault(); $("ia-form").requestSubmit(); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "cot-proyecto" && S.cot) {
      var cf = cfgDe(t.value); S.cot.proyecto = t.value; S.cot.unidades = []; S.cot.buscarU = ""; S.cot.reservaTocada = false;
      S.cot.entradaPct = String(cf.entrada_pct); S.cot.cuotas = String(cf.cuotas_entrada); S.cot.tasa = String(cf.tasa_anual); S.cot.plazo = String(cf.plazo_anios);
      pintarCotUnidades(); pintarCotCondiciones(); pintarCotResumen();
    }
    else if (t.id === "u-fotos-input") { subirFotos(t); }
    else if (t.id === "inv-proyecto") { S.invF.proyecto = t.value; S.invMax = 60; render(); }
    else if (t.id === "inv-tipo") { S.invF.tipo = t.value; S.invMax = 60; render(); }
    else if (t.id === "imp-archivo") { elegirArchivoImp(t); }
    else if (t.id === "imp-proyecto" && S.imp) { S.imp.proyecto = t.value; pintarImportar(); }
    else if (t.id === "imp-estado" && S.imp) { S.imp.actualizarEstado = t.checked; }
    else if (t.dataset && t.dataset.impMap !== undefined && S.imp) { S.imp.mapa[t.dataset.impMap] = Number(t.value); pintarImportar(); }
    else if (t.id === "m-logo") { elegirLogo(t, false); }
    else if (t.id === "m-logo-oscuro") { elegirLogo(t, true); }
    else if (t.id === "m-color") { S.mDraft.color = t.value.toUpperCase(); pintarPreviewMarca(); }
    else if (t.id === "m-acento") { S.mDraft.acento = t.value.toUpperCase(); pintarPreviewMarca(); }
    else if (t.id === "f-proyecto") { S.f.proyecto = t.value; render(); }
    else if (t.id === "f-quien") { S.f.quien = t.value; render(); }
    else if (t.dataset && t.dataset.rolDe) {
      sb.rpc("cambiar_rol", { p_org: S.org.id, p_user: t.dataset.rolDe, p_rol: t.value }).then(function (r) {
        if (r.error) throw r.error;
        return cargarEmpresa();
      }).then(function () { render(); toast("Rol actualizado"); }).catch(function (er) { toast(mensajeError(er), true); cargarEmpresa().then(render); });
    } else if (t.id === "asignar") {
      var id = S.det.op.id;
      sb.rpc("crm_asignar", { p_op: id, p_email: t.value }).then(function (r) {
        if (r.error) throw r.error;
        var o = opPorId(id); if (o) o.asignado_a = t.value || null;
        S.det.op.asignado_a = t.value || null; toast("Responsable actualizado"); pintarHoja(); render(); cargarDetalle(id, true);
      }).catch(function (er) { toast(mensajeError(er), true); pintarHoja(); });
    }
  });
  var busqueda;
  document.addEventListener("input", function (e) {
    var c = S.cot, id = e.target.id;
    if (c && id === "cot-buscar") { c.buscar = e.target.value; pintarCotResultados(); }
    else if (c && c.nuevo && /^cot-n-/.test(id)) { c.nuevo[id.slice(6)] = e.target.value; pintarCotDuplicado(); pintarCotResumen(); }
    else if (c && id === "cot-buscar-u") {
      c.buscarU = e.target.value; clearTimeout(busqueda);
      busqueda = setTimeout(function () { pintarCotUnidades(); var b = $("cot-buscar-u"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 150);
    }
    else if (c && /^cot-(descuento|entrada|reserva|cuotas|tasa|plazo)$/.test(id)) {
      var k = { "cot-descuento": "descuento", "cot-entrada": "entradaPct", "cot-reserva": "reserva", "cot-cuotas": "cuotas", "cot-tasa": "tasa", "cot-plazo": "plazo" }[id];
      c[k] = e.target.value; if (k === "reserva") c.reservaTocada = true; pintarCotResumen();
    }
    else if (c && id === "cot-notas") c.notas = e.target.value;
    if (id === "cot-q") { S.cotQ = e.target.value; clearTimeout(busqueda); busqueda = setTimeout(render, 200); }
    if (e.target.id === "inv-q") {
      S.invF.q = e.target.value; S.invMax = 60; clearTimeout(busqueda);
      busqueda = setTimeout(render, 200);
    }
    if (e.target.id === "f-q") {
      S.f.q = e.target.value; clearTimeout(busqueda);
      busqueda = setTimeout(render, 200);
    }
    if (e.target.id === "m-sub") {
      var v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (v !== e.target.value) e.target.value = v;
      $("m-sub-ayuda").textContent = v ? "Tu equipo y tus clientes entran por " + location.origin + "/app/?e=" + v : "Con ella, la pantalla de entrada muestra tu logo y tus colores.";
    }
    if (e.target.name === "nombre" && e.target.closest("#form-marca")) pintarPreviewMarca();
    if (e.target.id === "ia-input") { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px"; }
  });

  document.addEventListener("submit", async function (e) {
    var f = e.target; e.preventDefault();
    var btn = f.querySelector('button[type="submit"]');
    var fd = Object.fromEntries(new FormData(f).entries());
    if (f.id === "login-form") return login();
    if (f.id === "signup-form") return registrar();
    if (f.id === "onboard-form") return crearEmpresa();
    if (f.id === "ia-form") { var q = $("ia-input").value; $("ia-input").value = ""; return preguntar(q); }
    if (f.id === "form-nuevo") {
      return conBoton(btn, async function () {
        var r = await sb.rpc("crm_crear_lead", {
          p_org: S.org.id, p_nombre: fd.nombre, p_telefono: fd.telefono || null, p_correo: fd.correo || null, p_proyecto: fd.proyecto || null,
          p_interes: fd.interes || null, p_nota: fd.nota || null, p_fuente: fd.fuente || "otro", p_asignado: fd.asignado || null
        });
        if (r.error) throw r.error;
        cerrarModal(); await cargar(true); toast(r.data && r.data.nuevo ? "Lead creado" : "Ese cliente ya existía: se actualizó su ficha");
        if (r.data && r.data.oportunidad_id) abrirHoja(r.data.oportunidad_id);
      });
    }
    if (f.id === "form-clave") {
      return conBoton(btn, async function () {
        var r = await sb.auth.updateUser({ password: fd.clave }); if (r.error) throw r.error;
        cerrarModal(); toast("Contraseña actualizada");
      });
    }
    if (f.id === "form-invitar") {
      return conBoton(btn, async function () {
        var r = await sb.rpc("invitar", { p_org: S.org.id, p_email: fd.email, p_rol: fd.rol }); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast("Invitación creada. Pídele que cree su cuenta con ese correo.");
      });
    }
    if (f.id === "form-proyecto") {
      return conBoton(btn, async function () {
        var base = slugify(fd.nombre), slug = base, n = 2;
        while (S.proyectos.some(function (p) { return p.slug === slug; })) slug = base.slice(0, 36) + "-" + n++;
        var r = await sb.from("crm_proyectos").insert({ org_id: S.org.id, slug: slug, nombre: fd.nombre.trim() }); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast("Proyecto agregado");
      });
    }
    if (f.id === "form-marca") return guardarMarca(f, btn);
    if (f.id === "form-unidad") return guardarUnidad(f, btn);
    if (f.id === "form-cfg-cot") return guardarConfigCot(f, btn);
    if (f.id === "form-anular") {
      var mot = String(new FormData(f).get("motivo") || "").trim();
      if (mot.length < 3) { toast("Escribe el motivo", true); return; }
      return conBoton(btn, async function () {
        var r = await sb.rpc("anular_cotizacion", { p_id: f.dataset.id, p_motivo: mot }); if (r.error) throw r.error;
        cerrarModal(); toast("Proforma anulada"); S.cotizaciones = null; if (S.vista === "inventario") render(); if (S.det) cargarDetalle(S.det.op.id, true);
      });
    }
    if (f.id === "form-empresa") {
      return conBoton(btn, async function () {
        var r = await sb.rpc("actualizar_organizacion", { p_org: S.org.id, p_nombre: fd.nombre, p_reparto: fd.reparto }); if (r.error) throw r.error;
        await cargarEmpresa(); render(); toast("Ajustes guardados");
      });
    }
    if (!S.det) return;
    if (f.id === "form-nota") {
      return conBoton(btn, async function () {
        await guardarActividad(fd.tipo, fd.texto.trim()); f.reset(); S.prop = null;
        await cargarDetalle(S.det.op.id, true); toast("Guardado");
      });
    }
    if (f.id === "form-tarea") {
      return conBoton(btn, async function () {
        await guardarActividad("tarea", fd.titulo.trim(), new Date(fd.fecha + "T" + (fd.hora || "09:00") + ":00").toISOString());
        await cargarDetalle(S.det.op.id, true); cargar(true); toast("Tarea creada");
      });
    }
    if (f.id === "form-datos") {
      return conBoton(btn, async function () {
        var o = S.det.op;
        await upd("crm_contactos", o.contacto_id, { nombre: fd.nombre.trim(), telefono: fd.telefono.trim() || null, correo: fd.correo.trim().toLowerCase() || null });
        await upd("crm_oportunidades", o.id, {
          proyecto: fd.proyecto || null, unidad_interes: fd.unidad_interes.trim() || null, fuente: fd.fuente,
          valor_estimado: fd.valor_estimado === "" ? null : Number(fd.valor_estimado), proforma_numero: fd.proforma_numero.trim() || null
        });
        await cargar(true); await cargarDetalle(o.id, true); toast("Datos guardados");
      });
    }
  });

  async function login() {
    msg("auth-error", ""); msg("auth-info", "");
    var btn = $("login-btn"); btn.disabled = true; btn.textContent = "Entrando…";
    try {
      var r = await sb.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
      if (r.error) throw r.error;
      await entrar(r.data.user);
    } catch (e) {
      msg("auth-error", /invalid login/i.test(e.message || "") ? "Correo o contraseña incorrectos." : /not confirmed/i.test(e.message || "") ? "Confirma tu correo con el enlace que te enviamos y vuelve a entrar." : mensajeError(e));
    } finally { btn.disabled = false; btn.textContent = "Entrar"; }
  }
  async function registrar() {
    msg("auth-error", ""); msg("auth-info", "");
    var nombre = $("signup-nombre").value.trim(), email = $("signup-email").value.trim(), pass = $("signup-password").value;
    if (nombre.length < 2) { msg("auth-error", "Escribe tu nombre."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("auth-error", "Escribe un correo válido."); return; }
    if (pass.length < 8) { msg("auth-error", "La contraseña debe tener al menos 8 caracteres."); return; }
    var btn = $("signup-btn"); btn.disabled = true; btn.textContent = "Creando…";
    try {
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { nombre: nombre }, emailRedirectTo: location.origin + "/app/" } });
      if (r.error) throw r.error;
      if (r.data.session) { await entrar(r.data.session.user); return; }
      elegirAuth("login"); $("login-email").value = email;
      msg("auth-info", "Te enviamos un correo para confirmar tu cuenta. Ábrelo y vuelve a entrar.");
    } catch (e) {
      msg("auth-error", /already|registered/i.test(e.message || "") ? "Ese correo ya tiene cuenta. Entra con tu contraseña." : mensajeError(e));
    } finally { btn.disabled = false; btn.textContent = "Crear mi cuenta"; }
  }
  async function crearEmpresa() {
    msg("onboard-error", "");
    var nombre = $("onboard-nombre").value.trim();
    if (nombre.length < 2) { msg("onboard-error", "Escribe el nombre de tu inmobiliaria."); return; }
    var btn = $("onboard-btn"); btn.disabled = true; btn.textContent = "Creando…";
    try {
      var r = await sb.rpc("crear_organizacion", { p_nombre: nombre, p_nombre_usuario: (S.user.user_metadata && S.user.user_metadata.nombre) || null });
      if (r.error) throw r.error;
      await entrar(S.user);
    } catch (e) { msg("onboard-error", mensajeError(e)); }
    finally { btn.disabled = false; btn.textContent = "Empezar mi prueba gratis"; }
  }
  $("forgot-btn").addEventListener("click", async function () {
    var email = $("login-email").value.trim();
    if (!email) { msg("auth-error", "Escribe tu correo arriba y vuelve a tocar «Olvidé mi contraseña»."); return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app/" });
    if (r.error) msg("auth-error", mensajeError(r.error));
    else { msg("auth-error", ""); msg("auth-info", "Si el correo existe, te enviamos un enlace para crear una nueva contraseña."); }
  });
  document.querySelectorAll("[data-auth]").forEach(function (b) { b.addEventListener("click", function () { elegirAuth(b.dataset.auth); }); });
  $("btn-refresh").addEventListener("click", function () { cargar(false).then(function () { if (S.vista === "metricas") { S.metricas = null; render(); } toast("Actualizado"); }); });
  $("btn-menu").addEventListener("click", abrirCuenta);
  $("fab").addEventListener("click", abrirNuevo);

  /* Entrada por el enlace de la empresa (/app/?e=su-direccion): su logo y sus colores antes de iniciar sesión. */
  async function marcaDeEnlace() {
    var e = (new URLSearchParams(location.search).get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (!e) return;
    try {
      var r = await sb.rpc("marca_publica", { p_subdominio: e });
      var m = r.data; if (!m || !m.nombre) return;
      GPUTema.aplicarMarcaTemporal(m);
      authNombre = m.nombre; $("auth-titulo").textContent = "Entra a " + authNombre;
      var oscuro = GPUTema.modoEfectivo() === "dark" && m.logo_oscuro_path, logo = oscuro ? m.logo_oscuro_path : m.logo_path;
      var marca = document.querySelector("#auth .logo-mark");
      if (logo && marca) { var im = document.createElement("img"); im.className = "auth-logo"; im.alt = m.nombre; im.src = urlMarca(logo); marca.replaceWith(im); }
      var pie = $("auth-pie"); if (pie) pie.innerHTML = pieGPU(m);
    } catch (er) { /* sin marca: pantalla normal */ }
  }

  /* ------------------------------------------------------------------ inicio */
  (async function () {
    estadoRed();
    if (!CONFIGURADO) {
      $("boot").hidden = true; mostrar("login");
      $("login-form").hidden = true; $("signup-form").hidden = true; document.querySelector(".auth-tabs").hidden = true;
      msg("auth-error", "Falta configurar la conexión: edita web/js/config.js con la URL y la anon key de tu proyecto de Supabase (ver README).");
      return;
    }
    // Enlace de «olvidé mi contraseña»: pide la contraseña nueva.
    sb.auth.onAuthStateChange(function (ev) { if (ev === "PASSWORD_RECOVERY") setTimeout(abrirNuevaClave, 0); });
    try {
      var sess = (await sb.auth.getSession()).data.session;
      if (sess) await entrar(sess.user);
      else { await marcaDeEnlace(); mostrar("login"); if (new URLSearchParams(location.search).has("registro")) elegirAuth("signup"); }
    } catch (e) { mostrar("login"); msg("auth-error", mensajeError(e)); }
  })();
})();
