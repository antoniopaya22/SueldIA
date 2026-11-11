// Post-build: añade a cada HTML de dist/ una Content-Security-Policy con el
// hash de cada <script> en línea que contiene (hidratación de islas de Astro,
// tema, service worker…). Así script-src no necesita 'unsafe-inline' y un XSS
// no podría ejecutar código aunque consiguiera inyectar un <script> — importa
// porque el token de sesión de Supabase vive en localStorage.
//
// Va como <meta> porque el sitio es estático (vercel.json no puede calcular
// hashes); lo que una meta no admite (frame-ancestors, HSTS…) está en las
// cabeceras de vercel.json. Los estilos siguen con 'unsafe-inline': React usa
// atributos style y con hashes en style-src quedarían bloqueados.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : null;

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
const INLINE_HANDLER = /\son[a-z]+=["']/i;

let files = 0;
for (const file of htmlFiles(DIST)) {
  let html = readFileSync(file, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) continue;
  if (INLINE_HANDLER.test(html.replace(INLINE_SCRIPT, ""))) {
    throw new Error(`${file}: manejador de eventos en línea (onclick=…) — la CSP lo bloquearía. Usa addEventListener.`);
  }

  const hashes = new Set();
  for (const [, attrs, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/type=["']application\/(ld\+)?json["']/.test(attrs)) continue; // datos, no se ejecutan
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }

  const policy = [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  // Lo antes posible en <head>: la política solo cubre lo que viene después.
  const charset = html.match(/<meta charset="[^"]*"\s*\/?>/i);
  html = charset ? html.replace(charset[0], `${charset[0]}${meta}`) : html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`);
  writeFileSync(file, html);
  files++;
}

if (!supabaseOrigin) console.warn("⚠️  PUBLIC_SUPABASE_URL no definida: connect-src no incluirá Supabase y el login fallará.");
console.log(`🔒 CSP añadida a ${files} páginas`);
