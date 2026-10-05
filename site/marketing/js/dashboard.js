// ============================================================================
// GPUnlock Dashboard — motor de renderizado.
// Todo lo que se ve en index.html sale de UN solo objeto de datos (ver
// js/data.js para su forma exacta). Ese objeto viene de Supabase si está
// configurado y responde; si no, se usa el respaldo local GPUNLOCK_DEFAULT_DATA.
// ============================================================================

/* ---------------------------------------------------------------------- */
/* Utilidades                                                             */
/* ---------------------------------------------------------------------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convierte **negrita** (ya escapado) en <b>negrita</b>. Se aplica DESPUÉS
// de escapeHtml, así el texto que venga del panel nunca puede inyectar HTML.
function richText(str) {
  return escapeHtml(str).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("es-EC");
}

async function fetchDashboardData() {
  const sb = window.GPUNLOCK_SUPABASE;
  if (sb && sb.isConfigured) {
    try {
      const { data, error } = await sb.client
        .from("dashboard_content")
        .select("data, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (!error && data && data.data) {
        return { data: data.data, updatedAt: data.updated_at, source: "supabase" };
      }
      console.warn("Supabase no devolvió contenido, usando respaldo local.", error);
    } catch (err) {
      console.warn("No se pudo conectar a Supabase, usando respaldo local.", err);
    }
  }
  return { data: window.GPUNLOCK_DEFAULT_DATA, updatedAt: null, source: "local" };
}

/* ---------------------------------------------------------------------- */
/* Tema: los colores de d.theme se inyectan como variables CSS en vivo,   */
/* así que editar un color en el Panel de Control cambia TODO el sitio    */
/* (tarjetas, barras, gráficos) de forma consistente.                     */
/* ---------------------------------------------------------------------- */
function applyTheme(d) {
  const t = d.theme || {};
  const root = document.documentElement.style;
  const map = {
    primary1: "--gp-orange-1",
    primary2: "--gp-orange-2",
    navy: "--navy",
    navy2: "--navy2",
    teal: "--teal",
    gold: "--gold",
    terracotta: "--terracotta",
    green: "--green",
    red: "--red",
    slate: "--slate",
  };
  Object.keys(map).forEach((k) => {
    if (t[k]) root.setProperty(map[k], t[k]);
  });
  if (t.primary1 && t.primary2) {
    root.setProperty("--gp-gradient", `linear-gradient(135deg, ${t.primary2} 0%, ${t.primary1} 100%)`);
  }
}

/* ---------------------------------------------------------------------- */
/* Render: encabezado / estado de datos                                   */
/* ---------------------------------------------------------------------- */
function renderMeta(d) {
  document.title = "GPUnlock · " + d.meta.title + " · " + d.meta.periodValue;
  document.getElementById("m-eyebrow").textContent = d.meta.eyebrow;
  document.getElementById("m-title").textContent = d.meta.title;
  document.getElementById("m-subtitle").textContent = d.meta.subtitle;
  document.getElementById("m-period-label").textContent = d.meta.periodLabel;
  document.getElementById("m-period-value").textContent = d.meta.periodValue;
}

function renderDataStatus(result) {
  const el = document.getElementById("data-status");
  if (!el) return;
  if (result.source === "supabase") {
    const when = result.updatedAt
      ? new Date(result.updatedAt).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" })
      : "—";
    el.classList.remove("offline");
    el.innerHTML = `<span class="dot"></span> Datos en vivo (Supabase) · actualizado ${escapeHtml(when)}`;
  } else {
    el.classList.add("offline");
    el.innerHTML = `<span class="dot"></span> Mostrando datos de ejemplo (Supabase no configurado)`;
  }
}

/* ---------------------------------------------------------------------- */
/* Render: insights                                                       */
/* ---------------------------------------------------------------------- */
function renderInsights(d) {
  const wrap = document.getElementById("insights-wrap");
  wrap.innerHTML = d.insights
    .map((c) => {
      const cls = c.type && c.type !== "normal" ? " " + c.type : "";
      return `<div class="insight-card${cls}">
        <div class="tag">${escapeHtml(c.tag)}</div>
        <p>${richText(c.text)}</p>
      </div>`;
    })
    .join("");
}

