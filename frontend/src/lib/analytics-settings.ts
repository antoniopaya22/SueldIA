// Ajustes personalizables de la analítica financiera: lo que cada panel
// recuerda (tipo de gráfico, métrica, "Top N"), qué paneles se ven y en qué
// orden, y las vistas guardadas. Todo se guarda como preferencia del usuario
// (hook usePreference) y se VALIDA al leerlo: un valor guardado que ya no
// existe (porque cambió una opción) vuelve al valor por defecto en vez de
// romper el gráfico.

import type { RangePreset } from "../components/finance/finance-ui";

// ─── Controles de cada panel ────────────────────────────────────
type Metric4 = "expense" | "income" | "net" | "count";

export interface PanelSettings {
  trendMetric: "all" | "income" | "expenses" | "net" | "count" | "savingsRate";
  trendView: "bars" | "area" | "line";
  distributionMetric: "expense" | "income";
  distributionScope: "category" | "group";
  distributionView: "donut" | "bars";
  distributionValue: "total" | "count" | "average";
  distributionLimit: number;
  payeeMetric: "expense" | "income";
  payeeValue: "total" | "count" | "average";
  payeeLimit: number;
  stackGrouping: "category" | "group";
  stackMetric: "expense" | "income";
  stackView: "bars" | "area";
  stackLimit: number;
  weekdayMetric: Metric4;
  weekdayView: "radar" | "bars";
  accountMetric: "balance" | "income" | "expenses" | "net" | "count";
  accountView: "bars" | "donut";
  accountLimit: number;
  cumulativeMetric: "net" | "income" | "expenses" | "count";
  cumulativeView: "area" | "line";
  efficiencyMetric: "savingsRate" | "avgMovement" | "netPerMovement" | "count";
  compareScope: "category" | "group";
  compareValue: "total" | "count" | "average";
  compareLimit: number;
  matrixScope: "category" | "group";
  matrixMetric: "expense" | "income";
  matrixLimit: number;
}

type Spec = { [K in keyof PanelSettings]: { default: PanelSettings[K]; allowed?: readonly PanelSettings[K][] } };

/** Valores por defecto y, en las opciones cerradas, los valores válidos. Los "Top N" son enteros entre 1 y 50. */
export const PANEL_SETTINGS_SPEC: Spec = {
  trendMetric: { default: "all", allowed: ["all", "income", "expenses", "net", "count", "savingsRate"] },
  trendView: { default: "bars", allowed: ["bars", "area", "line"] },
  distributionMetric: { default: "expense", allowed: ["expense", "income"] },
  distributionScope: { default: "category", allowed: ["category", "group"] },
  distributionView: { default: "donut", allowed: ["donut", "bars"] },
  distributionValue: { default: "total", allowed: ["total", "count", "average"] },
  distributionLimit: { default: 8 },
  payeeMetric: { default: "expense", allowed: ["expense", "income"] },
  payeeValue: { default: "total", allowed: ["total", "count", "average"] },
  payeeLimit: { default: 8 },
  stackGrouping: { default: "category", allowed: ["category", "group"] },
  stackMetric: { default: "expense", allowed: ["expense", "income"] },
  stackView: { default: "bars", allowed: ["bars", "area"] },
  stackLimit: { default: 5 },
  weekdayMetric: { default: "expense", allowed: ["expense", "income", "net", "count"] },
  weekdayView: { default: "radar", allowed: ["radar", "bars"] },
  accountMetric: { default: "balance", allowed: ["balance", "income", "expenses", "net", "count"] },
  accountView: { default: "bars", allowed: ["bars", "donut"] },
  accountLimit: { default: 6 },
  cumulativeMetric: { default: "net", allowed: ["net", "income", "expenses", "count"] },
  cumulativeView: { default: "area", allowed: ["area", "line"] },
  efficiencyMetric: { default: "savingsRate", allowed: ["savingsRate", "avgMovement", "netPerMovement", "count"] },
  compareScope: { default: "group", allowed: ["category", "group"] },
  compareValue: { default: "total", allowed: ["total", "count", "average"] },
  compareLimit: { default: 6 },
  matrixScope: { default: "category", allowed: ["category", "group"] },
  matrixMetric: { default: "expense", allowed: ["expense", "income"] },
  matrixLimit: { default: 6 },
};

export const DEFAULT_PANEL_SETTINGS = Object.fromEntries(
  Object.entries(PANEL_SETTINGS_SPEC).map(([key, spec]) => [key, spec.default]),
) as unknown as PanelSettings;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Valida lo guardado campo a campo: lo válido se conserva y lo demás vuelve a su valor por defecto. */
export function normalizePanelSettings(raw: unknown): PanelSettings {
  const out: Record<string, unknown> = { ...DEFAULT_PANEL_SETTINGS };
  if (!isPlainObject(raw)) return out as unknown as PanelSettings;
  for (const [key, spec] of Object.entries(PANEL_SETTINGS_SPEC) as [keyof PanelSettings, Spec[keyof PanelSettings]][]) {
    const value = raw[key];
    if (typeof spec.default === "number") {
      if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50) out[key] = value;
    } else if (spec.allowed && (spec.allowed as readonly unknown[]).includes(value)) {
      out[key] = value;
    }
  }
  return out as unknown as PanelSettings;
}

