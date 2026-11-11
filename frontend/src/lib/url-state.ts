import { useCallback, useSyncExternalStore } from "react";

// Estado de pantalla en la URL (?filtro=…): se puede compartir, sobrevive a
// una recarga y el botón Atrás deshace un cambio de vista (p. ej. del detalle
// de una nómina a la lista).
//
// Convive con el ClientRouter de Astro:
// - Siempre se conserva history.state (ahí guarda Astro su índice).
// - Un Atrás/Adelante que solo cambia la query de la página que se está
//   viendo lo resolvemos aquí (fase de captura, antes que Astro) para no
//   recargar la página entera; si cambia de página, lo gestiona Astro.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

let displayedPath = typeof window !== "undefined" ? window.location.pathname : "";

if (typeof window !== "undefined") {
  document.addEventListener("astro:after-swap", () => {
    displayedPath = window.location.pathname;
    notify();
  });
  window.addEventListener(
    "popstate",
    (e) => {
      if (window.location.pathname === displayedPath) {
        e.stopImmediatePropagation();
        notify();
      }
    },
    { capture: true },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSearch = () => window.location.search;
const getServerSearch = () => "";

/** La query actual (`?a=1&b=2`) como estado de React; "" durante la hidratación. */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, getSearch, getServerSearch);
}

/** Escribe una URL ya construida (misma página) y avisa a quien la lee. */
export function writeUrl(url: URL, options: SetParamOptions = {}) {
  if (url.href === window.location.href) return;
  if (options.push) window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
  notify();
}

export interface SetParamOptions {
  /** Añade una entrada al historial (Atrás vuelve al estado anterior). Por defecto se reemplaza. */
  push?: boolean;
}

/** Cambia varios parámetros a la vez (null/"" los borra). */
export function setUrlParams(values: Record<string, string | number | null | undefined>, options: SetParamOptions = {}) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  writeUrl(url, options);
}

/**
 * Un parámetro de la URL como estado de React. Durante la hidratación vale
 * `fallback` (la página es estática y se generó sin URL); después, el valor real.
 */
export function useUrlParam(name: string, fallback = ""): [string, (value: string | number | null, options?: SetParamOptions) => void] {
  const search = useLocationSearch();
  const value = new URLSearchParams(search).get(name) ?? fallback;
  const set = useCallback(
    (next: string | number | null, options?: SetParamOptions) =>
      // El valor por defecto no se escribe: URLs limpias.
      setUrlParams({ [name]: next === null || String(next) === fallback ? null : next }, options),
    [name, fallback],
  );
  return [value, set];
}

/** Variante numérica (enteros positivos); fuera de rango → fallback. */
export function useUrlIntParam(name: string, fallback: number): [number, (value: number | null, options?: SetParamOptions) => void] {
  const [raw, setRaw] = useUrlParam(name, String(fallback));
  const n = Number(raw);
  const value = Number.isInteger(n) && n > 0 ? n : fallback;
  return [value, setRaw as (value: number | null, options?: SetParamOptions) => void];
}

/** Variante de lista cerrada de valores; lo que no está en la lista → fallback. */
export function useUrlEnumParam<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T, options?: SetParamOptions) => void] {
  const [raw, setRaw] = useUrlParam(name, fallback);
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  return [value, setRaw as (value: T, options?: SetParamOptions) => void];
}

/** Id opcional (entero positivo) en la URL; ausente o inválido → undefined. */
export function useUrlOptionalIdParam(name: string): [number | undefined, (value: number | undefined) => void] {
  const [raw] = useUrlParam(name);
  const n = Number(raw);
  const value = raw && Number.isInteger(n) && n > 0 ? n : undefined;
  const set = useCallback((next: number | undefined) => setUrlParams({ [name]: next ?? null }), [name]);
  return [value, set];
}
