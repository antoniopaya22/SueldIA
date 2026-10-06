import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  ArrowDownRight, ArrowUpRight, ArrowLeftRight, Wallet, Landmark, CreditCard, Banknote, TrendingUp,
  Check, ChevronDown, X, type LucideIcon,
} from "lucide-react";
import type { Account, CategoryGroup, RecurringCadence } from "../../../lib/api";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";
import { darkBoost } from "../../../lib/color";

export type TxType = "expense" | "income" | "transfer";

export const NONE = "__none__";

export const TYPE_META: Record<TxType, { label: string; plural: string; icon: LucideIcon; tile: string; text: string; selected: string }> = {
  expense: {
    label: "Gasto",
    plural: "Gastos",
    icon: ArrowDownRight,
    tile: "bg-red-500/10 text-red-600 dark:text-red-400",
    text: "text-foreground",
    selected: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  income: {
    label: "Ingreso",
    plural: "Ingresos",
    icon: ArrowUpRight,
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    selected: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  transfer: {
    label: "Transferencia",
    plural: "Traspasos",
    icon: ArrowLeftRight,
    tile: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    selected: "border-(--chart-2)/40 bg-(--chart-2)/10 text-foreground",
  },
};

export const ACCOUNT_ICONS: Record<Account["type"], LucideIcon> = {
  bank: Landmark,
  credit_card: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  other: Wallet,
};

export const CADENCE_LABELS: Record<RecurringCadence, string> = { weekly: "Semanal", monthly: "Mensual", yearly: "Anual" };

// ─── Fechas ─────────────────────────────────────────────────────
export function getTodayIsoDate(): string {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function getYesterdayIsoDate(reference = new Date()): string {
  const y = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - 1);
  return formatIsoDate(y.getFullYear(), y.getMonth() + 1, y.getDate());
}

function parseIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsFromBase(isoDate: string, monthsToAdd: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const absoluteMonth = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = (absoluteMonth % 12) + 1;
  return formatIsoDate(targetYear, targetMonth, Math.min(day, getDaysInMonth(targetYear, targetMonth)));
}

export function getNextMonthlyOccurrence(isoDate: string, fromDate = getTodayIsoDate()): string {
  for (let monthIndex = 0; monthIndex < 120; monthIndex += 1) {
    const candidate = addMonthsFromBase(isoDate, monthIndex);
    if (candidate >= fromDate) return candidate;
  }
  return fromDate;
}

export function formatDateShort(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateLong(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

/** "Hoy", "Ayer" o "Jueves, 25 sept" (con año si no es el actual). */
export function formatDayHeading(d: string, today = getTodayIsoDate()) {
  if (d === today) return "Hoy";
  const y = new Date(today + "T00:00:00");
  y.setDate(y.getDate() - 1);
  if (d === formatIsoDate(y.getFullYear(), y.getMonth() + 1, y.getDate())) return "Ayer";
  const sameYear = d.slice(0, 4) === today.slice(0, 4);
  const s = new Date(d + "T00:00:00").toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatCadence(cadence: RecurringCadence, intervalCount: number): string {
  if (cadence === "weekly") return intervalCount === 1 ? "Cada semana" : `Cada ${intervalCount} semanas`;
  if (cadence === "yearly") return intervalCount === 1 ? "Cada año" : `Cada ${intervalCount} años`;
  return intervalCount === 1 ? "Cada mes" : `Cada ${intervalCount} meses`;
}

// ─── Selects reutilizados en filtros y formularios ─────────────
export function AccountSelect({
  id, value, onChange, accounts, placeholder = "Selecciona una cuenta", allowNone = true, excludeId,
}: {
  id?: string;
  value: number | "";
  onChange: (v: number | "") => void;
  accounts: Account[];
  placeholder?: string;
  allowNone?: boolean;
  excludeId?: number | "";
}) {
  const options = accounts.filter((a) => a.id !== excludeId);
  return (
    <Select value={value ? String(value) : NONE} onValueChange={(v) => onChange(!v || v === NONE ? "" : Number(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder}>
          {(v: string) => {
            const a = accounts.find((acc) => String(acc.id) === v);
            if (!a) return <span className="text-muted-foreground">{placeholder}</span>;
            return (
              <span className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", darkBoost(a.color))} style={{ backgroundColor: a.color }} aria-hidden="true" />
                {a.name}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {options.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            <span className={cn("size-2 rounded-full", darkBoost(a.color))} style={{ backgroundColor: a.color }} aria-hidden="true" />
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface CategoryOption {
  id: number;
  label: string;
  groupName: string;
}

interface CategoryOptionGroup {
  value: string;
  items: CategoryOption[];
}

const normalizeText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Selector de categoría con búsqueda (por nombre de categoría o de grupo, sin
 * distinguir tildes). Con decenas de categorías, un desplegable sin filtro era
 * lo más lento de rellenar al apuntar un gasto.
 */
export function CategorySelect({
  id, value, onChange, groups, noneLabel = "Sin categoría", className,
}: {
  id?: string;
  value: number | "";
  onChange: (v: number | "") => void;
  groups: CategoryGroup[];
  noneLabel?: string;
  className?: string;
}) {
  const optionGroups = useMemo<CategoryOptionGroup[]>(
    () => groups
      .filter((g) => g.categories.length > 0)
      .map((g) => ({ value: g.name, items: g.categories.map((c) => ({ id: c.id, label: c.name, groupName: g.name })) })),
    [groups],
  );
  const selected = useMemo(
    () => optionGroups.flatMap((g) => g.items).find((o) => o.id === value) ?? null,
    [optionGroups, value],
  );

  return (
    <Combobox.Root
      items={optionGroups}
      value={selected}
      onValueChange={(option: CategoryOption | null) => onChange(option ? option.id : "")}
      isItemEqualToValue={(a: CategoryOption, b: CategoryOption) => a.id === b.id}
      itemToStringLabel={(option: CategoryOption) => option.label}
      filter={(option: CategoryOption, query: string) => normalizeText(`${option.groupName} ${option.label}`).includes(normalizeText(query.trim()))}
    >
      <Combobox.InputGroup className={cn("relative w-full", className)}>
        <Combobox.Input
          id={id}
          placeholder={noneLabel}
          // Al volver a la categoría ya elegida, el texto queda seleccionado: basta con escribir para cambiarla.
          onFocus={(e) => e.currentTarget.select()}
          render={<Input className="pr-14" />}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-1">
          <Combobox.Clear
            aria-label="Quitar categoría"
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Combobox.Clear>
          <Combobox.Trigger
            aria-label="Abrir lista de categorías"
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Combobox.Trigger>
        </div>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50 outline-none">
          <Combobox.Popup className="w-(--anchor-width) min-w-48 max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <Combobox.Empty className="px-3 py-4 text-center text-sm text-muted-foreground empty:hidden">
              Ninguna categoría coincide
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-0 data-empty:p-0">
              {(group: CategoryOptionGroup) => (
                <Combobox.Group key={group.value} items={group.items} className="block">
                  <Combobox.GroupLabel className="px-1.5 py-1 text-xs text-muted-foreground">{group.value}</Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(option: CategoryOption) => (
                      <Combobox.Item
                        key={option.id}
                        value={option}
                        className="relative flex cursor-default items-center rounded-md py-1.5 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="truncate">{option.label}</span>
                        <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                          <Check className="size-4" aria-hidden="true" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** Selector segmentado de tipo con color semántico (formularios). */
export function TypeToggle<T extends TxType>({
  value, onChange, types, disabled = [],
}: {
  value: T;
  onChange: (t: T) => void;
  types: readonly T[];
  disabled?: T[];
}) {
  return (
    <div role="radiogroup" aria-label="Tipo de movimiento" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${types.length}, minmax(0, 1fr))` }}>
      {types.map((t) => {
        const meta = TYPE_META[t];
        const selected = value === t;
        const isDisabled = disabled.includes(t);
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={isDisabled}
            onClick={() => onChange(t)}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
              selected ? meta.selected : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <meta.icon className="size-4" />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** Input de importe con símbolo € y sin flechas. */
export const amountInputClass =
  "pr-8 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** Chip de filtro rápido (periodo, "sin categoría"…): pulsado = filtro activo. */
export function FilterChip({
  active, onClick, children, count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-primary/40 bg-primary/10 text-primary-700 dark:text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  );
}
