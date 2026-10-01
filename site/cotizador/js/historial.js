// Historial de proformas: solo lo ven los roles editor, administrador y
// marketing (public.user_roles, ver /supabase/06_politicas.sql). El resto
// de asesores sigue generando proformas normalmente, solo no pueden leer
// este historial (ni desde aquí ni consultando la tabla directamente — la
// política de RLS en Supabase lo bloquea a nivel de base de datos).

let HISTORIAL = [];
let PROYECTOS_FILTRO = [];

async function boot() {
  const result = await CotizadorAuth.requireHistorialAccess();
  if (!result) return; // requireSession ya redirigió a index.html (no hay sesión)
  const { user, puedeVerHistorial } = result;

  document.getElementById('header-actions').innerHTML = `
    <span class="user-pill">${user.email}</span>
    <a href="/admin/#/cuenta">Mi cuenta</a>
    <a href="/admin/">Panel</a>
    <a href="index.html">Ver cotizador</a>
    ${CotizadorAuth.getIsAdmin() ? '<a href="admin.html">Configurar</a>' : ''}
    <button id="logout-btn">Cerrar sesión</button>`;
  document.getElementById('logout-btn').onclick = async () => { await CotizadorAuth.logout(); location.href = 'index.html'; };

  if (!puedeVerHistorial) {
    document.getElementById('sin-permisos').hidden = false;
    document.getElementById('sin-permisos').innerHTML = `
      <div class="card" style="text-align:center;padding:48px 32px;">
        <h3 class="centered">Tu cuenta no tiene acceso al historial</h3>
        <p class="hint" style="max-width:440px;margin:0 auto 18px;">
          El historial de proformas contiene datos de clientes y solo lo ven los roles editor,
          administrador y marketing. Tu usuario (<strong>${user.email}</strong>) puede seguir
          generando proformas normalmente desde el cotizador.
        </p>
        <a href="index.html" class="btn btn-primary">Ir al cotizador</a>
      </div>`;
    return;
  }

  document.getElementById('historial-content').hidden = false;
  await cargarProyectosFiltro();
  await cargarTipologiasFiltro();
  wireFiltros();
  wireTabs();
  document.getElementById('dash-exportar').onclick = () => exportarDashboardPDF();
  await cargarHistorial();
}

async function cargarProyectosFiltro() {
  const { data } = await supabaseClient.from('cotizador_proyectos').select('id, nombre').order('sort_order');
  PROYECTOS_FILTRO = data || [];
  const sel = document.getElementById('f-proyecto');
  sel.innerHTML = '<option value="">Todos los proyectos</option>' +
    PROYECTOS_FILTRO.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
}

// Tipologías disponibles para filtrar/graficar: se leen una sola vez de todo
// el historial (no del resultado ya filtrado), para que la lista de opciones
// no se vaya reduciendo a medida que se aplican otros filtros.
async function cargarTipologiasFiltro() {
  const { data, error } = await supabaseClient.from('cotizador_historial').select('unidades').limit(2000);
  const sel = document.getElementById('f-tipologia');
  if (error || !data) return;
  const set = new Set();
  data.forEach(row => (Array.isArray(row.unidades) ? row.unidades : []).forEach(u => { if (u.tipo) set.add(u.tipo); }));
  const tipos = Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todas las tipologías</option>' +
    tipos.map(t => `<option value="${t}">${t}</option>`).join('');
}

function wireFiltros() {
  ['f-proyecto', 'f-tipologia', 'f-buscar', 'f-desde', 'f-hasta'].forEach(id => {
    document.getElementById(id).addEventListener('input', debounce(cargarHistorial, 300));
    document.getElementById(id).addEventListener('change', cargarHistorial);
  });
  document.getElementById('f-limpiar').onclick = () => {
    document.getElementById('f-proyecto').value = '';
    document.getElementById('f-tipologia').value = '';
    document.getElementById('f-buscar').value = '';
    document.getElementById('f-desde').value = '';
    document.getElementById('f-hasta').value = '';
    cargarHistorial();
  };
  document.getElementById('f-exportar').onclick = exportarExcel;
}

