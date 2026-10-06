import type { ReactNode } from "react";
import type { Account } from "../../lib/api";
import { formatCompact, formatCurrency, formatPct } from "../../lib/format";
import { chartColors, chartPalette } from "../app";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { adaptiveColor } from "../../lib/color";
import { changeTrend } from "../../lib/analytics-compare";

// ─── Colores ────────────────────────────────────────────────────
// Mismo criterio que Inicio: ingresos en verde de marca, gastos en navy y el
// flujo neto/ahorro en ámbar. Todo son variables CSS → sigue el tema.
export const flowColors = {
  income: chartColors.primary,
  expense: chartColors.secondary,
  net: chartColors.tax,
  count: chartColors.quaternary,
  rate: chartColors.tertiary,
} as const;

export function paletteColor(index: number): string {
  return chartPalette[index % chartPalette.length];
}

export { adaptiveColor };

/** Mezcla un color (incluidas variables CSS) con transparente. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(percent)}%, transparent)`;
}

// ─── Formatos ───────────────────────────────────────────────────
export type ValueMode = "currency" | "count" | "percent";

export function valueFormatter(mode: ValueMode) {
  if (mode === "count") return (v: number) => `${Math.round(v).toLocaleString("es-ES")} mov.`;
  if (mode === "percent") return (v: number) => formatPct(v);
  return (v: number) => formatCurrency(v);
}

export function tickFormatter(mode: ValueMode) {
  if (mode === "count") {
    return (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })}k` : String(Math.round(v)));
  }
  if (mode === "percent") return (v: number) => `${Math.round(v)} %`;
  return (v: number) => formatCompact(v);
}

export function shortenLabel(value: string, maxLength = 18): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

// ─── Periodos ───────────────────────────────────────────────────
function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type RangePreset = "3m" | "6m" | "12m" | "ytd" | "all";

/** Rango de fechas de un preset; "all" devuelve un rango vacío (sin filtro). */
export function presetRange(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  const to = toDateInput(today);
  if (preset === "all") return { from: "", to: "" };
  if (preset === "ytd") return { from: `${today.getFullYear()}-01-01`, to };
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  start.setMonth(start.getMonth() - (preset === "3m" ? 2 : preset === "6m" ? 5 : 11));
  return { from: toDateInput(start), to };
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  "12m": "Últimos 12 meses",
  ytd: "Este año",
  all: "Todo el histórico",
};

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export function rangeLabel(from: string, to: string): string {
  if (from && to) return `${dateLabel(from)} – ${dateLabel(to)}`;
  if (from) return `Desde ${dateLabel(from)}`;
  if (to) return `Hasta ${dateLabel(to)}`;
  return "Todo el histórico";
}

