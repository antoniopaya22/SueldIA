import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDailySeries } from "../../../lib/api";
import { buildCalendar } from "../../../lib/analytics-charts";
import { formatCurrency } from "../../../lib/format";
import { transactionsHref } from "../../../lib/transaction-filters";
import { ChartEmpty } from "../finance-ui";
import { cn } from "cn";

interface Props {
  accountId?: number;
  groupId?: number;
  categoryId?: number;
  from: string;
  to: string;
  metric: "expense" | "income";
  expanded: boolean;
}

const WEEKDAYS = ["L", "", "X", "", "V", "", "D"];
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Intensidad 0-4 según el importe del día frente al máximo (raíz cuadrada: un día enorme no apaga a los demás). */
function level(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = Math.sqrt(value / max);
  return ratio > 0.8 ? 4 : ratio > 0.55 ? 3 : ratio > 0.3 ? 2 : 1;
}

const LEVEL_PERCENT = [0, 22, 42, 68, 100];

export function CalendarHeatmap({ accountId, groupId, categoryId, from, to, metric, expanded }: Props) {
  // Como mucho el último año, aunque el periodo sea mayor; sin periodo ("Todo") también el último año.
  const end = to || localIso(new Date());
  const earliest = new Date(`${end}T00:00:00`);
  earliest.setDate(earliest.getDate() - 371);
  const start = !from || from < localIso(earliest) ? localIso(earliest) : from;

  const { data: daily, isLoading } = useQuery({
    queryKey: ["finance-daily", "calendar", start, end, accountId, groupId, categoryId],
    queryFn: () => getDailySeries({ from: start, to: end, accountId, groupId, categoryId }),
  });
  const calendar = useMemo(() => (daily ? buildCalendar(daily, start, end, metric) : null), [daily, start, end, metric]);

  if (isLoading || !calendar) return <div className="h-48 animate-pulse rounded-lg bg-muted/50" />;
  if (calendar.max === 0) {
    return <ChartEmpty message={`No hay ${metric === "expense" ? "gasto" : "ingreso"} liquidado en este periodo.`} height={160} />;
  }

  const activeDays = calendar.weeks.flat().filter((c) => c && c.value > 0);
  const best = activeDays.reduce((a, c) => (c && (!a || c.value > a.value) ? c : a), null as (typeof activeDays)[number] | null);
  const cell = expanded ? 18 : 14;
  const color = metric === "expense" ? "var(--chart-2)" : "var(--chart-1)";

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        {formatCurrency(calendar.total)} en {activeDays.length} {activeDays.length === 1 ? "día" : "días"} con {metric === "expense" ? "gasto" : "ingresos"}
        {best && <> · el día más alto fue el <span className="text-foreground">{dayLabel(best.date)}</span> ({formatCurrency(best.value)})</>}
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="inline-block min-w-max">
          <div className="ml-6 flex gap-[3px]" style={{ height: 16 }} aria-hidden="true">
            {calendar.weeks.map((_, w) => {
              const label = calendar.monthLabels.find((m) => m.week === w)?.label;
              return <span key={w} className="relative text-[10px] text-muted-foreground" style={{ width: cell }}>{label && <span className="absolute left-0 whitespace-nowrap">{label}</span>}</span>;
            })}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex w-5 flex-col gap-[3px] text-[10px] text-muted-foreground" aria-hidden="true">
              {WEEKDAYS.map((d, i) => <span key={i} className="flex items-center" style={{ height: cell }}>{d}</span>)}
            </div>
            {calendar.weeks.map((week, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {week.map((c, i) =>
                  c === null ? (
                    <span key={i} style={{ width: cell, height: cell }} aria-hidden="true" />
                  ) : (
                    <a
                      key={i}
                      href={transactionsHref({ from: c.date, to: c.date, type: metric, cleared: "true", accountId, groupId, categoryId })}
                      title={`${dayLabel(c.date)}: ${c.value > 0 ? `${formatCurrency(c.value)} (${c.count} ${c.count === 1 ? "mov." : "movs."})` : "sin movimientos"}`}
                      aria-label={`${dayLabel(c.date)}: ${formatCurrency(c.value)}`}
                      className={cn("rounded-[3px] outline-none ring-offset-1 transition hover:ring-2 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring", c.value <= 0 && "bg-muted")}
                      style={{
                        width: cell,
                        height: cell,
                        ...(c.value > 0 ? { backgroundColor: `color-mix(in srgb, ${color} ${LEVEL_PERCENT[level(c.value, calendar.max)]}%, transparent)` } : {}),
                      }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground" aria-hidden="true">
        Menos
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={cn("size-3 rounded-[3px]", l === 0 && "bg-muted")} style={l > 0 ? { backgroundColor: `color-mix(in srgb, ${color} ${LEVEL_PERCENT[l]}%, transparent)` } : undefined} />
        ))}
        Más
      </div>
    </div>
  );
}
