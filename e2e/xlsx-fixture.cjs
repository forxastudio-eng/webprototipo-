/* Constructor de .xlsx de prueba (ZIP con directorio central, con o sin compresión y con «data descriptor» como Excel). */
const zlib = require("node:zlib");
function zip(archivos, { comprimir = true, descriptor = false } = {}) {
  const partes = [], central = []; let pos = 0;
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }, u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, "utf8"), c = comprimir ? zlib.deflateRawSync(datos) : datos, crc = zlib.crc32(datos), nom = Buffer.from(nombre);
    const flags = descriptor ? 8 : 0, metodo = comprimir ? 8 : 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(metodo), u16(0), u16(0), u32(descriptor ? 0 : crc), u32(descriptor ? 0 : c.length), u32(descriptor ? 0 : datos.length), u16(nom.length), u16(0), nom]);
    const desc = descriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(c.length), u32(datos.length)]) : Buffer.alloc(0);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(flags), u16(metodo), u16(0), u16(0), u32(crc), u32(c.length), u32(datos.length), u16(nom.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos), nom]));
    partes.push(local, c, desc); pos += local.length + c.length + desc.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...partes, cd, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(pos), u16(0)]);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function xlsx(filas, opts = {}) {
  const compartidas = []; const idx = (t) => { let i = compartidas.indexOf(t); if (i < 0) { i = compartidas.length; compartidas.push(t); } return i; };
  const col = (i) => String.fromCharCode(65 + i);
  const rows = filas.map((f, r) => `<row r="${r + 1}">` + f.map((v, c) => v === null || v === "" ? "" : typeof v === "number" ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join("") + "</row>").join("");
  return zip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="Inventario &amp; precios" sheetId="2" r:id="rId7"/><sheet name="Otra" sheetId="1" r:id="rId8"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId8" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hoja equivocada</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<sst>${compartidas.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("")}</sst>`
  }, opts);
}

module.exports = { zip, xlsx };