// Pestañas Tabla / Dashboard: ambas se calculan sobre el mismo HISTORIAL ya
// cargado y filtrado, así que cambiar de pestaña no vuelve a consultar la BD.
function wireTabs() {
  const btnTabla = document.getElementById('tab-btn-tabla');
  const btnDash = document.getElementById('tab-btn-dashboard');
  const vistaTabla = document.getElementById('vista-tabla');
  const vistaDash = document.getElementById('vista-dashboard');
  btnTabla.onclick = () => {
    vistaTabla.hidden = false; vistaDash.hidden = true;
    btnTabla.classList.add('active'); btnDash.classList.remove('active');
  };
  btnDash.onclick = () => {
    vistaTabla.hidden = true; vistaDash.hidden = false;
    btnDash.classList.add('active'); btnTabla.classList.remove('active');
  };
}

let debounceTimer = null;
function debounce(fn, ms) {
  return (...args) => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => fn(...args), ms); };
}

async function cargarHistorial() {
  const list = document.getElementById('historial-list');
  list.innerHTML = '<div class="empty-state">Cargando…</div>';

  const proyectoId = document.getElementById('f-proyecto').value;
  const tipologia = document.getElementById('f-tipologia').value;
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const buscar = document.getElementById('f-buscar').value.trim();

  let query = supabaseClient
    .from('cotizador_historial')
    .select('*, cotizador_proyectos(nombre, tagline, ubicacion)')
    .order('created_at', { ascending: false })
    .limit(500);

  if (proyectoId) query = query.eq('proyecto_id', proyectoId);
  if (desde) query = query.gte('created_at', desde + 'T00:00:00');
  if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

  const { data, error } = await query;
  if (error) { list.innerHTML = `<div class="empty-state">No se pudo cargar el historial: ${error.message}</div>`; return; }

  let filas = data || [];
  if (buscar) {
    const q = buscar.toLowerCase();
    filas = filas.filter(f =>
      (f.cliente_nombre || '').toLowerCase().includes(q) ||
      (f.asesor_nombre || '').toLowerCase().includes(q));
  }
  // La tipología vive dentro del jsonb "unidades" de cada proforma (puede
  // traer varias unidades), así que el filtro se aplica en el cliente: se
  // queda la fila si AL MENOS UNA de sus unidades es de esa tipología.
  if (tipologia) {
    filas = filas.filter(f => Array.isArray(f.unidades) && f.unidades.some(u => u.tipo === tipologia));
  }

  HISTORIAL = filas;
  document.getElementById('historial-contador').textContent =
    filas.length === 1 ? '1 proforma encontrada' : `${filas.length} proformas encontradas`;

  const puedeBorrar = CotizadorAuth.getIsAdmin();   // solo rol editor (la BD también lo exige)
  if (!filas.length) {
    list.innerHTML = '<div class="empty-state">No hay proformas con estos filtros.</div>';
  } else {
    list.innerHTML = (puedeBorrar ? `<div class="borrar-bar" id="borrar-bar" hidden>
        <span id="borrar-cuenta"></span>
        <button type="button" class="btn btn-danger-soft btn-sm" id="borrar-seleccion">Eliminar seleccionadas</button>
        <button type="button" class="btn btn-ghost btn-sm" id="borrar-cancelar">Quitar selección</button>
      </div>` : '') +
      `<table class="admin-table"><thead><tr>
      ${puedeBorrar ? '<th class="col-check"><input type="checkbox" id="sel-todas" aria-label="Seleccionar todas"></th>' : ''}
      <th>Cliente</th><th>Proyecto</th><th>Unidad(es)</th><th>N.º proforma</th><th>Fecha</th>
      <th>Asesor</th><th>Precio final</th><th>Abono</th><th>Financiado</th><th>Cuota/mes</th>
      ${puedeBorrar ? '<th class="col-accion"><span class="sr-only">Eliminar</span></th>' : ''}
    </tr></thead><tbody>${filas.map(f => filaHTML(f, puedeBorrar)).join('')}</tbody></table>`;
    if (puedeBorrar) wireBorrado(list);
  }

  renderDashboard(filas);
}

