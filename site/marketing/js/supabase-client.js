// ============================================================================
// Cliente Supabase compartido por index.html y admin.html.
// Requiere que la librería @supabase/supabase-js (CDN) y js/config.js
// se hayan cargado ANTES de este archivo.
// ============================================================================
window.GPUNLOCK_SUPABASE = (function () {
  const cfg = window.GPUNLOCK_CONFIG || {};
  const isConfigured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("TU_SUPABASE_URL") &&
    !cfg.SUPABASE_ANON_KEY.includes("TU_SUPABASE_ANON_KEY");

  let client = null;
  if (isConfigured && window.supabase && window.supabase.createClient) {
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (err) {
      console.error("No se pudo inicializar Supabase:", err);
    }
  }

  return {
    isConfigured: !!client,
    client: client,
    adminEmail: cfg.ADMIN_EMAIL || "panel@gpunlock.example",
  };
})();
