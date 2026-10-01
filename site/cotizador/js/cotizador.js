// Motor genérico del cotizador: sirve para los 4 proyectos (y cualquier otro
// que se agregue después) leyendo su configuración financiera desde
// cotizador_proyectos en vez de tener una copia de código por proyecto.

let PROYECTO = null;
let UNIDADES = [];
let seleccionadas = [];      // array de unidades seleccionadas (soporta comparar varias)

function qs(id) { return document.getElementById(id); }

async function boot() {
  const user = await CotizadorAuth.requireSession();
  if (!user) return;

  const params = new URLSearchParams(location.search);
  const slug = params.get('proyecto');
  if (!slug) { showToast('Falta el proyecto en la URL.'); location.href = 'index.html'; return; }

  document.getElementById('header-actions').innerHTML = `
    <span class="user-pill">${user.email}</span>
    <a href="/admin/#/cuenta">Mi cuenta</a>
    ${CotizadorAuth.getIsAdmin() ? '<a href="admin.html">Administrar</a>' : ''}
    ${CotizadorAuth.getPuedeVerHistorial() ? '<a href="historial.html">Historial</a>' : ''}
    <button id="logout-btn">Cerrar sesión</button>`;
  qs('logout-btn').onclick = async () => { await CotizadorAuth.logout(); location.href = 'index.html'; };

  const { data: proyecto, error } = await supabaseClient.from('cotizador_proyectos').select('*').eq('id', slug).single();
  if (error || !proyecto) { showToast('No se encontró ese proyecto.'); location.href = 'index.html'; return; }
  PROYECTO = proyecto;
  document.title = `Cotizador — ${proyecto.nombre}`;
  qs('page-title').textContent = `Cotizador — ${proyecto.nombre}`;
  qs('brand-project-name').textContent = proyecto.nombre;
  document.documentElement.style.setProperty('--olive', proyecto.color_primario);
  document.documentElement.style.setProperty('--arena', proyecto.color_acento);
  await renderProjectHero(proyecto);

  qs('discount-card').hidden = !proyecto.permite_descuento_manual;
  qs('unit-section-hint').textContent = proyecto.permite_multi_seleccion
    ? 'Puedes seleccionar una o más unidades para comparar en la misma proforma.'
    : 'Selecciona la unidad para este cliente.';

  await loadUnidades();
  renderFinancingFields();
  wireEvents();
  await loadAsesores();
  loadAsesorGuardado();
}

// Directorio de asesores GPUnlock (tabla cotizador_asesores, administrable
// desde Administrar → Asesores) — alimenta el desplegable de "Datos del
// asesor" para que, al elegir un nombre, el teléfono se rellene solo.
let ASESORES = [];
async function loadAsesores() {
  const { data, error } = await supabaseClient
    .from('cotizador_asesores')
    .select('*')
    .eq('activo', true)
    .order('sort_order').order('nombre');
  if (!error) ASESORES = data || [];
  poblarSelectorAsesores();
}

