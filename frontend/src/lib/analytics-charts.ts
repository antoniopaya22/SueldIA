// Datos de los gráficos nuevos de la analítica: funciones puras (sin React ni
// red) que convierten lo que devuelve la API en la forma que pinta cada gráfico.

const pad = (n: number) => String(n).padStart(2, "0");
const roundCents = (n: number) => Math.round(n * 100) / 100;

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const abs = y * 12 + (m - 1) + delta;
  return `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// ─── Ritmo de gasto del mes ─────────────────────────────────────
export interface DailyPoint {
  date: string;
  income: number;
  expense: number;
  count: number;
}

export interface PaceRow {
  day: number;
  /** Acumulado de este mes hasta hoy (null después de hoy). */
  current: number | null;
  /** Acumulado del mes anterior (null si ese mes no tuvo gasto). */
  previous: number | null;
  /** Media de los 3 meses anteriores con gasto (null si no hay ninguno). */
  average: number | null;
  /** Proyección a ritmo actual desde hoy hasta fin de mes (null antes de hoy). */
  projection: number | null;
}

export interface PaceSummary {
  month: string;
  today: number;
  spent: number;
  previousSameDay: number | null;
  /** spent − lo que llevabas el mes pasado a esta altura. */
  diff: number | null;
  diffPct: number | null;
  projectedEnd: number;
  previousTotal: number | null;
  averageTotal: number | null;
}

/** Acumulado diario de un mes: un valor por día, también los sin gasto. */
function cumulativeByDay(daily: DailyPoint[], month: string, upToDay: number): number[] {
  const byDay = new Map<number, number>();
  for (const d of daily) if (d.date.startsWith(`${month}-`)) byDay.set(Number(d.date.slice(8, 10)), d.expense);
  const out: number[] = [];
  let sum = 0;
  for (let day = 1; day <= upToDay; day++) {
    sum += byDay.get(day) ?? 0;
    out.push(roundCents(sum));
  }
  return out;
}

/**
 * Gasto acumulado de este mes frente al mes anterior y a la media de los tres
 * anteriores, día a día, más la proyección a fin de mes si sigues a este ritmo.
 * `daily` debe cubrir desde el primer día de hace 3 meses hasta hoy.
 */
export function buildPace(daily: DailyPoint[], todayIso: string): { rows: PaceRow[]; summary: PaceSummary } {
  const month = todayIso.slice(0, 7);
  const today = Number(todayIso.slice(8, 10));
  const total = daysInMonth(month);

  const current = cumulativeByDay(daily, month, today);
  const prevMonth = shiftMonth(month, -1);
  const prevAll = cumulativeByDay(daily, prevMonth, daysInMonth(prevMonth));
  const previousHasData = (prevAll[prevAll.length - 1] ?? 0) > 0;

  // Media: de los 3 meses anteriores, solo los que tuvieron gasto (un mes en blanco no debe bajar la media).
  const priorCurves = [1, 2, 3]
    .map((k) => shiftMonth(month, -k))
    .map((m) => cumulativeByDay(daily, m, daysInMonth(m)))
    .filter((curve) => (curve[curve.length - 1] ?? 0) > 0);
  const valueAt = (curve: number[], day: number) => curve[Math.min(day, curve.length) - 1];

  const spent = current[today - 1] ?? 0;
  const rate = today > 0 ? spent / today : 0;

  const rows: PaceRow[] = [];
  for (let day = 1; day <= 31; day++) {
    if (day > Math.max(total, daysInMonth(prevMonth))) break;
    rows.push({
      day,
      current: day <= today ? current[day - 1] : null,
      previous: previousHasData && day <= daysInMonth(prevMonth) ? prevAll[day - 1] : null,
      average: priorCurves.length ? roundCents(priorCurves.reduce((s, c) => s + valueAt(c, day), 0) / priorCurves.length) : null,
      // Desde hoy (empalma con la línea real) hasta fin de mes.
      projection: day >= today && day <= total ? roundCents(day === today ? spent : rate * day) : null,
    });
  }

  const previousSameDay = previousHasData ? valueAt(prevAll, today) : null;
  const diff = previousSameDay === null ? null : roundCents(spent - previousSameDay);
  return {
    rows,
    summary: {
      month,
      today,
      spent,
      previousSameDay,
      diff,
      diffPct: previousSameDay && previousSameDay > 0 ? roundCents(((spent - previousSameDay) / previousSameDay) * 100) : null,
      projectedEnd: roundCents(rate * total),
      previousTotal: previousHasData ? prevAll[prevAll.length - 1] : null,
      averageTotal: priorCurves.length ? roundCents(priorCurves.reduce((s, c) => s + c[c.length - 1], 0) / priorCurves.length) : null,
    },
  };
}

// ─── Cascada: de los ingresos al ahorro ─────────────────────────
export interface WaterfallStep {
  name: string;
  /** Barra flotante [desde, hasta]. */
  range: [number, number];
  kind: "income" | "expense" | "result";
  /** Cambio que aporta (con signo) o, en el resultado, el total. */
  value: number;
}

/** Ingresos, lo que se llevan los principales grupos de gasto, "Otros" y el resultado (ahorro o déficit). */
export function buildWaterfall(income: number, groups: { name: string; total: number }[], limit: number): WaterfallStep[] {
  const sorted = [...groups].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((s, g) => s + g.total, 0);
  const steps: WaterfallStep[] = [{ name: "Ingresos", range: [0, roundCents(income)], kind: "income", value: roundCents(income) }];
  let running = income;
  for (const g of [...top, ...(rest > 0 ? [{ name: "Otros", total: rest }] : [])]) {
    const next = running - g.total;
    steps.push({ name: g.name, range: [roundCents(Math.min(running, next)), roundCents(Math.max(running, next))], kind: "expense", value: -roundCents(g.total) });
    running = next;
  }
  const result = roundCents(running);
  steps.push({ name: result >= 0 ? "Ahorro" : "Déficit", range: [Math.min(0, result), Math.max(0, result)], kind: "result", value: result });
  return steps;
}

// ─── Sankey: ingresos → grupos de gasto (+ ahorro) ──────────────
export interface SankeyData {
  nodes: { name: string; kind: "source" | "group" | "saving" }[];
  links: { source: number; target: number; value: number }[];
}

/**
 * Flujo del dinero: de dónde sale (ingresos y, si se gasta más de lo que
 * entra, "Desde ahorros previos") y a dónde va (grupos de gasto y ahorro).
 * Cuando hay déficit, cada fuente reparte su parte en proporción a lo que
 * se lleva cada destino, para que lo que entra en cada nodo sea igual a lo que sale.
 */
export function buildSankey(income: number, groups: { name: string; total: number }[], limit: number): SankeyData {
  const sorted = [...groups].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, limit).map((g) => ({ name: g.name, total: g.total }));
  const rest = sorted.slice(limit).reduce((s, g) => s + g.total, 0);
  if (rest > 0) top.push({ name: "Otros", total: rest });

  const expense = top.reduce((s, g) => s + g.total, 0);
  const net = income - expense;
  const destinations: { name: string; value: number; kind: "group" | "saving" }[] = top.map((g) => ({ name: g.name, value: g.total, kind: "group" }));
  if (net > 0.005) destinations.push({ name: "Ahorro", value: net, kind: "saving" });

  const sources: { name: string; value: number }[] = [];
  if (income > 0) sources.push({ name: "Ingresos", value: income });
  if (net < -0.005) sources.push({ name: "Desde ahorros previos", value: -net });

  const nodes: SankeyData["nodes"] = [
    ...sources.map((s) => ({ name: s.name, kind: "source" as const })),
    ...destinations.map((d) => ({ name: d.name, kind: d.kind })),
  ];
  const outTotal = destinations.reduce((s, d) => s + d.value, 0);
  const links: SankeyData["links"] = [];
  sources.forEach((src, si) => {
    destinations.forEach((dst, di) => {
      const value = roundCents((src.value * dst.value) / outTotal);
      if (value > 0) links.push({ source: si, target: sources.length + di, value });
    });
  });
  return { nodes, links };
}

// ─── Treemap ────────────────────────────────────────────────────
export interface TreemapNode {
  name: string;
  size?: number;
  children?: TreemapNode[];
}

/** Gasto (o ingreso) como bloques: grupos que contienen sus categorías, por tamaño. */
export function buildTreemap(items: { groupName: string; categoryName: string; total: number }[]): TreemapNode[] {
  const byGroup = new Map<string, TreemapNode[]>();
  for (const item of items) {
    if (item.total <= 0) continue;
    byGroup.set(item.groupName, [...(byGroup.get(item.groupName) ?? []), { name: item.categoryName, size: roundCents(item.total) }]);
  }
  return [...byGroup.entries()]
    .map(([name, children]) => ({ name, children: children.sort((a, b) => (b.size ?? 0) - (a.size ?? 0)) }))
    .sort((a, b) => sumSize(b) - sumSize(a));
}

export const sumSize = (node: TreemapNode): number =>
  node.children ? node.children.reduce((s, c) => s + sumSize(c), 0) : node.size ?? 0;

// ─── Calendario de calor ────────────────────────────────────────
export interface CalendarCell {
  date: string;
  value: number;
  count: number;
}

export interface CalendarData {
  /** Semanas de lunes a domingo; null = día fuera del rango. */
  weeks: (CalendarCell | null)[][];
  max: number;
  total: number;
  /** Etiqueta de mes sobre la primera semana en que empieza. */
  monthLabels: { week: number; label: string }[];
}

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Cuadrícula de semanas entre dos fechas (como mucho `maxWeeks`, las más recientes), con el valor de cada día. */
export function buildCalendar(
  daily: DailyPoint[],
  from: string,
  to: string,
  metric: "expense" | "income",
  maxWeeks = 53,
): CalendarData {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const end = new Date(`${to}T00:00:00`);
  let start = new Date(`${from}T00:00:00`);
  // Retrocede al lunes de la semana de inicio y recorta a las últimas `maxWeeks` semanas.
  const mondayOf = (d: Date) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
    return copy;
  };
  start = mondayOf(start);
  const earliest = mondayOf(end);
  earliest.setDate(earliest.getDate() - (maxWeeks - 1) * 7);
  if (start < earliest) start = earliest;

  const weeks: (CalendarCell | null)[][] = [];
  const monthLabels: CalendarData["monthLabels"] = [];
  let max = 0;
  let total = 0;
  let lastMonth = "";
  for (const cursor = new Date(start); cursor <= end; ) {
    const week: (CalendarCell | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = toIso(cursor);
      const inRange = cursor >= new Date(`${from}T00:00:00`) && cursor <= end;
      const point = byDate.get(iso);
      const value = point ? point[metric] : 0;
      week.push(inRange ? { date: iso, value, count: point?.count ?? 0 } : null);
      if (inRange) {
        max = Math.max(max, value);
        total += value;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const firstReal = week.find((c) => c);
    const month = firstReal?.date.slice(0, 7) ?? "";
    if (month && month !== lastMonth) {
      monthLabels.push({ week: weeks.length, label: MONTH_SHORT[Number(month.slice(5, 7)) - 1] });
      lastMonth = month;
    }
    weeks.push(week);
  }
  return { weeks, max: roundCents(max), total: roundCents(total), monthLabels };
}

// ─── Comparativa interanual ─────────────────────────────────────
export interface YearOverYear {
  /** Años presentes, del más antiguo al más reciente. */
  years: string[];
  /** Un elemento por mes (ene…dic) con una clave por año. */
  rows: ({ label: string } & Record<string, number | string | null>)[];
}

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Cada año como una serie sobre los mismos 12 meses; los meses sin datos (futuros o anteriores al primer movimiento) quedan en null. */
export function buildYearOverYear(
  monthly: { month: string; income: number; expenses: number; savings: number }[],
  metric: "expenses" | "income" | "savings",
  lastMonth: string,
): YearOverYear {
  const active = monthly.filter((m) => m.income > 0 || m.expenses > 0);
  const years = [...new Set(active.map((m) => m.month.slice(0, 4)))].sort();
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const rows = MONTH_LABELS.map((label, i) => {
    const row: { label: string } & Record<string, number | string | null> = { label };
    for (const year of years) {
      const key = `${year}-${pad(i + 1)}`;
      const entry = byMonth.get(key);
      row[year] = entry && key <= lastMonth && (entry.income > 0 || entry.expenses > 0) ? entry[metric] : null;
    }
    return row;
  });
  return { years, rows };
}

// ─── Presupuesto frente a gasto real ────────────────────────────
export interface BudgetBar {
  name: string;
  /** Con lo que se contaba: arrastre + asignado. */
  budget: number;
  spent: number;
  over: boolean;
}

/** Categorías con presupuesto o gasto este mes, de mayor a menor importe. */
export function buildBudgetBars(
  groups: { categories: { name: string; assigned: number; activity: number; available: number; carryIn: number }[] }[],
  limit: number,
): BudgetBar[] {
  return groups
    .flatMap((g) => g.categories)
    .map((c) => ({
      name: c.name,
      budget: roundCents(Math.max(0, c.carryIn + c.assigned)),
      spent: roundCents(Math.max(0, -c.activity)),
      over: c.available < -0.005,
    }))
    .filter((b) => b.budget > 0 || b.spent > 0)
    .sort((a, b) => Math.max(b.budget, b.spent) - Math.max(a.budget, a.spent))
    .slice(0, limit);
}
