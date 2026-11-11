// OCR en el navegador para nóminas escaneadas (PDF sin texto). Todo ocurre en
// el dispositivo del usuario: el PDF se pinta con pdfjs y se lee con
// tesseract.js (WebAssembly). Solo el texto resultante va al servidor.
// Este módulo se carga a demanda (import() al pulsar el botón): pesa varios MB.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface OcrProgress {
  /** 0–1 */
  progress: number;
  label: string;
}

const MAX_PAGES = 4; // una nómina rara vez pasa de dos páginas
const SCALE = 2.5; // ~180 ppp: Tesseract lee bien a partir de 150–300

/** Pinta cada página del PDF en un canvas y la pasa por Tesseract (español). */
export async function ocrPdf(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, { createWorker, OEM }] = await Promise.all([
    import("pdfjs-dist"),
    import("tesseract.js"),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;
  onProgress?.({ progress: 0, label: "Preparando el lector…" });

  const worker = await createWorker("spa", OEM.LSTM_ONLY, {
    // Todo desde nuestro dominio (ver scripts/copy-ocr-assets.mjs).
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false,
  });
  // Las tablas de una nómina: respetar los espacios entre columnas ayuda al analizador.
  await worker.setParameters({ preserve_interword_spaces: "1" });

  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const texts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      onProgress?.({ progress: (i - 1) / pages, label: pages > 1 ? `Leyendo la página ${i} de ${pages}…` : "Leyendo la nómina…" });
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      texts.push(data.text);
      page.cleanup();
      canvas.width = 0; // libera la memoria del bitmap
    }
    onProgress?.({ progress: 1, label: "Listo" });
    return texts.join("\n");
  } finally {
    await task.destroy();
    await worker.terminate();
  }
}
