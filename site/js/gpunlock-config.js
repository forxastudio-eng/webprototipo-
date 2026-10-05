/* ==========================================================================
   GPUnlock · Configuración ÚNICA de Supabase para toda la plataforma
   (landing principal, Vértice, Prisma, Valle Sereno, cotizador, marketing y panel).
   Proyecto: gpunlock-plataforma. Para cambiar de proyecto reemplaza los dos
   valores con los de Supabase → Project Settings → API (Project URL y la
   clave "anon public"). La anon key es pública por diseño; la seguridad la
   dan las políticas RLS (supabase/06_politicas.sql).
   NUNCA pongas aquí la service_role key.
   ========================================================================== */
var SUPABASE_URL = "https://subxdipvxdpmgitmdpyg.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1YnhkaXB2eGRwbWdpdG1kcHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NzIzMjUsImV4cCI6MjEwNjQ0ODMyNX0.Hs0W0r0jOl1gC-_um8-D_sHD3D0l3K_9p0u7rdHXqQc";

window.GPUNLOCK_CONFIG = {
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  /* Número de WhatsApp de contacto (formato internacional, sin "+"). Es un valor de ejemplo. */
  WHATSAPP: "593900000000",
  LOGIN_URL: "/admin/"
};