// ─── Paneles: registro y diseño ─────────────────────────────────
export type PanelKey =
  | "trend" | "cumulative" | "efficiency" | "distribution" | "payees" | "compare" | "weekday"
  | "stack" | "matrix" | "accounts" | "insights";

export type PanelSpan = "half" | "full";

export interface PanelInfo {
  label: string;
  description: string;
  /** Ancho por defecto: "full" ocupa toda la fila; "half" comparte fila con otro. */
  span: PanelSpan;
}

/**
 * Todos los paneles de la analítica. El orden de las claves es el diseño por
 * defecto (reproduce el de antes: Evolución, Reparto, Categorías en el tiempo,
 * Cuentas). Los paneles nuevos se añaden aquí y aparecen solos al usuario.
 */
export const PANEL_REGISTRY: Record<PanelKey, PanelInfo> = {
  trend: { label: "Pulso mensual", description: "Ingresos, gastos y ahorro de cada mes", span: "full" },
  cumulative: { label: "Acumulado", description: "La pendiente real del periodo: cuánto sumas mes a mes", span: "half" },
  efficiency: { label: "Eficiencia mensual", description: "Ahorro, importe medio por movimiento y densidad de actividad", span: "half" },
  distribution: { label: "Distribución", description: "Qué categorías o grupos concentran el dinero", span: "half" },
  payees: { label: "Beneficiarios principales", description: "A quién pagas o de quién cobras más", span: "half" },
  compare: { label: "Ingresos frente a gastos", description: "Ambas direcciones del flujo por grupo o categoría", span: "half" },
  weekday: { label: "Ritmo semanal", description: "En qué días de la semana se concentra tu actividad", span: "half" },
  stack: { label: "Tendencia por categoría", description: "El peso de cada serie mes a mes, apilado", span: "full" },
  matrix: { label: "Matriz temporal", description: "Dónde aparecen los picos por categoría y mes", span: "full" },
  accounts: { label: "Peso por cuenta", description: "Tus cuentas por saldo, ingresos, gastos, neto o volumen", span: "half" },
  insights: { label: "Lecturas rápidas", description: "Lo más destacado de tus paneles", span: "half" },
};

export interface LayoutEntry {
  key: PanelKey;
  visible: boolean;
  span: PanelSpan;
}

export const defaultLayout = (): LayoutEntry[] =>
  (Object.keys(PANEL_REGISTRY) as PanelKey[]).map((key) => ({ key, visible: true, span: PANEL_REGISTRY[key].span }));

/**
 * Diseño guardado → diseño válido: se descartan paneles que ya no existen y
 * duplicados, y los paneles nuevos (que el usuario aún no conoce) se añaden al
 * final, visibles, con su ancho por defecto.
 */
export function normalizeLayout(raw: unknown): LayoutEntry[] {
  const known = new Set(Object.keys(PANEL_REGISTRY));
  const seen = new Set<string>();
  const out: LayoutEntry[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isPlainObject(item) || typeof item.key !== "string" || !known.has(item.key) || seen.has(item.key)) continue;
      const key = item.key as PanelKey;
      seen.add(key);
      out.push({
        key,
        visible: item.visible !== false,
        span: item.span === "half" || item.span === "full" ? item.span : PANEL_REGISTRY[key].span,
      });
    }
  }
  for (const entry of defaultLayout()) if (!seen.has(entry.key)) out.push(entry);
  return out;
}

/** Mueve un panel una posición (−1 arriba, +1 abajo) sin salirse de la lista. */
export function moveEntry(layout: LayoutEntry[], key: PanelKey, delta: -1 | 1): LayoutEntry[] {
  const i = layout.findIndex((e) => e.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ─── Vistas guardadas ───────────────────────────────────────────
export interface AnalyticsView {
  id: string;
  name: string;
  /** Un preset (3M, 12M…) se mantiene relativo a hoy; "custom" usa `from`/`to` fijos. */
  preset: RangePreset | "custom";
  from?: string;
  to?: string;
  accountId?: number;
  groupId?: number;
  categoryId?: number;
}

export const MAX_VIEWS = 12;
const PRESETS = ["3m", "6m", "12m", "ytd", "all", "custom"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const positiveInt = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);

/** Vistas guardadas → vistas válidas (sin duplicados de id, con nombre, como mucho MAX_VIEWS). */
export function normalizeViews(raw: unknown): AnalyticsView[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AnalyticsView[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || typeof item.id !== "string" || seen.has(item.id)) continue;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
    if (!name || typeof item.preset !== "string" || !PRESETS.includes(item.preset)) continue;
    seen.add(item.id);
    const custom = item.preset === "custom";
    out.push({
      id: item.id,
      name,
      preset: item.preset as AnalyticsView["preset"],
      from: custom && typeof item.from === "string" && ISO.test(item.from) ? item.from : undefined,
      to: custom && typeof item.to === "string" && ISO.test(item.to) ? item.to : undefined,
      accountId: positiveInt(item.accountId),
      groupId: positiveInt(item.groupId),
      categoryId: positiveInt(item.categoryId),
    });
    if (out.length >= MAX_VIEWS) break;
  }
  return out;
}
