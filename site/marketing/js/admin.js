// ============================================================================
// Panel de Control — GPUnlock Dashboard.
// Motor genérico de formularios (campos + listas repetibles) + lógica de
// autenticación / guardado en Supabase. Todo lo que edita este panel vive en
// un único objeto STATE cuya forma exacta es la de js/data.js.
// ============================================================================

let STATE = null;
let dirty = false;
let localOnly = false;

/* ======================================================================
   Utilidades generales
   ====================================================================== */
function deepClone(obj) {
  return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

function showToast(msg, isError) {
  const t = document.getElementById("adm-toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isError);
  t.classList.add("show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(() => t.classList.remove("show"), 3200);
}

function markDirty() {
  dirty = true;
  const el = document.getElementById("adm-status");
  el.textContent = "Cambios sin guardar";
  el.classList.add("dirty");
  syncJsonTextarea();
}

function markClean(msg) {
  dirty = false;
  const el = document.getElementById("adm-status");
  el.textContent = msg || "Sin cambios";
  el.classList.remove("dirty");
}

/* ======================================================================
   Motor genérico de campos
   ====================================================================== */
function renderField(item, f) {
  const wrap = document.createElement("label");
  wrap.className = "adm-field" + (f.type === "textarea" || f.type === "checkbox" ? " adm-field-wide" : "");
  const labelEl = document.createElement("span");
  labelEl.className = "adm-field-label";
  labelEl.textContent = f.label;
  wrap.appendChild(labelEl);

  const get = f.get || ((it) => it[f.key]);
  const set = f.set || ((it, v) => { it[f.key] = v; });

  let input;
  if (f.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = f.rows || 3;
    input.value = get(item) ?? "";
    input.addEventListener("input", () => { set(item, input.value); markDirty(); });
  } else if (f.type === "select") {
    input = document.createElement("select");
    (f.options || []).forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      input.appendChild(opt);
    });
    input.value = get(item) ?? "";
    input.addEventListener("change", () => { set(item, input.value); markDirty(); });
  } else if (f.type === "checkbox") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!get(item);
    input.addEventListener("change", () => { set(item, input.checked); markDirty(); rerenderActiveSection(); });
  } else if (f.type === "number") {
    input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    const v = get(item);
    input.value = v === null || v === undefined ? "" : v;
    input.addEventListener("input", () => {
      const raw = input.value;
      set(item, raw === "" ? null : parseFloat(raw));
      markDirty();
    });
  } else if (f.type === "color") {
    const rowWrap = document.createElement("div");
    rowWrap.className = "adm-color-row";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    const textInput = document.createElement("input");
    textInput.type = "text";
    const v = get(item) || "#000000";
    colorInput.value = /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000";
    textInput.value = v;
    colorInput.addEventListener("input", () => {
      textInput.value = colorInput.value;
      set(item, colorInput.value);
      markDirty();
    });
    textInput.addEventListener("input", () => {
      set(item, textInput.value);
      if (/^#[0-9a-fA-F]{6}$/.test(textInput.value)) colorInput.value = textInput.value;
      markDirty();
    });
    rowWrap.appendChild(colorInput);
    rowWrap.appendChild(textInput);
    wrap.appendChild(rowWrap);
    return wrap;
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = get(item) ?? "";
    input.addEventListener("input", () => { set(item, input.value); markDirty(); });
  }
  if (f.placeholder) input.placeholder = f.placeholder;
  wrap.appendChild(input);
  return wrap;
}

function renderScalarForm(container, obj, fields) {
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "adm-field-grid";
  fields.forEach((f) => grid.appendChild(renderField(obj, f)));
  container.appendChild(grid);
}

function renderList(container, arr, fields, opts) {
  opts = opts || {};
  container.innerHTML = "";
  arr.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "adm-item-card";

    const header = document.createElement("div");
    header.className = "adm-item-head";
    const title = document.createElement("span");
    title.className = "adm-item-title";
    title.textContent = opts.itemLabel ? opts.itemLabel(item, idx) : "#" + (idx + 1);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "adm-btn-icon";
    removeBtn.title = "Eliminar";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      if (!confirm("¿Eliminar este elemento? Esta acción no se puede deshacer (hasta que guardes).")) return;
      arr.splice(idx, 1);
      renderList(container, arr, fields, opts);
      markDirty();
    });
    header.appendChild(title);
    header.appendChild(removeBtn);
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "adm-field-grid";
    fields.forEach((f) => grid.appendChild(renderField(item, f)));
    card.appendChild(grid);

    if (opts.nested) {
      const nestWrap = document.createElement("div");
      nestWrap.className = "adm-nested";
      opts.nested(nestWrap, item);
      card.appendChild(nestWrap);
    }

    container.appendChild(card);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "adm-btn-add";
  addBtn.textContent = opts.addLabel || "+ Agregar elemento";
  addBtn.addEventListener("click", () => {
    arr.push(opts.newItem ? opts.newItem() : {});
    renderList(container, arr, fields, opts);
    markDirty();
  });
  container.appendChild(addBtn);
}

