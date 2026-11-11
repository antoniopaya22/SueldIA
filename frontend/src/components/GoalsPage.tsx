import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArchiveRestore, Goal, Landmark, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createSavingsGoal, deleteSavingsGoal, getAccounts, getSavingsGoals, updateSavingsGoal,
  type SavingsGoal, type SavingsGoalInput,
} from "../lib/api";
import { formatCurrency } from "../lib/format";
import { Providers } from "./Providers";
import { DecimalInput, ListCardSkeleton, PageHeader, PageHeaderSkeleton } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import { RowActions } from "./finance-manage/RowActions";
import { AccountSelect } from "./finance-manage/transactions/shared";
import { ColorSwatches, SWATCH_COLORS } from "./finance-manage/ColorSwatches";
import { GoalProgressBar, goalSummary } from "./finance/GoalProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";

interface FormState {
  name: string;
  targetAmount: number | null;
  targetDate: string;
  accountId: number | "";
  savedAmount: number | null;
  color: string;
}

const EMPTY: FormState = { name: "", targetAmount: null, targetDate: "", accountId: "", savedAmount: null, color: SWATCH_COLORS[0] };

function GoalDialog({ open, goal, onClose }: { open: boolean; goal: SavingsGoal | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const [form, setForm] = useState<FormState>(() =>
    goal
      ? { name: goal.name, targetAmount: goal.targetAmount, targetDate: goal.targetDate ?? "", accountId: goal.accountId ?? "", savedAmount: goal.savedAmount, color: goal.color }
      : EMPTY,
  );
  const saveMut = useMutation({
    mutationFn: () => {
      const data: SavingsGoalInput = {
        name: form.name.trim(),
        targetAmount: form.targetAmount ?? 0,
        targetDate: form.targetDate || null,
        accountId: form.accountId === "" ? null : form.accountId,
        color: form.color,
        ...(form.accountId === "" ? { savedAmount: form.savedAmount ?? 0 } : {}),
      };
      return goal ? updateSavingsGoal(goal.id, data) : createSavingsGoal(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["savings-goals"] });
      toast.success(goal ? "Objetivo actualizado" : "Objetivo creado");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const invalidTarget = form.targetAmount == null || !Number.isFinite(form.targetAmount) || form.targetAmount <= 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (!invalidTarget && form.name.trim()) saveMut.mutate(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{goal ? "Editar objetivo" : "Nuevo objetivo de ahorro"}</DialogTitle>
            <DialogDescription>Para qué ahorras, cuánto y para cuándo. Te diremos cuánto apartar cada mes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Nombre</Label>
            <Input id="goal-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Vacaciones, colchón, coche…" maxLength={100} required autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Cuánto (€)</Label>
              <DecimalInput id="goal-target" value={form.targetAmount} onValueChange={(v) => setForm({ ...form, targetAmount: v })} placeholder="2.000" aria-invalid={form.targetAmount !== null && invalidTarget} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-date">Para cuándo</Label>
              <Input id="goal-date" type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-account">¿Dónde lo guardas?</Label>
            <AccountSelect
              id="goal-account"
              value={form.accountId}
              onChange={(v) => setForm({ ...form, accountId: v })}
              accounts={accounts.filter((a) => !a.archived)}
              placeholder="No lo separo en una cuenta"
            />
            <p className="text-xs text-muted-foreground">
              {form.accountId === "" ? "Sin cuenta, apunta tú lo que llevas ahorrado." : "Lo ahorrado será el saldo de esa cuenta."}
            </p>
          </div>
          {form.accountId === "" && (
            <div className="space-y-1.5">
              <Label htmlFor="goal-saved">Llevo ahorrado (€)</Label>
              <DecimalInput id="goal-saved" value={form.savedAmount} onValueChange={(v) => setForm({ ...form, savedAmount: v })} placeholder="0" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <ColorSwatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saveMut.isPending || invalidTarget || !form.name.trim()} className="gap-1.5">
              {saveMut.isPending && <Loader2 className="size-4 animate-spin" />}
              {goal ? "Guardar" : "Crear objetivo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GoalCard({ goal, onEdit, onArchive, onDelete }: { goal: SavingsGoal; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const p = goal.progress;
  return (
    <article className={cn("flex flex-col rounded-xl border border-border bg-card p-5", goal.archived && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{goal.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            {goal.accountName ? <><Landmark className="size-3" aria-hidden="true" /> {goal.accountName}</> : "Apuntado a mano"}
          </p>
        </div>
        <RowActions
          itemLabel={goal.name}
          actions={[
            { label: "Editar", icon: Pencil, onSelect: onEdit },
            { label: goal.archived ? "Recuperar" : "Archivar", icon: goal.archived ? ArchiveRestore : Archive, onSelect: onArchive },
            { label: "Eliminar", icon: Trash2, onSelect: onDelete, destructive: true, separated: true },
          ]}
        />
      </div>
      <p className="mt-4 text-xl font-semibold tracking-tight tabular-nums text-foreground">
        {formatCurrency(p.saved)} <span className="text-sm font-normal text-muted-foreground">de {formatCurrency(goal.targetAmount)}</span>
      </p>
      <GoalProgressBar goal={goal} className="mt-3" />
      <p className={cn("mt-3 text-xs", p.status === "done" ? "font-medium text-primary-600 dark:text-primary" : p.status === "overdue" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
        {p.percent.toLocaleString("es-ES")} % · {goalSummary(goal)}
      </p>
    </article>
  );
}

function GoalsView() {
  const queryClient = useQueryClient();
  const { data: goals = [], isLoading, error, refetch } = useQuery({ queryKey: ["savings-goals"], queryFn: getSavingsGoals });
  const [editing, setEditing] = useState<SavingsGoal | null | "new">(null);
  const [toDelete, setToDelete] = useState<SavingsGoal | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["savings-goals"] });
  const archiveMut = useMutation({
    mutationFn: (g: SavingsGoal) => updateSavingsGoal(g.id, { archived: !g.archived }),
    onSuccess: (_, g) => { refresh(); toast.success(g.archived ? "Objetivo recuperado" : "Objetivo archivado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (g: SavingsGoal) => deleteSavingsGoal(g.id),
    onSuccess: () => { refresh(); toast.success("Objetivo eliminado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <><PageHeaderSkeleton /><ListCardSkeleton rows={3} /></>;
  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudieron cargar tus objetivos" description="Vuelve a intentarlo en unos segundos.">
        <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
      </EmptyState>
    );
  }

  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  const monthly = active.reduce((s, g) => s + (g.progress.monthlyNeeded ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Objetivos"
        accent="de ahorro"
        description={
          monthly > 0
            ? `Para llegar a todos a tiempo, aparta ${formatCurrency(monthly)} al mes.`
            : active.length && active.every((g) => g.progress.status === "done")
              ? `Has conseguido ${active.length === 1 ? "tu objetivo" : `tus ${active.length} objetivos`}.`
              : "Para qué ahorras, cuánto y para cuándo."
        }
        actions={<Button onClick={() => setEditing("new")} className="gap-1.5"><Plus className="size-4" /> Nuevo objetivo</Button>}
      />
      {goals.length === 0 ? (
        <EmptyState icon={Goal} title="Aún no tienes objetivos" description="«Vacaciones: 2.000 € para julio». Crea uno y te diremos cuánto apartar cada mes.">
          <Button onClick={() => setEditing("new")} className="gap-1.5"><Plus className="size-4" /> Crear el primero</Button>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((g) => (
              <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onArchive={() => archiveMut.mutate(g)} onDelete={() => setToDelete(g)} />
            ))}
          </div>
          {archived.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Archivados</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {archived.map((g) => (
                  <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onArchive={() => archiveMut.mutate(g)} onDelete={() => setToDelete(g)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {editing !== null && <GoalDialog open goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmModal
        open={!!toDelete}
        title="Eliminar objetivo"
        message={`¿Eliminar «${toDelete?.name ?? ""}»? No se borra ningún movimiento ni ninguna cuenta.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (toDelete) deleteMut.mutate(toDelete); setToDelete(null); }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Providers>
      <GoalsView />
    </Providers>
  );
}
