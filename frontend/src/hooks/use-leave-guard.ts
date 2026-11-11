import { useEffect } from "react";

/**
 * Avisa antes de salir de la página mientras `active` sea true:
 * - al cerrar o recargar la pestaña, o navegar con location.href (beforeunload);
 * - al pulsar un enlace interno, que con el ClientRouter de Astro no dispara
 *   beforeunload. Se intercepta el clic en fase de captura: si se cancela,
 *   `preventDefault()` hace que el router lo ignore y no pasa nada (cancelar
 *   en `astro:before-preparation` no sirve: Astro lo convierte en una recarga
 *   completa).
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      // Enlaces que no salen de la página (anclas, misma URL) no pierden nada.
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}
