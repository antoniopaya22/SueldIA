// Leer/escribir un parámetro numérico de la URL sin recargar la página
// (window.history.replaceState) — usado para que una selección (perfil,
// nómina abierta...) sea compartible/recargable, sin meter un router.
//
// Siempre `replaceState(window.history.state, …)`, nunca `null`: el
// ClientRouter de Astro guarda su índice en history.state y, si se borra, el
// botón Atrás cambia la URL pero deja la página anterior en pantalla.

export function readIntParam(name: string): number | null {
  if (typeof window === "undefined") return null;
  const v = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function setIntParam(name: string, value: number | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, String(value));
  else url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}