// ---------------------------------------------------------------------------
// Borrado de proformas (solo editor). Pensado para limpiar cotizaciones de
// prueba. La numeración NO se reutiliza: si se borra PRISMA-0012, la siguiente
// sigue siendo PRISMA-0013 (evita números duplicados con PDFs ya entregados).
// ---------------------------------------------------------------------------
function wireBorrado(list) {
  const checks = () => Array.from(list.querySelectorAll('input.sel-fila'));
  const seleccion = () => checks().filter(c => c.checked).map(c => c.value);
  const bar = document.getElementById('borrar-bar');

  function refrescar() {
    const n = seleccion().length;
    bar.hidden = n === 0;
    document.getElementById('borrar-cuenta').textContent = n === 1 ? '1 proforma seleccionada' : `${n} proformas seleccionadas`;
    const todas = document.getElementById('sel-todas');
    todas.checked = n > 0 && n === checks().length;
    todas.indeterminate = n > 0 && n < checks().length;
  }

  list.addEventListener('change', e => {
    if (e.target.id === 'sel-todas') checks().forEach(c => { c.checked = e.target.checked; });
    refrescar();
  });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-borrar]');
    if (b) borrarProformas([b.dataset.borrar]);
  });
  document.getElementById('borrar-seleccion').onclick = () => borrarProformas(seleccion());
  document.getElementById('borrar-cancelar').onclick = () => { checks().forEach(c => { c.checked = false; }); refrescar(); };
}

async function borrarProformas(ids) {
  if (!ids.length) return;
  const filas = HISTORIAL.filter(f => ids.includes(f.id));
  const lista = filas.slice(0, 12).map(f => `• ${f.numero_proforma || 'sin número'} — ${f.cliente_nombre || 'sin cliente'}`).join('\n');
  const mas = filas.length > 12 ? `\n… y ${filas.length - 12} más` : '';
  const ok = confirm(
    `¿Eliminar ${filas.length === 1 ? 'esta proforma' : `estas ${filas.length} proformas`} del historial?\n\n${lista}${mas}\n\n` +
    'No se puede deshacer. Los números eliminados no se vuelven a usar.');
  if (!ok) return;

  const { data, error } = await supabaseClient.from('cotizador_historial').delete().in('id', ids).select('id');
  if (error) { showToast('No se pudo eliminar: ' + error.message); return; }
  if (!data || data.length === 0) { showToast('No se eliminó nada. Solo el rol editor puede borrar proformas.'); return; }

  try {
    const user = CotizadorAuth.getUser();
    await supabaseClient.from('actividad').insert({
      email: user.email, accion: 'eliminar',
      detalle: 'Proformas eliminadas: ' + filas.filter(f => data.some(d => d.id === f.id)).map(f => f.numero_proforma || f.id).join(', ')
    });
  } catch (e) { /* el registro no bloquea el borrado */ }

  showToast(data.length === 1 ? 'Proforma eliminada' : `${data.length} proformas eliminadas`, 'ok');
  await cargarHistorial();
}