// Tabla "meses x series" compartida por Ventas / Leads / ROI.
function renderSeriesEditor(container, monthsArr, series) {
  container.innerHTML = "";
  const table = document.createElement("table");
  table.className = "adm-series-table";
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Mes</th>" + series.map((s) => `<th>${s.label}</th>`).join("") + "<th></th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  monthsArr.forEach((month, idx) => {
    const tr = document.createElement("tr");

    const tdMonth = document.createElement("td");
    const monthInput = document.createElement("input");
    monthInput.type = "text";
    monthInput.value = month;
    monthInput.addEventListener("input", () => { monthsArr[idx] = monthInput.value; markDirty(); });
    tdMonth.appendChild(monthInput);
    tr.appendChild(tdMonth);

    series.forEach((s) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = s.arr[idx] ?? 0;
      input.addEventListener("input", () => {
        s.arr[idx] = input.value === "" ? 0 : parseFloat(input.value);
        markDirty();
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    const tdDel = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "adm-btn-icon";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar mes/columna";
    delBtn.addEventListener("click", () => {
      monthsArr.splice(idx, 1);
      series.forEach((s) => s.arr.splice(idx, 1));
      renderSeriesEditor(container, monthsArr, series);
      markDirty();
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "adm-btn-add";
  addBtn.style.marginTop = "8px";
  addBtn.textContent = "+ Agregar mes";
  addBtn.addEventListener("click", () => {
    monthsArr.push("Nuevo");
    series.forEach((s) => s.arr.push(0));
    renderSeriesEditor(container, monthsArr, series);
    markDirty();
  });
  container.appendChild(addBtn);
}

/* ======================================================================
   Especificaciones de cada sección
   ====================================================================== */
function renderAllSections() {
  // --- Encabezado ---
  renderScalarForm(document.getElementById("adm-meta"), STATE.meta, [
    { key: "eyebrow", label: "Texto pequeño superior" },
    { key: "title", label: "Título del dashboard" },
    { key: "subtitle", label: "Subtítulo", type: "textarea", rows: 2 },
    { key: "periodLabel", label: "Etiqueta del periodo (ej. 'Periodo de análisis')" },
    { key: "periodValue", label: "Valor del periodo (ej. 'Agosto 2026 · Acum. enero–agosto')" },
  ]);

  // --- Insights ---
  renderList(
    document.getElementById("adm-insights"),
    STATE.insights,
    [
      { key: "tag", label: "Etiqueta" },
      { key: "type", label: "Estilo", type: "select", options: [["normal", "Normal (azul)"], ["warn", "Advertencia (dorado)"], ["risk", "Riesgo (rojo)"]] },
      { key: "text", label: "Texto (usa **negrita** para resaltar)", type: "textarea", rows: 3 },
    ],
    {
      itemLabel: (it) => it.tag || "Insight",
      newItem: () => ({ tag: "Nuevo insight", type: "normal", text: "Texto del insight…" }),
      addLabel: "+ Agregar insight",
    }
  );

  // --- KPIs ---
  renderList(
    document.getElementById("adm-kpis"),
    STATE.kpis,
    [
      { key: "label", label: "Etiqueta" },
      { key: "value", label: "Valor (texto, ej. '$21,725' o '5.34')" },
      { key: "suffix", label: "Sufijo pequeño (ej. '%', 'x')" },
      { key: "valueColor", label: "Color del valor", type: "select", options: [["", "Normal (navy)"], ["green", "Verde"], ["red", "Rojo"]] },
      { key: "ctx", label: "Texto de contexto (debajo)" },
      {
        label: "¿Mostrar variación (▲/▼)?",
        type: "checkbox",
        get: (it) => !!it.delta,
        set: (it, v) => { it.delta = v ? (it.delta || { type: "up", text: "" }) : null; },
      },
      {
        label: "Tipo de variación",
        type: "select",
        options: [["up", "Positiva (verde)"], ["down", "Negativa (roja)"], ["flat", "Neutra (gris)"]],
        get: (it) => (it.delta ? it.delta.type : "up"),
        set: (it, v) => { if (!it.delta) it.delta = { type: v, text: "" }; else it.delta.type = v; },
      },
      {
        label: "Texto de variación (ej. '▲ 12.3%')",
        get: (it) => (it.delta ? it.delta.text : ""),
        set: (it, v) => { if (!it.delta) it.delta = { type: "up", text: v }; else it.delta.text = v; },
      },
    ],
    {
      itemLabel: (it) => it.label || "KPI",
      newItem: () => ({ label: "Nuevo KPI", value: "0", suffix: "", valueColor: "", delta: null, ctx: "" }),
      addLabel: "+ Agregar KPI",
    }
  );

  // --- Ventas mensuales ---
  renderScalarForm(document.getElementById("adm-ventas-scalar"), STATE.ventasMensuales, [
    { key: "sectionTag", label: "Etiqueta de la sección (ej. 'Total YTD: $127,493')" },
    { key: "meta", label: "Meta mensual ($)", type: "number" },
    { key: "note", label: "Nota inferior (usa **negrita**)", type: "textarea", rows: 2 },
  ]);
  renderSeriesEditor(document.getElementById("adm-ventas-series"), STATE.ventasMensuales.months, [
    { label: "Ventas ($)", arr: STATE.ventasMensuales.data },
  ]);

  // --- Cumplimiento ---
  renderList(
    document.getElementById("adm-cumplimiento"),
    STATE.cumplimiento.rows,
    [
      { key: "label", label: "Nombre de la meta" },
      { key: "valueLabel", label: "% mostrado (ej. '144.8%')" },
      { key: "status", label: "Estado", type: "select", options: [["good", "Bien (verde/azul)"], ["bad", "Mal (rojo)"]] },
      { key: "barWidth", label: "Ancho de la barra (0-100)", type: "number" },
    ],
    {
      itemLabel: (it) => it.label || "Meta",
      newItem: () => ({ label: "Nueva meta", valueLabel: "0%", status: "good", barWidth: 0, ticks: [], legend: [] }),
      addLabel: "+ Agregar meta",
      nested: (wrap, item) => {
        const tLabel = document.createElement("div");
        tLabel.className = "adm-nested-label";
        tLabel.textContent = "Marcadores de referencia sobre la barra";
        wrap.appendChild(tLabel);
        const tWrap = document.createElement("div");
        wrap.appendChild(tWrap);
        renderList(
          tWrap,
          item.ticks,
          [
            { key: "pos", label: "Posición % (0-100)", type: "number" },
            { key: "type", label: "Color", type: "select", options: [["navy", "Navy (100% meta)"], ["gold", "Dorado (ritmo esperado)"]] },
          ],
          { itemLabel: (t) => "Marcador " + t.pos + "%", newItem: () => ({ pos: 50, type: "navy" }), addLabel: "+ Agregar marcador" }
        );
        const lLabel = document.createElement("div");
        lLabel.className = "adm-nested-label";
        lLabel.style.marginTop = "14px";
        lLabel.textContent = "Textos de leyenda (debajo de la barra)";
        wrap.appendChild(lLabel);
        const lWrap = document.createElement("div");
        wrap.appendChild(lWrap);
        renderList(
          lWrap,
          item.legend,
          [
            { key: "text", label: "Texto" },
            { key: "emphasis", label: "Énfasis", type: "select", options: [["none", "Normal"], ["bad", "Rojo / negativo"], ["good", "Verde / positivo"]] },
          ],
          { itemLabel: (t) => t.text || "Texto", newItem: () => ({ text: "", emphasis: "none" }), addLabel: "+ Agregar texto" }
        );
      },
    }
  );
  renderScalarForm(document.getElementById("adm-cumplimiento-note"), STATE.cumplimiento, [
    { key: "note", label: "Nota general (usa **negrita**)", type: "textarea", rows: 3 },
  ]);

  // --- Leads ---
  renderScalarForm(document.getElementById("adm-leads-scalar"), STATE.leads, [
    { key: "sectionTag", label: "Etiqueta de la sección" },
    { key: "leadsYtdLabel", label: "Texto 'Total YTD' sobre el gráfico de leads" },
    { key: "note", label: "Nota inferior (usa **negrita**)", type: "textarea", rows: 3 },
  ]);
  renderSeriesEditor(document.getElementById("adm-leads-series"), STATE.leads.months, [
    { label: "Leads", arr: STATE.leads.leadsData },
    { label: "CPL ($)", arr: STATE.leads.cplData },
    { label: "Conversión (%)", arr: STATE.leads.convData },
  ]);

  // --- Funnel ---
  renderList(
    document.getElementById("adm-funnel"),
    STATE.funnel.rows,
    [
      { key: "label", label: "Etiqueta" },
      { key: "value", label: "Valor mostrado", type: "number" },
      { key: "widthPct", label: "Ancho de barra % (0-100)", type: "number" },
      { key: "colorKey", label: "Color", type: "select", options: [["navy2", "Azul oscuro"], ["teal", "Verde azulado"], ["gold", "Dorado"]] },
      { key: "connectorLabel", label: "Texto arriba de esta barra (dejar vacío si es la primera)", placeholder: "ej. 30.5% agenda cita" },
    ],
    {
      itemLabel: (it) => it.label || "Paso",
      newItem: () => ({ label: "Nuevo paso", value: 0, widthPct: 0, colorKey: "navy2", connectorLabel: "" }),
      addLabel: "+ Agregar paso del embudo",
    }
  );
  renderScalarForm(document.getElementById("adm-funnel-note"), STATE.funnel, [
    { key: "note", label: "Nota del embudo (usa **negrita**)", type: "textarea", rows: 2 },
  ]);

  // --- ROI ---
  renderScalarForm(document.getElementById("adm-roi-scalar"), STATE.roi, [
    { key: "sectionTag", label: "Etiqueta de la sección" },
    { key: "note", label: "Nota inferior (usa **negrita**)", type: "textarea", rows: 3 },
  ]);
  renderSeriesEditor(document.getElementById("adm-roi-series"), STATE.roi.months, [
    { label: "Costo publicidad ($)", arr: STATE.roi.costo },
    { label: "Ingresos atribuidos ($)", arr: STATE.roi.ingresos },
    { label: "ROI (x)", arr: STATE.roi.roiX },
  ]);

  // --- Fuente de ventas ---
  renderScalarForm(document.getElementById("adm-fuente-scalar"), STATE.fuenteVentas, [
    { key: "sectionTag", label: "Etiqueta de la sección" },
  ]);
  renderList(
    document.getElementById("adm-fuente"),
    STATE.fuenteVentas.rows,
    [
      { key: "canal", label: "Canal" },
      { key: "ingresos", label: "Ingresos ($)", type: "number" },
      { key: "pct", label: "% del total", type: "number" },
    ],
    {
      itemLabel: (it) => it.canal || "Canal",
      newItem: () => ({ canal: "Nuevo canal", ingresos: 0, pct: 0 }),
      addLabel: "+ Agregar canal",
    }
  );
  renderScalarForm(document.getElementById("adm-fuente-note"), STATE.fuenteVentas, [
    { key: "note", label: "Nota (usa **negrita**)", type: "textarea", rows: 2 },
  ]);

  // --- Asesores ---
  renderScalarForm(document.getElementById("adm-asesores-scalar"), STATE.asesores, [
    { key: "metaAnualIndividual", label: "Meta anual individual ($)", type: "number" },
  ]);
  renderList(
    document.getElementById("adm-asesores"),
    STATE.asesores.rows,
    [
      { key: "nombre", label: "Nombre" },
      { key: "ago", label: "Ventas del mes ($)", type: "number" },
      { key: "captacYtd", label: "Captaciones YTD", type: "number" },
      {
        label: "Sin actividad (oculta el % de avance)",
        type: "checkbox",
        get: (it) => it.avancePct === null || it.avancePct === undefined,
        set: (it, v) => { it.avancePct = v ? null : 0; },
      },
      { key: "avancePct", label: "% avance meta anual", type: "number" },
      { key: "barColor", label: "Color en el gráfico", type: "select", options: [["gold", "Dorado (top)"], ["navy", "Azul"], ["slate", "Gris"]] },
    ],
    {
      itemLabel: (it) => it.nombre || "Asesor",
      newItem: () => ({ nombre: "Nuevo asesor", ago: 0, captacYtd: 0, avancePct: 0, barColor: "navy" }),
      addLabel: "+ Agregar asesor",
    }
  );
  renderScalarForm(document.getElementById("adm-asesores-note"), STATE.asesores, [
    { key: "note", label: "Nota (usa **negrita**)", type: "textarea", rows: 2 },
  ]);

  // --- Social ---
  renderScalarForm(document.getElementById("adm-social-scalar"), STATE.social, [
    { key: "sectionTag", label: "Etiqueta de la sección" },
    { key: "periodNote", label: "Línea de fuente / periodo" },
  ]);
  renderList(
    document.getElementById("adm-social-platforms"),
    STATE.social.platforms,
    [
      { key: "name", label: "Red" },
      { key: "value", label: "Seguidores" },
      { key: "delta", label: "Texto variación (ej. '▲ 17.79%')" },
      { key: "deltaType", label: "Tipo", type: "select", options: [["up", "Positiva"], ["down", "Negativa"]] },
    ],
    { itemLabel: (it) => it.name || "Red", newItem: () => ({ name: "Nueva red", value: "0", delta: "▲ 0%", deltaType: "up" }), addLabel: "+ Agregar red" }
  );
  renderList(
    document.getElementById("adm-social-overview"),
    STATE.social.overview,
    [
      { key: "name", label: "Métrica" },
      { key: "value", label: "Valor" },
      { key: "delta", label: "Texto variación / contexto" },
      { key: "deltaType", label: "Tipo", type: "select", options: [["up", "Positiva"], ["down", "Negativa"], ["ctx", "Solo texto (gris)"]] },
    ],
    { itemLabel: (it) => it.name || "Métrica", newItem: () => ({ name: "Nueva métrica", value: "0", delta: "", deltaType: "ctx" }), addLabel: "+ Agregar métrica" }
  );
  renderScalarForm(document.getElementById("adm-social-note1"), STATE.social, [
    { key: "note1", label: "Nota (usa **negrita**)", type: "textarea", rows: 2 },
  ]);
  renderList(
    document.getElementById("adm-social-inversion"),
    STATE.social.inversionRows,
    [
      { key: "plataforma", label: "Plataforma" },
      { key: "impresiones", label: "Impresiones" },
      { key: "gasto", label: "Gasto" },
      { key: "var", label: "Variación (texto)" },
      { key: "varType", label: "Color variación", type: "select", options: [["down", "Rojo"], ["good", "Verde"], ["neutral", "Gris"]] },
    ],
    { itemLabel: (it) => it.plataforma || "Plataforma", newItem: () => ({ plataforma: "Nueva plataforma", impresiones: "0", gasto: "$0", var: "", varType: "neutral" }), addLabel: "+ Agregar plataforma" }
  );
  renderScalarForm(document.getElementById("adm-social-note2"), STATE.social, [
    { key: "note2", label: "Nota (usa **negrita**)", type: "textarea", rows: 2 },
  ]);
  renderList(
    document.getElementById("adm-social-benchmark"),
    STATE.social.benchmarkRows,
    [
      { key: "name", label: "Competidor / marca" },
      { key: "widthPct", label: "Ancho de barra % (0-100)", type: "number" },
      { key: "value", label: "Valor mostrado (ej. '2.98%')" },
      { key: "self", label: "Es GPUnlock (resaltar)", type: "checkbox" },
    ],
    { itemLabel: (it) => it.name || "Competidor", newItem: () => ({ name: "Nuevo", widthPct: 0, value: "0%", self: false }), addLabel: "+ Agregar fila" }
  );
  renderScalarForm(document.getElementById("adm-social-note3"), STATE.social, [
    { key: "note3", label: "Nota (usa **negrita**)", type: "textarea", rows: 2 },
  ]);

  // --- Footer ---
  renderScalarForm(document.getElementById("adm-footer"), STATE.footer, [
    { key: "fuentes", label: "Fuentes de datos", type: "textarea", rows: 2 },
    { key: "notas", label: "Notas metodológicas (usa **negrita**)", type: "textarea", rows: 4 },
    { key: "generado", label: "Línea de 'Generado el…'" },
  ]);

  // --- Theme ---
  renderScalarForm(document.getElementById("adm-theme"), STATE.theme, [
    { key: "primary1", label: "Azul primario (oscuro del degradado)", type: "color" },
    { key: "primary2", label: "Azul primario (claro del degradado)", type: "color" },
    { key: "navy", label: "Navy (fondo encabezado)", type: "color" },
    { key: "navy2", label: "Navy secundario", type: "color" },
    { key: "teal", label: "Verde azulado", type: "color" },
    { key: "gold", label: "Dorado", type: "color" },
    { key: "terracotta", label: "Terracota", type: "color" },
    { key: "green", label: "Verde (positivo)", type: "color" },
    { key: "red", label: "Rojo (negativo)", type: "color" },
    { key: "slate", label: "Gris pizarra", type: "color" },
  ]);

  syncJsonTextarea();
}

function rerenderActiveSection() {
  renderAllSections();
}

/* ======================================================================
   JSON avanzado
   ====================================================================== */
function syncJsonTextarea() {
  const ta = document.getElementById("adm-json-textarea");
  if (!ta) return;
  if (document.activeElement === ta) return; // no pisar mientras el usuario escribe ahí
  ta.value = JSON.stringify(STATE, null, 2);
}

function applyJsonTextarea() {
  const ta = document.getElementById("adm-json-textarea");
  const msg = document.getElementById("adm-json-msg");
  try {
    const parsed = JSON.parse(ta.value);
    STATE = parsed;
    renderAllSections();
    markDirty();
    msg.textContent = "JSON aplicado correctamente a todos los formularios.";
    msg.className = "adm-json-msg ok";
  } catch (err) {
    msg.textContent = "JSON inválido: " + err.message;
    msg.className = "adm-json-msg err";
  }
}

/* ======================================================================
   Carga / guardado
   ====================================================================== */
async function loadContent() {
  const sb = window.GPUNLOCK_SUPABASE;
  if (sb.isConfigured && !localOnly) {
    try {
      const { data, error } = await sb.client.from("dashboard_content").select("data").eq("id", 1).maybeSingle();
      if (!error && data && data.data) {
        STATE = data.data;
        return;
      }
    } catch (err) {
      console.warn("No se pudo leer Supabase, se cargan datos de ejemplo.", err);
    }
  }
  STATE = deepClone(window.GPUNLOCK_DEFAULT_DATA);
}

async function saveContent() {
  const sb = window.GPUNLOCK_SUPABASE;
  if (!sb.isConfigured || localOnly) {
    showToast("Supabase no está configurado: usa \"Descargar JSON\" para guardar tus cambios por ahora.", true);
    return;
  }
  const btn = document.getElementById("btn-save");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const { error } = await sb.client
      .from("dashboard_content")
      .upsert({ id: 1, data: STATE, updated_at: new Date().toISOString() });
    if (error) throw error;
    markClean("Guardado " + new Date().toLocaleTimeString("es-EC"));
    try {
      const u = (await sb.client.auth.getUser()).data.user;
      await sb.client.from("actividad").insert({ email: u.email, accion: "dashboard", detalle: "Dashboard de marketing actualizado" });
    } catch (e) { /* el registro no bloquea el guardado */ }
    showToast("Cambios guardados correctamente.");
  } catch (err) {
    showToast("Error al guardar: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gpunlock-dashboard-datos.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ======================================================================
   Autenticación
   ====================================================================== */
function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("admin-app").style.display = "block";
}

function showLogin() {
  document.getElementById("admin-app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
}

async function boot() {
  const sb = window.GPUNLOCK_SUPABASE;

  // Login compartido con el panel /admin/: sin sesión se va allá; solo los
  // roles editor y marketing pueden editar este dashboard.
  if (sb.isConfigured) {
    const ses = await sb.client.auth.getSession();
    if (!ses.data || !ses.data.session) { location.replace("/admin/"); return; }
    const rol = await sb.client.rpc("mi_rol");
    if (["editor", "marketing"].indexOf(rol.data) === -1) { location.replace("index.html"); return; }
  }
  document.getElementById("login-admin-email").textContent = sb.adminEmail;

  if (!sb.isConfigured) {
    document.getElementById("login-config-warning").style.display = "block";
  }

  document.getElementById("btn-local-mode").addEventListener("click", async () => {
    localOnly = true;
    await loadContent();
    renderAllSections();
    showApp();
    showToast("Modo local: los cambios no se guardan en la nube.");
  });

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("login-error");
    errEl.classList.remove("show");
    if (!sb.isConfigured) {
      errEl.textContent = "Supabase no está configurado todavía (ver README.md). Usa \"modo local\" mientras tanto.";
      errEl.classList.add("show");
      return;
    }
    const password = document.getElementById("login-password").value;
    const { error } = await sb.client.auth.signInWithPassword({ email: sb.adminEmail, password });
    if (error) {
      errEl.textContent = "Contraseña incorrecta, o el usuario " + sb.adminEmail + " aún no existe en Supabase (ver README.md, Paso 2).";
      errEl.classList.add("show");
      return;
    }
    await loadContent();
    renderAllSections();
    showApp();
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (sb.isConfigured) await sb.client.auth.signOut();
    location.replace("/admin/");
  });

  document.getElementById("btn-save").addEventListener("click", saveContent);
  document.getElementById("btn-export").addEventListener("click", exportJson);
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!confirm("Esto reemplaza TODOS los campos por los datos de ejemplo originales. ¿Continuar?")) return;
    STATE = deepClone(window.GPUNLOCK_DEFAULT_DATA);
    renderAllSections();
    markDirty();
  });
  document.getElementById("btn-json-apply").addEventListener("click", applyJsonTextarea);
  document.getElementById("btn-json-refresh").addEventListener("click", () => {
    document.getElementById("adm-json-textarea").value = JSON.stringify(STATE, null, 2);
  });
  document.getElementById("btn-json-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("adm-json-textarea").value);
      showToast("JSON copiado al portapapeles.");
    } catch {
      showToast("No se pudo copiar automáticamente.", true);
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ¿Ya hay una sesión activa?
  if (sb.isConfigured) {
    const { data } = await sb.client.auth.getSession();
    if (data && data.session) {
      await loadContent();
      renderAllSections();
      showApp();
      return;
    }
  }
  showLogin();
}

document.addEventListener("DOMContentLoaded", boot);
