// ============================================================================
// GPUnlock · Crea las cuentas (correo + contraseña) de todas las personas que
// tienen un rol en public.user_roles y todavía no tienen cuenta.
//
//   node crear_usuarios.mjs              → simulación: lista qué cuentas crearía
//   node crear_usuarios.mjs --ejecutar   → las crea y guarda las contraseñas
//                                          iniciales en credenciales-iniciales.csv
//
// Cada contraseña es aleatoria y única. Entrégala a cada persona por un canal
// privado y pídele que la cambie en Panel → Mi cuenta (los asesores pueden
// usar "Olvidé mi contraseña" una vez configurado el correo SMTP).
// Borra credenciales-iniciales.csv cuando termines. Nunca lo subas a GitHub.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.join(DIR, ".env"), "utf8").split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, "")]));
if (!env.NUEVO_URL || !env.NUEVO_SERVICE_KEY) { console.error("Faltan NUEVO_URL y NUEVO_SERVICE_KEY en scripts/.env"); process.exit(1); }
const EJECUTAR = process.argv.includes("--ejecutar");
const sb = createClient(env.NUEVO_URL, env.NUEVO_SERVICE_KEY, { auth: { persistSession: false } });

// Contraseña legible (sin caracteres ambiguos como 0/O, 1/l), 14 caracteres.
function clave() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(14), b => a[b % a.length]).join("");
}

const { data: roles, error } = await sb.from("user_roles").select("email, role").order("role");
if (error) { console.error("No se pudo leer user_roles:", error.message); process.exit(1); }

const existentes = new Set();
for (let page = 1; ; page++) {
  const { data } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  data.users.forEach(u => existentes.add((u.email || "").toLowerCase()));
  if (data.users.length < 1000) break;
}

const pendientes = roles.filter(r => !existentes.has(r.email));
console.log(roles.length + " personas con rol · " + (roles.length - pendientes.length) + " ya tienen cuenta · " + pendientes.length + " por crear");
pendientes.forEach(r => console.log("  - " + r.email + " (" + r.role + ")"));
if (!EJECUTAR || !pendientes.length) { if (!EJECUTAR) console.log("\nSimulación. Agrega --ejecutar para crearlas."); process.exit(0); }

const filas = ["correo,rol,contraseña_inicial"];
for (const r of pendientes) {
  const password = clave();
  const res = await sb.auth.admin.createUser({ email: r.email, password, email_confirm: true });
  if (res.error) { console.log("  ! " + r.email + ": " + res.error.message); continue; }
  filas.push([r.email, r.role, password].join(","));
  console.log("  ✓ " + r.email);
}
const out = path.join(DIR, "credenciales-iniciales.csv");
fs.writeFileSync(out, filas.join("\n") + "\n", { mode: 0o600 });
console.log("\nContraseñas iniciales guardadas en " + out + " (bórralo después de entregarlas).");
