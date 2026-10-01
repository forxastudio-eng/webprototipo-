/* GPUnlock · Panel — vistas. Cada vista recibe el contenedor y lo dibuja. */
window.VIEWS = (function () {
  "use strict";
  var sb = FX.sb, esc = FX.esc, icon = FX.icon;

  /* =================================================================
     Inventarios: una sola vista genérica configurada por proyecto.
     Para sumar un proyecto nuevo al panel basta con agregar una entrada.
     ================================================================= */
  var KIND = { suite: "Suite / Depto", loft: "Loft", local: "Local comercial", isla: "Isla comercial" };
  function unitFields(kinds) {
    return [
      { k: "code", t: "Código", req: true, newOnly: true, hint: "Ej. A0, B12, LOFT-101. No se puede cambiar después." },
      { k: "kind", t: "Tipo", type: "select", opts: kinds.map(function (x) { return [x, KIND[x]]; }) },
      { k: "title", t: "Nombre visible", req: true },
      { k: "grupo", t: "Grupo / tipología" },
      { k: "tag", t: "Etiqueta corta" },
      { k: "area", t: "Área", hint: "Texto libre, ej. 58,4 m²" },
      { k: "dorm", t: "Dormitorios" },
      { k: "banos", t: "Baños" },
      { k: "extra", t: "Detalle adicional", type: "textarea", span: true },
      { k: "thumb", t: "Foto de la tarjeta", type: "img" },
      { k: "ficha", t: "Ficha técnica", type: "img" },
      { k: "sort_order", t: "Orden", type: "number", hint: "Menor número = aparece primero." }
    ];
  }
  var unitCols = [
    { k: "code", t: "Código", code: true },
    { k: "title", t: "Unidad" },
    { k: "kind", t: "Tipo", fmt: function (v) { return KIND[v] || v || "—"; } },
    { k: "area", t: "Área" },
    { k: "dorm", t: "Dorm." },
    { k: "banos", t: "Baños" }
  ];
  function byOrderThenCode(key) {
    return function (a, b) { return ((a.sort_order || 0) - (b.sort_order || 0)) || FX.naturalCompare(a[key], b[key]); };
  }

  var INV = {
    vertice: {
      label: "Vértice", table: "units", key: "code", col: "status",
      estados: ["disponible", "reservado", "vendido"], base: "/vertice/", prefix: "vertice/", site: "/vertice/",
      editable: true, thumb: "thumb", cols: unitCols, fields: unitFields(["suite", "local"]), sort: byOrderThenCode("code")
    },
    prisma: {
      label: "Prisma Suites & Lofts", table: "prisma_units", key: "code", col: "status",
      estados: ["disponible", "reservado", "vendido"], base: "/prisma/", prefix: "prisma/", site: "/prisma/",
      editable: true, thumb: "thumb", cols: unitCols, fields: unitFields(["suite", "loft", "local", "isla"]), sort: byOrderThenCode("code")
    },
    valle: {
      label: "Valle Sereno", table: "lots", key: "code", col: "status",
      estados: ["disponible", "reservado", "no_disponible"], base: "/valle/", prefix: "valle/", site: "/valle/",
      editable: true, noun: "lote",
      cols: [
        { k: "code", t: "Lote", code: true },
        { k: "area", t: "Área (m²)", num: true, fmt: function (v) { return v == null ? "—" : Number(v).toLocaleString("es-EC"); } },
        { k: "price", t: "Precio", num: true, fmt: FX.money }
      ],
      fields: [
        { k: "code", t: "Código del lote", req: true, newOnly: true },
        { k: "area", t: "Área (m²)", type: "number" },
        { k: "price", t: "Precio (USD)", type: "number" },
        { k: "cx", t: "Posición X en el mapa (0–100)", type: "number", hint: "Solo para lotes nuevos sin forma trazada." },
        { k: "cy", t: "Posición Y en el mapa (0–100)", type: "number" }
      ],
      sort: function (a, b) { return FX.naturalCompare(a.code, b.code); }
    },
    cot_unidades: {
      label: "Unidades del cotizador", table: "cotizador_unidades", key: "id", col: "estado",
      estados: ["disponible", "reservado", "vendida", "no_disponible"], editable: false, byProject: true,
      cols: [
        { k: "proyecto_id", t: "Proyecto", proyecto: true },
        { k: "codigo", t: "Código", code: true },
        { k: "tipo", t: "Tipo" },
        { k: "area_total_m2", t: "Área (m²)", num: true },
        { k: "precio", t: "Precio", num: true, fmt: FX.money }
      ],
      sort: function (a, b) { return FX.naturalCompare(a.proyecto_id, b.proyecto_id) || ((a.sort_order || 0) - (b.sort_order || 0)) || FX.naturalCompare(a.codigo, b.codigo); }
    },
    cot_extra: {
      label: "Parqueos, bodegas y lotes (cotizador)", table: "cotizador_inventario_extra", key: "id", col: "estado",
      estados: ["disponible", "reservado", "vendida", "no_disponible"], editable: false, byProject: true,
      cols: [
        { k: "proyecto_id", t: "Proyecto", proyecto: true },
        { k: "tipo", t: "Tipo" },
        { k: "codigo", t: "Código", code: true },
        { k: "categoria", t: "Categoría" },
        { k: "metraje_m2", t: "Área (m²)", num: true },
        { k: "precio", t: "Precio", num: true, fmt: FX.money }
      ],
      sort: function (a, b) { return FX.naturalCompare(a.proyecto_id, b.proyecto_id) || FX.naturalCompare(a.tipo, b.tipo) || FX.naturalCompare(a.codigo, b.codigo); }
    }
  };

  var proyectosCot = null;
  async function nombresProyectos() {
    if (proyectosCot) return proyectosCot;
    proyectosCot = {};
    try {
      (await FX.fetchAll("cotizador_proyectos", { select: "id,nombre", order: "sort_order" }))
        .forEach(function (p) { proyectosCot[p.id] = p.nombre; });
    } catch (e) { /* sin nombres: se muestran los ids */ }
    return proyectosCot;
  }

  function statusControl(cfg, row) {
    var v = row[cfg.col];
    if (!FX.can("estado")) return '<span class="pill s-' + esc(v) + '">' + esc(FX.ESTADOS[v] || v) + "</span>";
    return '<select class="status s-' + esc(v) + '" data-id="' + esc(row[cfg.key]) + '" aria-label="Estado de ' + esc(row.code || row.codigo) + '">' +
      cfg.estados.map(function (e) { return '<option value="' + e + '"' + (e === v ? " selected" : "") + ">" + FX.ESTADOS[e] + "</option>"; }).join("") +
      "</select>";
  }

  async function inventario(el, key) {
    var cfg = INV[key];
    if (!cfg) { el.innerHTML = '<div class="panel empty">Inventario no encontrado.</div>'; return; }
    var canEdit = FX.can("editar") && cfg.editable;
    var noun = cfg.noun || "unidad";
    var rows = [], filtro = "", busqueda = "", proyecto = "";
    var nombres = cfg.byProject ? await nombresProyectos() : {};

    var aviso = "";
    if (!cfg.editable && FX.can("editar")) aviso = '<div class="notice">Aquí se cambia la disponibilidad. La edición completa (precios, fotos, planos, unidades nuevas) está en <a href="/cotizador/admin.html">Configurar cotizador</a>.</div>';
    else if (FX.state.rol === "administrador") aviso = '<div class="notice">Tu rol puede cambiar la <strong>disponibilidad</strong> de cada unidad. El resto de campos es de solo lectura.</div>';
    else if (!FX.can("estado")) aviso = '<div class="notice">Vista de solo lectura. Puedes descargar esta tabla en Excel.</div>';

    el.innerHTML = aviso +
      '<section class="panel">' +
        '<div class="toolbar">' +
          '<label class="search">' + icon("search") + '<input class="input" type="search" placeholder="Buscar código, nombre o tipo…" aria-label="Buscar" id="inv-q"></label>' +
          (cfg.byProject ? '<select class="input" id="inv-proy" style="width:auto;max-width:220px" aria-label="Proyecto"><option value="">Todos los proyectos</option></select>' : "") +
          '<div class="chips" id="inv-chips" role="group" aria-label="Filtrar por estado"></div>' +
          '<span class="spacer"></span>' +
          (cfg.site ? '<a class="btn btn-ghost btn-sm" href="' + cfg.site + '" target="_blank" rel="noopener">' + icon("eye") + "Ver en el sitio</a>" : "") +
          '<button class="btn btn-ghost btn-sm" id="inv-xlsx">' + icon("download") + "Excel</button>" +
          (canEdit ? '<button class="btn btn-primary btn-sm" id="inv-new">' + icon("plus") + "Nueva " + noun + "</button>" : "") +
        "</div>" +
        '<div class="table-wrap"><table class="data"><thead><tr id="inv-head"></tr></thead><tbody id="inv-body"><tr><td class="empty">Cargando…</td></tr></tbody></table></div>' +
        '<div class="table-foot"><span id="inv-count"></span><span>Los cambios se publican al instante en el sitio.</span></div>' +
      "</section>";

    var head = el.querySelector("#inv-head"), body = el.querySelector("#inv-body");
    head.innerHTML = (cfg.thumb ? "<th></th>" : "") +
      cfg.cols.map(function (c) { return '<th class="' + (c.num ? "num" : "") + '">' + esc(c.t) + "</th>"; }).join("") +
      "<th>Estado</th>" + (canEdit ? '<th class="actions"><span class="sr-only">Acciones</span></th>' : "");

    function visibles() {
      var q = busqueda.toLowerCase();
      return rows.filter(function (r) {
        if (filtro && r[cfg.col] !== filtro) return false;
        if (proyecto && r.proyecto_id !== proyecto) return false;
        if (!q) return true;
        return cfg.cols.some(function (c) { return String(r[c.k] == null ? "" : r[c.k]).toLowerCase().indexOf(q) !== -1; }) ||
          String(r.title || r.nombre || "").toLowerCase().indexOf(q) !== -1;
      });
    }

    function renderChips() {
      var base = rows.filter(function (r) { return !proyecto || r.proyecto_id === proyecto; });
      var html = '<button class="chip" data-v="" aria-pressed="' + (filtro === "") + '">Todas<b>' + base.length + "</b></button>";
      cfg.estados.forEach(function (e) {
        var n = base.filter(function (r) { return r[cfg.col] === e; }).length;
        html += '<button class="chip" data-v="' + e + '" aria-pressed="' + (filtro === e) + '">' + FX.ESTADOS[e] + "<b>" + n + "</b></button>";
      });
      var box = el.querySelector("#inv-chips");
      box.innerHTML = html;
      box.querySelectorAll(".chip").forEach(function (b) {
        b.onclick = function () { filtro = b.dataset.v; renderChips(); renderRows(); };
      });
    }

    function cell(c, r) {
      var v = r[c.k];
      if (c.proyecto) v = nombres[v] || v;
      var txt = c.fmt ? c.fmt(r[c.k]) : (v == null || v === "" ? "—" : v);
      return '<td class="' + (c.num ? "num" : "") + '">' + (c.code ? '<span class="code">' + esc(txt) + "</span>" : esc(txt)) + "</td>";
    }

    function renderRows() {
      var list = visibles();
      el.querySelector("#inv-count").textContent = list.length + " de " + rows.length + " registros";
      if (!list.length) { body.innerHTML = '<tr><td class="empty" colspan="20">No hay registros con estos filtros.</td></tr>'; return; }
      body.innerHTML = list.map(function (r) {
        var id = esc(r[cfg.key]);
        return "<tr>" +
          (cfg.thumb ? "<td>" + (r[cfg.thumb] ? '<img class="thumb" loading="lazy" alt="" src="' + esc(FX.resolveImg(r[cfg.thumb], cfg.base)) + '">' : "") + "</td>" : "") +
          cfg.cols.map(function (c) { return cell(c, r); }).join("") +
          "<td>" + statusControl(cfg, r) + "</td>" +
          (canEdit ? '<td class="actions"><button class="icon-btn" data-edit="' + id + '" aria-label="Editar">' + icon("edit") + '</button> <button class="icon-btn danger" data-del="' + id + '" aria-label="Eliminar">' + icon("trash") + "</button></td>" : "") +
          "</tr>";
      }).join("");
    }

    async function cargar() {
      try {
        rows = (await FX.fetchAll(cfg.table)).sort(cfg.sort);
        if (cfg.byProject) {
          var sel = el.querySelector("#inv-proy");
          var ids = rows.map(function (r) { return r.proyecto_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
          sel.innerHTML = '<option value="">Todos los proyectos</option>' + ids.map(function (i) { return '<option value="' + esc(i) + '">' + esc(nombres[i] || i) + "</option>"; }).join("");
          sel.value = proyecto;
        }
        renderChips(); renderRows();
      } catch (e) {
        body.innerHTML = '<tr><td class="empty" colspan="20">No se pudo cargar: ' + esc(FX.errMsg(e)) + "</td></tr>";
      }
    }

    // Cambio de estado (editor y administrador) vía función segura con registro.
    body.addEventListener("change", async function (e) {
      var s = e.target.closest("select.status");
      if (!s) return;
      var row = rows.find(function (r) { return String(r[cfg.key]) === s.dataset.id; });
      var prev = row[cfg.col], nuevo = s.value;
      s.disabled = true;
      var res = await sb.rpc("cambiar_estado", { p_tabla: cfg.table, p_id: s.dataset.id, p_estado: nuevo });
      s.disabled = false;
      if (res.error) { s.value = prev; FX.toast(FX.errMsg(res.error), true); return; }
      row[cfg.col] = nuevo;
      s.className = "status s-" + nuevo;
      FX.toast((row.code || row.codigo) + ": " + FX.ESTADOS[nuevo]);
      renderChips();
      if (filtro) renderRows();
    });

    body.addEventListener("click", function (e) {
      var ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
      if (ed) editar(rows.find(function (r) { return String(r[cfg.key]) === ed.dataset.edit; }));
      if (del) eliminar(rows.find(function (r) { return String(r[cfg.key]) === del.dataset.del; }));
    });

    async function eliminar(row) {
      var id = row[cfg.key];
      if (!(await FX.confirmar("Eliminar " + noun, "¿Eliminar " + id + " de " + cfg.label + "? Desaparece del sitio y no se puede deshacer.", "Eliminar"))) return;
      var res = await sb.from(cfg.table).delete().eq(cfg.key, id);
      if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
      FX.log("eliminar", cfg.label + " · " + id);
      FX.toast(id + " eliminado");
      rows = rows.filter(function (r) { return r !== row; });
      renderChips(); renderRows();
    }

    function editar(row) {
      var nuevo = !row;
      row = row || { sort_order: rows.length + 1 };
      FX.modal({
        title: nuevo ? "Nueva " + noun + " · " + cfg.label : "Editar " + row[cfg.key],
        body: buildForm(cfg.fields, row, nuevo, cfg.base) +
          (nuevo ? '<p class="muted" style="margin-top:14px">Se crea como <strong>Disponible</strong>. Cambia el estado desde la tabla.</p>' : ""),
        actions: [{ label: "Cancelar", value: "cancel" }, { label: nuevo ? "Crear" : "Guardar cambios", value: "ok", cls: "btn-primary" }],
        onOpen: wireImageInputs,
        onSubmit: async function (form) {
          try {
            var data = await readForm(cfg.fields, form, nuevo, cfg.prefix);
            if (nuevo) {
              if (rows.some(function (r) { return String(r[cfg.key]).toLowerCase() === String(data[cfg.key]).toLowerCase(); })) {
                FX.toast("Ya existe " + data[cfg.key] + ".", true); return false;
              }
              data[cfg.col] = cfg.estados[0];
              var ins = await sb.from(cfg.table).insert(data).select().single();
              if (ins.error) throw ins.error;
              rows.push(ins.data); rows.sort(cfg.sort);
              FX.log("crear", cfg.label + " · " + data[cfg.key]);
              FX.toast(data[cfg.key] + " creado");
            } else {
              var up = await sb.from(cfg.table).update(data).eq(cfg.key, row[cfg.key]).select().single();
              if (up.error) throw up.error;
              Object.assign(row, up.data); rows.sort(cfg.sort);
              FX.log("editar", cfg.label + " · " + row[cfg.key]);
              FX.toast("Cambios guardados");
            }
            renderChips(); renderRows();
          } catch (e) { FX.toast(FX.errMsg(e), true); return false; }
        }
      });
    }

    el.querySelector("#inv-q").addEventListener("input", function (e) { busqueda = e.target.value.trim(); renderRows(); });
    var ps = el.querySelector("#inv-proy");
    if (ps) ps.addEventListener("change", function () { proyecto = ps.value; renderChips(); renderRows(); });
    el.querySelector("#inv-xlsx").onclick = function () {
      FX.exportXlsx([{ name: cfg.label, rows: visibles() }], "gpunlock-" + key + "-" + new Date().toISOString().slice(0, 10) + ".xlsx");
    };
    var nb = el.querySelector("#inv-new");
    if (nb) nb.onclick = function () { editar(null); };
    await cargar();
  }

  /* ----------------------------------------------- formularios genéricos */
  function buildForm(fields, row, nuevo, base) {
    return '<div class="form-grid">' + fields.map(function (f) {
      var v = row[f.k] == null ? "" : row[f.k];
      var id = "f-" + f.k;
      var lock = f.newOnly && !nuevo;
      var hint = f.hint ? "<small>" + esc(f.hint) + "</small>" : "";
      var cls = "fld" + (f.span || f.type === "img" ? " span-2" : "");
      if (f.type === "select") {
        return '<label class="' + cls + '"><span>' + esc(f.t) + '</span><select id="' + id + '">' +
          f.opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
          "</select>" + hint + "</label>";
      }
      if (f.type === "textarea") return '<label class="' + cls + '"><span>' + esc(f.t) + '</span><textarea id="' + id + '">' + esc(v) + "</textarea>" + hint + "</label>";
      if (f.type === "check") return '<label class="fld fld-check span-2"><input type="checkbox" id="' + id + '"' + (v ? " checked" : "") + "><span>" + esc(f.t) + "</span></label>";
      if (f.type === "img") {
        var src = FX.resolveImg(v, base);
        return '<div class="' + cls + '"><span>' + esc(f.t) + '</span><div class="img-field">' +
          (src ? '<img src="' + esc(src) + '" alt="" data-prev="' + f.k + '">' : '<div class="img-empty" data-prev="' + f.k + '">Sin imagen</div>') +
          '<div class="img-ctrl"><input type="file" accept="image/*" id="' + id + '-file" aria-label="Subir ' + esc(f.t) + '">' +
          '<input class="input" id="' + id + '" value="' + esc(v) + '" placeholder="o pega una ruta / URL" aria-label="Ruta de ' + esc(f.t) + '"></div></div>' + hint + "</div>";
      }
      return '<label class="' + cls + '"><span>' + esc(f.t) + (f.req ? " *" : "") + '</span><input id="' + id + '" type="' + (f.type === "number" ? "number" : "text") + '"' +
        (f.type === "number" ? ' step="any"' : "") + ' value="' + esc(v) + '"' + (f.req ? " required" : "") + (lock ? " readonly" : "") + ">" + hint + "</label>";
    }).join("") + "</div>";
  }

  function wireImageInputs(form) {
    form.querySelectorAll('input[type="file"]').forEach(function (inp) {
      inp.addEventListener("change", function () {
        var file = inp.files[0]; if (!file) return;
        var k = inp.id.replace(/^f-/, "").replace(/-file$/, "");
        var prev = form.querySelector('[data-prev="' + k + '"]');
        var img = document.createElement("img");
        img.alt = ""; img.dataset.prev = k; img.src = URL.createObjectURL(file);
        prev.replaceWith(img);
      });
    });
  }

  async function readForm(fields, form, nuevo, prefix) {
    var out = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.newOnly && !nuevo) continue;
      var input = form.querySelector("#f-" + f.k);
      if (f.type === "check") { out[f.k] = input.checked; continue; }
      if (f.type === "img") {
        var file = form.querySelector("#f-" + f.k + "-file").files[0];
        out[f.k] = file ? await FX.uploadImage(file, prefix) : (input.value.trim() || null);
        continue;
      }
      var v = input.value.trim();
      if (f.type === "number") out[f.k] = v === "" ? (f.k === "sort_order" ? 0 : null) : Number(v);
      else out[f.k] = v === "" ? null : v;
      if (f.req && (out[f.k] === null || out[f.k] === "")) throw new Error("Completa el campo " + f.t + ".");
    }
    return out;
  }

  /* =========================================================== Escritorio */
  async function escritorio(el) {
    var rolInfo = FX.ROLES[FX.state.rol] || {};
    el.innerHTML =
      '<section class="panel welcome"><div><h2>Hola, ' + esc(FX.state.user.email.split("@")[0]) + '</h2><p>Rol <strong>' + esc(rolInfo.label) + "</strong>. " + esc(rolInfo.desc) + "</p></div>" +
      '<div class="btns"><a class="btn btn-primary" href="/cotizador/">' + icon("calc") + 'Abrir cotizador</a><a class="btn btn-ghost" href="/" target="_blank" rel="noopener">' + icon("eye") + "Ver sitio</a></div></section>" +
      '<section><div class="panel-head"><h2>Disponibilidad</h2><p>Estado actual de cada inventario</p></div><div class="grid-3" id="d-stats"></div></section>' +
      '<div class="grid-2"><section class="panel" id="d-prof"></section><section class="panel"><div class="panel-head"><h2>Actividad reciente</h2><a href="#/actividad">Ver todo</a></div><ul class="feed" id="d-feed"><li class="muted">Cargando…</li></ul></section></div>' +
      '<section class="panel"><div class="panel-head"><h2>Accesos rápidos</h2></div><div class="quick" id="d-quick"></div></section>';

    var quick = [["#/portafolio", "globe", "Portafolio de proyectos"], ["#/exportar", "download", "Descargar tablas"]];
    if (FX.can("historial")) quick.push(["/cotizador/historial.html", "chart", "Historial y dashboard"]);
    quick.push(["/marketing/", "megaphone", "Dashboard de marketing"]);
    if (FX.can("usuarios")) quick.push(["#/usuarios", "users", "Usuarios y roles"]);
    el.querySelector("#d-quick").innerHTML = quick.map(function (q) { return '<a href="' + q[0] + '">' + icon(q[1]) + esc(q[2]) + "</a>"; }).join("");

    var stats = el.querySelector("#d-stats");
    var keys = ["vertice", "prisma", "valle", "cot_unidades"];
    stats.innerHTML = keys.map(function (k) { return '<a class="panel stat" href="#/inventario/' + k + '" id="st-' + k + '"><div class="stat-top"><h3>' + esc(INV[k].label) + '</h3><span class="stat-total">…</span></div></a>'; }).join("");
    keys.forEach(async function (k) {
      var cfg = INV[k], card = el.querySelector("#st-" + k);
      try {
        var rows = await FX.fetchAll(cfg.table, { select: cfg.col });
        var total = rows.length;
        var counts = cfg.estados.map(function (e) { return [e, rows.filter(function (r) { return r[cfg.col] === e; }).length]; });
        card.innerHTML = '<div class="stat-top"><h3>' + esc(cfg.label) + '</h3><span class="stat-total">' + total + "</span></div>" +
          '<div class="stack" role="img" aria-label="' + counts.map(function (c) { return FX.ESTADOS[c[0]] + " " + c[1]; }).join(", ") + '">' +
          counts.map(function (c) { return total ? '<span class="dot-' + c[0] + '" style="width:' + (c[1] / total * 100) + '%"></span>' : ""; }).join("") + "</div>" +
          '<div class="legend">' + counts.map(function (c) { return '<span><i class="dot-' + c[0] + '"></i>' + FX.ESTADOS[c[0]] + " " + c[1] + "</span>"; }).join("") + "</div>";
      } catch (e) { card.querySelector(".stat-total").textContent = "—"; }
    });

    var prof = el.querySelector("#d-prof");
    if (FX.can("historial")) {
      var hace30 = new Date(Date.now() - 30 * 864e5).toISOString();
      var r1 = await sb.from("cotizador_historial").select("id", { count: "exact", head: true });
      var r2 = await sb.from("cotizador_historial").select("id", { count: "exact", head: true }).gte("created_at", hace30);
      prof.innerHTML = '<div class="panel-head"><h2>Proformas</h2><a href="/cotizador/historial.html">Abrir historial</a></div>' +
        '<dl class="kv"><dt>Últimos 30 días</dt><dd>' + (r2.count == null ? "—" : r2.count) + "</dd><dt>Total histórico</dt><dd>" + (r1.count == null ? "—" : r1.count) + "</dd></dl>" +
        '<p class="muted" style="margin-top:14px">Genera el dashboard de preferencias con el período que necesites y expórtalo a PDF desde el historial.</p>';
    } else {
      prof.innerHTML = '<div class="panel-head"><h2>Cotizador</h2></div><p class="muted">Genera proformas para cualquier proyecto activo.</p><p style="margin-top:12px"><a class="btn btn-primary btn-sm" href="/cotizador/">Abrir cotizador</a></p>';
    }

    var feed = el.querySelector("#d-feed");
    var act = await sb.from("actividad").select("*").order("created_at", { ascending: false }).limit(8);
    feed.innerHTML = act.error || !act.data.length ? '<li class="muted">Sin actividad registrada todavía.</li>' :
      act.data.map(function (a) { return "<li><time>" + esc(FX.fecha(a.created_at, true)) + "</time><span><strong>" + esc((a.email || "").split("@")[0]) + "</strong> · " + esc(a.detalle || a.accion) + "</span></li>"; }).join("");
  }

  /* ============================================ Listas ordenables (tarjetas) */
  async function moverOrden(table, list, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= list.length) return false;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    var updates = list.map(function (r, idx) { return { r: r, o: idx + 1 }; }).filter(function (x) { return x.r.sort_order !== x.o; });
    for (var k = 0; k < updates.length; k++) {
      var res = await sb.from(table).update({ sort_order: updates[k].o }).eq("id", updates[k].r.id);
      if (res.error) { FX.toast(FX.errMsg(res.error), true); return false; }
      updates[k].r.sort_order = updates[k].o;
    }
    return true;
  }

  /* ============================================================ Portafolio */
  var PROJECT_FIELDS = [
    { k: "name", t: "Nombre del proyecto", req: true },
    { k: "url", t: "Enlace", req: true, hint: "Proyecto de esta plataforma: /carpeta/ (ej. /prisma/). Sitio externo: https://…" },
    { k: "tagline", t: "Descripción corta", type: "textarea", span: true },
    { k: "ubicacion", t: "Ubicación", hint: "Se usa para el filtro de la portada (ej. Ciudad Alta)." },
    { k: "tipo", t: "Tipo", hint: "Ej. Suites y locales, Lotes" },
    { k: "cover_url", t: "Imagen de portada", type: "img" },
    { k: "visible", t: "Visible en la landing principal", type: "check" }
  ];

  async function portafolio(el) {
    var canEdit = FX.can("editar"), list = [];
    el.innerHTML = '<div class="notice">Estas son las tarjetas de la <a href="/" target="_blank" rel="noopener">landing principal de GPUnlock</a>. Para sumar un proyecto nuevo: súbelo como carpeta en el repositorio (ver README) y agrégalo aquí.</div>' +
      '<section class="panel"><div class="panel-head"><h2>Proyectos publicados</h2>' +
      (canEdit ? '<button class="btn btn-primary btn-sm" id="p-new">' + icon("plus") + "Agregar proyecto</button>" : "") +
      '</div><div class="cards" id="p-list"><div class="empty">Cargando…</div></div></section>';
    var box = el.querySelector("#p-list");

    function render() {
      if (!list.length) { box.innerHTML = '<div class="empty">Todavía no hay proyectos.</div>'; return; }
      box.innerHTML = list.map(function (p, i) {
        var img = FX.resolveImg(p.cover_url, "/");
        return '<article class="pcard"><div class="pcard-media">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : "") +
          (p.visible === false ? '<span class="tag">Oculto</span>' : "") + "</div>" +
          '<div class="pcard-body"><h3>' + esc(p.name) + '</h3><span class="url">' + esc(p.url) + "</span>" +
          (p.tagline ? '<p class="muted" style="font-size:14px">' + esc(p.tagline) + "</p>" : "") + "</div>" +
          (canEdit ? '<div class="pcard-foot"><button class="btn btn-ghost btn-sm" data-e="' + i + '">' + icon("edit") + "Editar</button>" +
            '<button class="icon-btn" data-u="' + i + '" aria-label="Subir"' + (i === 0 ? " disabled" : "") + ">" + icon("up") + "</button>" +
            '<button class="icon-btn" data-d="' + i + '" aria-label="Bajar"' + (i === list.length - 1 ? " disabled" : "") + ">" + icon("down") + "</button>" +
            '<button class="icon-btn danger" data-x="' + i + '" aria-label="Eliminar">' + icon("trash") + "</button></div>" : "") +
          "</article>";
      }).join("");
    }

    async function cargar() {
      try { list = await FX.fetchAll("projects", { order: "sort_order" }); render(); }
      catch (e) { box.innerHTML = '<div class="empty">' + esc(FX.errMsg(e)) + "</div>"; }
    }

    function editar(p) {
      var nuevo = !p;
      p = p || { visible: true };
      FX.modal({
        title: nuevo ? "Agregar proyecto" : "Editar " + p.name,
        body: buildForm(PROJECT_FIELDS, p, nuevo, "/"),
        actions: [{ label: "Cancelar", value: "cancel" }, { label: nuevo ? "Agregar" : "Guardar", value: "ok", cls: "btn-primary" }],
        onOpen: wireImageInputs,
        onSubmit: async function (form) {
          try {
            var data = await readForm(PROJECT_FIELDS, form, nuevo, "portafolio/");
            if (nuevo) data.sort_order = list.length + 1;
            var res = nuevo ? await sb.from("projects").insert(data) : await sb.from("projects").update(data).eq("id", p.id);
            if (res.error) throw res.error;
            FX.log(nuevo ? "crear" : "editar", "Portafolio · " + data.name);
            FX.toast(nuevo ? "Proyecto agregado" : "Cambios guardados");
            await cargar();
          } catch (e) { FX.toast(FX.errMsg(e), true); return false; }
        }
      });
    }

    box.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.e) editar(list[+b.dataset.e]);
      if (b.dataset.u) { if (await moverOrden("projects", list, +b.dataset.u, -1)) render(); }
      if (b.dataset.d) { if (await moverOrden("projects", list, +b.dataset.d, 1)) render(); }
      if (b.dataset.x) {
        var p = list[+b.dataset.x];
        if (!(await FX.confirmar("Eliminar proyecto", "¿Quitar " + p.name + " de la landing principal? El sitio del proyecto no se borra.", "Eliminar"))) return;
        var res = await sb.from("projects").delete().eq("id", p.id);
        if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
        FX.log("eliminar", "Portafolio · " + p.name);
        await cargar();
      }
    });
    var nb = el.querySelector("#p-new"); if (nb) nb.onclick = function () { editar(null); };
    await cargar();
  }

  /* ================================================================ Slider */
  async function slider(el) {
    var canEdit = FX.can("editar"), list = [];
    el.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Fotos del slider de Valle Sereno</h2><p>Se muestran en ese orden en la <a href="/valle/" target="_blank" rel="noopener">landing de Valle Sereno</a>.</p></div>' +
      (canEdit ? '<label class="btn btn-primary btn-sm">' + icon("upload") + 'Subir fotos<input type="file" accept="image/*" multiple hidden id="s-up"></label>' : "") +
      '</div><div class="cards" id="s-list"><div class="empty">Cargando…</div></div></section>';
    var box = el.querySelector("#s-list");

    function render() {
      if (!list.length) { box.innerHTML = '<div class="empty">No hay fotos.</div>'; return; }
      box.innerHTML = list.map(function (s, i) {
        return '<article class="pcard"><div class="pcard-media"><img src="' + esc(FX.resolveImg(s.src, "/valle/")) + '" alt="" loading="lazy"><span class="tag">' + (i + 1) + "</span></div>" +
          '<div class="pcard-body"><label class="fld"><span>Texto alternativo</span><input class="input" data-alt="' + i + '" value="' + esc(s.alt || "") + '"' + (canEdit ? "" : " readonly") + "></label></div>" +
          (canEdit ? '<div class="pcard-foot"><button class="icon-btn" data-u="' + i + '" aria-label="Mover antes"' + (i === 0 ? " disabled" : "") + ">" + icon("up") + "</button>" +
            '<button class="icon-btn" data-d="' + i + '" aria-label="Mover después"' + (i === list.length - 1 ? " disabled" : "") + ">" + icon("down") + "</button>" +
            '<button class="icon-btn danger" data-x="' + i + '" aria-label="Eliminar">' + icon("trash") + "</button></div>" : "") + "</article>";
      }).join("");
    }
    async function cargar() {
      try { list = await FX.fetchAll("slider_images", { order: "sort_order" }); render(); }
      catch (e) { box.innerHTML = '<div class="empty">' + esc(FX.errMsg(e)) + "</div>"; }
    }
    box.addEventListener("change", async function (e) {
      var a = e.target.closest("[data-alt]"); if (!a || !canEdit) return;
      var s = list[+a.dataset.alt];
      var res = await sb.from("slider_images").update({ alt: a.value }).eq("id", s.id);
      if (res.error) FX.toast(FX.errMsg(res.error), true); else { s.alt = a.value; FX.toast("Texto guardado"); }
    });
    box.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.u) { if (await moverOrden("slider_images", list, +b.dataset.u, -1)) render(); }
      if (b.dataset.d) { if (await moverOrden("slider_images", list, +b.dataset.d, 1)) render(); }
      if (b.dataset.x) {
        if (!(await FX.confirmar("Eliminar foto", "¿Quitar esta foto del slider?", "Eliminar"))) return;
        var res = await sb.from("slider_images").delete().eq("id", list[+b.dataset.x].id);
        if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
        FX.log("eliminar", "Slider Valle Sereno · foto");
        await cargar();
      }
    });
    var up = el.querySelector("#s-up");
    if (up) up.addEventListener("change", async function () {
      var files = Array.prototype.slice.call(up.files);
      FX.toast("Subiendo " + files.length + " foto(s)…");
      for (var i = 0; i < files.length; i++) {
        try {
          var url = await FX.uploadImage(files[i], "valle/slider/");
          var res = await sb.from("slider_images").insert({ src: url, alt: "", sort_order: list.length + i + 1 });
          if (res.error) throw res.error;
        } catch (e) { FX.toast(FX.errMsg(e), true); }
      }
      FX.log("crear", "Slider Valle Sereno · " + files.length + " foto(s)");
      up.value = "";
      await cargar();
    });
    await cargar();
  }

  /* ============================================================== Usuarios */
  // Contraseña legible (sin 0/O ni 1/l), 12 caracteres.
  function generarClave() {
    var abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    var r = new Uint8Array(12); crypto.getRandomValues(r);
    return Array.prototype.map.call(r, function (x) { return abc[x % abc.length]; }).join("");
  }
  async function llamarAdminUsuarios(body) {
    var res = await sb.functions.invoke("admin-usuarios", { body: body });
    if (res.error) {
      var msg = res.error.message;
      try { var j = await res.error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* sin detalle */ }
      throw new Error(msg);
    }
    return res.data;
  }

  async function usuarios(el) {
    if (!FX.can("usuarios")) { el.innerHTML = '<div class="panel empty">Solo el editor administra usuarios.</div>'; return; }
    var list = [], estado = {};
    var opts = Object.keys(FX.ROLES).map(function (r) { return '<option value="' + r + '">' + FX.ROLES[r].label + "</option>"; }).join("");
    el.innerHTML =
      '<div class="notice">Para dar acceso a alguien: agrégalo con su rol y luego pulsa <strong>Contraseña</strong> en su fila. Si todavía no tiene cuenta, se crea en ese momento. Usa el mismo botón si alguien olvida su contraseña.</div>' +
      '<section class="panel"><div class="panel-head"><h2>Agregar persona</h2></div>' +
        '<form class="form-grid u-form" id="u-form">' +
          '<label class="fld"><span>Correo</span><input type="email" id="u-email" required></label>' +
          '<label class="fld"><span>Nombre (opcional)</span><input id="u-nombre"></label>' +
          '<label class="fld"><span>Rol</span><select id="u-rol">' + opts + "</select></label>" +
          '<button class="btn btn-primary" type="submit">' + icon("plus") + "Agregar</button>" +
        "</form></section>" +
      '<section class="panel"><div class="panel-head"><h2>Equipo</h2><p>' + Object.keys(FX.ROLES).map(function (r) { return "<strong>" + FX.ROLES[r].label + ":</strong> " + esc(FX.ROLES[r].desc); }).join("<br>") + "</p></div>" +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Cuenta</th><th class="actions"></th></tr></thead><tbody id="u-body"><tr><td class="empty" colspan="5">Cargando…</td></tr></tbody></table></div></section>';
    var body = el.querySelector("#u-body");
    var orden = { editor: 0, administrador: 1, marketing: 2, asesor: 3 };

    function cuentaCelda(u) {
      var e = estado[u.email];
      if (!e) return '<span class="pill s-no_disponible">Sin cuenta</span>';
      return '<span class="pill s-disponible">Activa</span><br><small class="muted">' +
        (e.ultimo_ingreso ? "Último ingreso: " + esc(FX.fecha(e.ultimo_ingreso, true)) : "Aún no ha entrado") + "</small>";
    }
    function render() {
      body.innerHTML = list.map(function (u, i) {
        var yo = u.email === FX.state.user.email.toLowerCase();
        return "<tr><td>" + esc(u.email) + (yo ? ' <span class="pill s-disponible">Tú</span>' : "") + "</td><td>" + esc(u.nombre || "—") + "</td>" +
          '<td><select class="input" data-r="' + i + '" style="width:auto"' + (yo ? " disabled" : "") + ">" +
          Object.keys(FX.ROLES).map(function (r) { return '<option value="' + r + '"' + (r === u.role ? " selected" : "") + ">" + FX.ROLES[r].label + "</option>"; }).join("") +
          "</select></td><td>" + cuentaCelda(u) + "</td>" +
          '<td class="actions"><button class="btn btn-ghost btn-sm" data-p="' + i + '">' + icon("key") + (estado[u.email] ? "Contraseña" : "Crear cuenta") + "</button> " +
          (yo ? "" : '<button class="icon-btn danger" data-x="' + i + '" aria-label="Quitar acceso">' + icon("trash") + "</button>") + "</td></tr>";
      }).join("");
    }
    async function cargar() {
      list = (await FX.fetchAll("user_roles")).sort(function (a, b) { return (orden[a.role] - orden[b.role]) || a.email.localeCompare(b.email); });
      try { estado = (await llamarAdminUsuarios({ accion: "listar" })).estado || {}; }
      catch (e) { estado = {}; FX.toast("No se pudo leer el estado de las cuentas: " + e.message, true); }
      render();
    }

    function asignarClave(u) {
      var nueva = !estado[u.email];
      FX.modal({
        title: (nueva ? "Crear cuenta de " : "Nueva contraseña para ") + u.email,
        body:
          '<p class="muted" style="margin-bottom:14px">' + (nueva
            ? "Se crea la cuenta con esta contraseña. Entrégala por un canal privado y pide que la cambie en Mi cuenta."
            : "La contraseña anterior deja de funcionar de inmediato. Entrégala por un canal privado y pide que la cambie en Mi cuenta.") + "</p>" +
          '<label class="fld"><span>Contraseña</span>' +
          '<div style="display:flex;gap:8px"><input class="input" id="np" minlength="8" autocomplete="off" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em" value="' + generarClave() + '">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="np-gen">Generar otra</button></div>' +
          "<small>Mínimo 8 caracteres. Puedes escribir una propia.</small></label>",
        actions: [{ label: "Cancelar", value: "cancel" }, { label: nueva ? "Crear cuenta" : "Asignar contraseña", value: "ok", cls: "btn-primary" }],
        onOpen: function (f) { f.querySelector("#np-gen").onclick = function () { f.querySelector("#np").value = generarClave(); }; },
        onSubmit: async function (f) {
          var pass = f.querySelector("#np").value.trim();
          if (pass.length < 8) { FX.toast("La contraseña debe tener al menos 8 caracteres.", true); return false; }
          try {
            await llamarAdminUsuarios({ accion: "asignar_password", email: u.email, password: pass });
          } catch (e) { FX.toast(e.message, true); return false; }
          await cargar();
          setTimeout(function () {
            FX.modal({
              title: "Listo",
              body: "<p>Contraseña " + (nueva ? "creada" : "asignada") + " para <strong>" + esc(u.email) + "</strong>:</p>" +
                '<p style="font:600 20px ui-monospace,Menlo,monospace;letter-spacing:.05em;background:var(--color-surface);padding:12px 14px;border-radius:10px;margin:12px 0;user-select:all">' + esc(pass) + "</p>" +
                '<p class="muted">Cópiala ahora: no se vuelve a mostrar. Entra en ' + (u.role === "asesor" ? "/cotizador/" : "/admin/") + ".</p>",
              actions: [{ label: "Copiar y cerrar", value: "ok", cls: "btn-primary" }],
              onSubmit: function () { try { navigator.clipboard.writeText(pass); FX.toast("Contraseña copiada"); } catch (e) { /* sin portapapeles */ } }
            });
          }, 50);
        }
      });
    }

    body.addEventListener("change", async function (e) {
      var s = e.target.closest("[data-r]"); if (!s) return;
      var u = list[+s.dataset.r];
      var res = await sb.from("user_roles").update({ role: s.value }).eq("email", u.email);
      if (res.error) { FX.toast(FX.errMsg(res.error), true); s.value = u.role; return; }
      FX.log("rol", u.email + " → " + s.value);
      FX.toast("Rol actualizado"); await cargar();
    });
    body.addEventListener("click", async function (e) {
      var p = e.target.closest("[data-p]");
      if (p) { asignarClave(list[+p.dataset.p]); return; }
      var b = e.target.closest("[data-x]"); if (!b) return;
      var u = list[+b.dataset.x];
      if (!(await FX.confirmar("Quitar acceso", "¿Quitar el rol de " + u.email + "? Podrá iniciar sesión, pero no verá nada hasta que le asignes un rol.", "Quitar"))) return;
      var res = await sb.from("user_roles").delete().eq("email", u.email);
      if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
      FX.log("rol", u.email + " sin acceso");
      await cargar();
    });
    el.querySelector("#u-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = el.querySelector("#u-email").value.trim().toLowerCase();
      if (!email) return;
      var res = await sb.from("user_roles").upsert({ email: email, role: el.querySelector("#u-rol").value, nombre: el.querySelector("#u-nombre").value.trim() || null });
      if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
      FX.log("rol", email + " → " + el.querySelector("#u-rol").value);
      e.target.reset(); await cargar();
      var nuevo = list.find(function (x) { return x.email === email; });
      if (nuevo && !estado[email]) asignarClave(nuevo); else FX.toast("Persona agregada");
    });
    await cargar();
  }

  /* ============================================================== Exportar */
  var DATASETS = [
    { n: "Portafolio", t: "projects", d: "Tarjetas de la landing principal" },
    { n: "Vértice", t: "units", d: "Unidades y disponibilidad" },
    { n: "Prisma", t: "prisma_units", d: "Unidades y disponibilidad" },
    { n: "Valle lotes", t: "lots", d: "Lotes, áreas, precios y disponibilidad" },
    { n: "Valle slider", t: "slider_images", d: "Fotos del slider" },
    { n: "Cotizador proyectos", t: "cotizador_proyectos", d: "Configuración de financiamiento por proyecto" },
    { n: "Cotizador unidades", t: "cotizador_unidades", d: "Unidades, precios y estado" },
    { n: "Cotizador extra", t: "cotizador_inventario_extra", d: "Parqueos, bodegas y lotes" },
    { n: "Asesores", t: "cotizador_asesores", d: "Directorio de asesores" },
    { n: "Historial proformas", t: "cotizador_historial", d: "Todas las proformas generadas", perm: "historial", order: "created_at" },
    { n: "Actividad", t: "actividad", d: "Registro de cambios del panel", order: "created_at" },
    { n: "Usuarios y roles", t: "user_roles", d: "Correos y roles del equipo", perm: "usuarios" }
  ];

  async function exportar(el) {
    var ds = DATASETS.filter(function (d) { return !d.perm || FX.can(d.perm); });
    el.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Descargar tablas</h2><p>Cada archivo es un Excel (.xlsx) con los datos actuales.</p></div>' +
      '<button class="btn btn-primary" id="x-all">' + icon("download") + "Todo en un solo Excel</button></div>" +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Tabla</th><th>Contenido</th><th class="actions"></th></tr></thead><tbody>' +
      ds.map(function (d, i) { return "<tr><td><strong>" + esc(d.n) + "</strong></td><td class=\"muted\">" + esc(d.d) + '</td><td class="actions"><button class="btn btn-ghost btn-sm" data-i="' + i + '">' + icon("download") + "Excel</button></td></tr>"; }).join("") +
      "</tbody></table></div>" +
      (FX.can("historial") ? '<p class="muted" style="margin-top:12px">Para el historial con formato de CRM (montos y fechas con formato) usa “Exportar a Excel” dentro de <a href="/cotizador/historial.html">Historial y dashboard</a>.</p>' : "") +
      "</section>";
    var hoy = new Date().toISOString().slice(0, 10);
    async function traer(d) { return FX.fetchAll(d.t, d.order ? { order: d.order, asc: false } : {}); }
    el.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-i]"); if (!b) return;
      var d = ds[+b.dataset.i];
      b.disabled = true;
      try { FX.exportXlsx([{ name: d.n, rows: await traer(d) }], "gpunlock-" + d.t + "-" + hoy + ".xlsx"); }
      catch (err) { FX.toast(FX.errMsg(err), true); }
      b.disabled = false;
    });
    el.querySelector("#x-all").onclick = async function () {
      var b = this; b.disabled = true; FX.toast("Preparando el archivo…");
      var sheets = [];
      for (var i = 0; i < ds.length; i++) {
        try { sheets.push({ name: ds[i].n, rows: await traer(ds[i]) }); } catch (err) { /* se omite la tabla sin acceso */ }
      }
      FX.exportXlsx(sheets, "gpunlock-plataforma-" + hoy + ".xlsx");
      b.disabled = false;
    };
  }

  /* ============================================================= Actividad */
  async function actividad(el) {
    el.innerHTML = '<section class="panel"><div class="panel-head"><div><h2>Actividad</h2><p>Últimos 300 cambios: estados de unidades, ediciones y roles.</p></div></div><div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th>Detalle</th></tr></thead><tbody id="a-body"><tr><td class="empty" colspan="4">Cargando…</td></tr></tbody></table></div></section>';
    var res = await sb.from("actividad").select("*").order("created_at", { ascending: false }).limit(300);
    var body = el.querySelector("#a-body");
    if (res.error) { body.innerHTML = '<tr><td class="empty" colspan="4">' + esc(FX.errMsg(res.error)) + "</td></tr>"; return; }
    var nombres = { estado: "Cambio de estado", crear: "Creación", editar: "Edición", eliminar: "Eliminación", rol: "Usuarios", dashboard: "Dashboard" };
    body.innerHTML = res.data.length ? res.data.map(function (a) {
      return "<tr><td>" + esc(FX.fecha(a.created_at, true)) + "</td><td>" + esc(a.email || "—") + "</td><td>" + esc(nombres[a.accion] || a.accion) + "</td><td>" + esc(a.detalle || "") + "</td></tr>";
    }).join("") : '<tr><td class="empty" colspan="4">Sin actividad todavía.</td></tr>';
  }

  /* ============================================================ Mi cuenta */
  async function cuenta(el) {
    var r = FX.ROLES[FX.state.rol] || {};
    el.innerHTML = '<div class="grid-2"><section class="panel"><div class="panel-head"><h2>Mi cuenta</h2></div><dl class="kv"><dt>Correo</dt><dd>' + esc(FX.state.user.email) + "</dd><dt>Rol</dt><dd>" + esc(r.label) + '</dd></dl><p class="muted" style="margin-top:12px">' + esc(r.desc) + "</p></section>" +
      '<section class="panel"><div class="panel-head"><h2>Cambiar contraseña</h2></div><form id="pw-form" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="fld"><span>Nueva contraseña</span><input type="password" id="pw1" minlength="8" autocomplete="new-password" required><small>Mínimo 8 caracteres.</small></label>' +
      '<label class="fld"><span>Repite la contraseña</span><input type="password" id="pw2" minlength="8" autocomplete="new-password" required></label>' +
      '<button class="btn btn-primary" type="submit" style="align-self:flex-start">Guardar contraseña</button></form>' +
      '<p class="muted" style="margin-top:14px;font-size:14px">Si olvidas tu contraseña, pide al editor que te asigne una nueva.</p></section></div>';
    el.querySelector("#pw-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var a = el.querySelector("#pw1").value, b = el.querySelector("#pw2").value;
      if (a !== b) { FX.toast("Las contraseñas no coinciden.", true); return; }
      var res = await sb.auth.updateUser({ password: a });
      if (res.error) { FX.toast(FX.errMsg(res.error), true); return; }
      e.target.reset(); FX.toast("Contraseña actualizada");
    });
  }

  return {
    INV: INV, escritorio: escritorio, inventario: inventario, portafolio: portafolio, slider: slider,
    usuarios: usuarios, exportar: exportar, actividad: actividad, cuenta: cuenta
  };
})();