/* ---------------------------------------------------------------------- */
/* Render: KPIs                                                           */
/* ---------------------------------------------------------------------- */
function renderKpis(d) {
  const wrap = document.getElementById("kpi-wrap");
  wrap.innerHTML = d.kpis
    .map((k) => {
      const colorStyle = k.valueColor ? ` style="color:var(--${k.valueColor})"` : "";
      const suffix = k.suffix ? `<small>${escapeHtml(k.suffix)}</small>` : "";
      const delta = k.delta
        ? `<span class="delta ${escapeHtml(k.delta.type)}">${escapeHtml(k.delta.text)}</span>`
        : "";
      return `<div class="kpi-card">
        <div class="label">${escapeHtml(k.label)}</div>
        <div class="num"${colorStyle}>${escapeHtml(k.value)}${suffix}</div>
        <div class="foot">${delta}<span class="ctx">${escapeHtml(k.ctx)}</span></div>
      </div>`;
    })
    .join("");
}

/* ---------------------------------------------------------------------- */
/* Render: cumplimiento de metas                                          */
/* ---------------------------------------------------------------------- */
function renderCumplimiento(d) {
  const c = d.cumplimiento;
  const wrap = document.getElementById("cumplimiento-wrap");
  wrap.innerHTML = c.rows
    .map((row) => {
      const ticks = row.ticks
        .map((t) => `<div class="bar-tick ${t.type === "gold" ? "gold" : ""}" style="left:${t.pos}%"></div>`)
        .join("");
      const legend = row.legend
        .map((l) => {
          const cls = l.emphasis === "bad" ? "bad-text" : l.emphasis === "good" ? "good-text" : "";
          return `<span class="${cls}">${escapeHtml(l.text)}</span>`;
        })
        .join("");
      return `<div class="progress-row">
        <div class="top-row">
          <span class="p-label">${escapeHtml(row.label)}</span>
          <span class="p-value ${escapeHtml(row.status)}">${escapeHtml(row.valueLabel)}</span>
        </div>
        <div class="bar-outer">
          <div class="bar-fill ${row.status === "bad" ? "bad" : ""}" style="width:${row.barWidth}%"></div>
          ${ticks}
        </div>
        <div class="legend-line">${legend}</div>
      </div>`;
    })
    .join("");
  document.getElementById("cumplimiento-note").innerHTML = richText(c.note);
}

/* ---------------------------------------------------------------------- */
/* Render: funnel                                                         */
/* ---------------------------------------------------------------------- */
function renderFunnel(d) {
  const f = d.funnel;
  const wrap = document.getElementById("funnel-wrap");
  let html = "";
  f.rows.forEach((row) => {
    if (row.connectorLabel) {
      html += `<div class="funnel-conv">${escapeHtml(row.connectorLabel)}</div>`;
    }
    html += `<div class="funnel-row">
      <span class="funnel-label">${escapeHtml(row.label)}</span>
      <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${row.widthPct}%;background:var(--${row.colorKey});">${escapeHtml(row.value)}</div></div>
    </div>`;
  });
  wrap.innerHTML = html;
  document.getElementById("funnel-note").innerHTML = richText(f.note);
}

/* ---------------------------------------------------------------------- */
/* Render: fuente de ventas (tabla)                                       */
/* ---------------------------------------------------------------------- */
function renderFuenteVentas(d) {
  const fv = d.fuenteVentas;
  document.getElementById("fuente-tag").textContent = fv.sectionTag;
  const tbody = document.getElementById("fuente-tbody");
  tbody.innerHTML = fv.rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.canal)}</td>
      <td class="num-cell">${fmtMoney(r.ingresos)}</td>
      <td class="num-cell">${r.pct}%</td>
    </tr>`
    )
    .join("");
  document.getElementById("fuente-note").innerHTML = richText(fv.note);
}

/* ---------------------------------------------------------------------- */
/* Render: asesores (tabla)                                                */
/* ---------------------------------------------------------------------- */
function renderAsesores(d) {
  const a = d.asesores;
  const tbody = document.getElementById("asesores-tbody");
  tbody.innerHTML = a.rows
    .map((r) => {
      const avance =
        r.avancePct === null || r.avancePct === undefined
          ? `<span class="zero-flag">Sin actividad registrada</span>`
          : `<span class="mini-bar-outer"><span class="mini-bar-fill" style="width:${Math.min(r.avancePct, 100)}%"></span></span>${r.avancePct}%`;
      return `<tr>
        <td class="adv-name">${escapeHtml(r.nombre)}</td>
        <td class="num-cell">${fmtMoney(r.ago)}</td>
        <td class="num-cell">${r.captacYtd}</td>
        <td>${avance}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("asesores-note").innerHTML = richText(a.note);
}

