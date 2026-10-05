// Panel de administración: CRUD de proyectos y unidades. Solo entra quien
// tenga el rol "editor" en public.user_roles (ver auth.js y /supabase/06_politicas.sql).

let PROYECTOS = [];

async function boot() {
  const result = await CotizadorAuth.requireAdmin();
  if (!result) return; // requireSession ya redirigió a index.html (no hay sesión)
  const { user, isAdmin } = result;

  document.getElementById('header-actions').innerHTML = `
    <span class="user-pill">${user.email} · ${CotizadorAuth.getRol() || 'sin rol'}</span>
    <a href="/admin/#/cuenta">Mi cuenta</a>
    <a href="/admin/">Panel</a>
    <a href="index.html">Ver cotizador</a>
    ${CotizadorAuth.getPuedeVerHistorial() ? '<a href="historial.html">Historial</a>' : ''}
    <button id="logout-btn">Cerrar sesión</button>`;
  document.getElementById('logout-btn').onclick = async () => { await CotizadorAuth.logout(); location.href = 'index.html'; };

  if (!isAdmin) {
    document.querySelector('main.wrap').innerHTML = `
      <div class="card" style="text-align:center;padding:48px 32px;">
        <h3 class="centered">Esta sección es solo para el rol editor</h3>
        <p class="hint" style="max-width:440px;margin:0 auto 18px;">
          Tu usuario (<strong>${user.email}</strong>) puede usar el cotizador. La configuración de proyectos,
          unidades y asesores la hace el editor. Si necesitas cambiar la disponibilidad de una unidad,
          hazlo desde el panel de administración.
        </p>
        <a href="index.html" class="btn btn-primary">Ir al cotizador</a>
      </div>`;
    return;
  }

  document.getElementById('project-form').addEventListener('submit', saveProject);
  document.getElementById('p-cancel').addEventListener('click', resetProjectForm);
  document.getElementById('unit-project-select').addEventListener('change', loadUnits);
  document.getElementById('add-unit-btn').addEventListener('click', addBlankUnit);
  document.getElementById('add-asesor-btn').addEventListener('click', addBlankAsesor);

  await loadProjects();
  await loadAsesoresAdmin();
}

// ---------- Asesores (directorio para el desplegable del cotizador) ----------
let ASESORES_ADMIN = [];

async function loadAsesoresAdmin() {
  const { data, error } = await supabaseClient.from('cotizador_asesores').select('*').order('sort_order').order('nombre');
  const list = document.getElementById('asesores-list');
  if (error) { list.innerHTML = `Error: ${error.message}`; return; }
  ASESORES_ADMIN = data;

  list.innerHTML = `<table class="admin-table"><thead><tr>
    <th>Nombre</th><th>Correo</th><th>Cód. país</th><th>Teléfono</th><th>Activo</th><th></th>
  </tr></thead><tbody>${data.map(a => `
    <tr data-id="${a.id}">
      <td><input class="a-nombre" value="${a.nombre || ''}" style="width:150px;"></td>
      <td><input class="a-correo" type="email" value="${a.correo || ''}" style="width:200px;"></td>
      <td><input class="a-codigo" value="${a.telefono_codigo || '593'}" style="width:64px;"></td>
      <td><input class="a-numero" value="${a.telefono_numero || ''}" style="width:120px;"></td>
      <td style="text-align:center;"><input type="checkbox" class="a-activo" ${a.activo ? 'checked' : ''} style="width:auto;min-height:auto;"></td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" title="Guardar" aria-label="Guardar asesor ${a.nombre || ''}" data-save>&#10003;</button>
        <button class="icon-btn danger" title="Eliminar" aria-label="Eliminar asesor ${a.nombre || ''}" data-del>&times;</button>
      </td>
    </tr>`).join('')}</tbody></table>`;

  list.querySelectorAll('[data-save]').forEach(b => b.onclick = (e) => saveAsesorRow(e.target.closest('tr')));
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => deleteAsesorRow(e.target.closest('tr')));
}

