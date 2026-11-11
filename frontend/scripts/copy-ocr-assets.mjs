// Copia a public/ocr/ lo que necesita el OCR del navegador (tesseract.js):
// el worker, los núcleos WebAssembly y el idioma español. Se sirven desde
// nuestro dominio: la CSP no permite descargarlos de un CDN, y así el PDF y el
// OCR no dependen de terceros. Se genera en cada build (public/ocr está en .gitignore).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "ocr");
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js")],
  // El worker elige el núcleo según lo que admita el navegador (SIMD o no); solo modelos LSTM.
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [
    join(pkgDir("tesseract.js-core"), f),
    join(out, "core", f),
  ]),
  // «best_int»: más preciso que el rápido y cuatro veces más pequeño que el «best».
  [join(pkgDir("@tesseract.js-data/spa"), "4.0.0_best_int", "spa.traineddata.gz"), join(out, "lang", "spa.traineddata.gz")],
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`🔤 OCR: ${files.length} ficheros copiados a public/ocr`);
