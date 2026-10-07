/* Las dos configuraciones de Netlify del producto deben coincidir: la de la raíz (publish = "web") y la de web/
   (Base directory = web, publish = "."). Solo puede diferir la línea «publish» y los comentarios iniciales. */
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const leer = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const normal = (t) => t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#") && !/^\s*publish\s*=/.test(l)).join("\n");

assert.match(leer("netlify.toml"), /publish\s*=\s*"web"/); console.log("ok  - la raíz publica la carpeta web/");
assert.match(leer("web/netlify.toml"), /publish\s*=\s*"\."/); console.log("ok  - web/netlify.toml publica su propia carpeta");
assert.equal(normal(leer("netlify.toml")), normal(leer("web/netlify.toml"))); console.log("ok  - cabeceras y reglas idénticas en ambos archivos");
assert.match(leer("site/netlify.toml"), /publish\s*=\s*"\."/); console.log("ok  - el demo (site/) conserva su configuración para publicarse aparte");
for (const f of ["web/index.html", "web/descargar/index.html", "web/app/index.html", "web/consola/index.html", "web/css/gp-tokens.css", "web/js/config.js", "web/terminos/index.html", "web/privacidad/index.html", "web/embed/inventario.js", "web/app/js/importar.js"]) assert.ok(fs.existsSync(path.join(__dirname, "..", f)), f);
console.log("ok  - existen las páginas y archivos que sirve Netlify");
console.log("Configuración de Netlify: OK");
