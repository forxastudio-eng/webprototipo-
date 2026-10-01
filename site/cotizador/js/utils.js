// Helpers compartidos: formato de moneda/fecha, matemática de crédito y
// generación de URLs firmadas para el bucket privado cotizador-media.

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  return d.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Cuota francesa estándar (usada tanto por LUMEN/Vértice como por Crédito VIP de Colina Verde).
function calcCuota(capital, tasaAnualPct, meses) {
  const r = (tasaAnualPct / 100) / 12;
  if (!capital || capital <= 0 || !meses || meses <= 0) return 0;
  if (r === 0) return capital / meses;
  return capital * (r * Math.pow(1 + r, meses)) / (Math.pow(1 + r, meses) - 1);
}

const ESTADO_LABEL = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendida: 'Vendida',
  no_disponible: 'No disponible',
};

// El bucket cotizador-media es privado (requiere sesión), así que las URLs
// públicas no sirven: hay que pedir una URL firmada cada vez que se renderiza.
async function signedMediaUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path; // ya es una URL absoluta (externa)
  const { data, error } = await supabaseClient
    .storage
    .from('cotizador-media')
    .createSignedUrl(path, expiresInSeconds);
  if (error) { console.warn('No se pudo firmar la imagen', path, error); return null; }
  return data.signedUrl;
}

// Aviso no bloqueante (reemplaza a alert(), que congela la página hasta que
// alguien hace clic en "Aceptar" — mala práctica de UX para errores de forma).
let toastTimer = null;
function showToast(message, type = 'error') {
  let el = document.getElementById('cotizador-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cotizador-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999;max-width:90vw;padding:13px 20px;border-radius:10px;font-size:13.5px;font-family:var(--font-body, sans-serif);box-shadow:0 8px 24px rgba(0,0,0,.18);transition:opacity .2s, transform .2s;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.background = type === 'error' ? '#C23A32' : (type === 'ok' ? '#17845A' : '#161616');
  el.style.color = '#fff';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(8px)'; }, 4200);
}

// Confirmación no bloqueante (reemplaza a confirm(), que también congela la
// página como alert()). Devuelve una Promise<boolean>.
function showConfirm(message, { confirmLabel = 'Eliminar', cancelLabel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" role="alertdialog" aria-modal="true">
        <p>${message}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="cancel">${cancelLabel}</button>
          <button type="button" class="btn btn-danger" data-action="confirm">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector('[data-action="cancel"]').onclick = () => close(false);
    overlay.querySelector('[data-action="confirm"]').onclick = () => close(true);
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

// Códigos telefónicos de país más frecuentes entre clientes y asesores de
// GPUnlock (Ecuador primero por ser el mercado principal). El asesor elige el
// país en un selector y solo escribe el número local — sin tener que
// recordar ni tipear el "+593" (u otro) a mano.
const PAISES_TEL = [
  { code: '593', name: 'Ecuador' },
  { code: '1', name: 'Estados Unidos / Canadá' },
  { code: '57', name: 'Colombia' },
  { code: '51', name: 'Perú' },
  { code: '58', name: 'Venezuela' },
  { code: '56', name: 'Chile' },
  { code: '54', name: 'Argentina' },
  { code: '52', name: 'México' },
  { code: '507', name: 'Panamá' },
  { code: '34', name: 'España' },
  { code: '44', name: 'Reino Unido' },
  { code: '39', name: 'Italia' },
  { code: '49', name: 'Alemania' },
  { code: '33', name: 'Francia' },
  { code: '351', name: 'Portugal' },
  { code: '506', name: 'Costa Rica' },
  { code: '502', name: 'Guatemala' },
  { code: '503', name: 'El Salvador' },
  { code: '504', name: 'Honduras' },
  { code: '505', name: 'Nicaragua' },
  { code: '598', name: 'Uruguay' },
  { code: '595', name: 'Paraguay' },
  { code: '591', name: 'Bolivia' },
  { code: '55', name: 'Brasil' },
];

function poblarSelectorPais(selectEl, codigoSeleccionado = '593') {
  if (!selectEl) return;
  selectEl.innerHTML = PAISES_TEL.map(p => `<option value="${p.code}">+${p.code} ${p.name}</option>`).join('');
  selectEl.value = codigoSeleccionado;
}

// Combina código de país + número local en el formato internacional que
// necesita wa.me (solo dígitos, sin '+'). Quita el 0 inicial típico de los
// números locales (ej. '0991234567' -> '991234567').
function normalizarTelefono(codigoPais, numeroLocal) {
  let d = (numeroLocal || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  return (codigoPais || '593') + d;
}

// Versión legible para mostrar en la proforma y el historial (ej. '+593 991234567').
function formatTelefono(codigoPais, numeroLocal) {
  let d = (numeroLocal || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  return `+${codigoPais || '593'} ${d}`;
}

function buildWhatsAppUrl(tel, mensaje) {
  const numero = (tel || '').replace(/[^\d]/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

// Exporta filas (array de arrays, primera fila = encabezados) a un .csv que
// Excel/Google Sheets abren directo con doble clic.
function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function descargarCSV(filename, rows) {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM: acentos correctos en Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function uploadMedia(file, folder) {
  const ext = file.name.split('.').pop();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await supabaseClient.storage.from('cotizador-media').upload(path, file, { upsert: false });
  if (error) throw error;
  return path; // guardamos el path (no la URL pública, porque el bucket es privado)
}
