/* Lectura de inventario desde Excel (.xlsx) y CSV (web/app/js/importar.js): formatos reales, columnas, números y errores por fila.
   Uso: node e2e/importar.test.mjs */
import assert from "node:assert/strict";
import I from "../web/app/js/importar.js";

let n = 0; const ok = (m) => console.log("ok  - " + m + " (" + ++n + ")");

import { createRequire } from "node:module";
const { zip, xlsx } = createRequire(import.meta.url)("./xlsx-fixture.cjs");
const archivo = (bytes, nombre, tipo = "") => new File([bytes], nombre, { type: tipo });

/* 1. CSV ---------------------------------------------------------------------------------------- */
let f = I.parseCSV('﻿proyecto;codigo;nota\r\ntorre;A-1;"dice ""hola"";\nsegunda línea"\r\ntorre;A-2;\r\n\r\n');
assert.deepEqual(f, [["proyecto", "codigo", "nota"], ["torre", "A-1", 'dice "hola";\nsegunda línea'], ["torre", "A-2", ""], [""]]); ok("CSV: BOM, punto y coma, comillas, comillas escapadas, saltos de línea dentro de una celda y CRLF");
assert.deepEqual(I.parseCSV("a,b,c\n1,2,3")[1], ["1", "2", "3"]); ok("CSV: detecta la coma como separador");
assert.deepEqual(I.parseCSV("a\tb\n1\t2")[1], ["1", "2"]); ok("CSV: detecta el tabulador");

