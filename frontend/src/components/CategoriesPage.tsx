import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, FolderPlus, Folder, Tags, Search, ArrowRightLeft, Check, X,
  AlertTriangle, Download, TrendingDown, CircleSlash,
} from "lucide-react";
import { CategoryRulesCard } from "./categories/CategoryRulesCard";
import { Providers } from "./Providers";
import { toast } from "sonner";
import { ConfirmModal } from "./ui/ConfirmModal";
import { EmptyState } from "./ui/EmptyState";
import {
  PageHeader, StatCard, StatGrid, PageHeaderSkeleton, StatCardSkeleton,
} from "./app";
import { RowActions } from "./finance-manage/RowActions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getCategories, getFinanceAnalytics,
  createCategoryGroup, updateCategoryGroup, deleteCategoryGroup,
  createCategory, updateCategory, deleteCategory,
  type CategoryGroup, type Category,
} from "../lib/api";
import { formatCurrency } from "../lib/format";
import { cn } from "cn";

// Ventana de actividad que se muestra junto a cada categoría.
const ACTIVITY_MONTHS = 3;

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function activityRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (ACTIVITY_MONTHS - 1), 1);
  return { from: isoDate(from), to: isoDate(now) };
}

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

interface Activity {
  total: number;
  count: number;
  type: "income" | "expense";
}

// ─── Edición en línea ───────────────────────────────────────────
function InlineNameInput({
  initial, placeholder, onSave, onCancel, pending,
}: {
  initial: string;
  placeholder: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form
      className="flex flex-1 items-center gap-1.5"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSave(value.trim()); }}
    >
      <Input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 flex-1"
      />
      <Button type="submit" size="icon-sm" disabled={pending || !value.trim()} aria-label="Guardar">
        <Check className="size-3.5" />
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Cancelar">
        <X className="size-3.5" />
      </Button>
    </form>
  );
}

