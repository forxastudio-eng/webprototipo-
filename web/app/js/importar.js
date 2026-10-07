/* ==========================================================================
   GPUnlock CRM · Lectura de archivos de inventario (Excel .xlsx y CSV)
   Sin librerías externas: el .xlsx es un ZIP de XML y se lee aquí mismo, en tu navegador (el archivo
   no sale de tu equipo hasta que confirmas la importación). Es JavaScript puro y también corre en Node.

     GPUImportar.leerArchivo(file)           → Promise<{ columnas: [...], filas: [[...]], nombreHoja }>
     GPUImportar.sugerirMapa(columnas)       → { campo: indiceDeColumna | -1 }
     GPUImportar.convertir(filas, mapa, ctx) → { filas, errores, avisos }   (lo que se manda a importar_unidades)
     GPUImportar.plantillaCSV(slug)          → texto CSV de ejemplo
   ========================================================================== */
(function (root) {
  "use strict";
  var MAX_BYTES = 5 * 1024 * 1024, MAX_FILAS = 2000;

  /* ------------------------------------------------------------------ texto --- */
  function norm(t) {
    return String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function sinEspacios(t) { return norm(t).replace(/ /g, ""); }
  function slugify(t) { return norm(t).replace(/ /g, "-").slice(0, 40); }
  function entidades(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      e = e.toLowerCase();
      if (e === "amp") return "&"; if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "quot") return '"'; if (e === "apos") return "'";
      return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }

  /* -------------------------------------------------------------------- CSV --- */
  function parseCSV(texto) {
    texto = String(texto).replace(/^﻿/, "");
    var primera = texto.split(/\r?\n/, 1)[0] || "";
    var delim = [";", "\t", ","].map(function (d) { return [d, primera.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var filas = [], fila = [], campo = "", comillas = false, i, c;
    for (i = 0; i < texto.length; i++) {
      c = texto[i];
      if (comillas) {
        if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
      } else if (c === '"' && campo === "") comillas = true;
      else if (c === delim) { fila.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        fila.push(campo); campo = ""; filas.push(fila); fila = [];
      } else campo += c;
    }
    if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }

  /* ------------------------------------------------------------------- XLSX --- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function texto(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  async function inflarRaw(bytes) {
    var ds = new root.DecompressionStream("deflate-raw");
    var w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new root.Response(ds.readable).arrayBuffer());
  }
  /* Entradas del ZIP leyendo el directorio central (los .xlsx de Excel traen tamaños 0 en la cabecera local). */
  function entradasZip(b) {
    var i, fin = -1;
    for (i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { fin = i; break; }
    if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");
    var n = u16(b, fin + 10), o = u32(b, fin + 16), mapa = {};
    for (i = 0; i < n; i++) {
      if (u32(b, o) !== 0x02014b50) throw new Error("El archivo Excel está dañado.");
      var metodo = u16(b, o + 10), comp = u32(b, o + 20), lnom = u16(b, o + 28), lext = u16(b, o + 30), lcom = u16(b, o + 32), local = u32(b, o + 42);
      mapa[texto(b.subarray(o + 46, o + 46 + lnom))] = { metodo: metodo, comp: comp, local: local };
      o += 46 + lnom + lext + lcom;
    }
    return mapa;
  }
  async function leerEntrada(b, e) {
    var o = e.local;
    if (u32(b, o) !== 0x04034b50) throw new Error("El archivo Excel está dañado.");
    var ini = o + 30 + u16(b, o + 26) + u16(b, o + 28), datos = b.subarray(ini, ini + e.comp);
    if (e.metodo === 0) return datos;
    if (e.metodo === 8) return inflarRaw(datos);
    throw new Error("El Excel usa una compresión no admitida. Guárdalo de nuevo como .xlsx o expórtalo a CSV.");
  }
  function colIndice(ref) {
    var m = /^([A-Z]+)/.exec(ref) || [0, "A"], n = 0, i;
    for (i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }
  function textosDe(xml) {   // contenido de todos los <t> de un fragmento (texto simple o enriquecido)
    var out = "", re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(xml))) out += m[1];
    return entidades(out);
  }
  async function parseXLSX(buffer) {
    var b = new Uint8Array(buffer), z = entradasZip(b);
    async function leer(nombre) { return z[nombre] ? texto(await leerEntrada(b, z[nombre])) : null; }
    var compartidas = [], ss = await leer("xl/sharedStrings.xml");
    if (ss) { var re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g, m; while ((m = re.exec(ss))) compartidas.push(textosDe(m[1])); }

    // Primera hoja del libro (en el orden del libro, no por nombre de archivo).
    var ruta = "xl/worksheets/sheet1.xml", nombreHoja = "", wb = await leer("xl/workbook.xml"), rels = await leer("xl/_rels/workbook.xml.rels");
    if (wb && rels) {
      var h = /<sheet\s[^>]*>/.exec(wb);
      if (h) {
        var rid = /r:id="([^"]+)"/.exec(h[0]), nom = /name="([^"]*)"/.exec(h[0]);
        nombreHoja = nom ? entidades(nom[1]) : "";
        if (rid) {
          var rel = new RegExp("<Relationship\\s[^>]*Id=\"" + rid[1] + "\"[^>]*>").exec(rels), tg = rel && /Target="([^"]+)"/.exec(rel[0]);
          if (tg) ruta = tg[1].charAt(0) === "/" ? tg[1].slice(1) : "xl/" + tg[1].replace(/^\.\//, "");
        }
      }
    }
    var hoja = await leer(ruta);
    if (hoja == null) throw new Error("No encontramos la hoja de datos en el Excel.");

    var filas = [], reFila = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g, fm;
    while ((fm = reFila.exec(hoja))) {
      var cells = [], reC = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = reC.exec(fm[1] || ""))) {
        var attrs = cm[1], cuerpo = cm[2] || "", ref = /r="([A-Z]+\d+)"/.exec(attrs), tipo = /\bt="([^"]+)"/.exec(attrs), v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo), val = "";
        if (tipo && tipo[1] === "inlineStr") val = textosDe(cuerpo);
        else if (tipo && tipo[1] === "s") val = v ? compartidas[parseInt(v[1], 10)] || "" : "";
        else if (tipo && tipo[1] === "b") val = v && v[1] === "1" ? "Sí" : "No";
        else val = v ? entidades(v[1]) : "";
        var col = ref ? colIndice(ref[1]) : cells.length;
        while (cells.length < col) cells.push("");
        cells[col] = val;
      }
      filas.push(cells);
    }
    return { filas: filas, nombreHoja: nombreHoja };
  }

  /* ---------------------------------------------------------------- archivo --- */
  function sinFilasVacias(filas) {
    return filas.filter(function (f) { return f.some(function (c) { return String(c).trim() !== ""; }); });
  }
  async function leerArchivo(file) {
    if (file.size > MAX_BYTES) throw new Error("El archivo pesa más de 5 MB. Divídelo en partes.");
    var nombre = String(file.name || "").toLowerCase(), filas, hoja = "";
    if (/\.xlsx$/.test(nombre)) {
      var r = await parseXLSX(await file.arrayBuffer()); filas = r.filas; hoja = r.nombreHoja;
    } else if (/\.(csv|txt|tsv)$/.test(nombre) || /text\//.test(file.type || "")) {
      filas = parseCSV(await file.text());
    } else if (/\.xls$/.test(nombre)) {
      throw new Error("Los .xls antiguos no se pueden leer. En Excel usa Guardar como → Libro de Excel (.xlsx) o CSV.");
    } else {
      throw new Error("Sube un archivo Excel (.xlsx) o CSV.");
    }
    filas = sinFilasVacias(filas);
    if (filas.length < 2) throw new Error("El archivo no tiene datos: necesita una fila de títulos y al menos una unidad.");
    var ancho = filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0);
    var columnas = filas[0].map(function (c) { return String(c).trim(); });
    while (columnas.length < ancho) columnas.push("");
    var datos = filas.slice(1).map(function (f) { var x = f.slice(); while (x.length < ancho) x.push(""); return x; });
    if (datos.length > MAX_FILAS) throw new Error("El archivo tiene " + datos.length + " filas. El máximo es " + MAX_FILAS + " por archivo; divídelo en partes.");
    return { columnas: columnas, filas: datos, nombreHoja: hoja };
  }

  /* --------------------------------------------------------------- columnas --- */
  var CAMPOS = {
    proyecto: ["proyecto", "project", "urbanizacion", "conjunto", "edificio"],
    codigo: ["codigo", "unidad", "numerodeunidad", "nunidad", "numero", "nro", "no", "n", "id", "ref", "referencia", "lote", "depto", "dpto", "departamento", "apto", "apartamento", "local"],
    tipo: ["tipo", "tipologia", "categoria", "clase", "tipodeunidad"],
    bloque: ["bloque", "torre", "etapa", "manzana", "mz", "fase", "sector"],
    piso: ["piso", "nivel", "planta"],
    area_m2: ["area", "aream", "aream2", "areatotal", "areaconstruccion", "areaneta", "m2", "mts2", "metros", "metros2", "superficie"],
    dormitorios: ["dormitorios", "dormitorio", "dorm", "habitaciones", "habitacion", "hab", "cuartos", "recamaras"],
    banos: ["banos", "bano", "wc"],
    parqueos: ["parqueos", "parqueo", "estacionamientos", "estacionamiento", "garaje", "garajes", "parking"],
    bodegas: ["bodegas", "bodega"],
    precio: ["precio", "preciolista", "preciodeventa", "preciototal", "pvp", "valor", "costo"],
    estado: ["estado", "disponibilidad", "status", "situacion"],
    descripcion: ["descripcion", "observaciones", "observacion", "notas", "nota", "detalle", "comentarios"]
  };
  var ETIQUETAS = { proyecto: "Proyecto", codigo: "Código de la unidad", tipo: "Tipo", bloque: "Torre / bloque", piso: "Piso", area_m2: "Área (m²)", dormitorios: "Dormitorios",
    banos: "Baños", parqueos: "Parqueos", bodegas: "Bodegas", precio: "Precio", estado: "Estado", descripcion: "Descripción" };
  var ORDEN = ["proyecto", "codigo", "tipo", "bloque", "piso", "area_m2", "dormitorios", "banos", "parqueos", "bodegas", "precio", "estado", "descripcion"];

  /* Para cada campo, la columna del archivo que mejor le corresponde (o -1). Primero coincidencia exacta, luego parcial. */
  function sugerirMapa(columnas, tipo) {
    var esq = tipo === "leads" ? LEADS : { CAMPOS: CAMPOS, ORDEN: ORDEN }, CAMPOS_ = esq.CAMPOS, ORDEN_ = esq.ORDEN;
    var mapa = {}, usadas = {}, claves = columnas.map(sinEspacios);
    ORDEN_.forEach(function (c) { mapa[c] = -1; });
    ORDEN_.forEach(function (campo) {
      var sin = CAMPOS_[campo];
      for (var s = 0; s < sin.length; s++) {
        var i = claves.indexOf(sin[s]);
        if (i >= 0 && !usadas[i]) { mapa[campo] = i; usadas[i] = true; return; }
      }
    });
    ORDEN_.forEach(function (campo) {
      if (mapa[campo] >= 0) return;
      for (var i = 0; i < claves.length; i++) {
        if (usadas[i] || !claves[i]) continue;
        var coincide = CAMPOS_[campo].some(function (s) { return s.length >= 3 && claves[i].indexOf(s) === 0; });
        if (coincide) { mapa[campo] = i; usadas[i] = true; return; }
      }
    });
    return mapa;
  }

  /* ----------------------------------------------------------------- valores --- */
  function numero(t) {
    var s = String(t == null ? "" : t).trim();
    if (s === "") return { vacio: true };
    s = s.replace(/[^\d.,\-]/g, "");
    if (s === "" || s === "-" || /(?!^)-/.test(s)) return { error: true };
    var neg = s[0] === "-"; s = s.replace("-", "");
    var coma = s.indexOf(","), punto = s.indexOf(".");
    if (coma >= 0 && punto >= 0) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");   // 1.234,56
      else s = s.replace(/,/g, "");                                                              // 1,234.56
    } else if (coma >= 0) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");              // 120,000 | 85,5
    } else if (punto >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");            // 120.000
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: true };
    var n = parseFloat(s);
    return { valor: neg ? -n : n };
  }
  var TIPOS = {
    departamento: ["departamento", "depto", "dpto", "apartamento", "apto", "dep", "flat"], suite: ["suite", "estudio", "monoambiente"], loft: ["loft"],
    casa: ["casa", "villa", "chalet", "townhouse"], lote: ["lote", "terreno", "solar"], local: ["local", "local comercial", "comercial"],
    oficina: ["oficina", "consultorio"], parqueo: ["parqueo", "estacionamiento", "garaje", "garage", "cochera"], bodega: ["bodega", "deposito"]
  };
  var ESTADOS = {
    disponible: ["disponible", "libre", "available", "en venta", "venta", "stock"], reservada: ["reservada", "reservado", "reserva", "apartado", "apartada", "separado", "separada", "bloqueada por reserva"],
    vendida: ["vendida", "vendido", "sold", "escriturada", "escriturado", "cerrada"], no_disponible: ["no disponible", "nodisponible", "bloqueada", "bloqueado", "retirada", "retirado", "inactiva", "inactivo", "congelada"]
  };
  function buscarEn(tabla, v) {
    var n = norm(v), k;
    for (k in tabla) if (tabla[k].indexOf(n) >= 0) return k;
    return null;
  }

  /* ------------------------------------------------------------------ convertir --- */
  /* filas: matriz sin la fila de títulos · mapa: campo → índice de columna (−1 = no viene) ·
     ctx: { proyectos: [{slug, nombre}], proyectoDefecto: slug|null }.
     Devuelve las filas listas para importar_unidades (solo con las claves que traen dato) y lo que haya que corregir. */
  function convertir(filas, mapa, ctx) {
    var out = [], errores = [], avisos = [], tiposRaros = 0, proy = {};
    (ctx.proyectos || []).forEach(function (p) { proy[p.slug] = p.slug; proy[sinEspacios(p.nombre)] = p.slug; proy[sinEspacios(p.slug)] = p.slug; });
    function val(f, campo) { var i = mapa[campo]; return i == null || i < 0 ? "" : String(f[i] == null ? "" : f[i]).trim(); }
    function err(n, m) { errores.push({ fila: n, error: m }); }
    filas.forEach(function (f, idx) {
      var n = idx + 2, o = { fila: n }, ok = true, raro = false;
      var cod = val(f, "codigo");
      if (!cod) { err(n, "Falta el código de la unidad"); return; }
      if (cod.length > 40) { err(n, "El código «" + cod.slice(0, 20) + "…» es demasiado largo (máx. 40)"); return; }
      o.codigo = cod;
      var pr = val(f, "proyecto");
      if (mapa.proyecto >= 0 && pr) {
        var slug = proy[sinEspacios(pr)];
        if (!slug) { err(n, "El proyecto «" + pr + "» no existe en tu empresa (créalo antes en Ajustes → Proyectos)"); return; }
        o.proyecto = slug;
      } else if (ctx.proyectoDefecto) o.proyecto = ctx.proyectoDefecto;
      else { err(n, "La fila no tiene proyecto y no elegiste uno para todo el archivo"); return; }

      var t = val(f, "tipo");
      if (t) { var tk = buscarEn(TIPOS, t); if (!tk) { tk = "otro"; raro = true; } o.tipo = tk; }
      var e = val(f, "estado");
      if (e) { var ek = buscarEn(ESTADOS, e); if (!ek) { err(n, "Estado no reconocido «" + e + "» (usa disponible, reservada, vendida o no disponible)"); return; } o.estado = ek; }
      ["bloque", "piso", "descripcion"].forEach(function (k) { var v = val(f, k); if (v) o[k] = v; });
      [["area_m2", "El área"], ["dormitorios", "Los dormitorios"], ["banos", "Los baños"], ["parqueos", "Los parqueos"], ["bodegas", "Las bodegas"], ["precio", "El precio"]].forEach(function (par) {
        if (!ok) return;
        var r = numero(val(f, par[0]));
        if (r.vacio) return;
        if (r.error || r.valor < 0) { err(n, par[1] + " «" + val(f, par[0]) + "» no es un número válido"); ok = false; return; }
        o[par[0]] = r.valor;
      });
      if (ok) { out.push(o); if (raro) tiposRaros++; }
    });
    if (tiposRaros) avisos.push(tiposRaros + (tiposRaros === 1 ? " unidad tiene un tipo que no reconocimos y se guardará como «otro»." : " unidades tienen un tipo que no reconocimos y se guardarán como «otro»."));
    // Códigos repetidos dentro del archivo
    var vistos = {};
    out.forEach(function (o) {
      var k = o.proyecto + "|" + o.codigo.toLowerCase();
      if (vistos[k]) err(o.fila, "El código «" + o.codigo + "» está repetido en el archivo (también en la fila " + vistos[k] + ")"); else vistos[k] = o.fila;
    });
    errores.sort(function (a, b) { return a.fila - b.fila; });
    var malas = {}; errores.forEach(function (x) { malas[x.fila] = 1; });
    return { filas: out.filter(function (o) { return !malas[o.fila]; }), errores: errores, avisos: avisos };
  }

  function plantillaCSV(slug) {
    var s = slug || "mi-proyecto";
    return "﻿proyecto;codigo;tipo;torre;piso;area_m2;dormitorios;banos;parqueos;bodegas;precio;estado\r\n" +
      s + ";A-101;departamento;A;1;85,5;2;2;1;1;120000;disponible\r\n" +
      s + ";A-102;suite;A;1;45;1;1;1;0;78500;reservada\r\n";
  }


  /* ============================================================ cartera de leads */
  /* Títulos de Excel propios y de las exportaciones de Kommo, Pipedrive y HubSpot. */
  var LEADS = {
    ORDEN: ["nombre", "apellido", "telefono", "correo", "proyecto", "unidad", "etapa", "fuente", "asignado", "valor", "nota"],
    ETIQUETAS: { nombre: "Nombre del cliente", apellido: "Apellido", telefono: "Teléfono / WhatsApp", correo: "Correo", proyecto: "Proyecto", unidad: "Unidad de interés",
      etapa: "Etapa", fuente: "Fuente", asignado: "Asesor", valor: "Valor / presupuesto", nota: "Nota" },
    CAMPOS: {
      nombre: ["contactoprincipal", "nombre", "nombres", "nombrecompleto", "nombredelcontacto", "nombredelcliente", "cliente", "contacto", "personanombre", "name", "fullname", "firstname", "primernombre", "nombredellead"],
      apellido: ["apellido", "apellidos", "lastname", "surname", "personaapellido"],
      telefono: ["telefono", "telefonomovil", "celular", "movil", "whatsapp", "personatelefono", "phone", "phonenumber", "mobilephone", "mobilephonenumber", "tel", "telefonodecontacto", "telefonotrabajo"],
      correo: ["correo", "correoelectronico", "email", "mail", "emailaddress", "personacorreoelectronico", "personaemail", "correodelcontacto"],
      proyecto: ["proyecto", "project", "desarrollo", "edificio", "proyectodeinteres"],
      unidad: ["unidad", "unidaddeinteres", "inmueble", "propiedad", "interes"],
      etapa: ["etapa", "estado", "stage", "status", "fase", "lifecyclestage", "negocioetapa", "etapadelembudo", "dealstage", "estadodellead"],
      fuente: ["fuente", "origen", "source", "canal", "medio", "leadsource", "fuentedellead", "originaltrafficsource", "negociofuente"],
      asignado: ["asesor", "vendedor", "responsable", "usuarioresponsable", "propietario", "owner", "contactowner", "dealowner", "negociopropietario", "agente", "asignadoa"],
      valor: ["valor", "presupuesto", "monto", "budget", "amount", "negociovalor", "dealvalue", "valorestimado", "venta"],
      nota: ["nota", "notas", "comentario", "comentarios", "observaciones", "observacion", "mensaje", "descripcion", "notes"]
    }
  };
  var ETAPAS_LEAD = {
    nuevo: ["nuevo", "nueva", "new", "lead", "prospecto", "sin contactar", "incoming leads", "leads entrantes", "subscriber", "contacto inicial"],
    contactado: ["contactado", "contactada", "contacted", "en contacto", "calificado", "calificada", "qualified", "marketing qualified lead", "sales qualified lead", "seguimiento"],
    cita: ["cita", "visita", "reunion", "meeting", "cita agendada", "visita agendada", "appointment scheduled"],
    proforma: ["proforma", "cotizacion", "cotizado", "propuesta", "propuesta enviada", "presupuesto", "presupuesto enviado", "proposal", "negociacion", "negotiation", "opportunity"],
    reserva: ["reserva", "reservado", "reservada", "separado", "apartado", "contract sent", "contrato"],
    vendido: ["vendido", "vendida", "ganado", "ganada", "won", "closed won", "cerrado ganado", "cliente", "customer", "logrado con exito", "venta"],
    perdido: ["perdido", "perdida", "lost", "closed lost", "cerrado perdido", "descartado", "descartada", "no interesado", "cerrado y no concretado"]
  };
  var FUENTES_LEAD = {
    formulario_web: ["formulario web", "formulario", "web", "sitio web", "pagina web", "landing", "website", "organic search", "direct traffic"],
    whatsapp: ["whatsapp", "wa"], llamada: ["llamada", "telefono", "call"], facebook: ["facebook", "fb", "meta", "facebook ads", "paid social"],
    instagram: ["instagram", "ig"], tiktok: ["tiktok"], google: ["google", "google ads", "adwords", "paid search"], marketplace: ["marketplace"],
    portal: ["portal", "portal inmobiliario", "plusvalia", "properati", "inmuebles24", "zonaprop"], feria: ["feria", "evento", "expo"],
    cartera: ["cartera", "base", "base de datos", "importado"], co_broker: ["co broker", "cobroker", "asesor externo", "broker"],
    referido: ["referido", "referida", "referral", "recomendado"], oficina: ["oficina", "sala de ventas", "walk in", "visita a oficina"], otro: ["otro", "otros", "other", "offline sources"]
  };
  function enTabla(tabla, v) { var n = norm(v), k; for (k in tabla) if (tabla[k].indexOf(n) >= 0) return k; return null; }

  /* ctx: { proyectos: [{slug, nombre}], equipo: [{email, nombre, rol}] } */
  function convertirLeads(filas, mapa, ctx) {
    var out = [], errores = [], cuenta = { etapa: 0, fuente: 0, asesor: 0 }, proy = {}, eq = {};
    (ctx.proyectos || []).forEach(function (p) { proy[sinEspacios(p.nombre)] = p.slug; proy[sinEspacios(p.slug)] = p.slug; });
    (ctx.equipo || []).filter(function (m) { return m.rol !== "lector"; }).forEach(function (m) { eq[String(m.email).toLowerCase()] = m.email; if (m.nombre) eq[sinEspacios(m.nombre)] = m.email; });
    function val(f, campo) { var i = mapa[campo]; return i == null || i < 0 ? "" : String(f[i] == null ? "" : f[i]).trim(); }
    function err(n, m) { errores.push({ fila: n, error: m }); }
    filas.forEach(function (f, idx) {
      var n = idx + 2, o = { fila: n }, av = {};
      var nom = (val(f, "nombre") + " " + val(f, "apellido")).replace(/\s+/g, " ").trim();
      if (nom.length < 2) { err(n, "Falta el nombre del cliente"); return; }
      o.nombre = nom.slice(0, 120);
      var tel = val(f, "telefono"), dig = tel.replace(/\D/g, ""), cor = val(f, "correo").toLowerCase();
      if (tel && (dig.length < 9 || dig.length > 15)) { err(n, "Teléfono «" + tel + "» no válido"); return; }
      if (cor && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cor)) { err(n, "Correo «" + cor + "» no válido"); return; }
      if (!tel && !cor) { err(n, "Falta el teléfono o el correo"); return; }
      if (tel) o.telefono = tel; if (cor) o.correo = cor;
      var pr = val(f, "proyecto");
      if (pr) { var sl = proy[sinEspacios(pr)]; if (!sl) { err(n, "El proyecto «" + pr + "» no existe en tu empresa (créalo antes en Ajustes → Proyectos)"); return; } o.proyecto = sl; }
      var et = val(f, "etapa");
      if (et) { var ek = enTabla(ETAPAS_LEAD, et); if (ek) o.etapa = ek; else av.etapa = 1; }
      var fu = val(f, "fuente");
      if (fu) { var fk = enTabla(FUENTES_LEAD, fu); if (fk) o.fuente = fk; else av.fuente = 1; }
      var as = val(f, "asignado");
      if (as) { var em = eq[as.toLowerCase()] || eq[sinEspacios(as)]; if (em) o.asignado = em; else av.asesor = 1; }
      var vr = numero(val(f, "valor"));
      if (!vr.vacio) { if (vr.error || vr.valor < 0) { err(n, "El valor «" + val(f, "valor") + "» no es un número válido"); return; } o.valor = vr.valor; }
      var un = val(f, "unidad"); if (un) o.unidad = un.slice(0, 120);
      var nt = val(f, "nota"); if (nt) o.nota = nt.slice(0, 4000);
      Object.defineProperty(o, "_av", { value: av, enumerable: false });
      out.push(o);
    });
    var vistos = {};
    out.forEach(function (o) {
      [o.telefono ? "t" + o.telefono.replace(/\D/g, "").replace(/^0/, "593") : null, o.correo ? "c" + o.correo : null].filter(Boolean).forEach(function (k) {
        if (vistos[k] && vistos[k] !== o.fila) err(o.fila, "Cliente repetido en el archivo (también en la fila " + vistos[k] + ")"); else vistos[k] = o.fila;
      });
    });
    errores.sort(function (a, b) { return a.fila - b.fila; });
    var malas = {}; errores.forEach(function (x) { malas[x.fila] = 1; });
    var buenas = out.filter(function (o) { return !malas[o.fila]; });
    buenas.forEach(function (o) { Object.keys(o._av).forEach(function (k) { cuenta[k]++; }); });
    var avisos = [];
    if (cuenta.etapa) avisos.push(cuenta.etapa + (cuenta.etapa === 1 ? " fila tiene" : " filas tienen") + " una etapa que no reconocimos: entrarán como «Nuevo».");
    if (cuenta.fuente) avisos.push(cuenta.fuente + (cuenta.fuente === 1 ? " fila tiene" : " filas tienen") + " una fuente que no reconocimos: se usará la fuente elegida abajo.");
    if (cuenta.asesor) avisos.push(cuenta.asesor + (cuenta.asesor === 1 ? " fila tiene" : " filas tienen") + " un asesor que no está en tu equipo: se asignarán como elijas abajo.");
    return { filas: buenas, errores: errores, avisos: avisos };
  }
  function plantillaLeadsCSV(slug) {
    var s = slug || "mi-proyecto";
    return "﻿nombre;telefono;correo;proyecto;etapa;fuente;asesor;presupuesto;nota\r\n" +
      "Lucía Mora;0991234567;lucia@correo.com;" + s + ";cita;facebook;;120000;Busca 2 dormitorios\r\n" +
      "Pedro Paz;0987654321;;" + s + ";nuevo;referido;;;Llamar después de las 5\r\n";
  }
  var API = { leerArchivo: leerArchivo, parseCSV: parseCSV, parseXLSX: parseXLSX, sugerirMapa: sugerirMapa, convertir: convertir, plantillaCSV: plantillaCSV, numero: numero,
    CAMPOS: ORDEN, ETIQUETAS: ETIQUETAS, MAX_FILAS: MAX_FILAS, slugify: slugify,
    convertirLeads: convertirLeads, plantillaLeadsCSV: plantillaLeadsCSV, LEADS: { CAMPOS: LEADS.ORDEN, ETIQUETAS: LEADS.ETIQUETAS } };
  root.GPUImportar = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