/* 2. XLSX --------------------------------------------------------------------------------------- */
const datos = [["Proyecto", "Unidad", "Precio", "Observaciones"], ["Torre Alba", "A-101", 120000, "Esquinera & vista"], ["Torre Alba", "A-102", null, null], ["Torre Alba", null, 99, "sin código"]];
for (const [que, o] of [["comprimido", {}], ["sin comprimir", { comprimir: false }], ["comprimido con «data descriptor» (como Excel)", { descriptor: true }]]) {
  const r = await I.parseXLSX(xlsx(datos, o));
  assert.equal(r.nombreHoja, "Inventario & precios");
  assert.deepEqual(r.filas[0], datos[0]); assert.deepEqual(r.filas[1], ["Torre Alba", "A-101", "120000", "Esquinera & vista"]);
  assert.deepEqual(r.filas[2], ["Torre Alba", "A-102"]); assert.deepEqual(r.filas[3], ["Torre Alba", "", "99", "sin código"]);
  ok("XLSX " + que + ": primera hoja del libro (no la del archivo sheet1), textos compartidos, números, entidades y celdas vacías");
}
await assert.rejects(() => I.parseXLSX(Buffer.from("esto no es un zip")), /no es un Excel/); ok("XLSX: un archivo que no es Excel da un error claro");
// Texto enriquecido, texto en línea y booleanos
const rico = zip({ "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>Pre</t></r><r><t>cio</t></r></is></c><c r="C1" t="b"><v>1</v></c></row></sheetData></worksheet>' });
assert.deepEqual((await I.parseXLSX(rico)).filas[0], ["Precio", "", "Sí"]); ok("XLSX: texto enriquecido y celdas salteadas sin libro (usa sheet1.xml)");

/* 3. leerArchivo -------------------------------------------------------------------------------- */
let r = await I.leerArchivo(archivo(xlsx(datos), "inv.xlsx"));
assert.deepEqual(r.columnas, datos[0]); assert.equal(r.filas.length, 3); assert.equal(r.filas[1].length, 4); ok("leerArchivo: .xlsx → columnas y filas del mismo ancho");
r = await I.leerArchivo(archivo("a;b\n1;2\n\n3;4\n", "inv.csv", "text/csv")); assert.equal(r.filas.length, 2); ok("leerArchivo: CSV sin filas vacías");
await assert.rejects(() => I.leerArchivo(archivo("x", "inv.xls")), /\.xls antiguos/); ok("rechaza .xls antiguo con instrucciones");
await assert.rejects(() => I.leerArchivo(archivo("x", "inv.pdf", "application/pdf")), /Excel \(\.xlsx\) o CSV/); ok("rechaza otros formatos");
await assert.rejects(() => I.leerArchivo(archivo("a;b\n", "inv.csv")), /no tiene datos/); ok("rechaza un archivo solo con títulos");
await assert.rejects(() => I.leerArchivo(archivo("a;b\n" + "1;2\n".repeat(2001), "inv.csv")), /2001 filas.*2000/); ok("rechaza más de 2.000 filas");
await assert.rejects(() => I.leerArchivo(archivo(Buffer.alloc(5 * 1024 * 1024 + 1), "inv.csv")), /más de 5 MB/); ok("rechaza archivos de más de 5 MB");

/* 4. Columnas ----------------------------------------------------------------------------------- */
const cols = ["Proyecto", "Unidad", "Tipo", "Torre", "Piso", "Área (m²)", "Dorm.", "Baños", "Parqueos", "Bodega", "Precio de venta", "Estado", "Observaciones"];
const m = I.sugerirMapa(cols);
assert.deepEqual(I.CAMPOS.map((c) => m[c]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); ok("reconoce títulos habituales en español (con tildes, abreviaturas y paréntesis)");
const m2 = I.sugerirMapa(["Lote", "Mz", "Superficie", "Valor", "Disponibilidad", "Columna rara"]);
assert.deepEqual([m2.codigo, m2.bloque, m2.area_m2, m2.precio, m2.estado, m2.proyecto, m2.tipo], [0, 1, 2, 3, 4, -1, -1]); ok("lotes: Lote, Mz, Superficie, Valor, Disponibilidad; lo que no existe queda sin asignar");
const m3 = I.sugerirMapa(["Departamento", "Tipo"]); assert.deepEqual([m3.codigo, m3.tipo], [0, 1]); ok("una columna solo se usa para un campo");

/* 5. Números ------------------------------------------------------------------------------------ */
const num = (t) => I.numero(t);
for (const [t, v] of [["85,5", 85.5], ["85.5", 85.5], ["120000", 120000], ["120,000", 120000], ["120.000", 120000], ["1.234,56", 1234.56], ["1,234.56", 1234.56], ["$ 98.500", 98500], ["USD 1 200", 1200], ["0", 0]])
  assert.equal(num(t).valor, v, t);
assert.ok(num("").vacio && num("   ").vacio); assert.ok(num("abc").error && num("12abc34x5-6").error && num("1.2.3").error); assert.equal(num("-5").valor, -5);
ok("números: coma o punto decimal, miles con punto o coma, símbolos de moneda, vacíos y basura");

/* 6. Convertir ---------------------------------------------------------------------------------- */
const proyectos = [{ slug: "torre-alba", nombre: "Torre Alba" }, { slug: "valle", nombre: "Valle Verde" }];
const crudas = [
  ["Torre Alba", "A-101", "Depto", "A", "1", "85,5", "2", "2,5", "1", "", "120.000", "Libre", "Esquinera"],     // 2
  ["valle", "L-7", "terreno", "", "", "300", "", "", "", "", "45000", "vendido", ""],                           // 3
  ["Torre Alba", "", "suite", "", "", "", "", "", "", "", "", "", ""],                                          // 4 sin código
  ["Otro Proyecto", "X-1", "", "", "", "", "", "", "", "", "", "", ""],                                         // 5 proyecto
  ["Torre Alba", "A-103", "dúplex", "", "", "", "", "", "", "", "caro", "", ""],                                // 6 precio
  ["Torre Alba", "A-104", "casa", "", "", "", "", "", "", "", "", "quizás", ""],                                // 7 estado
  ["Torre Alba", "a-101", "", "", "", "", "", "", "", "", "", "", ""],                                          // 8 repetido
  ["Torre Alba", "A-105", "dúplex", "", "", "50", "1", "1", "", "", "", "separado", ""]                         // 9 ok, tipo raro
];
let c = I.convertir(crudas, m, { proyectos, proyectoDefecto: null });
assert.deepEqual(c.filas[0], { fila: 2, codigo: "A-101", proyecto: "torre-alba", tipo: "departamento", bloque: "A", piso: "1", area_m2: 85.5, dormitorios: 2, banos: 2.5, parqueos: 1, precio: 120000, estado: "disponible", descripcion: "Esquinera" });
ok("convierte una fila: proyecto por nombre, «Depto» → departamento, 85,5 → 85.5, 120.000 → 120000, «Libre» → disponible");
assert.deepEqual(c.filas[1], { fila: 3, codigo: "L-7", proyecto: "valle", tipo: "lote", area_m2: 300, precio: 45000, estado: "vendida" }); ok("las celdas vacías no se envían (no borran datos existentes) y el proyecto se reconoce por su clave");
assert.deepEqual(c.errores.map((e) => e.fila), [4, 5, 6, 7, 8]); ok("errores por fila, en orden: " + c.errores.map((e) => e.fila).join(", "));
assert.match(c.errores[0].error, /Falta el código/); assert.match(c.errores[1].error, /proyecto «Otro Proyecto» no existe/); assert.match(c.errores[2].error, /precio «caro»/);
assert.match(c.errores[3].error, /Estado no reconocido «quizás»/); assert.match(c.errores[4].error, /«a-101» está repetido.*fila 2/); ok("cada error dice qué corregir");
assert.equal(c.filas.length, 3); assert.equal(c.filas[2].tipo, "otro"); assert.equal(c.filas[2].estado, "reservada"); ok("una fila válida con tipo desconocido se importa como «otro» y avisa");
assert.equal(c.avisos.length, 1); assert.match(c.avisos[0], /1 unidad tiene un tipo que no reconocimos/); ok("el aviso cuenta los tipos desconocidos");
c = I.convertir([["A-1", "casa"], ["A-2", "casa"]], { codigo: 0, tipo: 1, proyecto: -1 }, { proyectos, proyectoDefecto: "valle" });
assert.deepEqual(c.filas.map((x) => x.proyecto), ["valle", "valle"]); ok("sin columna de proyecto usa el elegido para todo el archivo");
c = I.convertir([["A-1"]], { codigo: 0, proyecto: -1 }, { proyectos, proyectoDefecto: null });
assert.match(c.errores[0].error, /no tiene proyecto/); ok("sin columna de proyecto y sin uno elegido avisa");
c = I.convertir([["x".repeat(41)]], { codigo: 0, proyecto: -1 }, { proyectos, proyectoDefecto: "valle" }); assert.match(c.errores[0].error, /demasiado largo/); ok("código de más de 40 caracteres");

/* 7. Plantilla ---------------------------------------------------------------------------------- */
const pl = I.parseCSV(I.plantillaCSV("torre-alba")), mp = I.sugerirMapa(pl[0]);
c = I.convertir(pl.slice(1), mp, { proyectos, proyectoDefecto: null });
assert.equal(c.errores.length, 0); assert.equal(c.filas.length, 2); assert.equal(c.filas[0].area_m2, 85.5); assert.equal(c.filas[1].estado, "reservada"); ok("la plantilla CSV descargable se lee sin errores (con coma decimal y punto y coma)");
/* 8. Cartera de leads (Excel propio y exportaciones de Kommo, Pipedrive y HubSpot) ------------------ */
const equipo = [{ email: "ana@x.com", nombre: "Ana Pérez", rol: "propietario" }, { email: "gabo@x.com", nombre: "Gabo Ruiz", rol: "agente" }, { email: "lu@x.com", nombre: "Lucho", rol: "lector" }];
let ml = I.sugerirMapa(["Contacto principal", "Teléfono móvil", "Correo electrónico", "Etapa", "Usuario responsable", "Presupuesto", "Nombre del lead"], "leads");
assert.deepEqual([ml.nombre, ml.telefono, ml.correo, ml.etapa, ml.asignado, ml.valor], [0, 1, 2, 3, 4, 5]); ok("reconoce una exportación de Kommo (y prefiere «Contacto principal» al nombre del lead)");
ml = I.sugerirMapa(["Persona - Nombre", "Persona - Teléfono", "Persona - Correo electrónico", "Negocio - Etapa", "Negocio - Valor", "Negocio - Propietario"], "leads");
assert.deepEqual([ml.nombre, ml.telefono, ml.correo, ml.etapa, ml.valor, ml.asignado], [0, 1, 2, 3, 4, 5]); ok("reconoce una exportación de Pipedrive");
ml = I.sugerirMapa(["First Name", "Last Name", "Phone Number", "Email", "Lifecycle Stage", "Contact owner", "Original Traffic Source"], "leads");
assert.deepEqual([ml.nombre, ml.apellido, ml.telefono, ml.correo, ml.etapa, ml.asignado, ml.fuente], [0, 1, 2, 3, 4, 5, 6]); ok("reconoce una exportación de HubSpot (nombre y apellido por separado)");
const mh = I.sugerirMapa(["Nombre", "Apellido", "Celular", "Email", "Proyecto", "Estado", "Origen", "Asesor", "Presupuesto", "Observaciones"], "leads");
const cl = I.convertirLeads([
  ["Lucía", "Mora", "099 123 4567", "LUCIA@X.com", "Torre Alba", "Cita agendada", "Facebook Ads", "gabo@x.com", "120.000", "Piso alto"],   // 2
  ["Pedro", "", "", "pedro@x.com", "", "Ganado", "Instagram", "Ana Pérez", "", ""],                                                        // 3
  ["X", "", "0991111111", "", "", "", "", "", "", ""],                                                                                       // 4 nombre
  ["Sin Contacto", "", "", "", "", "", "", "", "", ""],                                                                                      // 5
  ["Tel Malo", "", "12345", "", "", "", "", "", "", ""],                                                                                     // 6
  ["Proy Malo", "", "0992222222", "", "Otro", "", "", "", "", ""],                                                                           // 7
  ["Raro", "", "0993333333", "", "", "En el limbo", "TV abierta", "Lucho", "caro", ""],                                                      // 8 valor
  ["Raro Dos", "", "0994444444", "", "", "En el limbo", "TV abierta", "Lucho", "", ""],                                                      // 9 avisos
  ["Repetida", "", "+593 99 123 4567", "", "", "", "", "", "", ""]                                                                           // 10 repetido
], mh, { proyectos, equipo });
assert.deepEqual(cl.filas[0], { fila: 2, nombre: "Lucía Mora", telefono: "099 123 4567", correo: "lucia@x.com", proyecto: "torre-alba", etapa: "cita", fuente: "facebook", asignado: "gabo@x.com", valor: 120000, nota: "Piso alto" });
ok("convierte una fila completa: nombre + apellido, correo en minúsculas, etapa, fuente, asesor y 120.000");
assert.deepEqual(cl.filas[1], { fila: 3, nombre: "Pedro", correo: "pedro@x.com", etapa: "vendido", fuente: "instagram", asignado: "ana@x.com" }); ok("solo correo vale; «Ganado» → vendido; el asesor se reconoce por su nombre");
assert.deepEqual(cl.errores.map((e) => e.fila), [4, 5, 6, 7, 8, 10]); ok("errores por fila: nombre, sin contacto, teléfono, proyecto, valor y repetido");
assert.match(cl.errores[5].error, /repetido.*fila 2/); ok("detecta el mismo teléfono escrito de otra forma (+593…)");
assert.equal(cl.filas.length, 3); assert.equal(cl.filas[2].etapa, undefined); assert.equal(cl.filas[2].fuente, undefined); assert.equal(cl.filas[2].asignado, undefined); ok("etapa, fuente o asesor desconocidos no bloquean (los lectores no reciben leads)");
assert.equal(cl.avisos.length, 3); assert.match(cl.avisos[0], /1 fila tiene una etapa que no reconocimos/); ok("y se avisan");
const plc = I.parseCSV(I.plantillaLeadsCSV("torre-alba")), cpl = I.convertirLeads(plc.slice(1), I.sugerirMapa(plc[0], "leads"), { proyectos, equipo });
assert.equal(cpl.errores.length, 0); assert.equal(cpl.filas.length, 2); assert.equal(cpl.filas[0].valor, 120000); ok("la plantilla de cartera se lee sin errores");
console.log("Importación de inventario y cartera: OK (" + n + ")");
