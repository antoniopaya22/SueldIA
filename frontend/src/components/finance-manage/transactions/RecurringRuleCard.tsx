import { CalendarClock, Pause, Pencil, Play, Trash2, Hourglass, Zap } from "lucide-react";
import type { RecurringTransaction } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { RowActions } from "../RowActions";
import { TYPE_META, formatCadence, formatDateLong } from "./shared";
import { cn } from "cn";

interface Props {
  rule: RecurringTransaction;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

export function RecurringRuleCard({ rule, onEdit, onToggleActive, onDelete }: Props) {
  const meta = TYPE_META[rule.type];
  const isIncome = rule.type === "income";
  return (
    <article
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-shadow hover:shadow-md",
        !rule.active && "bg-muted/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", rule.active ? meta.tile : "bg-muted text-muted-foreground")}>
          <meta.icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={cn("truncate text-sm font-semibold", rule.active ? "text-foreground" : "text-muted-foreground")}>
              {rule.payee || (isIncome ? "Ingreso recurrente" : "Pago recurrente")}
            </h3>
            {!rule.active && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Pausada</span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {rule.accountName}
            {rule.categoryName ? ` · ${rule.categoryName}` : ""}
          </p>
        </div>
        <RowActions
          itemLabel={rule.payee || "la regla"}
          actions={[
            { label: "Editar", icon: Pencil, onSelect: onEdit },
            { label: rule.active ? "Pausar" : "Reactivar", icon: rule.active ? Pause : Play, onSelect: onToggleActive },
            { label: "Eliminar", icon: Trash2, onSelect: onDelete, destructive: true, separated: true },
          ]}
        />
      </div>

      <p className={cn("mt-4 text-xl font-semibold tracking-tight tabular-nums", isIncome ? TYPE_META.income.text : "text-foreground", !rule.active && "text-muted-foreground")}>
        {isIncome ? "+" : "−"}{formatCurrency(rule.amount)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
          {formatCadence(rule.cadence, rule.intervalCount)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5",
            rule.nextOccurrence && rule.active ? "bg-primary/10 text-primary-700 dark:text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <CalendarClock className="size-3" aria-hidden="true" />
          {rule.nextOccurrence ? `Próximo: ${formatDateLong(rule.nextOccurrence)}` : "Sin próximos vencimientos"}
        </span>
        {rule.autoSettle && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground"
            title="Se liquida sola el día del cargo"
          >
            <Zap className="size-3" aria-hidden="true" /> Automática
          </span>
        )}
        {rule.overdueCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
            <Hourglass className="size-3" aria-hidden="true" />
            {rule.overdueCount} {rule.overdueCount === 1 ? "vencida" : "vencidas"}
          </span>
        )}
        {rule.pendingCount > rule.overdueCount && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground" title="Ya generadas, aún no han llegado a su fecha">
            {rule.pendingCount - rule.overdueCount} {rule.pendingCount - rule.overdueCount === 1 ? "próxima" : "próximas"}
          </span>
        )}
      </div>

      {rule.memo && <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{rule.memo}</p>}
    </article>
  );
}
