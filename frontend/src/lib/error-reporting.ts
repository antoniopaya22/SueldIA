import { getAuthToken } from "./api";

// Envía los errores del navegador a los logs del backend (POST /api/client-errors).
// Nunca lanza ni reintenta: si falla, se pierde el informe, no la página.

type Source = "boundary" | "window" | "promise";

const sent = new Set<string>();

// Desajustes de hidratación que React ya corrige solo (vuelve a pintar la isla
// en el cliente). Son esperables con el ClientRouter: al navegar, la caché de
// React Query ya tiene datos y la página se pinta directamente con ellos, no
// con el esqueleto del HTML estático. No es un error para el usuario y
// llenaba los logs en cada navegación. (#418/#423/#425 en producción.)
const HYDRATION = /Hydration failed|hydrat|Minified React error #(418|423|425)\b/i;

export async function reportClientError(error: unknown, source: Source, componentStack?: string): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    if (HYDRATION.test(err.message)) return;
    // Un mismo error repetido en bucle se manda una vez por página.
    const key = `${source}:${err.message}`;
    if (sent.has(key) || sent.size > 20) return;
    sent.add(key);
    const token = await getAuthToken();
    if (!token) return; // el endpoint requiere sesión
    await fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: err.message.slice(0, 500),
        stack: err.stack?.slice(0, 4000),
        componentStack: componentStack?.slice(0, 4000),
        url: location.href.slice(0, 500),
        source,
      }),
    });
  } catch {
    // nada: informar de un error no puede provocar otro
  }
}

let installed = false;

/** Escucha errores no capturados de toda la página (una sola vez). */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Errores de carga de recursos (img, script) no traen `error`: se ignoran.
    if (e.error) void reportClientError(e.error, "window");
  });
  window.addEventListener("unhandledrejection", (e) => void reportClientError(e.reason, "promise"));
}
