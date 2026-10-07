/* Cálculo de la proforma (web/app/js/cotizar.js): mismas cifras que cotizacion_calcular() en el servidor (ver supabase/tests/cotizador.test.sql).
   Uso: node e2e/cotizar.test.mjs */
import assert from "node:assert/strict";
import C from "../web/app/js/cotizar.js";
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
let k = C.calcular({ precioLista: 128000, descuento: 3000, forma: "credito", entradaPct: 30, reserva: 2500, cuotas: 12, tasa: 9.5, plazo: 20 });
assert.deepEqual(k, { precioFinal: 125000, reserva: 2500, entrada: 37500, cuotaEntrada: 2916.67, saldo: 87500, cuotaMensual: 815.61 }); ok("crédito: mismas cifras que el servidor (cuota 815,61)");
assert.equal(C.calcular({ precioLista: 100000, descuento: 0, forma: "contado", entradaPct: 10, reserva: 20000, cuotas: 0, tasa: 9.5, plazo: 20 }).entrada, 20000); ok("si la reserva supera la entrada, la entrada sube a la reserva");
assert.equal(C.calcular({ precioLista: 100000, descuento: 0, forma: "contado", entradaPct: 10, reserva: 1000, cuotas: 0, tasa: 9.5, plazo: 20 }).cuotaMensual, null); ok("de contado no hay cuota mensual");
assert.equal(C.calcular({ precioLista: 120000, descuento: 0, forma: "credito", entradaPct: 20, reserva: 0, cuotas: 6, tasa: 0, plazo: 10 }).cuotaMensual, 800); ok("con tasa 0: saldo / meses");
assert.equal(C.calcular({ precioLista: 100000, descuento: 0, forma: "credito", entradaPct: 100, reserva: 0, cuotas: 0, tasa: 9, plazo: 20 }).cuotaMensual, 0); ok("entrada del 100 %: sin saldo, cuota 0");
assert.equal(C.calcular({ precioLista: 100, descuento: 0, forma: "contado", entradaPct: 30, reserva: 5000, cuotas: 0, tasa: 0, plazo: 1 }).reserva, 100); ok("la reserva nunca supera el precio");
assert.equal(C.reservaSugerida({ reserva_tipo: "porcentaje", reserva_valor: 2 }, 120000), 2400); assert.equal(C.reservaSugerida({ reserva_tipo: "monto", reserva_valor: 1500 }, 120000), 1500); ok("reserva sugerida por % o monto fijo");
// Valores raros: cifras copiadas de lo que devuelve el servidor (select cotizacion_calcular(99999.99, 0.01, 'credito', 33.33, 0, 7, 8.75, 25)).
assert.deepEqual(C.calcular({ precioLista: 99999.99, descuento: 0.01, forma: "credito", entradaPct: 33.33, reserva: 0, cuotas: 7, tasa: 8.75, plazo: 25 }),
  { precioFinal: 99999.98, reserva: 0, entrada: 33329.99, cuotaEntrada: 4761.43, saldo: 66669.99, cuotaMensual: 548.12 }); ok("redondeo a centavos idéntico al servidor en un caso raro");
console.log("Cálculo de proformas: OK (" + n + ")");
