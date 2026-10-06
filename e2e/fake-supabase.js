/* Simula @supabase/supabase-js para probar la app sin servidor.
   El estado vive en window.__FX (lo prepara cada prueba): tablas, respuestas rpc, llamadas y subidas. */
(function () {
  var FX = window.__FX || {};
  FX.calls = []; FX.uploads = [];
  var ORG = { id: "11111111-1111-1111-1111-111111111111", nombre: "Inmobiliaria Andes", clave_publica: "pk_demo", reparto: "ninguno", plan_id: "inicial", estado: "prueba" };
  var PLANES = [
    { id: "inicial", nombre: "Inicial", descripcion: "Para empezar.", precio_mensual: 19, precio_anual: 190, max_usuarios: 2, max_leads_mes: 150, ia_mes: 40, caracteristicas: ["Hasta 2 usuarios", "150 leads al mes"], destacado: false, orden: 1, activo: true },
    { id: "profesional", nombre: "Profesional", descripcion: "Para equipos.", precio_mensual: 49, precio_anual: 490, max_usuarios: 8, max_leads_mes: 1000, ia_mes: 400, caracteristicas: ["Hasta 8 usuarios"], destacado: true, orden: 2, activo: true },
    { id: "agencia", nombre: "Agencia", descripcion: "Para redes.", precio_mensual: 129, precio_anual: 1290, max_usuarios: 30, max_leads_mes: 5000, ia_mes: 2000, caracteristicas: ["Hasta 30 usuarios"], destacado: false, orden: 3, activo: true }
  ];
  var dia = 86400000;
  FX.user = FX.user || { id: "u1", email: "ana@x.com", user_metadata: { nombre: "Ana" } };
  FX.cobro = FX.cobro || { banco: "Banco Pichincha", tipo_cuenta: "Corriente", numero_cuenta: "2100123456", titular: "GPUnlock S.A.", identificacion: "1790000000001", whatsapp_cobros: "593999111222", iva_porcentaje: 15, dias_gracia: 5, instrucciones: "Escribe tu código de referencia en la descripción." };
  FX.uso = Object.assign({
    plan: PLANES[0], estado: "prueba", prueba_hasta: new Date(Date.now() + 9 * dia).toISOString(), periodo_hasta: null, gracia_hasta: null,
    activa: true, usuarios: 1, leads_mes: 12, ia_mes: 3, solicitud: null
  }, FX.uso || {});
  FX.tables = Object.assign({
    miembros: [{ rol: FX.rol || "propietario", nombre: "Ana", org: ORG }],
    crm_proyectos: [{ slug: "torre", nombre: "Torre Alba", activo: true }],
    planes: PLANES, organizaciones: [ORG], datos_cobro: [FX.cobro], pagos_suscripcion: FX.pagos || [],
    crm_oportunidades: [], crm_actividades: [], invitaciones: []
  }, FX.tables || {});
  FX.rpc = Object.assign({
    crm_equipo: [{ email: "ana@x.com", nombre: "Ana", rol: "propietario" }],
    aceptar_invitaciones: 0,
    uso_org: function () { return JSON.parse(JSON.stringify(FX.uso)); },
    crm_metricas: { dias: 30, abiertas: 0, sin_asignar: 0, nuevos: 0, vendidos: 0, perdidos: 0, tareas_vencidas: 0, por_etapa: {}, por_fuente: [], por_asesor: [], por_campana: [] },
    solicitar_pago: function (a) {
      if (FX.errorAlPedir) return { __error: FX.errorAlPedir };
      var pl = PLANES.filter(function (p) { return p.id === a.p_plan; })[0];
      var sub = a.p_periodo === "anual" ? pl.precio_anual : pl.precio_mensual, iva = Math.round(sub * 15) / 100;
      FX.uso.solicitud = { id: "sol-1", org_id: ORG.id, plan_id: a.p_plan, periodo: a.p_periodo, referencia: "GPU-7F3K-2611", subtotal: sub, iva: iva, total: sub + iva, estado: "pendiente", created_at: new Date().toISOString() };
      return { id: "sol-1", referencia: "GPU-7F3K-2611" };
    },
    subir_comprobante: function () { FX.uso.solicitud.estado = "en_revision"; FX.uso.solicitud.comprobante_subido_at = new Date().toISOString(); return null; },
    cancelar_solicitud: function () { FX.uso.solicitud = null; return null; },
    /* consola del equipo */
    es_superadmin: function () { return FX.superadmin !== false; },
    consola_resumen: function () { return FX.resumen || { empresas: { activa: 2, prueba: 1 }, por_revisar: 1, ingresos_mes: 98, por_vencer_30d: 1, ingresos_por_mes: [{ mes: "2026-09", subtotal: 49 }, { mes: "2026-10", subtotal: 98 }] }; },
    consola_pagos: function (a) { return (FX.pagosConsola || {})[a.p_estado] || []; },
    consola_empresas: function () { return FX.empresas || []; },
    consola_pagos_historial: function () { return FX.historial || []; },
    aprobar_pago: function () { return { periodo_hasta: "2026-11-15T00:00:00Z" }; },
    rechazar_pago: function (a) { return String(a.p_motivo || "").trim().length < 3 ? { __error: "Escribe el motivo: le llegará a la empresa" } : null; },
    registrar_pago_manual: function () { return { periodo_hasta: "2027-10-15T00:00:00Z" }; },
    consola_ajustar: function () { return null; },
    guardar_datos_cobro: function () { return null; }
  }, FX.rpc || {});

  function builder(table) {
    var single = false;
    var b = new Proxy({}, {
      get: function (_, k) {
        if (k === "then") return function (res, rej) { return Promise.resolve(fin()).then(res, rej); };
        if (k === "maybeSingle" || k === "single") return function () { single = true; return b; };
        return function () { return b; };
      }
    });
    function fin() {
      var d = typeof FX.tables[table] === "function" ? FX.tables[table]() : (FX.tables[table] || []);
      return { data: single ? (d[0] || null) : d, error: null };
    }
    return b;
  }
  var sb = {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: FX.sinSesion ? null : { user: FX.user } } }); },
      signInWithPassword: function (c) {
        if (FX.claveMala) return Promise.resolve({ data: null, error: { message: "Invalid login credentials" } });
        FX.sinSesion = false; FX.login = c; return Promise.resolve({ data: { session: { user: FX.user } }, error: null });
      },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve(); }
    },
    from: builder,
    rpc: function (name, args) {
      FX.calls.push({ name: name, args: args });
      var h = FX.rpc[name];
      var d = typeof h === "function" ? h(args) : h;
      if (d && d.__error) return Promise.resolve({ data: null, error: { message: d.__error } });
      return Promise.resolve({ data: d === undefined ? null : d, error: null });
    },
    channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; } }; return c; },
    removeChannel: function () {},
    storage: { from: function (bucket) {
      return { upload: function (path, file, opts) {
        FX.uploads.push({ bucket: bucket, path: path, type: opts && opts.contentType, size: file.size });
        return Promise.resolve({ data: { path: path }, error: null });
      }, createSignedUrl: function (path, seg) {
        FX.firmas = (FX.firmas || []).concat([{ bucket: bucket, path: path, seg: seg }]);
        return Promise.resolve({ data: { signedUrl: "https://fake.supabase.co/storage/firmado/" + path }, error: null });
      } };
    } }
  };
  window.supabase = { createClient: function () { return sb; } };
})();
