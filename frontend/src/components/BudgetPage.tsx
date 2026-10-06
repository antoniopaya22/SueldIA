import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, PiggyBank, Tags } from "lucide-react";
import { toast } from "sonner";
import { Providers } from "./Providers";
import { PageHeader, StatCard, SectionCard, PageHeaderSkeleton, ListCardSkeleton } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignBudget, getBudgetSummary, type BudgetSummary, type CategoryBudget } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { monthRange, transactionsHref } from "../lib/transaction-filters";
import { cn } from "cn";

const MONTHS_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_FULL[Number(m) - 1]} ${y}`;
}

/** Negativo en rojo, resto en color normal — misma convención que en FinanceAnalyticsPage. */
function signedTone(n: number): string {
  return n < 0 ? "text-red-600 dark:text-red-400" : "text-foreground";
}

// ─── Celda "Asignado" editable en línea ─────────────────────────
function AssignedCell({
  value, pending, onSave,
}: {
  value: number;
  pending: boolean;
  onSave: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const cancelledRef = useRef(false);

  const startEdit = () => {
    if (pending) return;
    setDraft(value ? String(value) : "0");
    setEditing(true);
  };

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isNaN(parsed) && parsed !== value) onSave(parsed);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        disabled={pending}
        className="w-full cursor-text rounded px-1.5 py-1 text-right tabular-nums text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60"
        title="Editar importe asignado"
      >
        {formatCurrency(value)}
      </button>
    );
  }

  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.preventDefault(); cancelledRef.current = true; e.currentTarget.blur(); }
      }}
      onBlur={() => {
        setEditing(false);
        if (cancelledRef.current) { cancelledRef.current = false; return; }
        commit();
      }}
      aria-label="Importe asignado"
      className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    />
  );
}

// ─── Tabla de un grupo ───────────────────────────────────────────
function GroupTable({
  categories, month, pendingId, onAssign,
}: {
  categories: CategoryBudget[];
  month: string;
  pendingId: number | null;
  onAssign: (categoryId: number, previous: number, next: number) => void;
}) {
  if (categories.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted-foreground">Sin categorías en este grupo — créalas en Categorías.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Categoría</TableHead>
          <TableHead className="text-right">Asignado</TableHead>
          <TableHead className="text-right">Actividad</TableHead>
          <TableHead className="pr-5 text-right">Disponible</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="py-2.5 pl-5 font-medium text-foreground">{c.name}</TableCell>
            <TableCell className="py-1.5 text-right">
              <AssignedCell
                value={c.assigned}
                pending={pendingId === c.id}
                onSave={(next) => onAssign(c.id, c.assigned, next)}
              />
            </TableCell>
            <TableCell className={cn("py-2.5 text-right tabular-nums", signedTone(c.activity))}>
              {c.activity === 0 ? formatCurrency(c.activity) : (
                <a
                  // La actividad solo suma gastos liquidados: el enlace filtra igual para que el total coincida.
                  href={transactionsHref({ categoryId: c.id, type: "expense", cleared: "true", ...monthRange(month) })}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  title="Ver los movimientos de este mes"
                >
                  {formatCurrency(c.activity)}
                </a>
              )}
            </TableCell>
            <TableCell className={cn("py-2.5 pr-5 text-right font-medium tabular-nums", signedTone(c.available))}>
              {formatCurrency(c.available)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Página ─────────────────────────────────────────────────────
function BudgetView() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => getBudgetSummary(month),
  });

  const assignMut = useMutation({
    mutationFn: ({ categoryId, assigned }: { categoryId: number; assigned: number; previous: number }) =>
      assignBudget(categoryId, month, assigned),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["budgets", month] });
      const previousData = queryClient.getQueryData<BudgetSummary>(["budgets", month]);
      if (previousData) {
        const delta = vars.assigned - vars.previous;
        const next: BudgetSummary = {
          ...previousData,
          readyToAssign: previousData.readyToAssign - delta,
          groups: previousData.groups.map((g) => ({
            ...g,
            categories: g.categories.map((c) =>
              c.id === vars.categoryId ? { ...c, assigned: vars.assigned, available: c.available + delta } : c,
            ),
          })),
        };
        queryClient.setQueryData(["budgets", month], next);
      }
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) queryClient.setQueryData(["budgets", month], context.previousData);
      toast.error("No se pudo guardar el importe asignado");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets", month] });
    },
  });

  const monthSwitcher = (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mes anterior">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 px-1 text-center text-sm font-medium text-foreground tabular-nums">
        {monthLabel(month)}
      </span>
      <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mes siguiente">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );

  if (error && !isLoading) {
    return (
      <>
        <PageHeader title="Presupuesto" description="Reparte tus ingresos entre categorías, mes a mes." />
        <EmptyState icon={AlertTriangle} title="No se pudo cargar el presupuesto" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </EmptyState>
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <div>
        <PageHeaderSkeleton />
        <ListCardSkeleton />
        <ListCardSkeleton className="mt-4" />
      </div>
    );
  }

  const totalCategories = data.groups.reduce((s, g) => s + g.categories.length, 0);

  if (totalCategories === 0) {
    return (
      <>
        <PageHeader title="Presupuesto" description="Reparte tus ingresos entre categorías, mes a mes." />
        <EmptyState
          icon={Tags}
          title="Aún no tienes categorías"
          description="Crea al menos una categoría para poder asignarle dinero cada mes."
          actionLabel="Ir a categorías"
          actionHref="/app/categories"
          actionIcon={Tags}
        />
      </>
    );
  }

  const tone = data.readyToAssign > 0 ? "positive" : data.readyToAssign < 0 ? "negative" : "zero";
  const readyValueClass = tone === "negative"
    ? "text-amber-700 dark:text-amber-400"
    : tone === "zero"
      ? "text-muted-foreground"
      : "text-foreground";
  const readyHint = tone === "negative"
    ? "Has asignado más dinero del que has recibido este mes."
    : tone === "zero"
      ? "Ya has asignado todo el dinero de este mes."
      : "Repártelo entre tus categorías para que trabaje para ti.";

  const pendingId = assignMut.isPending ? assignMut.variables?.categoryId ?? null : null;

  return (
    <div>
      <PageHeader title="Presupuesto" description="Reparte tus ingresos entre categorías, mes a mes.">
        {monthSwitcher}
      </PageHeader>

      <StatCard
        label="Para presupuestar"
        value={<span className={readyValueClass}>{formatCurrency(data.readyToAssign)}</span>}
        icon={PiggyBank}
        hint={readyHint}
        emphasis
        className={cn(tone === "negative" && "border-amber-500/30 bg-amber-500/5")}
      />

      <div className="mt-6 space-y-6">
        {data.groups.map((g) => (
          <SectionCard key={g.id} title={g.name} flush>
            <GroupTable
              categories={g.categories}
              month={month}
              pendingId={pendingId}
              onAssign={(categoryId, previous, next) => assignMut.mutate({ categoryId, assigned: next, previous })}
            />
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

export default function BudgetPage() {
  return (
    <Providers>
      <BudgetView />
    </Providers>
  );
}
