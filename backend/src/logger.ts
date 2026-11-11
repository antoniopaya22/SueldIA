import pino from "pino";
import { env } from "./config.js";

export const logger = pino({
  // En tests (vitest pone NODE_ENV=test) no se escribe nada: las pruebas de
  // integración levantan la API entera y llenaban la salida.
  level: env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  // Nunca registrar credenciales: pino-http vuelca las cabeceras de cada
  // petición y el token de sesión de Supabase acababa en los logs de Vercel.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ],
    censor: "[oculto]",
  },
  transport:
    env.NODE_ENV !== "production" && env.NODE_ENV !== "test"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});
