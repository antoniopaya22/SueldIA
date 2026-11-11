import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler.js";

// PDF magic bytes: %PDF
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new AppError(400, "Solo se permiten archivos PDF"));
  }
};

// Vercel Functions rechaza cualquier petición de más de 4.5MB de cuerpo
// (límite fijo de la plataforma, no configurable) — el frontend ya sube un
// PDF por petición (UploadPage.tsx), así que el límite real es el de un
// solo fichero. 4MB deja margen para la codificación multipart/form-data.
const MAX_UPLOAD_SIZE = 4 * 1024 * 1024;

const multerUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

// busboy (el parser multipart que usa multer) decodifica el campo filename
// como latin1 por defecto, aunque el navegador mande UTF-8 — los nombres con
// tildes/ñ llegan con mojibake ("NÃ³mina") si no se revierte aquí.
export function fixFilenameEncoding(req: Request, _res: Response, next: NextFunction) {
  const files = req.files as Express.Multer.File[] | undefined;
  for (const file of files ?? []) {
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
  }
  next();
}

// Post-upload validation: check actual file magic bytes
export function validatePdfMagicBytes(req: Request, _res: Response, next: NextFunction) {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) return next();

  for (const file of files) {
    const header = file.buffer.subarray(0, 4);
    if (!header.equals(PDF_MAGIC)) {
      return next(new AppError(400, "El archivo no es un PDF válido"));
    }
  }
  next();
}

export const upload = multerUpload;

// ─── CSV Upload (for YNAB import) ───────────────────────────────
// Por extensión: el navegador no manda un MIME fiable para .tsv (el export
// "Register" de YNAB), a menudo vacío o application/octet-stream.
const CSV_EXTENSIONS = [".csv", ".tsv", ".txt"];

const csvFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const name = file.originalname.toLowerCase();
  const allowed =
    CSV_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
    file.mimetype === "text/csv" ||
    file.mimetype === "text/tab-separated-values";
  if (allowed) {
    cb(null, true);
  } else {
    cb(new AppError(400, "Solo se permiten archivos CSV, TSV o TXT"));
  }
};

// Mismo límite de 4.5MB de Vercel Functions que arriba — un CSV/TSV de YNAB
// de varios años de movimientos raramente pasa de 1-2MB, así que 4MB es
// generoso sin arriesgarse a un 413 en producción.
export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  fileFilter: csvFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE },
});
