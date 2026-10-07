/* GPUnlock CRM · Cálculo de la proforma (vista previa en la app).
   Es exactamente la misma cuenta que hace el servidor en cotizacion_calcular() (08_cotizador.sql):
   el servidor recalcula todo al emitir, así que lo que se ve aquí es lo que sale en la proforma. */
(function (root) {
  "use strict";
  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  /* p: { precioLista, descuento, forma: "credito"|"contado", entradaPct, reserva, cuotas, tasa, plazo } */
  function calcular(p) {
    var final = r2(p.precioLista - (p.descuento || 0));
    var reserva = r2(Math.min(Math.max(p.reserva || 0, 0), final));
    var entrada = Math.max(r2(final * p.entradaPct / 100), reserva);
    var cuotaEntrada = p.cuotas > 0 ? r2((entrada - reserva) / p.cuotas) : 0;
    var saldo = r2(final - entrada), cuota = null;
    if (p.forma === "credito") {
      var r = p.tasa / 1200, n = p.plazo * 12;
      cuota = saldo > 0 ? r2(r === 0 ? saldo / n : saldo * r / (1 - Math.pow(1 + r, -n))) : 0;
    }
    return { precioFinal: final, reserva: reserva, entrada: entrada, cuotaEntrada: cuotaEntrada, saldo: saldo, cuotaMensual: cuota };
  }
  /* Reserva sugerida por la configuración del proyecto. */
  function reservaSugerida(cfg, precioFinal) {
    return cfg.reserva_tipo === "monto" ? Number(cfg.reserva_valor) : r2(precioFinal * Number(cfg.reserva_valor) / 100);
  }
  var DEFECTO = { entrada_pct: 30, reserva_tipo: "porcentaje", reserva_valor: 2, cuotas_entrada: 12, tasa_anual: 9.5, plazo_anios: 20, descuento_max_pct: 5, vigencia_dias: 15, condiciones: null, whatsapp: null, prefijo: "" };
  var API = { calcular: calcular, reservaSugerida: reservaSugerida, r2: r2, DEFECTO: DEFECTO };
  root.GPUCotizar = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
