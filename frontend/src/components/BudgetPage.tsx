import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, ChevronLeft, ChevronRight, PiggyBank, Receipt, Tags, Target } from "lucide-react";
import { toast } from "sonner";
import { Providers } from "./Providers";
import { PageHeader, StatCard, StatGrid, SectionCard, PageHeaderSkeleton, ListCardSkeleton } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { BudgetTable } from "./budget/BudgetTable";
import { CoverDialog, READY_TO_ASSIGN } from "./budget/CoverDialog";
import { QuickAssignMenu } from "./budget/QuickAssignMenu";
import { TargetDialog } from "./budget/TargetDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  assignBudget, autoAssignBudget, deleteBudgetTarget, getBudgetSummary, moveBudget, putBudgetTarget,
  type AutoAssignMode, type BudgetSummary, type CategoryBudget,
} from "../lib/api";
import { formatCurrency } from "../lib/format";
import { groupTotals } from "../lib/budget-progress";
import { invalidateFinance } from "../lib/finance-cache";
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

const AUTO_EMPTY_MESSAGE: Record<AutoAssignMode, string> = {
  "copy-previous": "Nada que copiar: el mes anterior no tenía importes, o esas categorías ya tienen asignación este mes.",
  "average-3": "Nada que asignar: no hay gasto en los meses anteriores, o esas categorías ya tienen asignación este mes.",
  targets: "Los objetivos ya están al día.",
};

