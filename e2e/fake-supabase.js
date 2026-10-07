/* Simula @supabase/supabase-js para probar la app sin servidor.
   El estado vive en window.__FX (lo prepara cada prueba): tablas, respuestas rpc, llamadas y subidas. */
(function () {
  var FX = window.__FX || {};
  FX.calls = []; FX.uploads = []; FX.escrituras = []; FX.quitados = []; FX.escuchas = [];
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
    crm_oportunidades: [], crm_actividades: [], invitaciones: [], org_marca: FX.marca ? [FX.marca] : [],
    crm_unidades: FX.unidades || [], crm_unidades_historial: FX.historialUnidades || [],
    crm_cotizador_config: FX.cfgCot || [], crm_cotizaciones: FX.cotizaciones || []
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
    guardar_datos_cobro: function () { return null; },
    /* marca de la empresa */
    guardar_marca: function (a) {
      if (FX.errorMarca) return { __error: FX.errorMarca };
      FX.marca = { org_id: ORG.id, nombre_comercial: a.p_nombre, subdominio: a.p_subdominio, color_primario: a.p_color, color_acento: a.p_acento,
        logo_path: a.p_logo, logo_oscuro_path: a.p_logo_oscuro, mostrar_pie_gpunlock: !a.p_ocultar_pie };
      FX.tables.org_marca = [FX.marca];
      return FX.marca;
    },
    marca_publica: function (a) { return (FX.publicas || {})[a.p_subdominio] || null; },
    /* inventario */
    guardar_unidad: function (a) {
      if (FX.errorUnidad) return { __error: FX.errorUnidad };
      var T = FX.tables.crm_unidades, d = a.p_datos, u;
      if (T.some(function (x) { return x.id !== a.p_id && x.proyecto === d.proyecto && x.codigo.toLowerCase() === d.codigo.toLowerCase(); })) return { __error: "Ya existe una unidad con el código «" + d.codigo + "» en ese proyecto" };
      if (a.p_id) { u = T.filter(function (x) { return x.id === a.p_id; })[0]; Object.assign(u, d); }
      else { u = Object.assign({ id: "u" + (T.length + 1), org_id: ORG.id, estado_at: new Date().toISOString(), publica: true }, d); T.push(u); }
      return u;
    },
    eliminar_unidad: function (a) { FX.tables.crm_unidades = FX.tables.crm_unidades.filter(function (x) { return x.id !== a.p_unidad; }); return null; },
    cambiar_estado_unidad: function (a) {
      if (FX.errorEstado) return { __error: FX.errorEstado };
      var u = FX.tables.crm_unidades.filter(function (x) { return x.id === a.p_unidad; })[0], antes = u.estado;
      u.estado = a.p_estado; u.estado_at = new Date().toISOString();
      FX.tables.crm_unidades_historial = [{ id: 99, unidad_id: u.id, estado_antes: antes, estado_despues: a.p_estado, oportunidad_id: a.p_oportunidad, por: "ana@x.com", nota: a.p_nota, created_at: new Date().toISOString() }].concat(FX.tables.crm_unidades_historial);
      return u;
    },
    /* cotizador */
    crear_cotizacion: function (a) {
      if (FX.errorCotizacion) return { __error: FX.errorCotizacion };
      var d = a.p_datos, ops = FX.tables.crm_oportunidades, op;
      if (d.oportunidad_id) op = ops.filter(function (o) { return o.id === d.oportunidad_id; })[0];
      else {
        op = { id: "nuevo-" + (ops.length + 1), org_id: ORG.id, etapa: "nuevo", proyecto: d.proyecto, asignado_a: FX.user.email, fuente: "oficina", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          contacto: { id: "cn", nombre: d.cliente.nombre, telefono: d.cliente.telefono, telefono_norm: d.cliente.telefono.replace(/\D/g, ""), correo: d.cliente.correo || null } };
        ops.push(op);
      }
      var us = FX.tables.crm_unidades.filter(function (u) { return d.unidades.indexOf(u.id) >= 0; });
      var lista = us.reduce(function (s, u) { return s + u.precio; }, 0);
      var k = window.GPUCotizar.calcular({ precioLista: lista, descuento: d.descuento, forma: d.forma_pago, entradaPct: d.entrada_pct, reserva: d.reserva, cuotas: d.cuotas_entrada, tasa: d.tasa_anual, plazo: d.plazo_anios });
      var n = FX.tables.crm_cotizaciones.length + 1;
      var q = { id: "q" + n, org_id: ORG.id, numero: "TA-" + String(n).padStart(4, "0"), proyecto: d.proyecto, oportunidad_id: op.id, cliente_nombre: op.contacto.nombre, cliente_telefono: op.contacto.telefono,
        unidades: us.map(function (u) { return { id: u.id, codigo: u.codigo, tipo: u.tipo, precio: u.precio, foto: (u.fotos || [])[0] || null }; }), precio_lista: lista, descuento: d.descuento,
        precio_final: k.precioFinal, forma_pago: d.forma_pago, entrada_pct: d.entrada_pct, entrada: k.entrada, reserva: k.reserva, cuotas_entrada: d.cuotas_entrada, cuota_entrada: k.cuotaEntrada,
        saldo: k.saldo, tasa_anual: d.tasa_anual, plazo_anios: d.plazo_anios, cuota_mensual: k.cuotaMensual, vigencia_hasta: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
        token: "ab".repeat(32), estado: "emitida", asesor_nombre: "Ana", asesor_email: FX.user.email, created_at: new Date().toISOString() };
      FX.tables.crm_cotizaciones.unshift(q); op.etapa = "proforma";
      return q;
    },
    guardar_config_cotizador: function (a) {
      var c = Object.assign({ org_id: ORG.id, proyecto: a.p_proyecto }, a.p_datos);
      FX.tables.crm_cotizador_config = FX.tables.crm_cotizador_config.filter(function (x) { return x.proyecto !== a.p_proyecto; }).concat([c]);
      return c;
    },
    anular_cotizacion: function (a) { FX.tables.crm_cotizaciones.forEach(function (q) { if (q.id === a.p_id) q.estado = "anulada"; }); return null; },
    crm_tomar_lead: function (a) { FX.tables.crm_oportunidades.forEach(function (o) { if (o.id === a.p_op) o.asignado_a = FX.user.email; }); return null; },
    guardar_fotos_unidad: function (a) { var u = FX.tables.crm_unidades.filter(function (x) { return x.id === a.p_unidad; })[0]; u.fotos = a.p_fotos; return a.p_fotos; },
    importar_unidades: function (a) {
      if (FX.respImportar) return FX.respImportar;
      var T = FX.tables.crm_unidades, c = 0, m = 0;
      a.p_filas.forEach(function (f) {
        var u = T.filter(function (x) { return x.proyecto === f.proyecto && x.codigo.toLowerCase() === f.codigo.toLowerCase(); })[0];
        if (u) { m++; Object.assign(u, f); } else { c++; T.push(Object.assign({ id: "i" + T.length, org_id: ORG.id, estado: "disponible", estado_at: new Date().toISOString(), publica: true }, f)); }
      });
      return { ok: true, creadas: c, actualizadas: m };
    }
  }, FX.rpc || {});

  function builder(table) {
    var single = false, cadena = [];
    var b = new Proxy({}, {
      get: function (_, k) {
        if (k === "then") return function (res, rej) { return Promise.resolve(fin()).then(res, rej); };
        if (k === "maybeSingle" || k === "single") return function () { single = true; return b; };
        return function () { cadena.push([k, [].slice.call(arguments)]); return b; };
      }
    });
    function fin() {
      if (cadena.some(function (c) { return /^(update|insert|delete|upsert)$/.test(c[0]); })) FX.escrituras.push({ tabla: table, cadena: cadena });
      var d = typeof FX.tables[table] === "function" ? FX.tables[table]() : (FX.tables[table] || []);
      return { data: single ? (d[0] || null) : d, error: null };
    }
    return b;
  }
  var sb = {
    auth: {
      getSession: function () {
        var r = { data: { session: FX.sinSesion ? null : { user: FX.user } } };
        return FX.demoraMs ? new Promise(function (ok) { setTimeout(function () { ok(r); }, FX.demoraMs); }) : Promise.resolve(r);
      },
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
    channel: function () {
      var c = { on: function (_t, f, cb) { FX.escuchas.push({ tabla: f.table, cb: cb }); return c; }, subscribe: function () { return c; } };
      return c;
    },
    removeChannel: function () {},
    storage: { from: function (bucket) {
      return { remove: function (rutas) { FX.quitados = FX.quitados.concat(rutas); return Promise.resolve({ data: [], error: null }); },
      upload: function (path, file, opts) {
        FX.uploads.push({ bucket: bucket, path: path, type: opts && opts.contentType, size: file.size });
        return Promise.resolve({ data: { path: path }, error: null });
      }, createSignedUrl: function (path, seg) {
        FX.firmas = (FX.firmas || []).concat([{ bucket: bucket, path: path, seg: seg }]);
        return Promise.resolve({ data: { signedUrl: "https://fake.supabase.co/storage/firmado/" + path }, error: null });
      } };
    } }
  };
  /* Simula un cambio en tiempo real hecho por otro usuario: FX.emitir("org_marca", {eventType:"UPDATE", new:{…}}) */
  FX.emitir = function (tabla, payload) { FX.escuchas.forEach(function (e) { if (e.tabla === tabla) e.cb(payload); }); };
  window.supabase = { createClient: function () { return sb; } };
})();