async function saveAsesorRow(tr) {
  const id = tr.dataset.id;
  const payload = {
    nombre: tr.querySelector('.a-nombre').value.trim(),
    correo: tr.querySelector('.a-correo').value.trim() || null,
    telefono_codigo: tr.querySelector('.a-codigo').value.trim() || '593',
    telefono_numero: tr.querySelector('.a-numero').value.replace(/[^\d]/g, ''),
    activo: tr.querySelector('.a-activo').checked,
  };
  if (!payload.nombre) { showToast('El nombre del asesor es obligatorio.'); return; }
  const { error } = id.startsWith('new-')
    ? await supabaseClient.from('cotizador_asesores').insert({ ...payload, sort_order: ASESORES_ADMIN.length + 1 })
    : await supabaseClient.from('cotizador_asesores').update(payload).eq('id', id);
  if (error) { showToast('Error guardando asesor: ' + error.message); return; }
  await loadAsesoresAdmin();
}

async function deleteAsesorRow(tr) {
  if (!(await showConfirm('¿Eliminar este asesor del directorio? Ya no va a aparecer en el desplegable del cotizador.'))) return;
  const id = tr.dataset.id;
  if (!id.startsWith('new-')) {
    const { error } = await supabaseClient.from('cotizador_asesores').delete().eq('id', id);
    if (error) { showToast('Error eliminando: ' + error.message); return; }
  }
  await loadAsesoresAdmin();
}