// ─── Página ─────────────────────────────────────────────────────
function BudgetView() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [targetFor, setTargetFor] = useState<CategoryBudget | null>(null);
  const [coverFor, setCoverFor] = useState<CategoryBudget | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => getBudgetSummary(month),
  });

  const refresh = () => invalidateFinance(queryClient);

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
    // Refresca todo (no solo este mes): lo asignado arrastra a los meses siguientes.
    onSuccess: refresh,
  });

  const autoMut = useMutation({
    mutationFn: (mode: AutoAssignMode) => autoAssignBudget(month, mode),
    onSuccess: (res, mode) => {
      refresh();
      if (res.categories === 0) toast.info(AUTO_EMPTY_MESSAGE[mode]);
      else toast.success(`Asignados ${formatCurrency(res.total)} en ${res.categories} ${res.categories === 1 ? "categoría" : "categorías"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const targetMut = useMutation({
    mutationFn: async (vars: { categoryId: number; remove: boolean; target?: Parameters<typeof putBudgetTarget>[1] }) => {
      if (vars.remove) await deleteBudgetTarget(vars.categoryId);
      else await putBudgetTarget(vars.categoryId, vars.target!);
    },
    onSuccess: (_res, vars) => {
      refresh();
      setTargetFor(null);
      toast.success(vars.remove ? "Objetivo quitado" : "Objetivo guardado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const coverMut = useMutation({
    mutationFn: async ({ category, source, amount }: { category: CategoryBudget; source: typeof READY_TO_ASSIGN | number; amount: number }) => {
      if (source === READY_TO_ASSIGN) await assignBudget(category.id, month, Math.round((category.assigned + amount) * 100) / 100);
      else await moveBudget(month, source, category.id, amount);
    },
    onSuccess: () => {
      refresh();
      setCoverFor(null);
      toast.success("Sobregasto cubierto");
    },
    onError: (e: Error) => toast.error(e.message),
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

  const allCategories = data.groups.flatMap((g) => g.categories);

  if (allCategories.length === 0) {
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

  const totals = groupTotals(allCategories);
  const overspentCount = allCategories.filter((c) => c.available < -0.005).length;
  const targetCount = allCategories.filter((c) => c.target).length;
  const pendingId = assignMut.isPending ? assignMut.variables?.categoryId ?? null : null;

  return (
    <div>
      <PageHeader
        title="Presupuesto"
        description="Reparte tus ingresos entre categorías, mes a mes."
        actions={
          <>
            <a
              href="/app/alerts?tipo=category_overspent"
              className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
              title="Crear una alerta para enterarte cuando una categoría se pase"
            >
              <Bell className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Avisarme si me paso</span>
            </a>
            <QuickAssignMenu onRun={(mode) => autoMut.mutate(mode)} busy={autoMut.isPending} hasTargets={targetCount > 0} />
          </>
        }
      >
        {monthSwitcher}
      </PageHeader>

      <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
        <StatCard
          label="Para presupuestar"
          value={<span className={readyValueClass}>{formatCurrency(data.readyToAssign)}</span>}
          icon={PiggyBank}
          hint={readyHint}
          emphasis
          className={cn(tone === "negative" && "border-amber-500/30 bg-amber-500/5")}
        />
        <StatCard
          label="Gastado este mes"
          value={formatCurrency(totals.spent)}
          icon={Receipt}
          hint={
            overspentCount > 0
              ? <span className="text-red-600 dark:text-red-400">{overspentCount} {overspentCount === 1 ? "categoría se ha pasado" : "categorías se han pasado"} del presupuesto</span>
              : `De ${formatCurrency(totals.assigned)} asignados. Todo dentro del presupuesto.`
          }
        />
        <StatCard
          label="Objetivos"
          value={
            targetCount === 0 ? "—" : data.targetsShortfall > 0
              ? <span className="text-amber-700 dark:text-amber-400">{formatCurrency(data.targetsShortfall)}</span>
              : <span className="text-emerald-700 dark:text-emerald-400">Al día</span>
          }
          icon={Target}
          hint={
            targetCount === 0
              ? "Pulsa ◎ junto a una categoría para ponerle un objetivo."
              : data.targetsShortfall > 0 ? "Faltan por asignar este mes para cumplirlos." : `${targetCount} ${targetCount === 1 ? "objetivo cumplido" : "objetivos cumplidos"} este mes.`
          }
        />
      </StatGrid>

      <div className="mt-6 space-y-6">
        {data.groups.map((g) => {
          const t = groupTotals(g.categories);
          return (
            <SectionCard
              key={g.id}
              title={g.name}
              flush
              action={
                g.categories.length > 0 ? (
                  <dl className="hidden items-center gap-4 text-xs sm:flex">
                    <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Asignado</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(t.assigned)}</dd></div>
                    <div className="flex items-baseline gap-1.5"><dt className="text-muted-foreground">Gastado</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(t.spent)}</dd></div>
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">Disponible</dt>
                      <dd className={cn("font-medium tabular-nums", t.available < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>{formatCurrency(t.available)}</dd>
                    </div>
                  </dl>
                ) : undefined
              }
            >
              <BudgetTable
                categories={g.categories}
                month={month}
                pendingId={pendingId}
                onAssign={(categoryId, previous, next) => assignMut.mutate({ categoryId, assigned: next, previous })}
                onEditTarget={setTargetFor}
                onCover={setCoverFor}
                onFund={(c) => assignMut.mutate({
                  categoryId: c.id,
                  previous: c.assigned,
                  assigned: Math.round((c.assigned + (c.target?.shortfall ?? 0)) * 100) / 100,
                })}
              />
            </SectionCard>
          );
        })}
      </div>

      <TargetDialog
        category={targetFor}
        month={month}
        pending={targetMut.isPending}
        onClose={() => setTargetFor(null)}
        onSave={(target) => targetFor && targetMut.mutate({ categoryId: targetFor.id, remove: false, target })}
        onRemove={() => targetFor && targetMut.mutate({ categoryId: targetFor.id, remove: true })}
      />
      <CoverDialog
        category={coverFor}
        summary={data}
        pending={coverMut.isPending}
        onClose={() => setCoverFor(null)}
        onConfirm={(source, amount) => coverFor && coverMut.mutate({ category: coverFor, source, amount })}
      />
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
