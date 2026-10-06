/* ==========================================================================
   GPUnlock CRM · Motor de tema (marca por empresa + modo claro / oscuro / automático)

   A partir de UN color de marca calcula la paleta completa (hover, tintes, texto sobre el color,
   texto de marca sobre fondo claro y oscuro) garantizando contraste AA (4,5:1) en los dos modos,
   y la escribe como variables CSS en <html>. La usan la app y (la demo de) la web de ventas.
   Es JavaScript puro, sin dependencias, y también se puede cargar en Node para probarlo.

   Variables que escribe (las que ya usan gp-tokens.css y app.css):
     --gp-orange-600  color de marca (fondos, botones)       --gp-orange-400  acento (final del degradado)
     --gp-orange-700  color de marca para TEXTO              --gp-orange-100 / -50  tintes
     --color-primary-hover   --color-on-primary (texto sobre el color)   --ring
   Sin marca guardada no escribe nada: la app queda con los colores de GPUnlock.
   ========================================================================== */
(function (root) {
  "use strict";
  var CLAVE_MODO = "gpu_modo", CLAVE_MARCA = "gpu_marca";
  var TINTA = [22, 22, 22], BLANCO = [255, 255, 255];
  var SUPERFICIE_CLARA = [250, 246, 243];            // --gp-mist
  var CARD_OSCURA = [31, 31, 31];                    // --color-card en modo oscuro
  var VARS = ["--gp-orange-600", "--gp-orange-400", "--gp-orange-700", "--gp-orange-100", "--gp-orange-50", "--color-primary-hover", "--color-on-primary", "--ring"];
  var DEFECTO = "#F2582B";

  /* ---------------------------------------------------------------- color --- */
  function hexValido(h) { return typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h); }
  function hexRgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgbHex(c) { return "#" + c.map(function (v) { v = Math.round(Math.max(0, Math.min(255, v))); return (v < 16 ? "0" : "") + v.toString(16); }).join("").toUpperCase(); }
  function lum(c) {
    var s = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mezclar(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function entero(c) { return c.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))); }); }   // el contraste se mide sobre el color ya redondeado

  /* Mueve el color hacia `hacia` (negro o blanco) de a poco hasta tener `min`:1 contra `ref`. */
  function acercar(c, ref, hacia, min) {
    var x = c.slice(), n = 0;
    while (ratio(x, ref) < min && n < 80) { x = entero(mezclar(x, hacia, 0.05)); n++; }
    return x;
  }
  /* Texto de marca legible sobre `ref` (claro u oscuro). */
  function textoDeMarca(P, ref, min) {
    if (ratio(P, ref) >= min) return P.slice();
    return acercar(P, ref, lum(ref) > 0.4 ? [0, 0, 0] : [255, 255, 255], min);
  }
  /* Fondo de marca que admita texto blanco o negro con 4,5:1. Si el color ya sirve, no se toca; si no, se ajusta
     lo mínimo posible, oscureciendo (texto blanco) o aclarando (texto negro), lo que cambie menos el color. */
  function ruta(P, hacia, texto) {
    var x = P.slice(), n = 0;
    while (ratio(x, texto) < 4.5 && n < 80) { x = entero(mezclar(x, hacia, 0.04)); n++; }
    return { fondo: x, n: n, texto: texto };
  }
  function fondoYTexto(P) {
    var a = ruta(P, [0, 0, 0], BLANCO), b = ruta(P, [255, 255, 255], TINTA);
    var e = a.n === b.n ? (ratio(P, BLANCO) >= ratio(P, TINTA) ? a : b) : (a.n < b.n ? a : b);
    return { fondo: e.fondo, texto: e.texto, ajustado: e.n > 0 };
  }

  /* Paleta completa para un color de marca. modo: "light" | "dark". */
  function paleta(hex, acento, modo) {
    hex = hexValido(hex) ? hex : DEFECTO;
    var P0 = hexRgb(hex), f = fondoYTexto(P0), P = f.fondo, oscuro = modo === "dark";
    var t100 = entero(oscuro ? mezclar(P, CARD_OSCURA, 0.78) : mezclar(P, BLANCO, 0.86));
    var t50 = entero(oscuro ? mezclar(P, CARD_OSCURA, 0.88) : mezclar(P, BLANCO, 0.94));
    var texto = textoDeMarca(P, t100, 4.6);                    // t100 es el fondo más exigente donde va el texto de marca
    if (!oscuro) texto = textoDeMarca(texto, SUPERFICIE_CLARA, 4.6);
    else texto = textoDeMarca(texto, CARD_OSCURA, 4.6);
    var ac = hexValido(acento) ? hexRgb(acento) : mezclar(P, BLANCO, 0.2);
    var hover = lum(P) > 0.4 ? mezclar(P, TINTA, 0.12) : mezclar(P, BLANCO, 0.12);
    var vars = {
      "--gp-orange-600": rgbHex(P), "--gp-orange-400": rgbHex(ac), "--gp-orange-700": rgbHex(texto),
      "--gp-orange-100": rgbHex(t100), "--gp-orange-50": rgbHex(t50),
      "--color-primary-hover": rgbHex(hover), "--color-on-primary": rgbHex(f.texto),
      "--ring": "rgba(" + Math.round(P[0]) + "," + Math.round(P[1]) + "," + Math.round(P[2]) + ",.35)"
    };
    return {
      vars: vars, ajustado: f.ajustado, fondo: rgbHex(P), textoSobreFondo: rgbHex(f.texto),
      contrasteBoton: ratio(P, f.texto), contrasteTexto: ratio(texto, oscuro ? CARD_OSCURA : SUPERFICIE_CLARA)
    };
  }

  /* Hasta 3 colores representativos de un logo (RGBA de un canvas pequeño): vivos, ni blanco ni negro ni gris. */
  function coloresDeImagen(rgba) {
    var cubos = {}, i, r, g, b, a, mx, mn, clave;
    for (i = 0; i + 3 < rgba.length; i += 4) {
      a = rgba[i + 3]; if (a < 200) continue;
      r = rgba[i]; g = rgba[i + 1]; b = rgba[i + 2];
      mx = Math.max(r, g, b); mn = Math.min(r, g, b);
      if ((mx - mn) / 255 < 0.22 || mx < 45 || mn > 225) continue;          // gris, negro o blanco
      clave = (r >> 4) + "," + (g >> 4) + "," + (b >> 4);
      var c = cubos[clave] || (cubos[clave] = { n: 0, r: 0, g: 0, b: 0 });
      c.n++; c.r += r; c.g += g; c.b += b;
    }
    var lista = Object.keys(cubos).map(function (k) { var c = cubos[k]; return { n: c.n, rgb: [c.r / c.n, c.g / c.n, c.b / c.n] }; })
      .sort(function (x, y) { return y.n - x.n; });
    var elegidos = [];
    lista.forEach(function (c) {
      if (elegidos.length >= 3) return;
      var lejos = elegidos.every(function (e) {
        var d = Math.sqrt(Math.pow(e[0] - c.rgb[0], 2) + Math.pow(e[1] - c.rgb[1], 2) + Math.pow(e[2] - c.rgb[2], 2));
        return d > 70;
      });
      if (lejos) elegidos.push(c.rgb);
    });
    return elegidos.map(rgbHex);
  }

  /* ------------------------------------------------------------ aplicar y recordar --- */
  var estado = { marca: null, pref: "auto" };
  function almacenar(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function modoEfectivo(pref) {
    if (pref === "oscuro") return "dark";
    if (pref === "claro") return "light";
    try { return root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { return "light"; }
  }
  function aplicar() {
    var el = root.document && root.document.documentElement; if (!el) return;
    var modo = modoEfectivo(estado.pref), m = estado.marca;
    el.setAttribute("data-theme", modo);
    var hex = m && hexValido(m.color_primario) ? m.color_primario : null;
    if (hex) {
      var p = paleta(hex, m.color_acento, modo);
      VARS.forEach(function (v) { el.style.setProperty(v, p.vars[v]); });
    } else {
      VARS.forEach(function (v) { el.style.removeProperty(v); });
    }
    var meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", hex ? paleta(hex, null, modo).fondo : (modo === "dark" ? "#121212" : "#F2582B"));
  }

  var Tema = {
    hexValido: hexValido, hexRgb: hexRgb, rgbHex: rgbHex, ratio: ratio, lum: lum,
    paleta: paleta, coloresDeImagen: coloresDeImagen, VARS: VARS,
    /* Antes del primer pintado: modo y marca recordados (evita el parpadeo de colores). */
    arranque: function () {
      var pref = leer(CLAVE_MODO); estado.pref = pref === "claro" || pref === "oscuro" ? pref : "auto";
      try { var c = JSON.parse(leer(CLAVE_MARCA) || "null"); estado.marca = c && c.marca ? c.marca : null; } catch (e) { estado.marca = null; }
      aplicar();
      try {
        var mq = root.matchMedia("(prefers-color-scheme: dark)");
        var alCambiar = function () { if (estado.pref === "auto") aplicar(); };
        if (mq.addEventListener) mq.addEventListener("change", alCambiar); else if (mq.addListener) mq.addListener(alCambiar);
      } catch (e) { /* sin matchMedia */ }
    },
    /* La marca llegó del servidor (o cambió en tiempo real): se aplica y se recuerda. */
    aplicarMarca: function (marca, orgId) {
      estado.marca = marca && hexValido(marca.color_primario) ? marca : null;
      almacenar(CLAVE_MARCA, estado.marca ? JSON.stringify({ org: orgId || null, marca: estado.marca }) : null);
      aplicar();
    },
    /* Solo para la pantalla de inicio de sesión de una empresa: se aplica sin recordarla. */
    aplicarMarcaTemporal: function (marca) { estado.marca = marca && hexValido(marca.color_primario) ? marca : null; aplicar(); },
    olvidarMarca: function () { estado.marca = null; almacenar(CLAVE_MARCA, null); aplicar(); },
    modo: function () { return estado.pref; },
    modoEfectivo: function () { return modoEfectivo(estado.pref); },
    fijarModo: function (pref) { estado.pref = pref === "claro" || pref === "oscuro" ? pref : "auto"; almacenar(CLAVE_MODO, estado.pref === "auto" ? null : estado.pref); aplicar(); }
  };
  root.GPUTema = Tema;
  if (typeof module !== "undefined" && module.exports) module.exports = Tema;
})(typeof window !== "undefined" ? window : globalThis);
