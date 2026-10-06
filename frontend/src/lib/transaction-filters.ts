// Los filtros de Transacciones viven en la URL (?cuenta=2&categoria=7&desde=…):
// se pueden compartir, sobreviven a un refresco y, sobre todo, permiten que
// cualquier gráfico o ranking enlace al detalle de lo que muestra
// (`transactionsHref`). Nombres en español, como el resto de la interfaz.

export type TxFilterType = "expense" | "income" | "transfer";

export interface TxUrlFilters {
  accountId?: number;
  search?: string;
  type?: TxFilterType;
  categoryId?: number;
  groupId?: number;
  from?: string;
  to?: string;
  cleared?: "true" | "false";
  uncategorized?: boolean;
  minAmount?: number;
  maxAmount?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_PARAM = { true: "liquidadas", false: "pendientes" } as const;

const positiveInt = (v: string | null): number | undefined => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n > 0 ? n : undefined;
};
const amount = (v: string | null): number | undefined => {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const isoDate = (v: string | null) => (v && ISO_DATE.test(v) ? v : undefined);

export function parseTxFilters(search: string): TxUrlFilters {
  const p = new URLSearchParams(search);
  const type = p.get("tipo");
  const state = p.get("estado");
  const filters: TxUrlFilters = {
    accountId: positiveInt(p.get("cuenta")),
    search: p.get("buscar")?.trim() || undefined,
    type: type === "expense" || type === "income" || type === "transfer" ? type : undefined,
    categoryId: positiveInt(p.get("categoria")),
    groupId: positiveInt(p.get("grupo")),
    from: isoDate(p.get("desde")),
    to: isoDate(p.get("hasta")),
    cleared: state === STATE_PARAM.true ? "true" : state === STATE_PARAM.false ? "false" : undefined,
    uncategorized: p.get("sin_categoria") === "1" ? true : undefined,
    minAmount: amount(p.get("min")),
    maxAmount: amount(p.get("max")),
  };
  // Solo claves con valor: así `{}` es "sin filtros" y se compara fácil.
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as TxUrlFilters;
}

const FILTER_PARAMS = ["cuenta", "buscar", "tipo", "categoria", "grupo", "desde", "hasta", "estado", "sin_categoria", "min", "max"];

function applyFilters(params: URLSearchParams, f: TxUrlFilters) {
  for (const name of FILTER_PARAMS) params.delete(name);
  if (f.accountId) params.set("cuenta", String(f.accountId));
  if (f.search) params.set("buscar", f.search);
  if (f.type) params.set("tipo", f.type);
  if (f.categoryId) params.set("categoria", String(f.categoryId));
  if (f.groupId) params.set("grupo", String(f.groupId));
  if (f.from) params.set("desde", f.from);
  if (f.to) params.set("hasta", f.to);
  if (f.cleared) params.set("estado", STATE_PARAM[f.cleared]);
  if (f.uncategorized) params.set("sin_categoria", "1");
  if (f.minAmount !== undefined) params.set("min", String(f.minAmount));
  if (f.maxAmount !== undefined) params.set("max", String(f.maxAmount));
}

/** Enlace a Transacciones ya filtrado (para gráficos, rankings, presupuesto…). */
export function transactionsHref(filters: TxUrlFilters): string {
  const params = new URLSearchParams();
  applyFilters(params, filters);
  const query = params.toString();
  return `/app/transactions${query ? `?${query}` : ""}`;
}

/** Escribe los filtros en la URL actual sin recargar ni añadir entradas al historial. */
export function writeTxFilters(filters: TxUrlFilters) {
  const url = new URL(window.location.href);
  applyFilters(url.searchParams, filters);
  window.history.replaceState(null, "", url);
}

// ─── Periodos ───────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Primer y último día de un mes "YYYY-MM". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return { from: `${y}-${pad(m)}-01`, to: iso(new Date(y, m, 0)) };
}

export type PeriodKey = "this-month" | "last-month" | "3m" | "year";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "this-month": "Este mes",
  "last-month": "Mes pasado",
  "3m": "3 meses",
  year: "Este año",
};

export function periodRange(key: PeriodKey, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case "this-month":
      return { from: iso(new Date(y, m, 1)), to: iso(today) };
    case "last-month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "3m":
      return { from: iso(new Date(y, m - 2, 1)), to: iso(today) };
    case "year":
      return { from: `${y}-01-01`, to: iso(today) };
  }
}

/** Qué preset coincide exactamente con el rango dado (para marcarlo como activo). */
export function activePeriod(from?: string, to?: string, today = new Date()): PeriodKey | null {
  if (!from || !to) return null;
  return (Object.keys(PERIOD_LABELS) as PeriodKey[]).find((k) => {
    const r = periodRange(k, today);
    return r.from === from && r.to === to;
  }) ?? null;
}
