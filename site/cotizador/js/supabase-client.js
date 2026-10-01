// Cliente único de Supabase: la URL y la anon key viven en /js/gpunlock-config.js
// (un solo lugar para toda la plataforma). La sesión se comparte con el panel
// /admin/ y el resto del sitio porque todo está en el mismo dominio.
const supabaseClient = window.supabase.createClient(
  window.GPUNLOCK_CONFIG.SUPABASE_URL,
  window.GPUNLOCK_CONFIG.SUPABASE_ANON_KEY
);
