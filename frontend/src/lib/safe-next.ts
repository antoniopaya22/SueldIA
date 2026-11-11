/**
 * Ruta a la que volver tras iniciar sesión (`?next=`). Solo se aceptan rutas
 * internas de la app: nada de `//otro-dominio`, `https://…` ni `\\` — si no,
 * el enlace de login serviría para redirigir a cualquier sitio.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/app"): string {
  if (!raw) return fallback;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!path.startsWith("/app") || path.startsWith("//") || path.includes("\\")) return fallback;
  if (path !== "/app" && !path.startsWith("/app/") && !path.startsWith("/app?")) return fallback;
  try {
    // Debe seguir siendo del mismo origen una vez resuelta.
    const url = new URL(path, "https://sueldia.local");
    if (url.origin !== "https://sueldia.local") return fallback;
    // Y dentro de /app tras resolver "..".
    if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
