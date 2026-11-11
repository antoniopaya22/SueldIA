// «Ver como»: ver en solo lectura los datos de alguien que los ha compartido
// contigo (Ajustes → Compartir). Se recuerda en este navegador; api.ts manda
// la cabecera X-View-As en cada petición y el backend sirve los datos del
// titular sin dejar cambiar nada.

const KEY = "sueldia-view-as";

export interface ViewAs {
  id: number;
  name: string;
}

export function getViewAs(): ViewAs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ViewAs;
    return Number.isInteger(v?.id) && v.id > 0 ? v : null;
  } catch {
    return null;
  }
}

export function viewAsHeader(): Record<string, string> {
  const v = typeof window === "undefined" ? null : getViewAs();
  return v ? { "X-View-As": String(v.id) } : {};
}

/** Empieza a ver los datos de `owner` (o vuelve a los propios con null) y recarga la app. */
export function switchViewAs(owner: ViewAs | null, href = "/app"): void {
  try {
    if (owner) localStorage.setItem(KEY, JSON.stringify(owner));
    else localStorage.removeItem(KEY);
  } catch {
    // sin almacenamiento no se puede ver a otro: se queda en los propios
  }
  // Recarga completa: la caché de React Query es de los datos de antes.
  window.location.href = href;
}