// ─── Controles ──────────────────────────────────────────────────
export function AccountSelect({ accounts, value, onChange, className }: {
  accounts: Account[];
  value: number | undefined;
  onChange: (id: number | undefined) => void;
  className?: string;
}) {
  return (
    <Select value={value ? String(value) : "all"} onValueChange={(v) => onChange(!v || v === "all" ? undefined : Number(v))}>
      <SelectTrigger size="sm" className={cn("min-w-40 bg-card", className)} aria-label="Cuenta">
        <SelectValue>{(v: string) => (v === "all" ? "Todas las cuentas" : accounts.find((a) => String(a.id) === v)?.name ?? v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas las cuentas</SelectItem>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={String(account.id)}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: adaptiveColor(account.color, chartColors.secondary) }} />
            {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface OptionGroup {
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** Select compacto con opción "todos" (valor vacío). Admite opciones agrupadas. */
export function FilterSelect({ label, allLabel, value, onChange, options, groups, className }: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options?: Array<{ value: string; label: string }>;
  groups?: OptionGroup[];
  className?: string;
}) {
  const flat = options ?? groups?.flatMap((g) => g.options) ?? [];
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(!v || v === "all" ? "" : v)}>
      <SelectTrigger size="sm" className={cn("min-w-36 bg-card", className)} aria-label={label}>
        <SelectValue>{(v: string) => (v === "all" ? allLabel : flat.find((o) => o.value === v)?.label ?? v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options?.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
        {groups?.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Selector "Top N" de los paneles de ranking. */
export function LimitSelect({ value, onChange, options, label }: {
  value: number;
  onChange: (value: number) => void;
  options: number[];
  label: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => v && onChange(Number(v))}>
      <SelectTrigger size="sm" className="bg-card" aria-label={label}>
        <SelectValue>{(v: string) => `Top ${v}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((n) => (
          <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Leyendas y listas ──────────────────────────────────────────
export function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-full")} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function ChartLegend({ items }: { items: Array<{ color: string; label: string; line?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => <LegendDot key={item.label} {...item} />)}
    </div>
  );
}

export interface RankedItem {
  key: string;
  label: string;
  sublabel?: ReactNode;
  value: number;
  color: string;
  /** Texto a la derecha bajo el valor (porcentaje, nº de movimientos...). */
  meta?: ReactNode;
  /** Si está, la etiqueta enlaza al detalle (p. ej. Transacciones ya filtradas). */
  href?: string;
}

/** Ranking con barra proporcional: más legible que un bar chart horizontal. */
export function RankedList({ items, format, className }: {
  items: RankedItem[];
  format: (value: number) => string;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0);
  return (
    <ul className={cn("space-y-3.5", className)}>
      {items.map((item) => (
        <li key={item.key} className="group">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <p className="truncate text-sm font-medium text-foreground" title={item.href ? `Ver movimientos de ${item.label}` : item.label}>
                {item.href ? (
                  <a href={item.href} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">{item.label}</a>
                ) : item.label}
              </p>
              {item.sublabel && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{item.sublabel}</span>}
            </div>
            <div className="shrink-0 text-right">
              <span className="text-sm font-medium tabular-nums text-foreground">{format(item.value)}</span>
              {item.meta && <span className="ml-2 text-xs tabular-nums text-muted-foreground">{item.meta}</span>}
            </div>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${max > 0 ? Math.max((Math.abs(item.value) / max) * 100, 2) : 0}%`, backgroundColor: item.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Cambio frente al periodo anterior junto a un valor. `goodWhen` dice qué
 * dirección es buena (en gastos, bajar); sin base de comparación → "nuevo".
 */
export function ChangeBadge({ change, goodWhen }: { change: number | null | undefined; goodWhen: "up" | "down" }) {
  if (change === undefined) return null;
  if (change === null) return <span className="rounded bg-muted px-1 text-[11px] font-medium text-muted-foreground">nuevo</span>;
  const trend = changeTrend(change);
  const good = trend === "flat" ? null : trend === goodWhen;
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "=";
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded px-1 text-[11px] font-medium tabular-nums",
        good === null && "bg-muted text-muted-foreground",
        good === true && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        good === false && "bg-red-500/10 text-red-700 dark:text-red-400",
      )}
      title="Frente al periodo anterior"
    >
      {arrow} {formatPct(Math.abs(change))}
    </span>
  );
}

/** Mensaje dentro de un panel cuando la combinación de filtros no da datos. */
export function ChartEmpty({ message, height = 280 }: { message: string; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-6 text-center text-sm text-muted-foreground" style={{ height }}>
      {message}
    </div>
  );
}

// ─── Tooltips ───────────────────────────────────────────────────
interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

/** Como ui/ChartTooltip, pero con formato por serie (ejes con unidades distintas). */
export function SeriesTooltip({ active, payload, label, format, formatters }: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  format: (value: number) => string;
  formatters?: Record<string, (value: number) => string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-lg shadow-black/10">
      {label != null && <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, i) => {
          const name = String(entry.name ?? "");
          const fmt = formatters?.[name] ?? format;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{name}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{fmt(Number(entry.value ?? 0))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tooltip de tartas: el color viene en el payload del sector, no en la entrada. */
export function PieTooltip({ active, payload, format }: { active?: boolean; payload?: TooltipEntry[]; format: (value: number) => string }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const color = (entry.payload?.color as string | undefined) ?? (entry.payload?.fill as string | undefined) ?? entry.color;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg shadow-black/10">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-muted-foreground">{entry.name}</span>
        <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{format(Number(entry.value ?? 0))}</span>
      </div>
    </div>
  );
}