/* ---------------------------------------------------------------------- */
/* Render: social media                                                   */
/* ---------------------------------------------------------------------- */
function renderSocial(d) {
  const s = d.social;
  document.getElementById("social-sub").textContent = s.periodNote;
  document.getElementById("social-tag").textContent = s.sectionTag;

  document.getElementById("social-platforms").innerHTML = s.platforms
    .map(
      (p) => `<div class="platform-card">
      <div class="p-name">${escapeHtml(p.name)}</div>
      <div class="p-num">${escapeHtml(p.value)}</div>
      <div class="p-delta"><span class="delta ${escapeHtml(p.deltaType)}">${escapeHtml(p.delta)}</span></div>
    </div>`
    )
    .join("");

  document.getElementById("social-overview").innerHTML = s.overview
    .map((o) => {
      const deltaHtml =
        o.deltaType === "ctx"
          ? `<span class="ctx" style="color:var(--muted-2)">${escapeHtml(o.delta)}</span>`
          : `<span class="delta ${escapeHtml(o.deltaType)}">${escapeHtml(o.delta)}</span>`;
      return `<div class="platform-card">
        <div class="p-name">${escapeHtml(o.name)}</div>
        <div class="p-num">${escapeHtml(o.value)}</div>
        <div class="p-delta">${deltaHtml}</div>
      </div>`;
    })
    .join("");

  document.getElementById("social-note1").innerHTML = richText(s.note1);

  document.getElementById("inversion-tbody").innerHTML = s.inversionRows
    .map((r) => {
      const varColor = r.varType === "down" ? "var(--red)" : r.varType === "good" ? "var(--green)" : "var(--muted)";
      return `<tr>
        <td>${escapeHtml(r.plataforma)}</td>
        <td class="num-cell">${escapeHtml(r.impresiones)}</td>
        <td class="num-cell">${escapeHtml(r.gasto)}</td>
        <td class="num-cell" style="color:${varColor}">${escapeHtml(r.var)}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("social-note2").innerHTML = richText(s.note2);

  document.getElementById("benchmark-wrap").innerHTML = s.benchmarkRows
    .map(
      (b) => `<div class="benchmark-row${b.self ? " self" : ""}">
      <span class="bname">${escapeHtml(b.name)}</span>
      <div class="benchmark-bar-outer"><div class="benchmark-bar-fill" style="width:${b.widthPct}%"></div></div>
      <span class="benchmark-val">${escapeHtml(b.value)}</span>
    </div>`
    )
    .join("");
  document.getElementById("social-note3").innerHTML = richText(s.note3);
}

/* ---------------------------------------------------------------------- */
/* Render: footer                                                         */
/* ---------------------------------------------------------------------- */
function renderFooter(d) {
  document.getElementById("footer-fuentes").innerHTML = "<b>Fuentes:</b> " + escapeHtml(d.footer.fuentes);
  document.getElementById("footer-notas").innerHTML = "<b>Notas metodológicas:</b> " + richText(d.footer.notas);
  document.getElementById("footer-generado").textContent = d.footer.generado;
}

/* ---------------------------------------------------------------------- */
/* Charts (Chart.js)                                                      */
/* ---------------------------------------------------------------------- */
function renderCharts(d) {
  const t = d.theme;
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = "#6B6B6B";
  Chart.defaults.font.size = 11.5;

  function gridOpt() {
    return { color: "#F1EEEC", drawTicks: false };
  }

  // ---- Ventas mensuales ----
  const vm = d.ventasMensuales;
  new Chart(document.getElementById("chartVentas"), {
    type: "bar",
    data: {
      labels: vm.months,
      datasets: [
        {
          type: "bar",
          label: "Ventas ($)",
          data: vm.data,
          backgroundColor: vm.data.map((v, i) => (i === vm.data.length - 1 ? t.gold : t.primary1)),
          borderRadius: 5,
          barPercentage: 0.6,
          order: 2,
        },
        {
          type: "line",
          label: `Meta mensual ($${vm.meta.toLocaleString("es-EC")})`,
          data: Array(vm.months.length).fill(vm.meta),
          borderColor: t.terracotta,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } } },
      scales: {
        y: { grid: gridOpt(), ticks: { callback: (v) => "$" + v.toLocaleString() } },
        x: { grid: { display: false } },
      },
    },
  });

  // ---- Leads ----
  const lead = d.leads;
  new Chart(document.getElementById("chartLeads"), {
    type: "bar",
    data: { labels: lead.months, datasets: [{ data: lead.leadsData, backgroundColor: t.teal, borderRadius: 4, barPercentage: 0.65 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grid: gridOpt(), ticks: { stepSize: 100 } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
    },
  });

  // ---- CPL ----
  new Chart(document.getElementById("chartCPL"), {
    type: "line",
    data: { labels: lead.months, datasets: [{ data: lead.cplData, borderColor: t.terracotta, backgroundColor: t.terracotta, pointRadius: 3, tension: 0.3, fill: false, borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grid: gridOpt(), ticks: { callback: (v) => "$" + v } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
    },
  });

  // ---- Conversión ----
  new Chart(document.getElementById("chartConv"), {
    type: "line",
    data: { labels: lead.months, datasets: [{ data: lead.convData, borderColor: t.green, backgroundColor: t.green, pointRadius: 3, tension: 0.3, fill: false, borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grid: gridOpt(), ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
    },
  });

  // ---- ROI ----
  const roi = d.roi;
  new Chart(document.getElementById("chartROI"), {
    type: "bar",
    data: {
      labels: roi.months,
      datasets: [
        { type: "bar", label: "Costo publicidad", data: roi.costo, backgroundColor: t.slate, borderRadius: 4, barPercentage: 0.55, yAxisID: "y" },
        { type: "bar", label: "Ingresos atribuidos", data: roi.ingresos, backgroundColor: t.primary1, borderRadius: 4, barPercentage: 0.55, yAxisID: "y" },
        { type: "line", label: "ROI (x)", data: roi.roiX, borderColor: t.gold, backgroundColor: t.gold, borderWidth: 2.5, pointRadius: 4, yAxisID: "y1", tension: 0.25 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 12, usePointStyle: true } } },
      scales: {
        y: { position: "left", grid: gridOpt(), ticks: { callback: (v) => "$" + v.toLocaleString() }, title: { display: true, text: "USD" } },
        y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => v + "x" }, title: { display: true, text: "ROI (x)" } },
        x: { grid: { display: false } },
      },
    },
  });

  // ---- Fuente de ventas (doughnut) ----
  const fv = d.fuenteVentas;
  new Chart(document.getElementById("chartFuente"), {
    type: "doughnut",
    data: {
      labels: fv.rows.map((r) => r.canal),
      datasets: [
        {
          data: fv.rows.map((r) => r.ingresos),
          backgroundColor: [t.primary1, t.teal, t.gold, t.terracotta, "#F5703F", "#F7B08D", "#E0B27A", "#D0977E", "#F9D2BE", "#C7CCD3"],
          borderColor: "#fff",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 11, font: { size: 11 }, padding: 10 } },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ": $" + ctx.parsed.toLocaleString() } },
      },
    },
  });

  // ---- Asesores ----
  const as = d.asesores;
  const colorFor = { gold: t.gold, navy: t.primary1, slate: t.slate };
  new Chart(document.getElementById("chartAsesores"), {
    type: "bar",
    data: {
      labels: as.rows.map((r) => r.nombre),
      datasets: [
        {
          data: as.rows.map((r) => r.ago),
          backgroundColor: as.rows.map((r) => colorFor[r.barColor] || t.slate),
          borderRadius: 4,
          barPercentage: 0.65,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => "$" + ctx.parsed.x.toLocaleString() } } },
      scales: { x: { grid: gridOpt(), ticks: { callback: (v) => "$" + v.toLocaleString() } }, y: { grid: { display: false } } },
    },
  });
}

/* ---------------------------------------------------------------------- */
/* Secciones simples (tags / notas sueltas)                               */
/* ---------------------------------------------------------------------- */
function renderSimpleSections(d) {
  document.getElementById("ventas-tag").textContent = d.ventasMensuales.sectionTag;
  document.getElementById("ventas-note").innerHTML = richText(d.ventasMensuales.note);
  document.getElementById("leads-tag").textContent = d.leads.sectionTag;
  document.getElementById("leads-ytd-label").textContent = d.leads.leadsYtdLabel;
  document.getElementById("leads-note").innerHTML = richText(d.leads.note);
  document.getElementById("roi-tag").textContent = d.roi.sectionTag;
  document.getElementById("roi-note").innerHTML = richText(d.roi.note);
}

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */
async function initDashboard() {
  const result = await fetchDashboardData();
  const d = result.data;
  applyTheme(d);
  renderMeta(d);
  renderDataStatus(result);
  renderInsights(d);
  renderKpis(d);
  renderSimpleSections(d);
  renderCumplimiento(d);
  renderFunnel(d);
  renderFuenteVentas(d);
  renderAsesores(d);
  renderSocial(d);
  renderFooter(d);
  renderCharts(d);
}

document.addEventListener("DOMContentLoaded", initDashboard);
