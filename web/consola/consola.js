/* GPUnlock · Consola del equipo: revisar pagos por transferencia, administrar empresas y ver ingresos.
   La seguridad real es de la base de datos (supabase/04_cobros.sql): todas las funciones consola_* y
   aprobar_pago exigen ser superadmin. Aquí solo se decide qué mostrar. */
(function () {
  "use strict";
  var CFG = window.CRM_CONFIG || {};
  var CONFIGURADO = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CFG.SUPABASE_URL || "") && !!CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY !== "TU_ANON_KEY";
  var sb = CONFIGURADO ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  var $ = function (id) { return document.getElementById(id); };
  var CFGC = window.CRM_CONFIG || {}, PAGOS_APP = CFGC.PAGOS_EN_APP === true;
  var S = { vista: PAGOS_APP ? "pagos" : "empresas", resumen: null, pagos: [], pendientes: [], empresas: [], historial: [], cobro: null, planes: [] };
  var ESTADOS = { prueba: ["En prueba", "ojo"], activa: ["Activa", "ok"], gracia: ["En gracia", "ojo"], vencida: ["Vencida", "mal"], cancelada: ["Cancelada", "mal"] };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function usd(n) { return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(n || 0); }
  function fecha(iso) { return iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
  function hace(iso) {
    var h = (Date.now() - new Date(iso).getTime()) / 3600000;
    return h < 1 ? "hace minutos" : h < 24 ? "hace " + Math.floor(h) + " h" : "hace " + Math.floor(h / 24) + " d";
  }
  function hoy() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function msgErr(e) { return (e && e.message) || "No se pudo completar la acción."; }
  var tt;
  function toast(t, mal) { var n = $("toast"); n.textContent = t; n.className = "toast" + (mal ? " mal" : ""); n.hidden = false; clearTimeout(tt); tt = setTimeout(function () { n.hidden = true; }, 5000); }
  function mostrar(que) { ["login", "denegado", "consola"].forEach(function (id) { $(id).hidden = id !== que; }); }
  async function conBoton(btn, fn) {
    if (btn.disabled) return; btn.disabled = true;
    try { return await fn(); } catch (e) { toast(msgErr(e), true); } finally { btn.disabled = false; }
  }
  async function rpc(nombre, args) { var r = await sb.rpc(nombre, args || {}); if (r.error) throw r.error; return r.data; }

  /* ------------------------------------------------------------ diálogos */
  function dlg(html, alEnviar) {
    var d = $("dlg"); d.innerHTML = '<form method="dialog" novalidate>' + html + "</form>";
    var f = d.querySelector("form");
    f.addEventListener("submit", async function (e) {
      e.preventDefault();
      var b = f.querySelector('[type="submit"]'); if (b.disabled) return;
      b.disabled = true;
      try { await alEnviar(new FormData(f)); d.close(); } catch (er) { var a = f.querySelector(".aviso"); if (a) { a.textContent = msgErr(er); a.hidden = false; } else toast(msgErr(er), true); }
      finally { b.disabled = false; }
    });
    f.querySelector("[data-cerrar]").addEventListener("click", function () { d.close(); });
    d.showModal();
  }
  var AV = '<div class="aviso mal" role="alert" hidden></div>';
  function pie(txt, cls) { return '<div class="acciones"><button type="button" class="btn" data-cerrar>Cancelar</button><button type="submit" class="btn ' + (cls || "primario") + '">' + txt + "</button></div>"; }
  function selPlanes(sel) { return S.planes.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === sel ? " selected" : "") + ">" + esc(p.nombre) + "</option>"; }).join(""); }

  /* -------------------------------------------------------------- carga */
  async function cargar() {
    var r = await Promise.all([
      rpc("consola_resumen"), rpc("consola_pagos", { p_estado: "en_revision" }), rpc("consola_pagos", { p_estado: "pendiente" }),
      rpc("consola_empresas"), rpc("consola_pagos_historial", { p_org: null, p_limite: 60 }),
      sb.from("datos_cobro").select("*").maybeSingle(), sb.from("planes").select("id,nombre").order("orden")
    ]);
    S.resumen = r[0]; S.pagos = r[1] || []; S.pendientes = r[2] || []; S.empresas = r[3] || []; S.historial = r[4] || [];
    S.cobro = r[5].data || {}; S.planes = r[6].data || [];
    pintar();
  }
  function pintar() {
    var tabs = (PAGOS_APP ? [["pagos", "Pagos por revisar", S.pagos.length]] : []).concat([["empresas", "Empresas", 0], ["ingresos", "Ingresos", 0], ["cobro", PAGOS_APP ? "Datos de cobro" : "Ajustes de cobro", 0]]);
    $("tabs").innerHTML = tabs.map(function (t) {
      return '<button data-a="vista" data-v="' + t[0] + '"' + (S.vista === t[0] ? ' aria-current="page"' : "") + ">" + t[1] + (t[2] ? "<b>" + t[2] + "</b>" : "") + "</button>";
    }).join("");
    $("vista").innerHTML = ({ pagos: vistaPagos, empresas: vistaEmpresas, ingresos: vistaIngresos, cobro: vistaCobro })[S.vista]();
  }

  /* -------------------------------------------------------------- pagos */
  function tarjetaPago(p, conComprobante) {
    return '<article class="tarjeta pago"><header><h3>' + esc(p.empresa) + '</h3><span class="chip marca">' + esc(p.plan) + " · " + esc(p.periodo) + "</span></header>" +
      '<dl class="datos"><div><dt>Total a recibir</dt><dd>' + usd(p.total) + '</dd></div><div><dt>Subtotal + impuesto</dt><dd>' + usd(p.subtotal) + " + " + usd(p.iva) + '</dd></div>' +
      '<div><dt>Referencia (búscala en el banco)</dt><dd class="ref">' + esc(p.referencia) + '</dd></div><div><dt>Propietario</dt><dd>' + esc(p.propietario || "—") + "</dd></div>" +
      "<div><dt>" + (conComprobante ? "Comprobante enviado" : "Solicitud creada") + "</dt><dd>" + hace(p.comprobante_subido_at || p.created_at) + "</dd></div>" +
      '<div><dt>Empresa ahora</dt><dd>' + chipEstado(p.estado_empresa) + (p.periodo_hasta ? " · vence " + fecha(p.periodo_hasta) : "") + "</dd></div></dl>" +
      '<div class="acciones">' + (conComprobante && p.comprobante_path ? '<button class="btn" data-a="ver" data-id="' + esc(p.id) + '">Ver comprobante</button>' : "") +
      '<button class="btn primario" data-a="aprobar" data-id="' + esc(p.id) + '">Ya veo el dinero: aprobar</button><button class="btn peligro" data-a="rechazar" data-id="' + esc(p.id) + '">Rechazar</button></div></article>';
  }
  function vistaPagos() {
    var h = '<div class="cab"><h2>Pagos por revisar</h2><span class="suave">Aprueba solo cuando veas el dinero en el banco con la referencia.</span></div>';
    h += S.pagos.length ? S.pagos.map(function (p) { return tarjetaPago(p, true); }).join("") : '<div class="vacio">No hay comprobantes por revisar.</div>';
    if (S.pendientes.length) {
      h += '<div class="cab" style="margin-top:12px"><h2>Esperando su transferencia</h2><span class="suave">Pidieron el pago pero aún no suben comprobante. Si ya pagaron, puedes aprobar igual.</span></div>';
      h += S.pendientes.map(function (p) { return tarjetaPago(p, false); }).join("");
    }
    return h;
  }
  function chipEstado(e) { var x = ESTADOS[e] || [e, ""]; return '<span class="chip ' + x[1] + '">' + esc(x[0]) + "</span>"; }
  function buscar(lista, id) { return lista.filter(function (x) { return x.id === id; })[0]; }

  /* ----------------------------------------------------------- empresas */
  function vistaEmpresas() {
    var h = '<div class="cab"><h2>Empresas (' + S.empresas.length + ")</h2></div>";
    if (!S.empresas.length) return h + '<div class="vacio">Todavía no hay empresas registradas.</div>';
    return h + '<div class="tabla-wrap"><table><thead><tr><th>Empresa</th><th>Plan</th><th>Estado</th><th>Vence</th><th>Usuarios</th><th>Leads mes</th><th>Último pago</th><th></th></tr></thead><tbody>' +
      S.empresas.map(function (o) {
        var vence = o.estado === "prueba" ? o.prueba_hasta : o.periodo_hasta;
        return "<tr><td><b>" + esc(o.nombre) + '</b><span class="sub">' + esc(o.propietario || "") + "</span></td><td>" + esc(o.plan) + "</td><td>" + chipEstado(o.estado) +
          (o.pago_abierto ? ' <span class="chip ojo">Pago abierto</span>' : "") + "</td><td>" + fecha(vence) + "</td><td>" + o.usuarios + "</td><td>" + o.leads_mes + "</td><td>" + fecha(o.ultimo_pago) +
          '</td><td><button class="btn peq" data-a="pago-manual" data-id="' + esc(o.id) + '">Activar plan</button> <button class="btn peq" data-a="ajustar" data-id="' + esc(o.id) + '">Ajustar</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  /* ------------------------------------------------------------ ingresos */
  function vistaIngresos() {
    var r = S.resumen || {}, e = r.empresas || {}, meses = r.ingresos_por_mes || [], max = Math.max.apply(null, meses.map(function (m) { return Number(m.subtotal); }).concat([1]));
    var h = '<div class="cab"><h2>Ingresos</h2><span class="suave">Sin impuestos (subtotal de cada pago).</span></div><div class="kpis">' +
      '<div class="kpi"><span>Ingresos de este mes</span><b>' + usd(r.ingresos_mes) + '</b></div><div class="kpi"><span>Vencen en 30 días</span><b>' + (r.por_vencer_30d || 0) + '</b></div>' +
      '<div class="kpi"><span>Empresas activas</span><b>' + (e.activa || 0) + '</b></div><div class="kpi"><span>En prueba</span><b>' + (e.prueba || 0) + '</b></div>' +
      '<div class="kpi"><span>En gracia o vencidas</span><b>' + ((e.gracia || 0) + (e.vencida || 0)) + "</b></div></div>";
    h += '<div class="tarjeta"><h3>Últimos 12 meses</h3>' + (meses.length ? '<div class="barras" role="img" aria-label="Ingresos por mes">' + meses.map(function (m) {
      return '<div class="barra-m"><span>' + esc(m.mes) + '</span><i style="width:' + Math.max(2, Number(m.subtotal) / max * 100) + '%"></i><b>' + usd(m.subtotal) + "</b></div>";
    }).join("") + "</div>" : '<p class="suave" style="margin:0">Aún no hay pagos registrados.</p>') + "</div>";
    h += '<div class="cab"><h2>Pagos recientes</h2></div>';
    h += S.historial.length ? '<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Empresa</th><th>Plan</th><th>Total</th><th>Factura</th><th>Cubre hasta</th></tr></thead><tbody>' + S.historial.map(function (g) {
      return "<tr><td>" + fecha(g.fecha_transferencia) + "</td><td>" + esc(g.empresa) + "</td><td>" + esc(g.plan_id) + " · " + esc(g.periodo) + "</td><td>" + usd(g.total) + "</td><td>" + esc(g.factura_numero || "—") + "</td><td>" + fecha(g.cubre_hasta) + "</td></tr>";
    }).join("") + "</tbody></table></div>" : '<div class="vacio">Sin pagos todavía.</div>';
    return h;
  }

  /* ----------------------------------------------------- datos de cobro */
  function vistaCobro() {
    var c = S.cobro || {};
    function f(n, et, v, extra) { return '<label class="fld"><span>' + et + '</span><input name="' + n + '" value="' + esc(v) + '" ' + (extra || "") + "></label>"; }
    return '<div class="cab"><h2>Datos de cobro</h2><span class="suave">Esto ven las inmobiliarias al pagar.</span></div><form class="tarjeta" id="form-cobro" novalidate><div class="form2">' +
      f("banco", "Banco", c.banco, "maxlength=80") + f("tipo_cuenta", "Tipo de cuenta", c.tipo_cuenta, "maxlength=40") + f("numero_cuenta", "Número de cuenta", c.numero_cuenta, "maxlength=40 inputmode=numeric") +
      f("titular", "Titular", c.titular, "maxlength=120") + f("identificacion", "RUC o cédula del titular", c.identificacion, "maxlength=20") + f("correo", "Correo de cobros", c.correo_cobros, "type=email maxlength=120") +
      f("whatsapp", "WhatsApp de cobros (con código de país)", c.whatsapp_cobros, "inputmode=numeric maxlength=20") +
      f("iva", "IVA (%)", c.iva_porcentaje, "type=number min=0 max=30 step=0.5") + f("gracia", "Días de gracia después del vencimiento", c.dias_gracia, "type=number min=0 max=30") + "</div>" +
      '<label class="fld"><span>Instrucciones para quien paga</span><textarea name="instrucciones" maxlength="500">' + esc(c.instrucciones) + '</textarea><small>Verifica el IVA vigente con tu contador.</small></label>' +
      '<div class="acciones"><button class="btn primario" type="submit">Guardar</button></div></form>';
  }

  /* ----------------------------------------------------------- acciones */
  var ACC = {
    vista: function (el) { S.vista = el.dataset.v; pintar(); $("vista").focus(); },
    salir: async function () { await sb.auth.signOut(); location.reload(); },
    ver: function (el) {
      var p = buscar(S.pagos, el.dataset.id);
      return conBoton(el, async function () {
        var r = await sb.storage.from("comprobantes").createSignedUrl(p.comprobante_path, 120); if (r.error) throw r.error;
        window.open(r.data.signedUrl, "_blank", "noopener");
      });
    },
    aprobar: function (el) {
      var p = buscar(S.pagos, el.dataset.id) || buscar(S.pendientes, el.dataset.id);
      dlg('<h2 id="dlg-titulo">Aprobar pago de ' + esc(p.empresa) + "</h2>" + AV +
        '<p style="margin:0">Confirma que ya ves <b>' + usd(p.total) + "</b> en el banco con la referencia <b class=\"ref\">" + esc(p.referencia) + "</b>. Se activará el plan <b>" + esc(p.plan) + "</b> (" + esc(p.periodo) + ").</p>" +
        '<div class="form2"><label class="fld"><span>Fecha de la transferencia</span><input type="date" name="fecha" value="' + hoy() + '" required></label>' +
        '<label class="fld"><span>Banco de origen</span><input name="banco" maxlength="60"></label><label class="fld"><span>N.º de comprobante</span><input name="comprobante" maxlength="60"></label>' +
        '<label class="fld"><span>N.º de factura</span><input name="factura" placeholder="001-001-000000123" maxlength="60"></label></div>' + pie("Aprobar y activar plan"),
        async function (f) {
          var r = await rpc("aprobar_pago", { p_solicitud: p.id, p_fecha: f.get("fecha"), p_banco: f.get("banco"), p_comprobante: f.get("comprobante"), p_factura: f.get("factura") });
          toast("Plan activado hasta el " + fecha(r.periodo_hasta)); await cargar();
        });
    },
    rechazar: function (el) {
      var p = buscar(S.pagos, el.dataset.id) || buscar(S.pendientes, el.dataset.id);
      dlg('<h2 id="dlg-titulo">Rechazar pago de ' + esc(p.empresa) + "</h2>" + AV +
        '<label class="fld"><span>Motivo (se lo mostramos a la empresa)</span><textarea name="motivo" required maxlength="300" placeholder="Ej.: No vemos la transferencia en el banco."></textarea></label>' + pie("Rechazar pago", "peligro"),
        async function (f) { await rpc("rechazar_pago", { p_solicitud: p.id, p_motivo: f.get("motivo") }); toast("Pago rechazado"); await cargar(); });
    },
    "pago-manual": function (el) {
      var o = buscar(S.empresas, el.dataset.id);
      dlg('<h2 id="dlg-titulo">Activar plan de ' + esc(o.nombre) + "</h2>" + AV +
        '<p class="suave" style="margin:0">Para un pago que recibiste por fuera. Se activa el plan y se suma el periodo (desde hoy, o desde el vencimiento si aún está vigente). El monto es opcional y va con impuesto incluido.</p><div class="form2">' +
        '<label class="fld"><span>Plan</span><select name="plan">' + selPlanes(o.plan_id) + '</select></label><label class="fld"><span>Periodo</span><select name="periodo"><option value="mensual">Mensual</option><option value="anual">Anual</option></select></label>' +
        '<label class="fld"><span>Total recibido (USD, opcional)</span><input name="total" type="number" min="0" step="0.01"></label><label class="fld"><span>Fecha del pago</span><input type="date" name="fecha" value="' + hoy() + '" required></label>' +
        '<label class="fld"><span>Banco de origen</span><input name="banco" maxlength="60"></label><label class="fld"><span>N.º de comprobante</span><input name="comprobante" maxlength="60"></label>' +
        '<label class="fld"><span>N.º de factura</span><input name="factura" maxlength="60"></label></div>' + pie("Activar plan"),
        async function (f) {
          var r = await rpc("registrar_pago_manual", { p_org: o.id, p_plan: f.get("plan"), p_periodo: f.get("periodo"), p_total: Number(f.get("total") || 0), p_fecha: f.get("fecha"), p_banco: f.get("banco"), p_comprobante: f.get("comprobante"), p_factura: f.get("factura") });
          toast("Plan activado. Vence el " + fecha(r.periodo_hasta)); await cargar();
        });
    },
    ajustar: function (el) {
      var o = buscar(S.empresas, el.dataset.id);
      dlg('<h2 id="dlg-titulo">Ajustar ' + esc(o.nombre) + "</h2>" + AV +
        '<p class="suave" style="margin:0">Cambios manuales (quedan en la auditoría). Deja en blanco lo que no quieras tocar.</p><div class="form2">' +
        '<label class="fld"><span>Plan</span><select name="plan"><option value="">Sin cambio</option>' + selPlanes("") + '</select></label>' +
        '<label class="fld"><span>Estado</span><select name="estado"><option value="">Sin cambio</option>' + Object.keys(ESTADOS).map(function (k) { return '<option value="' + k + '">' + ESTADOS[k][0] + "</option>"; }).join("") + "</select></label>" +
        '<label class="fld"><span>Vence el</span><input type="date" name="hasta"></label><label class="fld"><span>Extender la prueba (días)</span><input type="number" name="dias" min="1" max="365"></label></div>' + pie("Guardar ajuste"),
        async function (f) {
          var hasta = f.get("hasta");
          await rpc("consola_ajustar", { p_org: o.id, p_plan: f.get("plan") || null, p_estado: f.get("estado") || null,
            p_periodo_hasta: hasta ? new Date(hasta + "T23:59:00").toISOString() : null, p_prueba_dias: f.get("dias") ? Number(f.get("dias")) : null });
          toast("Ajuste guardado"); await cargar();
        });
    }
  };
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-a]"); if (!el || !ACC[el.dataset.a]) return;
    e.preventDefault(); ACC[el.dataset.a](el);
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "form-cobro") return;
    e.preventDefault();
    var f = new FormData(e.target), b = e.target.querySelector('[type="submit"]');
    conBoton(b, async function () {
      await rpc("guardar_datos_cobro", { p_banco: f.get("banco"), p_tipo_cuenta: f.get("tipo_cuenta"), p_numero_cuenta: f.get("numero_cuenta"), p_titular: f.get("titular"),
        p_identificacion: f.get("identificacion"), p_correo: f.get("correo"), p_whatsapp: f.get("whatsapp"), p_iva: Number(f.get("iva")), p_dias_gracia: Number(f.get("gracia")), p_instrucciones: f.get("instrucciones") });
      toast("Datos de cobro guardados"); await cargar();
    });
  });

  /* -------------------------------------------------------------- inicio */
  $("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var b = $("login-btn"), er = $("login-error"); er.hidden = true; b.disabled = true;
    try {
      var r = await sb.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-clave").value });
      if (r.error) throw new Error("Correo o contraseña incorrectos.");
      await entrar();
    } catch (x) { er.textContent = msgErr(x); er.hidden = false; } finally { b.disabled = false; }
  });
  async function entrar() {
    var r = await sb.rpc("es_superadmin");
    if (r.error || r.data !== true) { mostrar("denegado"); return; }
    mostrar("consola"); await cargar();
  }
  (async function () {
    if (!CONFIGURADO) {
      mostrar("login");
      $("login-form").querySelectorAll("input,button").forEach(function (n) { n.disabled = true; });
      var er = $("login-error");
      er.textContent = "Esta consola todavía no está conectada a una base de datos. Edita web/js/config.js con la URL y la clave anon de tu proyecto de Supabase (ver el README). Las cuentas de otros sitios no sirven aquí: la consola usa su propio proyecto.";
      er.hidden = false;
      return;
    }
    try {
      var s = (await sb.auth.getSession()).data.session;
      if (s) await entrar(); else mostrar("login");
    } catch (e) { mostrar("login"); }
  })();
})();
