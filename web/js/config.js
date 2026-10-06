/* ==========================================================================
   GPUnlock CRM · Configuración pública de la web
   Solo valores PÚBLICOS. La anon key de Supabase es pública por diseño; la
   seguridad la dan las políticas RLS. Nunca pongas aquí la service_role ni
   otra clave secreta.
   Mientras SUPABASE_URL tenga el valor de ejemplo, la página muestra los
   precios escritos en el HTML; con valores reales los lee de la tabla planes.
   ========================================================================== */
window.CRM_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_ANON_KEY",
  APP_NAME: "GPUnlock CRM",
  /* WhatsApp de ventas, formato internacional sin "+". Valor de ejemplo. */
  VENTAS_WHATSAPP: "593900000000"
};
