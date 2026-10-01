/* GPUnlock · Panel — núcleo compartido (cliente, permisos, utilidades de UI). */
window.FX = (function () {
  "use strict";
  var CFG = window.GPUNLOCK_CONFIG || {};
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  var state = { user: null, rol: null };

  /* ---------------------------------------------------------- permisos
     La base de datos (RLS) es quien realmente bloquea; esto solo decide qué
     botones se muestran, para no ofrecer acciones que van a fallar. */
  var PERMISOS = {
    panel:     ["editor", "administrador", "marketing"],
    editar:    ["editor"],
    estado:    ["editor", "administrador"],
    historial: ["editor", "administrador", "marketing"],
    marketing: ["editor", "marketing"],
    usuarios:  ["editor"]
  };
  function can(p) { return !!state.rol && (PERMISOS[p] || []).indexOf(state.rol) !== -1; }

  var ROLES = {
    editor: { label: "Editor", desc: "Acceso total: puedes crear, editar y eliminar contenido." },
    administrador: { label: "Administrador", desc: "Puedes ver y descargar todo, cambiar la disponibilidad de las unidades y generar dashboards del historial." },
    marketing: { label: "Marketing", desc: "Puedes ver y descargar todo, generar dashboards del historial y editar el dashboard de marketing." },
    asesor: { label: "Asesor", desc: "Acceso al cotizador." }
  };

  /* ----------------------------------------------------------- estados */
  var ESTADOS = {
    disponible: "Disponible", reservado: "Reservado", vendido: "Vendido",
    vendida: "Vendido", no_disponible: "No disponible"
  };

  /* ------------------------------------------------------------ íconos */
  var P = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    building: '<path d="M4 21V5l8-3v19M12 8l8 3v10M8 7v.01M8 11v.01M8 15v.01M16 13v.01M16 17v.01M2 21h20"/>',
    map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 6l3 3M14 8l2 2"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || "") + "</svg>";
  }

  /* --------------------------------------------------------- utilidades */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
  }
  function money(n) {
    if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString("es-EC", { maximumFractionDigits: 0 });
  }
  function fecha(iso, conHora) {
    if (!iso) return "—";
    var d = new Date(iso);
    var o = { day: "2-digit", month: "short", year: "numeric" };
    if (conHora) { o.hour = "2-digit"; o.minute = "2-digit"; o.hourCycle = "h23"; }
    return d.toLocaleString("es-EC", o);
  }
  // Rutas de imagen: absolutas se usan tal cual; relativas ("img/x.jpg")
  // son relativas a la carpeta de su landing (/vertice/, /prisma/, /valle/).
  function resolveImg(path, base) {
    if (!path) return "";
    if (/^(https?:)?\/\//i.test(path) || path.charAt(0) === "/" || path.indexOf("data:") === 0) return path;
    return (base || "/") + path;
  }

  /* -------------------------------------------------------------- avisos */
  function toast(msg, isError) {
    var el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    document.getElementById("toasts").appendChild(el);
    setTimeout(function () { el.remove(); }, isError ? 6500 : 3200);
  }
  function errMsg(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/row-level security|permission denied|42501/i.test(m)) return "Tu rol no tiene permiso para esta acción.";
    if (/duplicate key/i.test(m)) return "Ya existe un registro con ese código.";
    return m;
  }

  /* --------------------------------------------------------------- modal
     modal({title, body(html), actions:[{label, value, cls}], onOpen(el)})
     → promesa con el value del botón pulsado (o "cancel"). */
  function modal(opts) {
    var dlg = document.getElementById("modal");
    document.getElementById("modal-title").textContent = opts.title || "";
    document.getElementById("modal-x").innerHTML = icon("x");
    var body = document.getElementById("modal-body");
    body.innerHTML = opts.body || "";
    var foot = document.getElementById("modal-foot");
    var actions = opts.actions || [{ label: "Cerrar", value: "cancel", cls: "btn-ghost" }];
    foot.innerHTML = actions.map(function (a) {
      return '<button class="btn ' + (a.cls || "btn-ghost") + '" value="' + esc(a.value) + '"' +
        (a.value !== "cancel" ? ' type="submit"' : ' type="button" data-cancel') + ">" + esc(a.label) + "</button>";
    }).join("");
    return new Promise(function (resolve) {
      var form = document.getElementById("modal-form");
      function finish(v) { cleanup(); if (dlg.open) dlg.close(); resolve(v); }
      function onSubmit(e) {
        e.preventDefault();
        var v = e.submitter ? e.submitter.value : "ok";
        if (opts.validate && v !== "cancel") {
          var err = opts.validate(body, v);
          if (err) { toast(err, true); return; }
        }
        if (opts.onSubmit && v !== "cancel") {
          var btns = foot.querySelectorAll("button"); btns.forEach(function (b) { b.disabled = true; });
          Promise.resolve(opts.onSubmit(body, v)).then(function (ok) {
            btns.forEach(function (b) { b.disabled = false; });
            if (ok !== false) finish(v);
          });
          return;
        }
        finish(v);
      }
      function onCancel(e) { if (e.target.closest("[data-cancel]") || e.target.closest("#modal-x")) { e.preventDefault(); finish("cancel"); } }
      function onClose() { cleanup(); resolve("cancel"); }
      function cleanup() {
        form.removeEventListener("submit", onSubmit);
        dlg.removeEventListener("click", onCancel);
        dlg.removeEventListener("cancel", onClose);
      }
      form.addEventListener("submit", onSubmit);
      dlg.addEventListener("click", onCancel);
      dlg.addEventListener("cancel", onClose);
      dlg.showModal();
      if (opts.onOpen) opts.onOpen(body);
      var first = body.querySelector("input,select,textarea");
      if (first) first.focus();
    });
  }
  function confirmar(title, text, label) {
    return modal({
      title: title, body: "<p>" + esc(text) + "</p>",
      actions: [{ label: "Cancelar", value: "cancel" }, { label: label || "Confirmar", value: "ok", cls: "btn-danger" }]
    }).then(function (v) { return v === "ok"; });
  }

  /* ------------------------------------------------------------- datos */
  // Trae todas las filas (Supabase devuelve máx. 1000 por consulta).
  async function fetchAll(table, opts) {
    opts = opts || {};
    var out = [], from = 0, size = 1000;
    for (;;) {
      var q = sb.from(table).select(opts.select || "*").range(from, from + size - 1);
      if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
      var res = await q;
      if (res.error) throw res.error;
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < size) break;
      from += size;
    }
    return out;
  }

  async function log(accion, detalle) {
    try { await sb.from("actividad").insert({ email: state.user.email, accion: accion, detalle: detalle }); }
    catch (e) { /* el registro nunca debe bloquear la acción principal */ }
  }

  async function uploadImage(file, prefix) {
    var clean = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    var path = prefix + Date.now() + "-" + clean;
    var res = await sb.storage.from("site-images").upload(path, file, { upsert: false, cacheControl: "3600" });
    if (res.error) throw res.error;
    return sb.storage.from("site-images").getPublicUrl(path).data.publicUrl;
  }

  // Excel con una o varias hojas: sheets = [{name, rows:[{...}]}]
  function exportXlsx(sheets, filename) {
    if (!window.XLSX) { toast("No se pudo cargar el generador de Excel. Revisa tu conexión.", true); return; }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var rows = (s.rows || []).map(function (r) {
        var o = {};
        Object.keys(r).forEach(function (k) {
          var v = r[k];
          o[k] = (v && typeof v === "object") ? JSON.stringify(v) : v;
        });
        return o;
      });
      var ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: "Sin datos" }]);
      XLSX.utils.book_append_sheet(wb, ws, String(s.name).slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
  }

  return {
    sb: sb, state: state, can: can, ROLES: ROLES, ESTADOS: ESTADOS, icon: icon, esc: esc,
    naturalCompare: naturalCompare, money: money, fecha: fecha, resolveImg: resolveImg,
    toast: toast, errMsg: errMsg, modal: modal, confirmar: confirmar,
    fetchAll: fetchAll, log: log, uploadImage: uploadImage, exportXlsx: exportXlsx
  };
})();
