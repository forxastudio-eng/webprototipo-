// Gráficos del Dashboard de preferencias (historial.html): donut, barras y
// línea, todos en SVG "a mano" — nada de Chart.js/D3. Dos razones: (1) el
// sitio no tiene build step y ya evita dependencias pesadas donde puede
// evitarlas, y (2) SVG imprime nítido en el "Exportar a PDF" sin depender de
// que el navegador tenga activado "Gráficos de fondo" (a diferencia de
// colores puestos con CSS background, que si dependen de esa opción).
//
// Paleta: el naranja y los neutros de la marca GPUnlock (ver /css/gp-tokens.css),
// alternando claro/oscuro para que porciones vecinas se distingan bien.

const CHART_PALETTE = [
  '#F2582B', // naranja GPUnlock
  '#161616', // tinta (wordmark)
  '#F08A30', // ámbar GPUnlock
  '#6B6B6B', // grafito
  '#F7C4A8', // durazno
  '#C9421B', // naranja profundo
  '#B5B5B5', // gris niebla
  '#262626', // carbón
];
function chartColor(i) { return CHART_PALETTE[i % CHART_PALETTE.length]; }

// Recorta a 6 categorías para donuts (más de eso, la guía de accesibilidad
// de gráficos recomienda agrupar el resto en "Otros" en vez de amontonar
// porciones indistinguibles) y ordena de mayor a menor — la porción más
// grande queda a las 12, que es la lectura más natural.
function prepararEntriesDonut(entries, maxSlices = 6) {
  const ordenado = [...entries].sort((a, b) => b.value - a.value);
  if (ordenado.length <= maxSlices) return ordenado;
  const top = ordenado.slice(0, maxSlices - 1);
  const restoValue = ordenado.slice(maxSlices - 1).reduce((a, e) => a + e.value, 0);
  return [...top, { label: 'Otros', value: restoValue }];
}

// Dona vía "stacked circles" (stroke-dasharray por segmento) — más simple y
// robusto que construir arcos a mano con paths, y el resultado es idéntico.
function svgDonut(entries, { size = 132, thickness = 20 } = {}) {
  const total = entries.reduce((a, b) => a + b.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const segmentos = entries.map((e, i) => {
    const pct = total ? e.value / total : 0;
    const dash = pct * circumference;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${e.color || chartColor(i)}"
      stroke-width="${thickness}" stroke-dasharray="${dash} ${circumference - dash}"
      stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    acc += dash;
    return seg;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--crema)" stroke-width="${thickness}"></circle>
    ${segmentos}
  </svg>`;
}

// Tarjeta donut + leyenda (dot, etiqueta, valor y %) + total al centro —
// la leyenda hace de "tabla accesible": todo lo que cuenta el color también
// está como texto, no solo como porción de color.
function renderDonutCard(containerId, entriesRaw, { centerLabel, centerValueFmt = (v) => v } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const conDatos = entriesRaw.filter(e => e.value > 0);
  if (!conDatos.length) { el.innerHTML = '<div class="empty-state">Sin datos para estos filtros.</div>'; return; }
  const entries = prepararEntriesDonut(conDatos).map((e, i) => ({ ...e, color: e.color || chartColor(i) }));
  const total = entries.reduce((a, b) => a + b.value, 0);
  const donut = svgDonut(entries);
  const legend = entries.map(e => `
    <div class="chart-legend-row">
      <span class="dot" style="background:${e.color}"></span>
      <span class="chart-legend-label">${e.label}</span>
      <span class="chart-legend-value">${e.value} <span class="pct">(${total ? Math.round(e.value / total * 100) : 0}%)</span></span>
    </div>`).join('');
  el.innerHTML = `
    <div class="donut-row">
      <div class="donut-svg-wrap">
        ${donut}
        ${centerLabel ? `<div class="donut-center"><span class="v">${centerValueFmt(total)}</span><span class="l">${centerLabel}</span></div>` : ''}
      </div>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

// Barras verticales (rango de precio, dormitorios preferidos): valor arriba
// de cada barra, etiqueta abajo — nunca solo color, siempre número visible.
function svgBarChart(entries, { width = 460, height = 190, valueFmt = (v) => v } = {}) {
  if (!entries.length) return '';
  const max = Math.max(...entries.map(e => e.value), 1);
  const padTop = 26, padBottom = 30, padSide = 10;
  const chartH = height - padTop - padBottom;
  const n = entries.length;
  const gap = 12;
  const barW = Math.max(16, (width - padSide * 2 - gap * (n - 1)) / n);
  let x = padSide;
  const partes = entries.map((e, i) => {
    const h = max ? (e.value / max) * chartH : 0;
    const y = padTop + (chartH - h);
    const color = e.color || chartColor(i);
    const cx = x + barW / 2;
    const svg = `
      <text x="${cx}" y="${Math.max(12, y - 8)}" text-anchor="middle" class="bar-value">${valueFmt(e.value)}</text>
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 1)}" rx="5" fill="${color}"></rect>
      <text x="${cx}" y="${height - 8}" text-anchor="middle" class="bar-label">${e.label}</text>`;
    x += barW + gap;
    return svg;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${partes}</svg>`;
}

// Línea/área para "demanda por período" — un punto por mes, con el valor
// encima de cada punto (igual que las barras: el número siempre visible).
function svgLineChart(points, { width = 680, height = 200 } = {}) {
  if (!points.length) return '';
  const max = Math.max(...points.map(p => p.value), 1);
  const padTop = 26, padBottom = 30, padSide = 22;
  const chartW = width - padSide * 2;
  const chartH = height - padTop - padBottom;
  const n = points.length;
  const stepX = n > 1 ? chartW / (n - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padSide + stepX * i,
    y: padTop + (chartH - (p.value / max) * chartH),
    ...p,
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const base = padTop + chartH;
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${base} L ${coords[0].x.toFixed(1)} ${base} Z`;
  const dots = coords.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="var(--olive)"></circle>`).join('');
  const labels = coords.map(c => `<text x="${c.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="bar-label">${c.label}</text>`).join('');
  const values = coords.map(c => `<text x="${c.x.toFixed(1)}" y="${Math.max(12, c.y - 10)}" text-anchor="middle" class="bar-value">${c.value}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">
    <path d="${areaPath}" fill="var(--olive)" opacity="0.12"></path>
    <path d="${linePath}" fill="none" stroke="var(--olive)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
    ${dots}${labels}${values}
  </svg>`;
}

// Barras horizontales tipo "leaderboard" (demanda por unidad, precio
// promedio por proyecto, mayor/menor tipología) — ya existía una versión
// simple de esto; queda generalizada para reusar en varios reportes.
function renderRankedBars(containerId, entries, { formatValue = (v) => v, showPct = true } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!entries.length) { el.innerHTML = '<div class="empty-state">Sin datos para estos filtros.</div>'; return; }
  const max = Math.max(...entries.map(e => e.value));
  const total = entries.reduce((a, b) => a + b.value, 0);
  el.innerHTML = entries.map((e, i) => `
    <div class="dash-bar-row">
      <div class="dash-bar-label">${e.label}</div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${max ? (e.value / max * 100) : 0}%;background:${e.color || chartColor(i)};"></div></div>
      <div class="dash-bar-count"><strong>${formatValue(e.value)}</strong>${showPct && total ? ` <span>(${Math.round(e.value / total * 100)}%)</span>` : ''}</div>
    </div>`).join('');
}
