import type { ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ChevronRight, FileSearch, PiggyBank, Tag, TrendingDown } from "lucide-react";
import { getBudgetSummary, getForecast, getPayslips, getTransactions } from "@/lib/api";
import { formatCurrency, plural } from "@/lib/format";
import { currentMonthKey } from "@/lib/dates";
import { transactionsHref } from "@/lib/transaction-filters";
import { cn } from "cn";

interface Item {
  key: string;
  icon: ElementType;
  text: string;
  href: string;
  tone: "warning" | "info";
}

const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long" });

/**
 * «¿Cómo voy?»: cuánto quedará a fin de mes según la previsión y lo que
 * pide atención ahora (nóminas por revisar, gastos sin categoría, pendientes
 * vencidos, categorías pasadas de presupuesto), cada cosa con su enlace.
 */
export function AttentionCard({ hasFinance, hasPayroll }: { hasFinance: boolean; hasPayroll: boolean }) {
  const month = currentMonthKey();
  const { data: forecast } = useQuery({ queryKey: ["finance-forecast", 60], queryFn: () => getForecast(60), enabled: hasFinance });
  const { data: review } = useQuery({
    queryKey: ["payslips", "review-count", "all"],
    queryFn: () => getPayslips({ status: "review", limit: 1 }),
    enabled: hasPayroll,
  });
  const { data: tx } = useQuery({ queryKey: ["transactions", "attention"], queryFn: () => getTransactions({ limit: 1 }), enabled: hasFinance });
  const { data: budget } = useQuery({ queryKey: ["budget-summary", month], queryFn: () => getBudgetSummary(month), enabled: hasFinance });

  const items: Item[] = [];
  const reviewCount = review?.total ?? 0;
  if (reviewCount > 0) {
    items.push({ key: "review", icon: FileSearch, tone: "warning", text: `${plural(reviewCount, "nómina", "nóminas")} por revisar: no se leyeron todos sus conceptos`, href: "/app/payslips?estado=review" });
  }
  const uncategorized = tx?.summary.uncategorizedExpenses ?? 0;
  if (uncategorized > 0) {
    items.push({ key: "uncat", icon: Tag, tone: "info", text: `${plural(uncategorized, "gasto", "gastos")} sin categoría`, href: transactionsHref({ uncategorized: true, type: "expense" }) });
  }
  const overdue = (forecast?.upcoming ?? []).filter((i) => i.overdue);
  if (overdue.length > 0) {
    items.push({ key: "overdue", icon: CalendarClock, tone: "warning", text: `${plural(overdue.length, "movimiento pendiente", "movimientos pendientes")} con la fecha ya pasada`, href: transactionsHref({ cleared: "false", to: forecast!.today }) });
  }
  const overspent = (budget?.groups ?? []).flatMap((g) => g.categories).filter((c) => c.carryIn + c.assigned > 0 && c.available < -0.005);
  if (overspent.length > 0) {
    const names = overspent.slice(0, 2).map((c) => c.name).join(" y ");
    items.push({ key: "overspent", icon: PiggyBank, tone: "warning", text: `${overspent.length > 2 ? `${names} y ${overspent.length - 2} más` : names} ${overspent.length === 1 ? "se ha pasado" : "se han pasado"} del presupuesto`, href: `/app/budget?mes=${month}` });
  }

  const endOfMonth = forecast?.endOfMonth;
  const negative = forecast?.firstNegative;
  if (!hasFinance && items.length === 0) return null;

  return (
    <section aria-labelledby="attention-title" className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 id="attention-title" className="text-sm font-semibold text-foreground">¿Cómo voy?</h2>
      {endOfMonth && (
        <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
          {negative ? <TrendingDown className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> : null}
          <span>
            A fin de mes tendrás unos <strong className="font-semibold text-foreground tabular-nums">{formatCurrency(endOfMonth.balance)}</strong>, contando lo pendiente y lo programado.
            {negative && <> <span className="text-destructive">Ojo: el {dayMonth(negative)} el saldo previsto baja de cero.</span></>}
          </span>
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <CheckCircle2 className="size-4 text-primary-600 dark:text-primary" aria-hidden="true" /> Todo en orden: nada pendiente de revisar.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.key}>
              <a href={item.href} className="group flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                <item.icon className={cn("size-4 shrink-0", item.tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-foreground">{item.text}</span>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
