/* Motor de tema (web/js/tema.js): contraste AA garantizado para CUALQUIER color de marca, en claro y oscuro. */
const assert = require("node:assert/strict");
const T = require("../web/js/tema.js");
let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");
const BLANCO = [255, 255, 255], TINTA = [22, 22, 22], SUP = [250, 246, 243], CARD = [31, 31, 31];

// Colores: los de marca habituales, los extremos y 600 al azar (semilla fija para que sea repetible).
const fijos = ["#F2582B", "#1E4FD8", "#0F8A5F", "#7A1F3D", "#C9A227", "#161616", "#FFFFFF", "#000000", "#FFFF00", "#00FFFF", "#FF00FF", "#808080", "#FFD700", "#E0E0E0", "#101010"];
let semilla = 1234567; const azar = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
const azarosos = Array.from({ length: 600 }, () => "#" + [0, 0, 0].map(() => Math.floor(azar() * 256).toString(16).padStart(2, "0")).join("").toUpperCase());
const todos = fijos.concat(azarosos);

let peorBoton = 99, peorTextoClaro = 99, peorTextoOscuro = 99, ajustados = 0;
for (const hex of todos) {
  for (const modo of ["light", "dark"]) {
    const p = T.paleta(hex, null, modo), v = p.vars;
    for (const k of T.VARS) assert.ok(v[k], hex + " " + modo + " falta " + k);
    for (const k of ["--gp-orange-600", "--gp-orange-400", "--gp-orange-700", "--gp-orange-100", "--gp-orange-50", "--color-primary-hover", "--color-on-primary"]) assert.match(v[k], /^#[0-9A-F]{6}$/, hex + " " + k + " = " + v[k]);
    const P = T.hexRgb(v["--gp-orange-600"]), on = T.hexRgb(v["--color-on-primary"]);
    const botón = T.ratio(P, on); peorBoton = Math.min(peorBoton, botón);
    assert.ok(botón >= 4.5, `${hex} ${modo}: texto sobre el color ${botón.toFixed(2)} < 4,5`);
    const txt = T.hexRgb(v["--gp-orange-700"]), t100 = T.hexRgb(v["--gp-orange-100"]);
    const sobreTinte = T.ratio(txt, t100);
    assert.ok(sobreTinte >= 4.5, `${hex} ${modo}: texto de marca sobre su tinte ${sobreTinte.toFixed(2)} < 4,5`);
    const base = modo === "light" ? SUP : CARD, sobreBase = T.ratio(txt, base);
    assert.ok(sobreBase >= 4.5, `${hex} ${modo}: texto de marca sobre la superficie ${sobreBase.toFixed(2)} < 4,5`);
    if (modo === "light") peorTextoClaro = Math.min(peorTextoClaro, sobreBase); else peorTextoOscuro = Math.min(peorTextoOscuro, sobreBase);
    if (modo === "light" && p.ajustado) ajustados++;
  }
}
ok(`${todos.length} colores × 2 modos: el texto sobre el color de marca cumple 4,5:1 (peor caso ${peorBoton.toFixed(2)})`);
ok(`el texto de marca sobre fondo claro cumple 4,5:1 (peor caso ${peorTextoClaro.toFixed(2)}) y sobre fondo oscuro (peor caso ${peorTextoOscuro.toFixed(2)})`);
ok(`solo se ajustó el tono de ${ajustados} de ${todos.length} colores (los demás se respetan tal cual)`);

// Colores habituales: se respetan sin tocarlos.
for (const hex of ["#1E4FD8", "#7A1F3D", "#161616", "#F2582B"]) assert.equal(T.paleta(hex, null, "light").vars["--gp-orange-600"], hex, hex + " no debería cambiar");
ok("los colores de marca que ya cumplen (azul, vino, negro, naranja) se respetan sin cambios");
// El verde #0F8A5F no admite texto blanco ni negro con 4,5:1: se ajusta, pero lo mínimo (apenas se nota).
{ const p = T.paleta("#0F8A5F", null, "light"), a = T.hexRgb("#0F8A5F"), b = T.hexRgb(p.vars["--gp-orange-600"]);
  const dist = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  assert.equal(p.ajustado, true); assert.ok(dist <= 16, "el verde cambió " + dist); assert.ok(p.contrasteBoton >= 4.5);
  console.log("ok  - el verde #0F8A5F se ajusta lo mínimo para llegar a AA (cambio máximo de " + dist + "/255 por canal) (" + ++n + ")"); }

// Texto negro u blanco según el color.
assert.equal(T.paleta("#F2582B", null, "light").vars["--color-on-primary"], "#161616");
assert.equal(T.paleta("#1E4FD8", null, "light").vars["--color-on-primary"], "#FFFFFF");
ok("elige texto negro sobre naranja y blanco sobre azul");

// Entradas inválidas caen en el color de GPUnlock; el acento propio se respeta.
assert.equal(T.paleta("rojo", null, "light").vars["--gp-orange-600"], "#F2582B");
assert.equal(T.paleta(undefined, null, "dark").vars["--gp-orange-600"], "#F2582B");
assert.equal(T.paleta("#1E4FD8", "#F0C330", "light").vars["--gp-orange-400"], "#F0C330");
assert.notEqual(T.paleta("#1E4FD8", "javascript:alert(1)", "light").vars["--gp-orange-400"], "javascript:alert(1)");
ok("un color inválido cae en el de GPUnlock y un acento inválido se ignora (nada sin validar llega al CSS)");

// Colores sugeridos desde un logo.
const px = (r, g, b, a = 255) => [r, g, b, a];
const logo = []; for (let i = 0; i < 600; i++) logo.push(...px(242, 88, 43)); for (let i = 0; i < 300; i++) logo.push(...px(22, 22, 22)); for (let i = 0; i < 900; i++) logo.push(...px(255, 255, 255)); for (let i = 0; i < 500; i++) logo.push(...px(0, 0, 0, 0)); for (let i = 0; i < 250; i++) logo.push(...px(30, 79, 216));
const sug = T.coloresDeImagen(Uint8ClampedArray.from(logo));
assert.equal(sug[0], "#F2582B"); assert.ok(sug.includes("#1E4FD8")); assert.ok(!sug.includes("#161616") && !sug.includes("#FFFFFF"));
ok("de un logo naranja con negro, blanco y transparencia sugiere el naranja y el azul, nunca el blanco, el negro ni los grises");
assert.deepEqual(T.coloresDeImagen(Uint8ClampedArray.from([...px(255, 255, 255), ...px(10, 10, 10), ...px(128, 128, 128)])), []);
ok("un logo solo en blanco, negro y gris no sugiere nada");
console.log("Motor de tema: OK (" + n + ")");
