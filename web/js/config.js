/* ==========================================================================
   GPUnlock CRM · Configuración pública de la web
   Solo valores PÚBLICOS. La anon key de Supabase es pública por diseño; la
   seguridad la dan las políticas RLS. Nunca pongas aquí la service_role ni
   otra clave secreta.
   Conectado al proyecto de Supabase del producto (clave pública «anon»; la seguridad la dan las
   políticas RLS). Si SUPABASE_URL vuelve a tener el valor de ejemplo, la página muestra los precios
   escritos en el HTML y la app y la consola avisan que falta conectar.
   ========================================================================== */
window.CRM_CONFIG = {
  SUPABASE_URL: "https://koiwwotrhswocpldgava.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvaXd3b3RyaHN3b2NwbGRnYXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMTI1MTAsImV4cCI6MjEwNjg4ODUxMH0.BJlRRYApwPbJfzfMGlmTCVE1bm8IZhMEcagRRNkE338",
  APP_NAME: "GPUnlock CRM",
  /* WhatsApp de ventas, formato internacional sin "+". Valor de ejemplo. */
  VENTAS_WHATSAPP: "593900000000",
  /* false = nadie paga ni sube comprobantes dentro de la app: el pago se acuerda directamente con GPUnlock y
     tú activas el plan desde /consola/. true = flujo de transferencia con referencia y comprobante dentro de la app. */
  PAGOS_EN_APP: false,
  /* Datos que aparecen en /terminos y /privacidad. Lo que quede vacío se muestra resaltado como «[completar: …]».
     Cuando un abogado revise los textos, pon revisado: true para quitar el aviso de borrador. */
  LEGAL: {
    razon_social: "GPUnlock",
    ruc: "",
    domicilio: "",
    ciudad: "",
    correo_privacidad: "",
    actualizado: "7 de octubre de 2026",
    revisado: false
  }
};