function poblarSelectorAsesores() {
  const sel = qs('asesor-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona tu nombre…</option>' +
    ASESORES.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('') +
    '<option value="__otro__">Otro / no está en la lista</option>';
}

// Muestra el desplegable (empresa = gpunlock) o los campos manuales (empresa =
// independiente, o "Otro" elegido en el desplegable) y, si hay un asesor
// del directorio seleccionado, copia su nombre/teléfono a los campos que
// generarProforma() ya lee — así el resto del flujo no cambia.
function aplicarModoAsesor() {
  const empresa = qs('asesor-empresa').value;
  const selField = qs('asesor-select-field');
  const manualFields = qs('asesor-manual-fields');
  if (empresa === 'independiente') {
    selField.hidden = true;
    manualFields.hidden = false;
    return;
  }
  selField.hidden = false;
  const selVal = qs('asesor-select').value;
  if (selVal && selVal !== '__otro__') {
    const a = ASESORES.find(x => x.id === selVal);
    if (a) {
      qs('asesor-nombre').value = a.nombre;
      poblarSelectorPais(qs('asesor-tel-code'), a.telefono_codigo || '593');
      qs('asesor-tel').value = a.telefono_numero || '';
    }
    manualFields.hidden = true;
  } else {
    manualFields.hidden = false;
  }
}

// El asesor llena su nombre/teléfono una vez (o los elige del desplegable)
// y queda recordado en este navegador (localStorage), para no repetirlo en
// cada proforma.
function loadAsesorGuardado() {
  let savedCode = '593', nombre = '', tel = '', empresa = 'gpunlock', asesorId = '';
  try {
    savedCode = localStorage.getItem('gpunlock_asesor_tel_code') || '593';
    nombre = localStorage.getItem('gpunlock_asesor_nombre') || '';
    tel = localStorage.getItem('gpunlock_asesor_tel') || '';
    empresa = localStorage.getItem('gpunlock_asesor_empresa') || 'gpunlock';
    asesorId = localStorage.getItem('gpunlock_asesor_id') || '';
  } catch (e) { /* localStorage puede fallar en modo privado; no es crítico */ }
  poblarSelectorPais(qs('asesor-tel-code'), savedCode);
  poblarSelectorPais(qs('cli-tel-code'), '593'); // el cliente cambia en cada proforma; Ecuador por defecto
  if (nombre) qs('asesor-nombre').value = nombre;
  if (tel) qs('asesor-tel').value = tel;
  qs('asesor-empresa').value = empresa;
  // Si el asesor guardado ya no existe en el directorio (lo desactivaron o
  // lo borraron), simplemente no se marca nada y queda en modo manual con
  // los datos guardados de la última vez.
  if (asesorId && qs('asesor-select').querySelector(`option[value="${asesorId}"]`)) {
    qs('asesor-select').value = asesorId;
  }
  aplicarModoAsesor();
}
function guardarAsesor(nombre, tel, empresa, telCode, asesorId) {
  try {
    localStorage.setItem('gpunlock_asesor_nombre', nombre);
    localStorage.setItem('gpunlock_asesor_tel', tel);
    localStorage.setItem('gpunlock_asesor_empresa', empresa);
    localStorage.setItem('gpunlock_asesor_tel_code', telCode);
    localStorage.setItem('gpunlock_asesor_id', asesorId || '');
  } catch (e) { /* no crítico */ }
}

// Banner con la identidad propia del proyecto (color_primario/color_acento
// desde la BD, y su portada si ya fue subida) — el logo GPUnlock se mantiene
// fijo en el header por encima de esto.
async function renderProjectHero(proyecto) {
  const el = qs('project-hero');
  if (!el) return;
  const coverUrl = await signedMediaUrl(proyecto.cover_url);
  el.style.backgroundImage = coverUrl
    ? `url('${coverUrl}')`
    : `linear-gradient(150deg, ${proyecto.color_primario}, ${proyecto.color_acento})`;
  el.innerHTML = `
    <div class="project-hero-scrim"></div>
    <div class="project-hero-content">
      <span class="tag">GPUnlock · Proyecto</span>
      <h1>${proyecto.nombre}</h1>
      ${proyecto.tagline ? `<p>${proyecto.tagline}</p>` : ''}
      ${proyecto.ubicacion ? `<div class="meta">${proyecto.ubicacion}</div>` : ''}
    </div>`;
  el.hidden = false;
}

async function loadUnidades() {
  const grid = qs('unit-grid');
  if (PROYECTO.tipo_financiamiento === 'lote') {
    const { data, error } = await supabaseClient
      .from('cotizador_inventario_extra')
      .select('*')
      .eq('proyecto_id', PROYECTO.id).eq('tipo', 'lote')
      .order('codigo');
    if (error) { grid.innerHTML = `<div class="empty-state">Error cargando lotes: ${error.message}</div>`; return; }
    UNIDADES = data.map(l => ({
      id: l.id, codigo: l.codigo, nombre: `Lote ${l.codigo}`, tipo: `Categoría ${l.categoria || '—'}`,
      specsText: `${l.metraje_m2 ? l.metraje_m2 + ' m²' : ''} · ${fmtMoney(l.precio_m2)}/m²`,
      precio: l.precio, estado: l.estado, raw: l,
    }));
  } else {
    const { data, error } = await supabaseClient
      .from('cotizador_unidades')
      .select('*')
      .eq('proyecto_id', PROYECTO.id)
      .order('sort_order').order('codigo');
    if (error) { grid.innerHTML = `<div class="empty-state">Error cargando unidades: ${error.message}</div>`; return; }
    UNIDADES = data.map(u => ({
      id: u.id, codigo: u.codigo, nombre: u.nombre || u.codigo, tipo: u.tipo,
      specsText: buildSpecsText(u), precio: u.precio, estado: u.estado, raw: u,
    }));
  }
  renderUnitGrid();
}

function buildSpecsText(u) {
  const parts = [];
  if (u.dormitorios) parts.push(`${u.dormitorios} dorm.`);
  if (u.banos) parts.push(`${u.banos} baños`);
  if (u.terreno_m2) parts.push(`Terreno ${u.terreno_m2} m²`);
  if (u.construccion_m2) parts.push(`Constr. ${u.construccion_m2} m²`);
  if (u.area_util_m2) parts.push(`${u.area_util_m2} m² útiles`);
  if (u.parqueos) parts.push(`${u.parqueos} parq.`);
  if (u.planta) parts.push(u.planta);
  return parts.join(' · ');
}

function renderUnitGrid() {
  const grid = qs('unit-grid');
  if (!UNIDADES.length) { grid.innerHTML = '<div class="empty-state">Este proyecto todavía no tiene unidades cargadas.</div>'; return; }
  grid.innerHTML = UNIDADES.map(u => {
    const disabled = u.estado !== 'disponible';
    return `
    <div class="unit-card ${disabled ? '' : ''}" data-id="${u.id}" style="${disabled ? 'opacity:.55;cursor:not-allowed;' : ''}">
      <span class="badge badge-${u.estado}">${ESTADO_LABEL[u.estado] || u.estado}</span>
      <div class="name" style="margin-top:8px;">${u.nombre}</div>
      <div class="specs">${u.specsText}</div>
      <div class="price">${u.precio ? fmtMoney(u.precio) : 'Consultar precio'}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.unit-card').forEach(card => {
    const u = UNIDADES.find(x => x.id === card.dataset.id);
    if (u.estado !== 'disponible' || !u.precio) return;
    card.addEventListener('click', () => toggleUnit(u, card));
  });
}

function toggleUnit(u, card) {
  const idx = seleccionadas.findIndex(x => x.id === u.id);
  if (idx === -1) {
    if (!PROYECTO.permite_multi_seleccion) {
      seleccionadas = [];
      qs('unit-grid').querySelectorAll('.unit-card.selected').forEach(c => c.classList.remove('selected'));
    }
    seleccionadas.push(u);
    card.classList.add('selected');
  } else {
    seleccionadas.splice(idx, 1);
    card.classList.remove('selected');
  }
  renderFinancingSummary();
}

function wireEvents() {
  qs('desc-monto').addEventListener('input', renderFinancingSummary);
  qs('asesor-empresa').addEventListener('change', aplicarModoAsesor);
  qs('asesor-select').addEventListener('change', aplicarModoAsesor);
  qs('forma-pago').addEventListener('change', aplicarFormaPago);
  qs('generate-btn').onclick = generarProforma;
  qs('back-btn').onclick = () => { qs('proforma-view').hidden = true; qs('form-view').hidden = false; window.scrollTo(0, 0); };
  qs('print-btn').onclick = () => window.print();
}

// El descuento ahora es un monto libre que escribe el asesor (antes era por
// clics de a $X fijos) — sigue controlado por permite_descuento_manual.
function getDescuento() {
  if (!PROYECTO.permite_descuento_manual) return 0;
  return Math.max(0, parseFloat(qs('desc-monto')?.value) || 0);
}

// Reserva y promesa parten del % configurado en el proyecto, pero el asesor
// puede editarlos caso a caso (ej. negociaciones especiales) — si el campo
// existe en el formulario actual se usa ese valor, si no, el % del proyecto.
function getReservaPct() {
  const inp = qs('f-reserva-pct');
  if (inp && inp.value !== '') return Math.max(0, parseFloat(inp.value) || 0) / 100;
  return PROYECTO.reserva_pct;
}
function getPromesaPct() {
  const inp = qs('f-promesa-pct');
  if (inp && inp.value !== '') return Math.max(0, parseFloat(inp.value) || 0) / 100;
  return PROYECTO.promesa_pct;
}

function renderFinancingFields() {
  const el = qs('financing-fields');
  const tipo = PROYECTO.tipo_financiamiento;

  if (tipo === 'cuotas_entrega') {
    // Reserva y promesa parten de un % sugerido por el proyecto, pero quedan
    // editables (ej. negociaciones especiales); el asesor solo define en
    // cuántas cuotas se paga el resto hasta la entrega — el monto de cada
    // cuota se calcula solo, no hay que escribirlo ni puede quedar
    // descuadrado.
    el.innerHTML = `
      <p class="hint" style="margin-bottom:14px;">
        Reserva, promesa de compraventa y el monto de cada cuota se calculan automáticamente. Los % de reserva y promesa se pueden ajustar si la negociación lo requiere.
      </p>
      <div class="row2">
        <div class="field"><label>Reserva (%)</label><input type="number" id="f-reserva-pct" min="0" step="0.1" value="${(PROYECTO.reserva_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
        <div class="field"><label>Promesa de compraventa (%)</label><input type="number" id="f-promesa-pct" min="0" step="0.1" value="${(PROYECTO.promesa_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
      </div>
      <div class="field" style="max-width:260px;"><label>Número de cuotas hasta la entrega</label><input type="number" id="f-num-cuotas" min="0" step="1" value="0"></div>
      <div class="row2">
        <div class="field fp-only"><label>Interés anual del financiamiento (%)</label><input type="number" id="f-tasa" step="0.01" value="${PROYECTO.tasa_default}"></div>
        <div class="field fp-only"><label>Plazo (años)</label><input type="number" id="f-plazo" value="${PROYECTO.plazo_default_anios}"></div>
      </div>`;
  } else if (tipo === 'pago_directo') {
    // Valle Sereno: ya está listo para entrega — un solo abono (sugerido
    // según reserva_pct) en vez del desglose por pasos, más el financiamiento.
    const abonoSugerido = PROYECTO.reserva_pct * 100;
    el.innerHTML = `
      <div class="row2">
        <div class="field"><label>Abono antes de la entrega (USD)</label><input type="number" id="f-abono" min="0" step="1" placeholder="Sugerido: ${abonoSugerido.toFixed(0)}% del precio"></div>
        <div class="field fp-only"><label>Interés anual del financiamiento (%)</label><input type="number" id="f-tasa" step="0.01" value="${PROYECTO.tasa_default}"></div>
      </div>
      <div class="field fp-only" style="max-width:260px;"><label>Plazo (años)</label><input type="number" id="f-plazo" value="${PROYECTO.plazo_default_anios}"></div>`;
  } else if (tipo === 'vip_fijo') {
    el.innerHTML = `
      <div class="field" style="max-width:260px;"><label>Reserva (%)</label><input type="number" id="f-reserva-pct" min="0" step="0.1" value="${(PROYECTO.reserva_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
      <div class="field"><label>Pagos al capital durante construcción (USD) — sin interés</label>
        <input type="number" id="f-capital" min="0" value="0"></div>`;
  } else if (tipo === 'simulacion') {
    el.innerHTML = `
      <div class="row2">
        <div class="field"><label>Reserva (%)</label><input type="number" id="f-reserva-pct" min="0" step="0.1" value="${(PROYECTO.reserva_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
        <div class="field"><label>Promesa de compraventa (%)</label><input type="number" id="f-promesa-pct" min="0" step="0.1" value="${(PROYECTO.promesa_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Cuotas a capital (USD, opcional)</label><input type="number" id="f-capital" min="0" value="0"></div>
        <div class="field fp-only"><label>Tasa anual simulada (%)</label><input type="number" id="f-tasa" step="0.01" value="${PROYECTO.tasa_default}"></div>
      </div>
      <div class="field fp-only"><label>Plazo (años)</label><input type="number" id="f-plazo" value="${PROYECTO.plazo_default_anios}"></div>`;
  } else {
    el.innerHTML = `<div class="field" style="max-width:260px;"><label>Entrada (%)</label><input type="number" id="f-reserva-pct" min="0" step="0.1" value="${(PROYECTO.reserva_pct * 100).toFixed(2).replace(/\.?0+$/, '')}"></div>
      <p class="hint">Lote: entrada + saldo a coordinar directamente con el fideicomiso.</p>`;
  }
  el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', renderFinancingSummary));
  aplicarFormaPago();
}

// "Forma de pago" es una elección del cliente (no del proyecto): si paga de
// contado, no hay préstamo bancario de por medio, así que se ocultan los
// campos de interés/plazo (marcados con la clase fp-only en el HTML de
// arriba) y el plan de pago deja de calcular una cuota mensual — ver
// ajustarPorFormaPago() más abajo, que es donde se anula esa parte del plan.
function getFormaPago() {
  const sel = qs('forma-pago');
  return sel ? sel.value : 'financiamiento';
}
function aplicarFormaPago() {
  const esContado = getFormaPago() === 'contado';
  document.querySelectorAll('.fp-only').forEach(el => { el.hidden = esContado; });
  renderFinancingSummary();
}

function calcularPlan(unidad) {
  const desc = getDescuento();
  const precioFinal = unidad.precio - desc;
  const tipo = PROYECTO.tipo_financiamiento;

  if (tipo === 'cuotas_entrega') {
    const reservaPct = getReservaPct();
    const promesaPct = getPromesaPct();
    const reserva = precioFinal * reservaPct;
    const promesa = precioFinal * promesaPct;
    const numCuotas = parseInt(qs('f-num-cuotas')?.value) || 0;
    // Reserva + promesa + cuotas = 30% del precio (el 70% restante se
    // financia). Las cuotas cubren lo que falta del 30% después de la
    // reserva y la promesa (por defecto 2% + 8% = 10% → cuotas = 20%, pero
    // ambos % son editables) — se reparte entre el número de cuotas que
    // ponga el asesor, así el monto de cada cuota sale solo y nunca puede
    // quedar descuadrado con esa meta.
    const ABONO_TOTAL_PCT = 0.30;
    const cuotasTotal = precioFinal * Math.max(0, ABONO_TOTAL_PCT - reservaPct - promesaPct);
    const montoCuota = numCuotas > 0 ? cuotasTotal / numCuotas : 0;
    const abonoTotal = reserva + promesa + (numCuotas > 0 ? cuotasTotal : 0);
    const montoFinanciado = Math.max(0, precioFinal - abonoTotal);
    const tasa = parseFloat(qs('f-tasa')?.value) || PROYECTO.tasa_default;
    const plazo = parseFloat(qs('f-plazo')?.value) || PROYECTO.plazo_default_anios;
    const cuotaMensual = calcCuota(montoFinanciado, tasa, plazo * 12);
    return ajustarPorFormaPago({
      desc, precioFinal, reserva, promesa, numCuotas, montoCuota, cuotasTotal: (numCuotas > 0 ? cuotasTotal : 0),
      abonoTotal, saldo: montoFinanciado, montoFinanciado, tasa, plazo, cuota: cuotaMensual,
    });
  }

  if (tipo === 'pago_directo') {
    const abonoSugerido = precioFinal * PROYECTO.reserva_pct;
    const abonoInput = qs('f-abono');
    const abono = (abonoInput && abonoInput.value !== '') ? Math.max(0, parseFloat(abonoInput.value) || 0) : abonoSugerido;
    const montoFinanciado = Math.max(0, precioFinal - abono);
    const tasa = parseFloat(qs('f-tasa')?.value) || PROYECTO.tasa_default;
    const plazo = parseFloat(qs('f-plazo')?.value) || PROYECTO.plazo_default_anios;
    const cuotaMensual = calcCuota(montoFinanciado, tasa, plazo * 12);
    return ajustarPorFormaPago({
      desc, precioFinal, reserva: abono, promesa: 0, abonoTotal: abono,
      saldo: montoFinanciado, montoFinanciado, tasa, plazo, cuota: cuotaMensual,
    });
  }

  const capital = parseFloat(qs('f-capital')?.value) || 0;
  if (tipo === 'vip_fijo') {
    const reserva = precioFinal * getReservaPct();
    const saldo = Math.max(0, precioFinal - reserva - capital);
    const cuota25 = calcCuota(saldo, PROYECTO.tasa_default, PROYECTO.plazo_default_anios * 12);
    const cuota20 = calcCuota(saldo, PROYECTO.tasa_default, 20 * 12);
    const cuota15 = calcCuota(saldo, PROYECTO.tasa_default, 15 * 12);
    return ajustarPorFormaPago({ desc, precioFinal, reserva, promesa: 0, capital, saldo, cuota: cuota25, cuota20, cuota15, aplicaCredito: unidad.raw?.aplica_vip });
  }
  if (tipo === 'simulacion') {
    const reserva = precioFinal * getReservaPct();
    const promesa = precioFinal * getPromesaPct();
    const saldo = Math.max(0, precioFinal - reserva - promesa - capital);
    const tasa = parseFloat(qs('f-tasa')?.value) || PROYECTO.tasa_default;
    const plazo = parseFloat(qs('f-plazo')?.value) || PROYECTO.plazo_default_anios;
    const cuota = calcCuota(saldo, tasa, plazo * 12);
    return ajustarPorFormaPago({ desc, precioFinal, reserva, promesa, capital, saldo, cuota, tasa, plazo, aplicaCredito: true });
  }
  // lote
  const reserva = precioFinal * getReservaPct();
  const saldo = Math.max(0, precioFinal - reserva);
  return ajustarPorFormaPago({ desc, precioFinal, reserva, promesa: 0, capital: 0, saldo, cuota: 0, aplicaCredito: false });
}

// Si el cliente paga de contado, no hay préstamo bancario: el saldo
// pendiente (reserva/promesa/abonos ya están bien calculados arriba, eso no
// cambia) deja de tener tasa/plazo/cuota mensual asociados — se cancela
// directo. buildPagoBreakdown()/renderFinancingSummary() ya saben omitir esas
// líneas cuando vienen undefined/0, así que no hace falta tocarlas aparte.
function ajustarPorFormaPago(plan) {
  if (getFormaPago() === 'contado') {
    plan.tasa = undefined;
    plan.plazo = undefined;
    plan.cuota = 0;
    plan.cuota20 = undefined;
    plan.cuota15 = undefined;
    plan.formaPago = 'contado';
  } else {
    plan.formaPago = 'financiamiento';
  }
  return plan;
}

function renderFinancingSummary() {
  const box = qs('financing-summary');
  if (!seleccionadas.length) { box.innerHTML = ''; return; }
  const ref = seleccionadas[0];
  const plan = calcularPlan(ref);
  const tipo = PROYECTO.tipo_financiamiento;

  let rows = `<div class="pf-line"><span>Precio de lista</span><b>${fmtMoney(ref.precio)}</b></div>`;
  if (plan.desc > 0) rows += `<div class="pf-line"><span>Descuento</span><b>- ${fmtMoney(plan.desc)}</b></div>`;

  if (tipo === 'cuotas_entrega') {
    rows += `<div class="pf-line"><span>Reserva</span><b>${fmtMoney(plan.reserva)}</b></div>`;
    rows += `<div class="pf-line"><span>Promesa de compraventa</span><b>${fmtMoney(plan.promesa)}</b></div>`;
    rows += `<div class="pf-line"><span>Cuotas hasta la entrega (${plan.numCuotas} × ${fmtMoney(plan.montoCuota)})</span><b>${fmtMoney(plan.cuotasTotal)}</b></div>`;
    rows += `<div class="pf-line"><span><strong>Total abonado antes de la entrega</strong></span><b>${fmtMoney(plan.abonoTotal)}</b></div>`;
  } else if (tipo === 'pago_directo') {
    rows += `<div class="pf-line"><span>Abono antes de la entrega</span><b>${fmtMoney(plan.abonoTotal)}</b></div>`;
  } else {
    rows += `<div class="pf-line"><span>Reserva</span><b>${fmtMoney(plan.reserva)}</b></div>`;
    if (plan.promesa) rows += `<div class="pf-line"><span>Promesa de compraventa</span><b>${fmtMoney(plan.promesa)}</b></div>`;
  }

  rows += `<div class="pf-line"><span><strong>${plan.formaPago === 'contado' ? 'Saldo a cancelar de contado' : 'Monto a financiar'}</strong></span><b>${fmtMoney(plan.saldo)}</b></div>`;
  if (plan.tasa !== undefined) rows += `<div class="pf-line"><span>Interés anual</span><b>${plan.tasa}%</b></div>`;
  if (plan.plazo !== undefined) rows += `<div class="pf-line"><span>Plazo</span><b>${plan.plazo} años</b></div>`;
  if (plan.cuota) rows += `<div class="pf-line"><span>Cuota mensual estimada</span><b>${fmtMoney(plan.cuota)}</b></div>`;
  box.innerHTML = `<div class="pf-breakdown">${rows}</div>`;
}

// Desglose de pago de una unidad dentro de la proforma — cambia según el tipo
// de financiamiento del proyecto (misma estructura visual, distinto contenido).
function buildPagoBreakdown(plan) {
  const tipo = PROYECTO.tipo_financiamiento;
  let rows = `<div class="pf-line"><span>Precio de lista</span><b>${fmtMoney(plan.precioLista)}</b></div>`;
  if (plan.desc > 0) rows += `<div class="pf-line"><span>Descuento por negociación</span><b>&minus; ${fmtMoney(plan.desc)}</b></div>`;

  if (tipo === 'cuotas_entrega') {
    rows += `<div class="pf-line"><span>Reserva</span><b>${fmtMoney(plan.reserva)}</b></div>`;
    rows += `<div class="pf-line"><span>Promesa de compraventa</span><b>${fmtMoney(plan.promesa)}</b></div>`;
    rows += `<div class="pf-line"><span>Cuotas hasta la entrega (${plan.numCuotas} de ${fmtMoney(plan.montoCuota)})</span><b>${fmtMoney(plan.cuotasTotal)}</b></div>`;
    rows += `<div class="pf-line total"><span>Total a abonar hasta la entrega</span><b>${fmtMoney(plan.abonoTotal)}</b></div>`;
  } else if (tipo === 'pago_directo') {
    rows += `<div class="pf-line total"><span>Abono antes de la entrega</span><b>${fmtMoney(plan.abonoTotal)}</b></div>`;
  } else {
    rows += `<div class="pf-line"><span>Reserva</span><b>${fmtMoney(plan.reserva)}</b></div>`;
    if (plan.promesa) rows += `<div class="pf-line"><span>Promesa de compraventa</span><b>${fmtMoney(plan.promesa)}</b></div>`;
    if (plan.capital) rows += `<div class="pf-line"><span>Pagos/cuotas a capital</span><b>${fmtMoney(plan.capital)}</b></div>`;
  }

  rows += `<div class="pf-line total"><span>${plan.formaPago === 'contado' ? 'Saldo a cancelar de contado' : 'Monto a financiar'}</span><b>${fmtMoney(plan.saldo)}</b></div>`;
  if (plan.tasa !== undefined) rows += `<div class="pf-line"><span>Interés anual</span><b>${plan.tasa}%</b></div>`;
  if (plan.plazo !== undefined) rows += `<div class="pf-line"><span>Plazo</span><b>${plan.plazo} años</b></div>`;

  const cuotaBox = plan.cuota ? `
    <div class="pf-cuota">
      <div>
        <div class="label">Cuota mensual estimada</div>
        <div class="amount">${fmtMoney(plan.cuota)}<span> /mes</span></div>
      </div>
      ${plan.cuota20 ? `<div class="alt">20 años: <strong>${fmtMoney(plan.cuota20)}</strong><br>15 años: <strong>${fmtMoney(plan.cuota15)}</strong></div>` : ''}
    </div>` : '';

  return `<div class="pf-breakdown">${rows}</div>${cuotaBox}`;
}

// Mensaje de WhatsApp para el cliente — profesional, con los datos de esta
// proforma ya insertados. El asesor lo revisa/edita dentro de WhatsApp antes
// de enviarlo (el enlace solo pre-llena el texto, no envía automáticamente).
function buildWhatsAppMessage({ numeroProforma, asesorNombre, asesorEmpresa, clienteNombre, proyectoNombre, unidadesTexto, precioFinalTexto }) {
  // Colaboradores externos/independientes no representan a GPUnlock, así que se
  // omite la mención de la empresa en la presentación del asesor.
  const presentacion = asesorEmpresa === 'independiente'
    ? `mi nombre es ${asesorNombre}.`
    : `mi nombre es ${asesorNombre}, asesor comercial de GPUnlock.`;
  return `Buenas, ${clienteNombre ? clienteNombre + ', ' : ''}${presentacion}\n\n` +
    `Le escribo para presentarle la cotización del proyecto ${proyectoNombre}${unidadesTexto ? ' — ' + unidadesTexto : ''}, con un valor final de ${precioFinalTexto}.\n\n` +
    `Le comparto la proforma N.º ${numeroProforma} con el detalle completo del plan de pago. Quedo atento/a a cualquier consulta que tenga.\n\n` +
    `Saludos cordiales.`;
}

async function generarProforma() {
  if (!seleccionadas.length) { showToast('Selecciona al menos una unidad.'); return; }
  const asesorNombre = qs('asesor-nombre').value.trim();
  const asesorTelCode = qs('asesor-tel-code').value;
  const asesorTelLocal = qs('asesor-tel').value.trim();
  const asesorEmpresa = qs('asesor-empresa').value;
  if (!asesorNombre || !asesorTelLocal) { showToast('Ingresa tu nombre y teléfono de asesor.'); return; }
  const nombre = qs('cli-nombre').value.trim();
  if (!nombre) { showToast('Ingresa el nombre del cliente.'); return; }
  const motivoCompra = qs('motivo-compra').value;
  const formaPagoValor = getFormaPago();
  const asesorSeleccionadoId = qs('asesor-select') ? qs('asesor-select').value : '';
  guardarAsesor(asesorNombre, asesorTelLocal, asesorEmpresa, asesorTelCode, asesorSeleccionadoId);
  const asesorTel = formatTelefono(asesorTelCode, asesorTelLocal); // ej. '+593 991234567', para mostrar

  const telCode = qs('cli-tel-code').value;
  const telLocal = qs('cli-tel').value.trim();
  const tel = telLocal ? formatTelefono(telCode, telLocal) : '';
  const email = qs('cli-email').value.trim();
  const notas = qs('notas').value.trim();
  const hoy = new Date();
  const asesorEmail = CotizadorAuth.getUser().email;
  const logoProyecto = `assets/logos/${PROYECTO.id}.png`;

  // Número de proforma: lo genera la base de datos de forma atómica (nunca
  // se repite aunque dos asesores generen al mismo tiempo). Si por algún
  // motivo falla (ej. sin conexión), seguimos igual con un número temporal
  // para no bloquear al asesor — el historial de todas formas queda sin ese
  // número, así que conviene reintentar cuando haya conexión.
  let numeroProforma = null;
  try {
    const { data, error } = await supabaseClient.rpc('siguiente_numero_proforma', { p_proyecto_id: PROYECTO.id });
    if (!error) numeroProforma = data;
  } catch (e) { /* se maneja abajo con el aviso */ }
  if (!numeroProforma) {
    showToast('No se pudo generar el número de proforma (sin conexión). Se generó igual, pero avísale al admin.', 'error');
  }

  let unitSections = '';
  const fotos = []; // { caption, url } — van todas juntas en la página 2
  let plan0 = null;
  const unidadesTexto = seleccionadas.map(u => u.nombre).join(', ');
  for (const u of seleccionadas) {
    const plan = calcularPlan(u);
    plan.precioLista = u.precio;
    if (!plan0) plan0 = plan;
    const fotoUrl = await signedMediaUrl(u.raw?.foto_url);
    if (fotoUrl) fotos.push({ caption: `${u.nombre}${u.specsText ? ' · ' + u.specsText : ''}`, url: fotoUrl });

    unitSections += `
      <div class="pf-unit">
        <div class="pf-unit-head">
          <div>
            <div class="tag">Propiedad cotizada${plan.formaPago === 'contado' ? ' · Pago de contado' : ''}</div>
            <h2>${u.nombre}</h2>
            <div class="specs">${u.specsText}</div>
          </div>
          <div class="price-box">
            ${plan.desc > 0 ? `<div class="price-old">${fmtMoney(u.precio)}</div>` : ''}
            <div class="price-final">${fmtMoney(plan.precioFinal)}</div>
            <div class="price-final-label">Precio final</div>
          </div>
        </div>
        ${buildPagoBreakdown(plan)}
      </div>`;
  }

  const page1 = `
    <div class="pf-page">
      <div class="pf-letterhead">
        <div class="logos">
          <img src="assets/logo.png" alt="GPUnlock" onerror="this.style.display='none'">
          <div class="div"></div>
          <img src="${logoProyecto}" alt="${PROYECTO.nombre}" onerror="this.style.display='none'">
        </div>
        <div class="doc-meta">
          <div class="doc-title">Proforma${numeroProforma ? ' ' + numeroProforma : ''}</div>
          <div class="doc-date">${fmtDate(hoy)}</div>
        </div>
      </div>

      <div class="pf-parties">
        <div>
          <div class="pf-party-label">Asesor</div>
          <div class="pf-party-name">${asesorNombre}</div>
          <div class="pf-party-meta">${asesorTel}${asesorEmail ? ' · ' + asesorEmail : ''}</div>
        </div>
        <div>
          <div class="pf-party-label">Cotización preparada para</div>
          <div class="pf-party-name">${nombre}</div>
          <div class="pf-party-meta">${[tel, email].filter(Boolean).join(' · ') || '&mdash;'}</div>
        </div>
      </div>

      ${unitSections}

      ${notas ? `
      <div class="pf-notes">
        <div class="pf-party-label">Notas adicionales</div>
        <p>${notas.replace(/\n/g, '<br>')}</p>
      </div>` : ''}

      <div class="pf-footer">
        <div class="col"><strong>${asesorNombre}</strong><br>Asesor GPUnlock<br>${asesorTel}${asesorEmail ? '<br>' + asesorEmail : ''}</div>
        <div class="col"><strong>GPUnlock</strong><br>${PROYECTO.nombre}${PROYECTO.ubicacion ? '<br>' + PROYECTO.ubicacion : ''}</div>
        <div class="col"><strong>Vigencia</strong><br>Esta proforma es referencial y válida por 8 días desde su emisión. Precios y disponibilidad sujetos a confirmación al momento de la reserva.</div>
      </div>
    </div>`;

  const page2 = fotos.length ? `
    <div class="pf-page pf-photos">
      <div class="pf-photos-title">Fichas de la propiedad</div>
      <div class="pf-photos-sub">${PROYECTO.nombre} · ${fotos.length > 1 ? fotos.length + ' unidades cotizadas' : '1 unidad cotizada'}</div>
      ${fotos.map(f => `
        <div class="pf-photo-item">
          <div class="cap">${f.caption}</div>
          <img src="${f.url}">
        </div>`).join('')}
    </div>` : '';

  qs('proforma-doc').innerHTML = page1 + page2;
  qs('form-view').hidden = true;
  qs('proforma-view').hidden = false;
  window.scrollTo(0, 0);

  // Botón de WhatsApp: solo se activa si hay teléfono de cliente. El mensaje
  // queda pre-llenado pero el asesor lo revisa/edita dentro de WhatsApp antes
  // de enviarlo — este botón no envía nada automáticamente.
  const waBtn = qs('whatsapp-btn');
  if (tel) {
    const mensaje = buildWhatsAppMessage({
      numeroProforma: numeroProforma || 'GPUnlock',
      asesorNombre, asesorEmpresa, clienteNombre: nombre, proyectoNombre: PROYECTO.nombre,
      unidadesTexto, precioFinalTexto: fmtMoney(plan0.precioFinal),
    });
    waBtn.hidden = false;
    waBtn.onclick = () => window.open(buildWhatsAppUrl(tel, mensaje), '_blank');
  } else {
    waBtn.hidden = true;
  }

  await supabaseClient.from('cotizador_historial').insert({
    numero_proforma: numeroProforma,
    creado_por: CotizadorAuth.getUser().id,
    asesor_nombre: asesorNombre, asesor_telefono: asesorTel,
    proyecto_id: PROYECTO.id,
    cliente_nombre: nombre, cliente_telefono: tel, cliente_correo: email,
    unidades: seleccionadas.map(u => ({
      codigo: u.codigo, nombre: u.nombre, precio_lista: u.precio, tipo: u.tipo || null,
      dormitorios: u.raw?.dormitorios ?? null,
      area_m2: PROYECTO.tipo_financiamiento === 'lote'
        ? (u.raw?.metraje_m2 ?? null)
        : (u.raw?.area_util_m2 ?? u.raw?.construccion_m2 ?? u.raw?.area_total_m2 ?? u.raw?.terreno_m2 ?? null),
    })),
    motivo_compra: motivoCompra || null, forma_pago: formaPagoValor,
    descuento: plan0.desc, precio_final: plan0.precioFinal, reserva: plan0.reserva, promesa: plan0.promesa || 0,
    abono_total: plan0.abonoTotal ?? plan0.reserva, monto_financiado: plan0.saldo,
    tasa_usada: plan0.tasa ?? null, plazo_anios_usado: plan0.plazo ?? null,
    numero_cuotas: plan0.numCuotas ?? null, monto_cuota: plan0.montoCuota ?? null,
    saldo_financiar: plan0.saldo, cuota_mensual: plan0.cuota || 0, notas,
  }).then(({ error }) => { if (error) console.warn('No se pudo guardar en el historial:', error); });
}

boot();