// ─── Tarjeta de grupo ───────────────────────────────────────────
function GroupCard({
  group, categories, activity, searching,
  editingCatId, addingHere, pending,
  onRenameGroup, onDeleteGroup, onStartAdd, onCancelAdd, onCreateCat,
  onStartEditCat, onCancelEditCat, onSaveCat, onMoveCat, onDeleteCat,
}: {
  group: CategoryGroup;
  categories: Category[];
  activity: Map<number, Activity>;
  searching: boolean;
  editingCatId: number | null;
  addingHere: boolean;
  pending: boolean;
  onRenameGroup: () => void;
  onDeleteGroup: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onCreateCat: (name: string) => void;
  onStartEditCat: (c: Category) => void;
  onCancelEditCat: () => void;
  onSaveCat: (c: Category, name: string) => void;
  onMoveCat: (c: Category) => void;
  onDeleteCat: (c: Category) => void;
}) {
  const groupTotal = group.categories.reduce((s, c) => s + (activity.get(c.id)?.total ?? 0), 0);
  const groupType = group.categories.some((c) => activity.get(c.id)?.type === "income")
    && !group.categories.some((c) => activity.get(c.id)?.type === "expense") ? "income" : "expense";
  const maxInGroup = Math.max(0, ...group.categories.map((c) => activity.get(c.id)?.total ?? 0));

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
          <Folder className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{group.name}</h2>
          <p className="text-xs text-muted-foreground">
            {group.categories.length} {group.categories.length === 1 ? "categoría" : "categorías"}
          </p>
        </div>
        {groupTotal > 0 && (
          <div className="text-right">
            <p className={cn("text-sm font-semibold tabular-nums", groupType === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
              {groupType === "income" ? "+" : ""}{formatCurrency(groupTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground">últimos {ACTIVITY_MONTHS} meses</p>
          </div>
        )}
        <RowActions
          itemLabel={group.name}
          actions={[
            { label: "Añadir categoría", icon: Plus, onSelect: onStartAdd },
            { label: "Renombrar grupo", icon: Pencil, onSelect: onRenameGroup },
            { label: "Eliminar grupo", icon: Trash2, onSelect: onDeleteGroup, destructive: true, separated: true },
          ]}
        />
      </header>

      <ul className="flex-1 divide-y divide-border">
        {categories.map((cat) => {
          const act = activity.get(cat.id);
          const isIncome = act?.type === "income";
          const editing = editingCatId === cat.id;
          return (
            <li key={cat.id} className="group/row flex min-h-12 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40">
              {editing ? (
                <InlineNameInput
                  initial={cat.name}
                  placeholder="Nombre de la categoría"
                  onSave={(name) => onSaveCat(cat, name)}
                  onCancel={onCancelEditCat}
                  pending={pending}
                />
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onStartEditCat(cat)}
                      className="max-w-full cursor-text truncate rounded text-left text-sm text-foreground outline-none hover:underline hover:decoration-border hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                      title="Renombrar"
                    >
                      {cat.name}
                    </button>
                    {act && maxInGroup > 0 && (
                      <div className="mt-1.5 h-1 w-full max-w-48 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", isIncome ? "bg-emerald-500/70" : "bg-(--chart-2)/60")}
                          style={{ width: `${Math.max(4, (act.total / maxInGroup) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {act ? (
                      <>
                        <p className={cn("text-sm font-medium tabular-nums", isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                          {isIncome ? "+" : ""}{formatCurrency(act.total)}
                        </p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {act.count} {act.count === 1 ? "movimiento" : "movimientos"}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin movimientos</p>
                    )}
                  </div>
                  <RowActions
                    itemLabel={cat.name}
                    className="opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100 data-popup-open:opacity-100"
                    actions={[
                      { label: "Renombrar", icon: Pencil, onSelect: () => onStartEditCat(cat) },
                      { label: "Mover a otro grupo", icon: ArrowRightLeft, onSelect: () => onMoveCat(cat) },
                      { label: "Eliminar", icon: Trash2, onSelect: () => onDeleteCat(cat), destructive: true, separated: true },
                    ]}
                  />
                </>
              )}
            </li>
          );
        })}

        {categories.length === 0 && !addingHere && (
          <li className="px-5 py-6 text-center text-sm text-muted-foreground">
            {searching ? "Ninguna categoría coincide en este grupo." : "Este grupo aún no tiene categorías."}
          </li>
        )}
      </ul>

      <footer className="border-t border-border px-3 py-2">
        {addingHere ? (
          <div className="px-2 py-1">
            <InlineNameInput initial="" placeholder="Nueva categoría" onSave={onCreateCat} onCancel={onCancelAdd} pending={pending} />
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartAdd}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" /> Añadir categoría
          </button>
        )}
      </footer>
    </section>
  );
}

// ─── Página ─────────────────────────────────────────────────────
function CategoriesView() {
  const queryClient = useQueryClient();
  const { data: groups = [], isLoading, error } = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const range = useMemo(activityRange, []);
  const { data: analytics } = useQuery({
    queryKey: ["finance-analytics", "categories-activity", range.from, range.to],
    queryFn: () => getFinanceAnalytics(range),
  });

  const [search, setSearch] = useState("");
  const [groupDialog, setGroupDialog] = useState<{ mode: "create" } | { mode: "rename"; group: CategoryGroup } | null>(null);
  const [groupName, setGroupName] = useState("");
  const [addingToGroupId, setAddingToGroupId] = useState<number | null>(null);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<Category | null>(null);
  const [moveGroupId, setMoveGroupId] = useState<string>("");
  const [confirm, setConfirm] = useState<{ type: "group" | "category"; id: number; name: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["categories"] });

  const createGroupMut = useMutation({
    mutationFn: (name: string) => createCategoryGroup({ name }),
    onSuccess: () => { invalidate(); toast.success("Grupo creado"); setGroupDialog(null); },
    onError: () => toast.error("Error al crear grupo"),
  });

  const updateGroupMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateCategoryGroup(id, { name }),
    onSuccess: () => { invalidate(); toast.success("Grupo actualizado"); setGroupDialog(null); },
    onError: () => toast.error("Error al actualizar grupo"),
  });

  const deleteGroupMut = useMutation({
    mutationFn: (id: number) => deleteCategoryGroup(id),
    onSuccess: () => { invalidate(); toast.success("Grupo eliminado"); },
    onError: () => toast.error("Error al eliminar grupo (puede tener categorías con transacciones)"),
  });

  const createCatMut = useMutation({
    mutationFn: ({ groupId, name }: { groupId: number; name: string }) => createCategory({ groupId, name }),
    onSuccess: () => { invalidate(); toast.success("Categoría creada"); setAddingToGroupId(null); },
    onError: () => toast.error("Error al crear categoría"),
  });

  const updateCatMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; groupId?: number } }) => updateCategory(id, data),
    onSuccess: (_r, vars) => {
      invalidate();
      toast.success(vars.data.groupId ? "Categoría movida" : "Categoría actualizada");
      setEditingCatId(null);
      setMoveTarget(null);
    },
    onError: () => toast.error("Error al actualizar categoría"),
  });

  const deleteCatMut = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => { invalidate(); toast.success("Categoría eliminada"); },
    onError: () => toast.error("Error al eliminar categoría (puede tener transacciones asignadas)"),
  });

  const activity = useMemo(() => {
    const map = new Map<number, Activity>();
    for (const c of analytics?.categories ?? []) {
      if (c.categoryId == null) continue;
      const prev = map.get(c.categoryId);
      // Una categoría puede tener ingresos y gastos: prevalece el mayor.
      if (!prev || c.total > prev.total) map.set(c.categoryId, { total: c.total, count: c.count, type: c.type });
    }
    return map;
  }, [analytics]);

  const allCategories = useMemo(() => groups.flatMap((g) => g.categories), [groups]);

  const stats = useMemo(() => {
    const expenses = allCategories
      .map((c) => ({ c, a: activity.get(c.id) }))
      .filter((x) => x.a?.type === "expense")
      .sort((a, b) => (b.a!.total - a.a!.total));
    return {
      top: expenses[0],
      unused: allCategories.filter((c) => !activity.has(c.id)).length,
    };
  }, [allCategories, activity]);

  const q = normalize(search.trim());
  const visibleGroups = useMemo(() => {
    if (!q) return groups.map((g) => ({ group: g, categories: g.categories }));
    return groups
      .map((g) => {
        const groupMatch = normalize(g.name).includes(q);
        const categories = groupMatch ? g.categories : g.categories.filter((c) => normalize(c.name).includes(q));
        return { group: g, categories, show: groupMatch || categories.length > 0 };
      })
      .filter((x) => x.show);
  }, [groups, q]);

  const openCreateGroup = () => { setGroupName(""); setGroupDialog({ mode: "create" }); };
  const openRenameGroup = (g: CategoryGroup) => { setGroupName(g.name); setGroupDialog({ mode: "rename", group: g }); };
  const submitGroup = () => {
    const name = groupName.trim();
    if (!name || !groupDialog) return;
    if (groupDialog.mode === "create") createGroupMut.mutate(name);
    else updateGroupMut.mutate({ id: groupDialog.group.id, name });
  };

  const handleConfirmDelete = () => {
    if (!confirm) return;
    if (confirm.type === "group") deleteGroupMut.mutate(confirm.id);
    else deleteCatMut.mutate(confirm.id);
    setConfirm(null);
  };

  if (isLoading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudieron cargar las categorías" description="Revisa tu conexión y vuelve a intentarlo.">
        <Button variant="outline" onClick={invalidate}>Reintentar</Button>
      </EmptyState>
    );
  }

  const pending = createCatMut.isPending || updateCatMut.isPending;

  return (
    <div>
      <PageHeader
        title="Categorías"
        accent="con sentido."
        description="Agrupa tus movimientos para saber en qué se va cada euro. Pulsa el nombre de una categoría para renombrarla."
        actions={
          groups.length > 0 ? (
            <Button onClick={openCreateGroup} className="gap-1.5">
              <FolderPlus className="size-4" /> Nuevo grupo
            </Button>
          ) : undefined
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Aún no tienes categorías"
          description="Crea un grupo (por ejemplo «Vivienda» o «Alimentación») y añade categorías dentro, o impórtalas desde YNAB."
        >
          <Button onClick={openCreateGroup} className="gap-1.5"><FolderPlus className="size-4" /> Crear grupo</Button>
          <a href="/app/import" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
            <Download className="size-4" /> Importar YNAB
          </a>
        </EmptyState>
      ) : (
        <>
          <StatGrid className="grid-cols-2">
            <StatCard label="Grupos" value={groups.length} icon={Folder} hint="Para ordenar" />
            <StatCard label="Categorías" value={allCategories.length} icon={Tags} hint={`En ${groups.length} ${groups.length === 1 ? "grupo" : "grupos"}`} />
            <StatCard
              label="Mayor gasto"
              value={stats.top ? <span className="block truncate">{stats.top.c.name}</span> : "—"}
              icon={TrendingDown}
              hint={stats.top ? `${formatCurrency(stats.top.a!.total)} en ${ACTIVITY_MONTHS} meses` : `Sin gastos en ${ACTIVITY_MONTHS} meses`}
            />
            <StatCard
              label="Sin movimientos"
              value={stats.unused}
              icon={CircleSlash}
              hint={`Sin uso en ${ACTIVITY_MONTHS} meses`}
            />
          </StatGrid>

          <div className="mt-8 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Importes de los últimos {ACTIVITY_MONTHS} meses
            </p>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar grupo o categoría"
                aria-label="Buscar grupo o categoría"
                className="pl-8"
              />
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <EmptyState
              compact
              icon={Search}
              title="Sin resultados"
              description={`Ningún grupo ni categoría contiene «${search.trim()}».`}
              className="rounded-xl border border-dashed border-border"
            >
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>Limpiar búsqueda</Button>
            </EmptyState>
          ) : (
            <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {visibleGroups.map(({ group, categories }) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  categories={categories}
                  activity={activity}
                  searching={!!q}
                  editingCatId={editingCatId}
                  addingHere={addingToGroupId === group.id}
                  pending={pending}
                  onRenameGroup={() => openRenameGroup(group)}
                  onDeleteGroup={() => setConfirm({ type: "group", id: group.id, name: group.name })}
                  onStartAdd={() => { setEditingCatId(null); setAddingToGroupId(group.id); }}
                  onCancelAdd={() => setAddingToGroupId(null)}
                  onCreateCat={(name) => createCatMut.mutate({ groupId: group.id, name })}
                  onStartEditCat={(c) => { setAddingToGroupId(null); setEditingCatId(c.id); }}
                  onCancelEditCat={() => setEditingCatId(null)}
                  onSaveCat={(c, name) => {
                    if (name === c.name) { setEditingCatId(null); return; }
                    updateCatMut.mutate({ id: c.id, data: { name } });
                  }}
                  onMoveCat={(c) => { setMoveTarget(c); setMoveGroupId(""); }}
                  onDeleteCat={(c) => setConfirm({ type: "category", id: c.id, name: c.name })}
                />
              ))}
            </div>
          )}

          <CategoryRulesCard groups={groups} />
        </>
      )}

      {/* Crear / renombrar grupo */}
      <Dialog open={!!groupDialog} onOpenChange={(o) => { if (!o) setGroupDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); submitGroup(); }} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{groupDialog?.mode === "rename" ? "Renombrar grupo" : "Nuevo grupo"}</DialogTitle>
              <DialogDescription>
                {groupDialog?.mode === "rename" ? "El nuevo nombre se aplicará a todas sus categorías." : "Los grupos reúnen categorías relacionadas, como «Vivienda» o «Transporte»."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Nombre</Label>
              <Input id="group-name" autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ej: Vivienda" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGroupDialog(null)}>Cancelar</Button>
              <Button type="submit" disabled={!groupName.trim() || createGroupMut.isPending || updateGroupMut.isPending}>
                {groupDialog?.mode === "rename" ? "Guardar" : "Crear grupo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mover categoría */}
      <Dialog open={!!moveTarget} onOpenChange={(o) => { if (!o) setMoveTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (moveTarget && moveGroupId) updateCatMut.mutate({ id: moveTarget.id, data: { groupId: Number(moveGroupId) } });
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Mover «{moveTarget?.name}»</DialogTitle>
              <DialogDescription>Sus movimientos siguen asignados a la categoría; solo cambia de grupo.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="move-group">Grupo de destino</Label>
              <Select value={moveGroupId} onValueChange={(v) => setMoveGroupId(v ?? "")}>
                <SelectTrigger id="move-group" className="w-full">
                  <SelectValue placeholder="Elige un grupo">
                    {(v: string) => groups.find((g) => String(g.id) === v)?.name ?? "Elige un grupo"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.filter((g) => g.id !== moveTarget?.groupId).map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMoveTarget(null)}>Cancelar</Button>
              <Button type="submit" disabled={!moveGroupId || updateCatMut.isPending}>Mover</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!confirm}
        title={`Eliminar ${confirm?.type === "group" ? "grupo" : "categoría"}`}
        message={`¿Seguro que quieres eliminar "${confirm?.name ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default function CategoriesPage() {
  return (
    <Providers>
      <CategoriesView />
    </Providers>
  );
}
