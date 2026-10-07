import cors from "cors";
import type { Request } from "express";

// El frontend llama a /api en su propio dominio (rewrite de Vercel), y el
// navegador manda la cabecera Origin en toda petición de escritura (POST,
// PUT, PATCH, DELETE) aunque sea del mismo origen. Por eso el mismo origen
// se acepta siempre, sin depender de configurar CORS_ORIGIN con cada dominio
// (producción, alias, previews): antes, sin esa variable en Vercel, toda
// escritura desde la web devolvía "Origen no permitido".
// CORS_ORIGIN queda para orígenes extra (p. ej. el frontend en local).

/** Hosts con los que llega la petición: el público (tras el proxy) y el directo. */
export function requestHosts(req: Pick<Request, "headers">): string[] {
  const hosts: string[] = [];
  const forwarded = req.headers["x-forwarded-host"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedValue) hosts.push(...forwardedValue.split(",").map((h) => h.trim()));
  if (req.headers.host) hosts.push(req.headers.host);
  return hosts.filter(Boolean).map((h) => h.toLowerCase());
}

export function isOriginAllowed(origin: string | undefined, hosts: string[], allowedOrigins: string[]): boolean {
  // Sin cabecera Origin (GET del mismo origen, curl, health checks, servidor-servidor).
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return hosts.includes(originHost);
}

export function corsMiddleware(allowedOrigins: string[]) {
  return cors((req, callback) => {
    const request = req as Request;
    const allowed = isOriginAllowed(request.headers.origin, requestHosts(request), allowedOrigins);
    if (allowed) callback(null, { origin: true });
    else callback(new Error("No permitido por CORS"));
  });
}
