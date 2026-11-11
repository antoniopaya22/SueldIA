// ¿Hay una versión nueva desplegada? Con la navegación sin recarga
// (ClientRouter), una pestaña puede quedarse días con el JavaScript de un
// build anterior. Al volver a ella, se compara el id de su build con el de
// /build.json (como mucho cada 10 minutos).

const CHECK_EVERY_MS = 10 * 60_000;
let lastCheck = 0;

export function currentBuildId(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="sueldia-build"]')?.content ?? null;
}

/** true si el servidor ya tiene otro build. Nunca lanza. */
export async function isNewVersionAvailable(force = false): Promise<boolean> {
  const mine = currentBuildId();
  if (!mine || (!force && Date.now() - lastCheck < CHECK_EVERY_MS)) return false;
  lastCheck = Date.now();
  try {
    const res = await fetch("/build.json", { cache: "no-store" });
    if (!res.ok) return false;
    const { id } = (await res.json()) as { id?: string };
    return Boolean(id) && id !== mine;
  } catch {
    return false;
  }
}