// Evita que un nombre con "<" o comillas rompa la tabla.
function escHTML(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function filaHTML(f, puedeBorrar) {
  const fecha = f.created_at ? new Date(f.created_at).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const unidades = Array.isArray(f.unidades) ? f.unidades.map(u => u.nombre || u.codigo).join(', ') : '';
  return `<tr>
    ${puedeBorrar ? `<td class="col-check"><input type="checkbox" class="sel-fila" value="${escHTML(f.id)}" aria-label="Seleccionar ${escHTML(f.numero_proforma)}"></td>` : ''}
    <td>${escHTML(f.cliente_nombre) || '—'}${f.cliente_telefono ? `<br><span class="hint">${escHTML(f.cliente_telefono)}</span>` : ''}</td>
    <td>${escHTML(f.cotizador_proyectos?.nombre || f.proyecto_id) || '—'}</td>
    <td>${escHTML(unidades) || '—'}</td>
    <td><strong>${escHTML(f.numero_proforma) || '—'}</strong></td>
    <td>${fecha}</td>
    <td>${escHTML(f.asesor_nombre) || '—'}${f.asesor_telefono ? `<br><span class="hint">${escHTML(f.asesor_telefono)}</span>` : ''}</td>
    <td>${fmtMoney(f.precio_final)}</td>
    <td>${fmtMoney(f.abono_total)}</td>
    <td>${fmtMoney(f.monto_financiado)}</td>
    <td>${f.cuota_mensual ? fmtMoney(f.cuota_mensual) : '—'}</td>
    ${puedeBorrar ? `<td class="col-accion"><button type="button" class="btn-borrar" data-borrar="${escHTML(f.id)}" title="Eliminar proforma" aria-label="Eliminar ${escHTML(f.numero_proforma)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></td>` : ''}
  </tr>`;
}

// ============================================================================
// Dashboard de preferencias de compra: KPIs + reportes (proyecto, tipo de
// inmueble, dormitorios, rango de precio, precio promedio por proyecto,
// motivo de compra, forma de pago, demanda por unidad y por período) sobre
// las proformas que cumplen los filtros de arriba. Se recalcula cada vez que
// cargarHistorial() trae datos nuevos — no hace consultas propias a la BD.
// Los gráficos (donut/barras/línea) los dibuja js/charts.js en SVG puro.
// ============================================================================

function promedio(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function numsValidos(filas, campo) {
  return filas.map(f => Number(f[campo])).filter(n => !isNaN(n) && n > 0);
}
// Formato compacto para ejes de gráfico ($85k en vez de $85,000.00) — fmtMoney
// (utils.js) es el que se usa en el resto del sitio para montos "serios".
function fmtMoneyShort(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + Math.round(n);
}

function todasLasUnidades(filas) {
  const out = [];
  filas.forEach(f => (Array.isArray(f.unidades) ? f.unidades : []).forEach(u => out.push(u)));
  return out;
}

function renderDashboard(filas) {
  const unidadesFlat = todasLasUnidades(filas);

  // ---- KPIs ----
  document.getElementById('kpi-total').textContent = filas.length;
  const precios = numsValidos(filas, 'precio_final');
  const financiados = numsValidos(filas, 'monto_financiado');
  const cuotas = numsValidos(filas, 'cuota_mensual');
  document.getElementById('kpi-ticket').textContent = precios.length ? fmtMoney(promedio(precios)) : '—';
  document.getElementById('kpi-financiado').textContent = financiados.length ? fmtMoney(promedio(financiados)) : '—';
  document.getElementById('kpi-cuota').textContent = cuotas.length ? fmtMoney(promedio(cuotas)) + ' /mes' : '—';
  const areas = unidadesFlat.map(u => Number(u.area_m2)).filter(n => !isNaN(n) && n > 0);
  document.getElementById('kpi-metraje').textContent = areas.length ? `${Math.round(promedio(areas))} m²` : '—';

  const proyectoEntries = calcularDistribucionProyecto(filas);
  const tipoEntries = calcularDistribucionTipo(unidadesFlat);
  document.getElementById('kpi-proyecto-top').textContent = proyectoEntries.length ? proyectoEntries[0].label : '—';
  document.getElementById('kpi-tipo-top').textContent = tipoEntries.length ? tipoEntries[0].label : '—';

  // ---- Gráficos ----
  renderDonutCard('dash-proyecto-donut', proyectoEntries, { centerLabel: 'proformas' });
  renderDonutCard('dash-tipo-donut', tipoEntries, { centerLabel: 'unidades' });
  renderResumenTipo(tipoEntries);
  renderDormitorios(unidadesFlat);
  renderRangosPrecio(precios);
  renderPrecioPorProyecto(filas);
  renderDemandaUnidad(unidadesFlat);
  renderDonutCard('dash-motivo-donut', calcularDistribucionCampo(filas, 'motivo_compra', { inversion: 'Inversión', vivienda: 'Vivienda' }), { centerLabel: 'proformas' });
  renderDonutCard('dash-formapago-donut', calcularDistribucionCampo(filas, 'forma_pago', { financiamiento: 'Financiamiento', contado: 'Contado' }), { centerLabel: 'proformas' });
  renderDemandaPeriodo(filas);
  renderReporteEncabezado();
}

// "Distribución de cotizaciones por proyecto" — cuenta proformas por
// proyecto_id, usando el nombre real del proyecto (no el sector/tagline: acá
// lo que se pide es por proyecto, a diferencia de una vista por ubicación).
function calcularDistribucionProyecto(filas) {
  const counts = {};
  filas.forEach(f => {
    const label = f.cotizador_proyectos?.nombre || f.proyecto_id || 'Sin proyecto';
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// "Tipo de inmueble más cotizado" — a partir de unidades[].tipo (Casa Tipo 1,
// Departamento, Suite, Local, Lote…). Una proforma con varias unidades cuenta
// una vez por cada tipo que incluya.
function calcularDistribucionTipo(unidadesFlat) {
  const counts = {};
  unidadesFlat.forEach(u => {
    const t = u.tipo || 'Sin especificar';
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function renderResumenTipo(entries) {
  const el = document.getElementById('dash-tipo-resumen');
  if (!el) return;
  if (entries.length >= 2) {
    el.textContent = `Mayor demanda: ${entries[0].label} (${entries[0].value}) · Menor demanda: ${entries[entries.length - 1].label} (${entries[entries.length - 1].value})`;
  } else if (entries.length === 1) {
    el.textContent = `Única tipología cotizada en estos filtros: ${entries[0].label}`;
  } else {
    el.textContent = 'Departamentos, casas, suites, locales…';
  }
}

// Genérico para campos de una sola opción con etiquetas fijas (motivo_compra,
// forma_pago) — cuenta cuántas proformas tienen cada valor. Los valores nulos
// (proformas de antes de esta actualización) no se cuentan, no se inventan.
function calcularDistribucionCampo(filas, campo, etiquetas) {
  const counts = {};
  filas.forEach(f => {
    const v = f[campo];
    if (!v) return;
    const label = etiquetas[v] || v;
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// "Dormitorios preferidos" — se agrupa por número exacto de dormitorios (no
// por frecuencia como los demás, sino ordenado 1, 2, 3, 4+ — así se lee como
// una escala, no como un ranking).
function renderDormitorios(unidadesFlat) {
  const counts = {};
  unidadesFlat.forEach(u => {
    const d = Number(u.dormitorios);
    const key = (!u.dormitorios || isNaN(d)) ? 'Sin especificar' : (d >= 4 ? '4+' : String(d));
    counts[key] = (counts[key] || 0) + 1;
  });
  const orden = ['1', '2', '3', '4+', 'Sin especificar'];
  const entries = orden.filter(k => counts[k]).map(k => ({ label: k === 'Sin especificar' ? k : `${k} dorm.`, value: counts[k] }));
  document.getElementById('dash-dormitorios').innerHTML = entries.length
    ? svgBarChart(entries)
    : '<div class="empty-state">Sin datos para estos filtros.</div>';
}

// "Rango de precio consultado" — 5 franjas iguales entre el mínimo y el
// máximo de las proformas filtradas (no franjas fijas en USD), para que
// tenga sentido tanto en un proyecto de $80k como en uno de $300k.
function renderRangosPrecio(precios) {
  const el = document.getElementById('dash-rangos');
  if (!precios.length) { el.innerHTML = '<div class="empty-state">Sin datos para estos filtros.</div>'; return; }
  const min = Math.min(...precios), max = Math.max(...precios);
  const NUM_BUCKETS = 5;
  let buckets;
  if (min === max) {
    buckets = [{ label: fmtMoneyShort(min), value: precios.length }];
  } else {
    const step = (max - min) / NUM_BUCKETS;
    buckets = Array.from({ length: NUM_BUCKETS }, (_, i) => ({
      from: min + step * i, to: i === NUM_BUCKETS - 1 ? max : min + step * (i + 1), value: 0,
    }));
    precios.forEach(p => {
      let idx = Math.floor((p - min) / step);
      if (idx >= NUM_BUCKETS) idx = NUM_BUCKETS - 1;
      if (idx < 0) idx = 0;
      buckets[idx].value++;
    });
    buckets.forEach(b => { b.label = `${fmtMoneyShort(b.from)}–${fmtMoneyShort(b.to)}`; });
  }
  el.innerHTML = svgBarChart(buckets);
}

// "Precio promedio por proyecto" — no es un conteo, es el ticket promedio de
// cada proyecto; se muestra como ranking horizontal en vez de donut porque
// acá lo que importa es comparar montos, no proporciones de un total.
function renderPrecioPorProyecto(filas) {
  const porProyecto = {};
  filas.forEach(f => {
    const precio = Number(f.precio_final);
    if (isNaN(precio) || precio <= 0) return;
    const label = f.cotizador_proyectos?.nombre || f.proyecto_id || 'Sin proyecto';
    (porProyecto[label] = porProyecto[label] || []).push(precio);
  });
  const entries = Object.entries(porProyecto)
    .map(([label, arr]) => ({ label, value: Math.round(promedio(arr)) }))
    .sort((a, b) => b.value - a.value);
  renderRankedBars('dash-precio-proyecto', entries, { formatValue: fmtMoney, showPct: false });
}

// "Demanda por unidad" — qué códigos de unidad concentran el interés (top 8).
function renderDemandaUnidad(unidadesFlat) {
  const counts = {};
  unidadesFlat.forEach(u => {
    const label = u.nombre || u.codigo || 'Sin código';
    counts[label] = (counts[label] || 0) + 1;
  });
  const entries = Object.entries(counts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  renderRankedBars('dash-unidad', entries, { showPct: true });
}

// "Demanda por período" — proformas por mes (según created_at), hasta los
// últimos 12 meses del rango filtrado para que el eje no se sature.
function renderDemandaPeriodo(filas) {
  const counts = {};
  filas.forEach(f => {
    if (!f.created_at) return;
    const d = new Date(f.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  let keys = Object.keys(counts).sort();
  if (keys.length > 12) keys = keys.slice(-12);
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const points = keys.map(k => {
    const [y, m] = k.split('-');
    return { label: `${MESES[parseInt(m, 10) - 1]} ${y.slice(2)}`, value: counts[k] };
  });
  document.getElementById('dash-periodo').innerHTML = points.length
    ? svgLineChart(points)
    : '<div class="empty-state">Sin datos para estos filtros.</div>';
}

// Encabezado que solo se ve al exportar a PDF: qué filtros estaban activos y
// cuándo se generó, para que el PDF tenga contexto aunque se comparta suelto.
function renderFiltrosResumenImpresion() {
  const el = document.getElementById('dash-print-filtros');
  if (!el) return;
  const proyectoSel = document.getElementById('f-proyecto');
  const proyectoTxt = proyectoSel.value ? proyectoSel.selectedOptions[0].textContent : 'Todos los proyectos';
  const tipologiaSel = document.getElementById('f-tipologia');
  const tipologiaTxt = tipologiaSel.value || 'Todas las tipologías';
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const buscar = document.getElementById('f-buscar').value.trim();
  const partes = [
    `Proyecto: ${proyectoTxt}`,
    `Tipología: ${tipologiaTxt}`,
    desde ? `Desde: ${desde}` : null,
    hasta ? `Hasta: ${hasta}` : null,
    buscar ? `Búsqueda: "${buscar}"` : null,
    `Generado: ${new Date().toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
  ].filter(Boolean);
  el.textContent = partes.join(' · ');
}

// Excel (.xlsx) pensado para importar a un CRM y, a la
// vez, legible para revisar a simple vista en Excel/Sheets: encabezado fijo
// y en negrita, columnas con ancho propio, montos con formato de moneda,
// fecha como fecha real (ordenable) y filtro automático en el encabezado.
// El valor guardado en cada celda sigue siendo un número/fecha plano (no
// texto con '$' ni comas), así que cualquier importador de CRM lo sigue
// leyendo igual que antes — el formato es solo visual.
function num2(n) {
  return (n === null || n === undefined || n === '') ? '' : Math.round(Number(n) * 100) / 100;
}

const EXPORT_COLUMNAS = [
  { header: 'Cliente - Nombre completo', key: 'clienteNombre', width: 24 },
  { header: 'Cliente - Teléfono', key: 'clienteTelefono', width: 17 },
  { header: 'Cliente - Correo', key: 'clienteCorreo', width: 26 },
  { header: 'Proyecto', key: 'proyecto', width: 20 },
  { header: 'Unidad(es)', key: 'unidades', width: 22 },
  { header: 'N.º de proforma', key: 'numeroProforma', width: 15 },
  { header: 'Fecha', key: 'fecha', width: 12, numFmt: 'dd/mm/yyyy' },
  { header: 'Asesor - Nombre', key: 'asesorNombre', width: 20 },
  { header: 'Asesor - Teléfono', key: 'asesorTelefono', width: 17 },
  { header: 'Precio final (USD)', key: 'precioFinal', width: 15, numFmt: '"$"#,##0.00' },
  { header: 'Descuento (USD)', key: 'descuento', width: 14, numFmt: '"$"#,##0.00' },
  { header: 'Reserva (USD)', key: 'reserva', width: 13, numFmt: '"$"#,##0.00' },
  { header: 'Promesa (USD)', key: 'promesa', width: 13, numFmt: '"$"#,##0.00' },
  { header: 'Abono total antes de entrega (USD)', key: 'abonoTotal', width: 20, numFmt: '"$"#,##0.00' },
  { header: 'Monto financiado (USD)', key: 'montoFinanciado', width: 17, numFmt: '"$"#,##0.00' },
  { header: 'Tasa anual (%)', key: 'tasa', width: 13, numFmt: '0.00"%"' },
  { header: 'Plazo (años)', key: 'plazo', width: 12 },
  { header: 'N.º de cuotas', key: 'numCuotas', width: 12 },
  { header: 'Monto por cuota (USD)', key: 'montoCuota', width: 16, numFmt: '"$"#,##0.00' },
  { header: 'Cuota mensual estimada (USD)', key: 'cuotaMensual', width: 18, numFmt: '"$"#,##0.00' },
  { header: 'Notas', key: 'notas', width: 32 },
];

const EXPORT_COLOR_HEADER = 'FF565A41'; // --olive
const EXPORT_COLOR_ZEBRA = 'FFF8F6F0';  // --crema
const EXPORT_COLOR_BORDE = 'FFE4E0D2'; // --border

async function exportarExcel() {
  if (!HISTORIAL.length) { showToast('No hay filas para exportar con estos filtros.'); return; }
  if (typeof ExcelJS === 'undefined') {
    showToast('No se pudo cargar el generador de Excel (revisa tu conexión) e intenta de nuevo.');
    return;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GPUnlock';
  wb.created = new Date();
  const ws = wb.addWorksheet('Historial', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = EXPORT_COLUMNAS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  HISTORIAL.forEach(f => {
    ws.addRow({
      clienteNombre: f.cliente_nombre || '',
      clienteTelefono: f.cliente_telefono || '',
      clienteCorreo: f.cliente_correo || '',
      proyecto: f.cotizador_proyectos?.nombre || f.proyecto_id || '',
      unidades: Array.isArray(f.unidades) ? f.unidades.map(u => u.nombre || u.codigo).join(' / ') : '',
      numeroProforma: f.numero_proforma || '',
      fecha: f.created_at ? new Date(f.created_at) : null,
      asesorNombre: f.asesor_nombre || '',
      asesorTelefono: f.asesor_telefono || '',
      precioFinal: num2(f.precio_final),
      descuento: num2(f.descuento),
      reserva: num2(f.reserva),
      promesa: num2(f.promesa),
      abonoTotal: num2(f.abono_total),
      montoFinanciado: num2(f.monto_financiado),
      tasa: num2(f.tasa_usada),
      plazo: f.plazo_anios_usado ?? '',
      numCuotas: f.numero_cuotas ?? '',
      montoCuota: num2(f.monto_cuota),
      cuotaMensual: num2(f.cuota_mensual),
      notas: (f.notas || '').replace(/\r?\n+/g, ' / ').trim(),
    });
  });

  // Formato numérico por columna (moneda/fecha/%) — no afecta el valor real.
  EXPORT_COLUMNAS.forEach(c => { if (c.numFmt) ws.getColumn(c.key).numFmt = c.numFmt; });

  // Encabezado: fondo oliva de marca, texto blanco en negrita, fijo al
  // desplazar (freeze pane) y con filtro automático para ordenar/filtrar.
  const header = ws.getRow(1);
  header.height = 26;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLOR_HEADER } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNAS.length } };

  // Filas: borde suave + franjas alternadas para que sea fácil seguir cada
  // fila con la vista, en vez de una grilla plana sin ningún tipo de guía.
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const zebra = rowNumber % 2 === 0;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: EXPORT_COLOR_BORDE } },
        bottom: { style: 'thin', color: { argb: EXPORT_COLOR_BORDE } },
        left: { style: 'thin', color: { argb: EXPORT_COLOR_BORDE } },
        right: { style: 'thin', color: { argb: EXPORT_COLOR_BORDE } },
      };
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXPORT_COLOR_ZEBRA } };
      cell.alignment = { ...cell.alignment, vertical: 'middle' };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `historial-proformas-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

boot();
