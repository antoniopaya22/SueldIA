import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    logger.warn({ statusCode: err.statusCode, message: err.message }, "Operational error");
    return res.status(err.statusCode).json({ error: err.message });
  }

  // JSON mal formado en el cuerpo (express.json): es un error del cliente, no un 500.
  if ((err as Error & { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "El cuerpo de la petición no es un JSON válido" });
  }
  if ((err as Error & { type?: string }).type === "entity.too.large") {
    return res.status(413).json({ error: "La petición es demasiado grande" });
  }

  if (err.message === "No permitido por CORS") {
    logger.warn("Origen rechazado por CORS");
    return res.status(403).json({ error: "Origen no permitido" });
  }

  // Multer errors
  if (err.name === "MulterError") {
    logger.warn({ message: err.message }, "Upload error");
    const message =
      (err as Error & { code?: string }).code === "LIMIT_FILE_SIZE"
        ? "El archivo es demasiado grande"
        : "No se pudo recibir el archivo";
    return res.status(400).json({ error: message });
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Error interno del servidor" });
}
