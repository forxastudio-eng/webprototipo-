// Reporte del Dashboard de preferencias: título editable, período con fechas
// escritas ("del 1 de agosto al 21 de septiembre de 2026"), rangos rápidos y
// exportación a PDF con un nombre de archivo útil. Se carga ANTES de
// historial.js; renderDashboard() llama a renderReporteEncabezado().

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseIsoLocal(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fechaLarga(d) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// "del 3 de agosto al 21 de septiembre de 2026" (omite el año repetido)
function textoPeriodo(desde, hasta) {
  if (!desde && !hasta) return 'Sin proformas en el período seleccionado';
  if (desde && hasta) {
    if (isoLocal(desde) === isoLocal(hasta)) return `${fechaLarga(desde)}`;
    const mismoAnio = desde.getFullYear() === hasta.getFullYear();
    const ini = mismoAnio ? `${desde.getDate()} de ${MESES[desde.getMonth()]}` : fechaLarga(desde);
    return `Del ${ini} al ${fechaLarga(hasta)}`;
  }
  return desde ? `Desde el ${fechaLarga(desde)}` : `Hasta el ${fechaLarga(hasta)}`;
}

function periodoActual() {
  const fDesde = document.getElementById('f-desde').value;
  const fHasta = document.getElementById('f-hasta').value;
  let desde = fDesde ? parseIsoLocal(fDesde) : null;
  let hasta = fHasta ? parseIsoLocal(fHasta) : null;
  // Sin filtro de fechas: usa el rango real de las proformas mostradas.
  const fechas = (typeof HISTORIAL !== 'undefined' ? HISTORIAL : [])
    .map(f => f.created_at ? new Date(f.created_at) : null).filter(Boolean)
    .sort((a, b) => a - b);
  if (!desde && fechas.length) desde = fechas[0];
  if (!hasta && fechas.length) hasta = fechas[fechas.length - 1];
  return { desde, hasta };
}

// Se llama al final de renderDashboard() (historial.js).
function renderReporteEncabezado() {
  const { desde, hasta } = periodoActual();
  document.getElementById('report-period').textContent = textoPeriodo(desde, hasta);

  const proyectoSel = document.getElementById('f-proyecto');
  const tipologiaSel = document.getElementById('f-tipologia');
  const buscar = document.getElementById('f-buscar').value.trim();
  const partes = [
    proyectoSel.value ? proyectoSel.selectedOptions[0].textContent : 'Todos los proyectos',
    tipologiaSel.value || 'Todas las tipologías',
    buscar ? `Búsqueda: "${buscar}"` : null,
  ].filter(Boolean);
  document.getElementById('dash-print-filtros').textContent = partes.join('  |  ');

  document.getElementById('report-count').textContent =
    (typeof HISTORIAL !== 'undefined' ? HISTORIAL.length : 0).toLocaleString('es-EC');
  const user = CotizadorAuth.getUser();
  document.getElementById('report-generated').textContent =
    fechaLarga(new Date()) + (user ? ` · ${user.email}` : '');
  marcarRangoActivo();
}

// ---------- Rangos rápidos ----------
function aplicarRango(tipo) {
  const hoy = new Date();
  let desde = null, hasta = hoy;
  if (tipo === 'mes') desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (tipo === '30') { desde = new Date(hoy); desde.setDate(hoy.getDate() - 29); }
  if (tipo === 'trimestre') { desde = new Date(hoy); desde.setMonth(hoy.getMonth() - 3); desde.setDate(desde.getDate() + 1); }
  if (tipo === 'anio') desde = new Date(hoy.getFullYear(), 0, 1);
  if (tipo === 'todo') { desde = null; hasta = null; }
  document.getElementById('f-desde').value = desde ? isoLocal(desde) : '';
  document.getElementById('f-hasta').value = hasta ? isoLocal(hasta) : '';
  document.getElementById('f-hasta').dispatchEvent(new Event('change'));
}

function marcarRangoActivo() {
  const d = document.getElementById('f-desde').value;
  const h = document.getElementById('f-hasta').value;
  document.querySelectorAll('.range-btn').forEach(btn => {
    const tipo = btn.dataset.range;
    let activo = false;
    if (tipo === 'todo') activo = !d && !h;
    else {
      const hoy = isoLocal(new Date());
      if (h === hoy) {
        const f = new Date();
        if (tipo === 'mes') activo = d === isoLocal(new Date(f.getFullYear(), f.getMonth(), 1));
        if (tipo === 'anio') activo = d === isoLocal(new Date(f.getFullYear(), 0, 1));
        if (tipo === '30') { const x = new Date(); x.setDate(x.getDate() - 29); activo = d === isoLocal(x); }
        if (tipo === 'trimestre') { const x = new Date(); x.setMonth(x.getMonth() - 3); x.setDate(x.getDate() + 1); activo = d === isoLocal(x); }
      }
    }
    btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
  });
}

// ---------- Título ----------
function tituloReporte() {
  const v = document.getElementById('report-title-input').value.trim();
  return v || 'Dashboard de preferencias de compra';
}

// ---------- PDF ----------
// window.print() con un document.title temporal: Chrome/Edge/Safari usan el
// título como nombre sugerido del archivo al "Guardar como PDF".
function exportarDashboardPDF() {
  renderReporteEncabezado();
  const { desde, hasta } = periodoActual();
  const original = document.title;
  const rango = desde && hasta ? `${isoLocal(desde)} a ${isoLocal(hasta)}` : 'sin fechas';
  document.title = `GPUnlock - ${tituloReporte()} (${rango})`;
  const restaurar = () => { document.title = original; window.removeEventListener('afterprint', restaurar); };
  window.addEventListener('afterprint', restaurar);
  window.print();
  setTimeout(restaurar, 1500);
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('report-title-input');
  const titulo = document.getElementById('report-title');
  input.addEventListener('input', () => { titulo.textContent = tituloReporte(); });
  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => aplicarRango(btn.dataset.range)));
  ['f-desde', 'f-hasta'].forEach(id => document.getElementById(id).addEventListener('change', marcarRangoActivo));
});
