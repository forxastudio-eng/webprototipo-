/* GPUnlock · Dashboard de marketing — Exportar a PDF conservando el diseño.
   Captura cada bloque tal como se ve en pantalla (colores, gráficos, tipografía)
   y lo acomoda en páginas A4 sin partir las secciones, salvo que una sola
   sección sea más alta que una página. Las librerías se cargan solo al pulsar. */
(function () {
  "use strict";
  var H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  var JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var btn = document.getElementById("btn-pdf");
  if (!btn) return;

  function cargar(src) {
    return new Promise(function (ok, fallo) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var s = document.createElement("script");
      s.src = src; s.onload = ok;
      s.onerror = function () { fallo(new Error("No se pudo cargar una librería. Revisa tu conexión.")); };
      document.head.appendChild(s);
    });
  }

  async function exportar() {
    var label = btn.querySelector("span"), textoOriginal = label.textContent;
    btn.disabled = true; label.textContent = "Generando…";
    var aviso = document.createElement("div");
    aviso.className = "pdf-overlay"; aviso.setAttribute("data-pdf-ignore", "");
    aviso.innerHTML = "<div>Generando el PDF, un momento…</div>";
    document.body.appendChild(aviso);

    try {
      await cargar(H2C); await cargar(JSPDF);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;

      var fondo = getComputedStyle(document.body).backgroundColor || "#F6F3F1";
      var bloques = [document.querySelector(".masthead")]
        .concat(Array.prototype.slice.call(document.querySelectorAll(".wrap > section")))
        .concat([document.querySelector(".site-footer")])
        .filter(function (el) { return el && el.offsetHeight > 0; });

      var pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
      var PW = 210, PH = 297, M = 8, ANCHO = PW - 2 * M, PIE = 9, LIMITE = PH - PIE, ESPACIO = 4;
      function pintarFondo() { pdf.setFillColor(244, 246, 249); pdf.rect(0, 0, PW, PH, "F"); }
      pintarFondo();
      var y = M;

      for (var i = 0; i < bloques.length; i++) {
        var el = bloques[i];
        var lienzo = await window.html2canvas(el, {
          scale: 2, backgroundColor: fondo, useCORS: true, logging: false,
          ignoreElements: function (n) { return n.hasAttribute && n.hasAttribute("data-pdf-ignore"); },
          // La librería falla con degradados en elementos de 0 px (p. ej. una barra
          // de progreso en 0 %). En la copia que se captura se les quita el degradado:
          // no se ven en pantalla, así que el resultado es idéntico.
          onclone: function (doc) {
            Array.prototype.forEach.call(doc.querySelectorAll("*"), function (n) {
              var cs = doc.defaultView.getComputedStyle(n);
              if (cs.backgroundImage.indexOf("gradient") !== -1 && (n.offsetWidth < 1 || n.offsetHeight < 1)) {
                n.style.backgroundImage = "none";
              }
            });
          }
        });
        var altoMm = lienzo.height * ANCHO / lienzo.width;
        var esCabecera = el.classList.contains("masthead");
        // La cabecera oscura va a lo ancho de toda la hoja, como en pantalla.
        var x = esCabecera ? 0 : M, ancho = esCabecera ? PW : ANCHO;
        if (esCabecera) altoMm = lienzo.height * PW / lienzo.width;

        if (altoMm <= LIMITE - M) {
          if (y + altoMm > LIMITE) { pdf.addPage(); pintarFondo(); y = M; }
          pdf.addImage(lienzo.toDataURL("image/jpeg", 0.92), "JPEG", x, esCabecera && y === M ? 0 : y, ancho, altoMm);
          y = (esCabecera && y === M ? 0 : y) + altoMm + ESPACIO;
        } else {
          // Sección más alta que una página: se reparte en varias.
          var pxPorMm = lienzo.width / ancho, desde = 0;
          while (desde < lienzo.height) {
            if (y > M + 1) { pdf.addPage(); pintarFondo(); y = M; }
            var altoPx = Math.min(lienzo.height - desde, Math.floor((LIMITE - y) * pxPorMm));
            var trozo = document.createElement("canvas");
            trozo.width = lienzo.width; trozo.height = altoPx;
            trozo.getContext("2d").drawImage(lienzo, 0, desde, lienzo.width, altoPx, 0, 0, lienzo.width, altoPx);
            pdf.addImage(trozo.toDataURL("image/jpeg", 0.92), "JPEG", x, y, ancho, altoPx / pxPorMm);
            y += altoPx / pxPorMm + ESPACIO; desde += altoPx;
          }
        }
      }

      var total = pdf.getNumberOfPages();
      var hoy = new Date().toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
      var periodo = (document.getElementById("m-period-value") || {}).textContent || "";
      for (var p = 1; p <= total; p++) {
        pdf.setPage(p);
        pdf.setFontSize(8); pdf.setTextColor(91, 100, 114);
        pdf.text("GPUnlock  |  Dashboard ejecutivo de marketing" + (periodo && periodo !== "—" ? "  |  " + periodo : "") + "  |  Generado el " + hoy, M, PH - 4);
        pdf.text(p + " / " + total, PW - M, PH - 4, { align: "right" });
      }
      pdf.save("gpunlock-dashboard-marketing-" + new Date().toISOString().slice(0, 10) + ".pdf");
    } catch (e) {
      alert("No se pudo generar el PDF: " + (e && e.message ? e.message : e));
    } finally {
      aviso.remove();
      btn.disabled = false; label.textContent = textoOriginal;
    }
  }

  btn.addEventListener("click", exportar);
})();
