/* GPUnlock CRM · Proforma que ve el cliente: /proforma/?t=<enlace privado>
   Lee SOLO esa proforma con cotizacion_publica() (sin teléfono, correo ni cédula del cliente). Se ve con el logo y
   los colores de la inmobiliaria y, en una esquina, «Impulsado por GPUnlock». «Descargar PDF» usa la impresión del
   navegador (Guardar como PDF), así el archivo sale igual en el celular y en la computadora. */
(function () {
  "use strict";
  var CFG = window.CRM_CONFIG || {}, q = new URLSearchParams(location.search), token = (q.get("t") || "").toLowerCase();
  var hoja = document.getElementById("hoja");
  var TIPOS = { departamento: "Departamento", suite: "Suite", loft: "Loft", casa: "Casa", lote: "Lote", local: "Local", oficina: "Oficina", parqueo: "Parqueo", bodega: "Bodega", otro: "Otro" };
  var D2 = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  var N1 = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });
  function $$(t, cls, txt) { var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function fecha(iso) { return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" }); }
  function estado(titulo, texto) { hoja.textContent = ""; var d = $$("div", "estado"); d.appendChild($$("h1", "", titulo)); d.appendChild($$("p", "", texto)); hoja.appendChild(d); }
  function marcaGPU() {
    var a = $$("a", "impulsado"); a.href = "https://gpunlock.netlify.app"; a.target = "_blank"; a.rel = "noopener";
    a.appendChild($$("span", "", "Impulsado por"));
    var img = $$("img"); img.src = "/assets/brand/gp-mark.png"; img.alt = ""; a.appendChild(img);
    var b = $$("b"); var i = $$("i", "", "GPU"); b.appendChild(i); b.appendChild(document.createTextNode("nlock")); a.appendChild(b);
    return a;
  }
  function colores(p) {
    if (!window.GPUTema || !GPUTema.hexValido(p.color_primario || "")) return;
    var pal = GPUTema.paleta(p.color_primario, p.color_acento, "light"), r = document.documentElement.style;
    r.setProperty("--m", pal.vars["--gp-orange-600"]); r.setProperty("--m-txt", pal.vars["--gp-orange-700"]);
    r.setProperty("--m-50", pal.vars["--gp-orange-50"]); r.setProperty("--m-on", pal.vars["--color-on-primary"]);
    r.setProperty("--m-acento", pal.vars["--gp-orange-400"]);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = pal.fondo;
  }

  if (!/^[0-9a-f]{64}$/.test(token) || !CFG.SUPABASE_URL || /TU-PROYECTO/.test(CFG.SUPABASE_URL)) {
    estado("Enlace no válido", "Revisa que el enlace esté completo o pide a tu asesor que te lo envíe de nuevo.");
    return;
  }
  fetch(CFG.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/cotizacion_publica", {
    method: "POST", headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token })
  }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (p) {
    if (!p) return estado("Proforma no encontrada", "Este enlace ya no está disponible. Pide a tu asesor una proforma actualizada.");
    if (p.anulada) return estado("Proforma " + p.numero + " anulada", "Esta proforma ya no es válida. Pide a tu asesor una actualizada.");
    pintar(p);
  }).catch(function () { estado("No pudimos cargar la proforma", "Revisa tu conexión e inténtalo de nuevo en unos minutos."); });

  function pintar(p) {
    colores(p);
    document.title = "Proforma " + p.numero + " · " + p.empresa;
    hoja.textContent = "";

    var cab = $$("header", "cab"), emp = $$("div", "empresa");
    if (p.logo_path) { var lg = $$("img"); lg.src = CFG.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/marcas/" + p.logo_path; lg.alt = p.empresa; lg.onerror = function () { lg.replaceWith($$("b", "", p.empresa)); }; emp.appendChild(lg); }
    else emp.appendChild($$("b", "", p.empresa));
    var num = $$("div", "numero"); num.appendChild($$("small", "", "Proforma")); num.appendChild($$("h1", "", p.numero));
    num.appendChild($$("p", "", "Emitida el " + fecha(p.fecha)));
    num.appendChild($$("span", "chip" + (p.vigente ? "" : " vencida"), p.vigente ? "Válida hasta el " + fecha(p.vigencia_hasta) : "Venció el " + fecha(p.vigencia_hasta)));
    cab.appendChild(emp); cab.appendChild(num); hoja.appendChild(cab);

    var datos = $$("section", "datos");
    [["Cliente", p.cliente_nombre], ["Proyecto", p.proyecto], ["Asesor", p.asesor_nombre], ["Contacto", p.asesor_email]].forEach(function (x) {
      if (!x[1]) return; var d = $$("div"); d.appendChild($$("small", "", x[0])); d.appendChild($$("span", "", x[1])); datos.appendChild(d);
    });
    hoja.appendChild(datos);

    var conFoto = (p.unidades || []).filter(function (u) { return u.foto; })[0];
    if (conFoto) { var f = $$("img", "foto"); f.src = CFG.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/inventario/" + conFoto.foto; f.alt = "Unidad " + conFoto.codigo; f.onerror = function () { f.remove(); }; hoja.appendChild(f); }

    hoja.appendChild($$("h2", "", (p.unidades || []).length > 1 ? "Unidades" : "Unidad"));
    var tw = $$("div", "tabla-wrap"), t = $$("table"), th = $$("thead"), tr = $$("tr");
    [["Unidad"], ["Tipo"], ["Ubicación"], ["Área", "num"], ["Detalle"], ["Precio", "num"]].forEach(function (c) { tr.appendChild($$("th", c[1] || "", c[0])); });
    th.appendChild(tr); t.appendChild(th);
    var tb = $$("tbody");
    (p.unidades || []).forEach(function (u) {
      var r = $$("tr");
      r.appendChild($$("td", "", u.codigo)); r.appendChild($$("td", "", TIPOS[u.tipo] || u.tipo || ""));
      r.appendChild($$("td", "", [u.bloque ? "Torre " + u.bloque : "", u.piso ? "Piso " + u.piso : ""].filter(Boolean).join(" · ") || "—"));
      r.appendChild($$("td", "num", u.area_m2 != null ? N1.format(u.area_m2) + " m²" : "—"));
      r.appendChild($$("td", "", [u.dormitorios != null ? u.dormitorios + " dorm." : "", u.banos != null ? N1.format(u.banos) + " baños" : "", u.parqueos ? u.parqueos + " parq." : ""].filter(Boolean).join(" · ") || "—"));
      r.appendChild($$("td", "num", D2.format(u.precio)));
      tb.appendChild(r);
    });
    t.appendChild(tb); tw.appendChild(t); hoja.appendChild(tw);

    hoja.appendChild($$("h2", "", "Precio y forma de pago"));
    var res = $$("div", "resumen");
    function linea(a, b, cls) { var l = $$("div", "linea" + (cls ? " " + cls : "")); l.appendChild($$("span", "", a)); l.appendChild($$("b", "", b)); res.appendChild(l); }
    if (Number(p.descuento) > 0) { linea("Precio de lista", D2.format(p.precio_lista)); linea("Descuento", "− " + D2.format(p.descuento)); }
    linea("Precio final", D2.format(p.precio_final), "total");
    linea("Reserva", D2.format(p.reserva));
    var resto = Number(p.entrada) - Number(p.reserva);
    if (resto > 0) {
      if (p.cuotas_entrada > 0) linea("Saldo de la entrada en " + p.cuotas_entrada + (p.cuotas_entrada === 1 ? " cuota" : " cuotas mensuales") + " de", D2.format(p.cuota_entrada));
      else linea("Saldo de la entrada (a la firma)", D2.format(resto));
    }
    linea("Entrada total (" + N1.format(p.entrada_pct) + " %)", D2.format(p.entrada));
    linea(p.forma_pago === "credito" ? "Saldo a financiar con crédito hipotecario" : "Saldo contra entrega", D2.format(p.saldo));
    hoja.appendChild(res);
    if (p.forma_pago === "credito" && p.cuota_mensual != null && Number(p.saldo) > 0) {
      var dest = $$("div", "destacado");
      dest.appendChild($$("span", "", "Cuota mensual estimada · " + p.plazo_anios + " años al " + N1.format(p.tasa_anual) + " % anual"));
      dest.appendChild($$("b", "", D2.format(p.cuota_mensual)));
      hoja.appendChild(dest);
    }
    if (p.notas) hoja.appendChild($$("p", "notas", p.notas));
    var legal = (p.condiciones ? p.condiciones + "\n\n" : "") +
      "Valores referenciales en dólares de los Estados Unidos. La cuota mensual es una simulación: la aprobación, la tasa y el plazo finales dependen de la entidad financiera. " +
      "La disponibilidad de las unidades se confirma al momento de la reserva.";
    hoja.appendChild($$("p", "legal", legal));

    var pie = $$("footer", "pie"); pie.appendChild($$("span", "", p.empresa + " · Proforma " + p.numero)); pie.appendChild(marcaGPU());
    hoja.appendChild(pie);

    // Acciones
    document.getElementById("acciones").hidden = false;
    document.getElementById("btn-pdf").addEventListener("click", function () { window.print(); });
    if (p.whatsapp) {
      var wa = document.getElementById("btn-wa"); wa.hidden = false;
      wa.href = "https://wa.me/" + p.whatsapp + "?text=" + encodeURIComponent("Hola, tengo una consulta sobre la proforma " + p.numero + " de " + p.proyecto + ".");
    }
    if (navigator.share) {
      var sh = document.getElementById("btn-compartir"); sh.hidden = false;
      sh.addEventListener("click", function () { navigator.share({ title: "Proforma " + p.numero, text: p.empresa + " · " + p.proyecto, url: location.href }).catch(function () {}); });
    }
    if (q.get("imprimir") === "1") setTimeout(function () { window.print(); }, 400);
  }
})();