function addBlankAsesor() {
  const list = document.getElementById('asesores-list');
  const tbody = list.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = 'new-' + Date.now();
  tr.innerHTML = `
    <td><input class="a-nombre" style="width:150px;"></td>
    <td><input class="a-correo" type="email" style="width:200px;"></td>
    <td><input class="a-codigo" value="593" style="width:64px;"></td>
    <td><input class="a-numero" style="width:120px;"></td>
    <td style="text-align:center;"><input type="checkbox" class="a-activo" checked style="width:auto;min-height:auto;"></td>
    <td style="white-space:nowrap;">
      <button class="icon-btn" title="Guardar" aria-label="Guardar asesor nuevo" data-save>&#10003;</button>
      <button class="icon-btn danger" title="Eliminar" aria-label="Quitar fila" data-del>&times;</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('[data-save]').onclick = () => saveAsesorRow(tr);
  tr.querySelector('[data-del]').onclick = () => tr.remove();
}

async function loadProjects() {
  const { data, error } = await supabaseClient.from('cotizador_proyectos').select('*').order('sort_order');
  const list = document.getElementById('project-list');
  if (error) { list.innerHTML = `Error: ${error.message}`; return; }
  PROYECTOS = data;

  list.innerHTML = `<table class="admin-table"><thead><tr>
    <th>Portada</th><th>Proyecto</th><th>Color</th><th>Tipo financiamiento</th><th>Activo</th><th></th>
  </tr></thead><tbody>${await Promise.all(data.map(async p => {
    const cover = await signedMediaUrl(p.cover_url);
    return `<tr>
      <td>${cover ? `<img class="thumb" src="${cover}">` : `<div class="thumb" style="background:linear-gradient(150deg, ${p.color_primario}, ${p.color_acento});"></div>`}</td>
      <td><strong>${p.nombre}</strong><br><span class="hint">${p.id}${p.prefijo_proforma ? ' · proforma ' + p.prefijo_proforma + '-####' : ''}</span></td>
      <td><span style="display:inline-block;width:16px;height:16px;border-radius:5px;background:${p.color_primario};border:1px solid var(--border);vertical-align:middle;" title="${p.color_primario}"></span></td>
      <td>${p.tipo_financiamiento}</td>
      <td>${p.activo ? 'Sí' : 'No'}</td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" title="Editar" aria-label="Editar ${p.nombre}" data-edit="${p.id}">✎</button>
        <button class="icon-btn" title="${p.activo ? 'Desactivar' : 'Activar'}" aria-label="${p.activo ? 'Desactivar' : 'Activar'} ${p.nombre}" data-toggle="${p.id}">${p.activo ? '⏻' : '▶'}</button>
      </td>
    </tr>`;
  })).then(rows => rows.join(''))}</tbody></table>`;

  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editProject(b.dataset.edit));
  list.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => toggleProject(b.dataset.toggle));

  const sel = document.getElementById('unit-project-select');
  sel.innerHTML = data.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
  if (data.length) loadUnits();
}

function editProject(id) {
  const p = PROYECTOS.find(x => x.id === id);
  document.getElementById('project-form-title').textContent = `Editando: ${p.nombre}`;
  document.getElementById('p-id').value = p.id;
  document.getElementById('p-id').disabled = true;
  document.getElementById('p-nombre').value = p.nombre;
  document.getElementById('p-tagline').value = p.tagline || '';
  document.getElementById('p-color1').value = p.color_primario;
  document.getElementById('p-color2').value = p.color_acento;
  document.getElementById('p-prefijo').value = p.prefijo_proforma || '';
  document.getElementById('p-tipo').value = p.tipo_financiamiento;
  document.getElementById('p-reserva').value = p.reserva_pct;
  document.getElementById('p-promesa').value = p.promesa_pct;
  document.getElementById('p-tasa').value = p.tasa_default;
  document.getElementById('p-plazo').value = p.plazo_default_anios;
  document.getElementById('p-multi').checked = p.permite_multi_seleccion;
  document.getElementById('p-desc').checked = p.permite_descuento_manual;
  document.getElementById('p-editing-id').value = p.id;
  document.getElementById('p-cancel').hidden = false;
  window.scrollTo({ top: document.getElementById('project-form').offsetTop - 20, behavior: 'smooth' });
}

function resetProjectForm() {
  document.getElementById('project-form').reset();
  document.getElementById('p-id').disabled = false;
  document.getElementById('p-editing-id').value = '';
  document.getElementById('project-form-title').textContent = 'Agregar proyecto nuevo';
  document.getElementById('p-cancel').hidden = true;
}

async function toggleProject(id) {
  const p = PROYECTOS.find(x => x.id === id);
  await supabaseClient.from('cotizador_proyectos').update({ activo: !p.activo }).eq('id', id);
  await loadProjects();
}

async function saveProject(e) {
  e.preventDefault();
  const editingId = document.getElementById('p-editing-id').value;
  const payload = {
    id: document.getElementById('p-id').value.trim(),
    nombre: document.getElementById('p-nombre').value.trim(),
    tagline: document.getElementById('p-tagline').value.trim(),
    color_primario: document.getElementById('p-color1').value,
    color_acento: document.getElementById('p-color2').value,
    prefijo_proforma: document.getElementById('p-prefijo').value.trim().toUpperCase() || null,
    tipo_financiamiento: document.getElementById('p-tipo').value,
    reserva_pct: parseFloat(document.getElementById('p-reserva').value) || 0,
    promesa_pct: parseFloat(document.getElementById('p-promesa').value) || 0,
    tasa_default: parseFloat(document.getElementById('p-tasa').value) || 0,
    plazo_default_anios: parseInt(document.getElementById('p-plazo').value) || 0,
    permite_multi_seleccion: document.getElementById('p-multi').checked,
    permite_descuento_manual: document.getElementById('p-desc').checked,
  };
  const coverFile = document.getElementById('p-cover').files[0];
  if (coverFile) payload.cover_url = await uploadMedia(coverFile, `proyectos/${payload.id}`);

  const { error } = editingId
    ? await supabaseClient.from('cotizador_proyectos').update(payload).eq('id', editingId)
    : await supabaseClient.from('cotizador_proyectos').insert({ ...payload, sort_order: PROYECTOS.length + 1 });
  if (error) { showToast('Error guardando: ' + error.message); return; }
  resetProjectForm();
  await loadProjects();
}

async function loadUnits() {
  const proyectoId = document.getElementById('unit-project-select').value;
  const proyecto = PROYECTOS.find(p => p.id === proyectoId);
  const list = document.getElementById('unit-list');
  const table = proyecto.tipo_financiamiento === 'lote' ? 'cotizador_inventario_extra' : 'cotizador_unidades';
  const query = supabaseClient.from(table).select('*').eq('proyecto_id', proyectoId).order('codigo');
  const { data, error } = table === 'cotizador_inventario_extra' ? await query.eq('tipo', 'lote') : await query;
  if (error) { list.innerHTML = `Error: ${error.message}`; return; }

  const rows = await Promise.all(data.map(async u => {
    const thumb = table === 'cotizador_unidades' ? await signedMediaUrl(u.foto_url) : null;
    return `<tr data-id="${u.id}" data-table="${table}">
      <td>${thumb ? `<img class="thumb" src="${thumb}">` : '<div class="thumb"></div>'}</td>
      <td><input class="f-codigo" value="${u.codigo}" style="width:90px;"></td>
      <td><input class="f-nombre" value="${u.nombre || ''}" style="width:140px;"></td>
      <td><input class="f-precio" type="number" step="0.01" value="${u.precio ?? ''}" style="width:110px;"></td>
      <td><select class="f-estado">
        ${['disponible','reservado','vendida','no_disponible'].map(s => `<option value="${s}" ${u.estado===s?'selected':''}>${ESTADO_LABEL[s]}</option>`).join('')}
      </select></td>
      <td><input class="f-nota" value="${u.nota || ''}" placeholder="Nota interna (no se imprime)" style="width:170px;"></td>
      <td><input type="file" class="f-foto" accept="image/*" style="width:130px;"></td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" title="Guardar" aria-label="Guardar unidad ${u.codigo || ''}" data-save>&#10003;</button>
        <button class="icon-btn danger" title="Eliminar" aria-label="Eliminar unidad ${u.codigo || ''}" data-del>&times;</button>
      </td>
    </tr>`;
  }));

  list.innerHTML = `<table class="admin-table"><thead><tr>
    <th>Foto</th><th>Código</th><th>Nombre</th><th>Precio</th><th>Estado</th><th>Nota</th><th>Subir foto</th><th></th>
  </tr></thead><tbody>${rows.join('')}</tbody></table>`;

  list.querySelectorAll('[data-save]').forEach(b => b.onclick = (e) => saveUnitRow(e.target.closest('tr')));
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => deleteUnitRow(e.target.closest('tr')));
}

async function saveUnitRow(tr) {
  const table = tr.dataset.table;
  const id = tr.dataset.id;
  const payload = {
    codigo: tr.querySelector('.f-codigo').value.trim(),
    nombre: tr.querySelector('.f-nombre').value.trim(),
    precio: parseFloat(tr.querySelector('.f-precio').value) || null,
    estado: tr.querySelector('.f-estado').value,
    nota: tr.querySelector('.f-nota').value.trim() || null,
  };
  const fotoFile = tr.querySelector('.f-foto').files[0];
  if (fotoFile && table === 'cotizador_unidades') {
    payload.foto_url = await uploadMedia(fotoFile, `unidades/${document.getElementById('unit-project-select').value}`);
  }
  const { error } = id.startsWith('new-')
    ? await supabaseClient.from(table).insert({ ...payload, proyecto_id: document.getElementById('unit-project-select').value, ...(table === 'cotizador_inventario_extra' ? { tipo: 'lote' } : {}) })
    : await supabaseClient.from(table).update(payload).eq('id', id);
  if (error) { showToast('Error guardando unidad: ' + error.message); return; }
  await loadUnits();
}

async function deleteUnitRow(tr) {
  if (!(await showConfirm('¿Eliminar esta unidad? Esta acción no se puede deshacer.'))) return;
  const table = tr.dataset.table;
  const id = tr.dataset.id;
  if (!id.startsWith('new-')) {
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) { showToast('Error eliminando: ' + error.message); return; }
  }
  await loadUnits();
}

function addBlankUnit() {
  const list = document.getElementById('unit-list');
  const table = PROYECTOS.find(p => p.id === document.getElementById('unit-project-select').value).tipo_financiamiento === 'lote' ? 'cotizador_inventario_extra' : 'cotizador_unidades';
  const tbody = list.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = 'new-' + Date.now();
  tr.dataset.table = table;
  tr.innerHTML = `
    <td><div class="thumb"></div></td>
    <td><input class="f-codigo" style="width:90px;"></td>
    <td><input class="f-nombre" style="width:140px;"></td>
    <td><input class="f-precio" type="number" step="0.01" style="width:110px;"></td>
    <td><select class="f-estado">${['disponible','reservado','vendida','no_disponible'].map(s => `<option value="${s}">${ESTADO_LABEL[s]}</option>`).join('')}</select></td>
    <td><input class="f-nota" placeholder="Nota interna (no se imprime)" style="width:170px;"></td>
    <td><input type="file" class="f-foto" accept="image/*" style="width:130px;"></td>
    <td style="white-space:nowrap;">
      <button class="icon-btn" title="Guardar" aria-label="Guardar unidad nueva" data-save>&#10003;</button>
      <button class="icon-btn danger" title="Eliminar" aria-label="Quitar fila" data-del>&times;</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('[data-save]').onclick = () => saveUnitRow(tr);
  tr.querySelector('[data-del]').onclick = () => tr.remove();
}

boot();
