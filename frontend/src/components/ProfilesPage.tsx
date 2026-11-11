import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, BarChart3, Check, FileText, MoreHorizontal, Pencil, Plus, Trash2, Upload, Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  createProfile, deleteProfile, getPayslips, getProfiles, updateProfile, type Profile,
} from "../lib/api";
import { formatCurrency } from "../lib/format";
import { Providers } from "./Providers";
import { PageHeader, PageHeaderSkeleton } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import { ProfileDot, adaptiveProfileColor, formatPeriod } from "./payroll/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";

const COLORS = [
  "#2a8558", "#2e3a48", "#3b82f6", "#8b5cf6",
  "#ec4899", "#ef4444", "#f59e0b", "#6366f1",
  "#14b8a6", "#06b6d4",
];

function formatSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

// ─── Formulario (alta / edición) ────────────────────────────────
function ProfileDialog({
  open, profile, onOpenChange,
}: {
  open: boolean;
  profile: Profile | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile?.name ?? "");
  const [color, setColor] = useState(profile?.color ?? COLORS[0]);
  const editing = profile !== null;
  const colorKeys = radioGroupKeys(COLORS, color, setColor);

  const saveMut = useMutation({
    mutationFn: () =>
      editing ? updateProfile(profile.id, { name: name.trim(), color }) : createProfile({ name: name.trim(), color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(editing ? "Perfil actualizado" : "Perfil creado");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar el perfil"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveMut.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar perfil" : "Nuevo perfil"}</DialogTitle>
            <DialogDescription>
              {editing ? "Cambia el nombre o el color con el que aparece en gráficas y listados." : "Cada perfil tiene su propio histórico de nóminas y su analítica."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex items-center gap-4 rounded-xl border border-border bg-muted/40 p-4">
            <ProfileDot color={color} name={name.trim() || "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{name.trim() || "Nombre del perfil"}</p>
              <p className="text-xs text-muted-foreground">Vista previa</p>
            </div>
          </div>

          <div className="mt-5 space-y-1.5">
            <Label htmlFor="profile-name">Nombre</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: Yo, Mi pareja…"
              maxLength={60}
              autoFocus
              required
            />
          </div>

          <div className="mt-5 space-y-2">
            <Label id="profile-color-label">Color</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="profile-color-label">
              {COLORS.map((c) => {
                const selected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Color ${c}`}
                    tabIndex={colorKeys.tabIndex(c)}
                    onKeyDown={colorKeys.onKeyDown}
                    onClick={() => setColor(c)}
                    className={cn(
                      "flex size-8 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "ring-2 ring-foreground/70" : "hover:scale-110",
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {selected && <Check className="size-4 text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!name.trim() || saveMut.isPending}>
              {saveMut.isPending ? "Guardando…" : editing ? "Guardar cambios" : "Crear perfil"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tarjeta de perfil ──────────────────────────────────────────
function ProfileCard({
  profile, total, latest, loading, onEdit, onDelete,
}: {
  profile: Profile;
  total: number | undefined;
  latest: { periodMonth: number | null; periodYear: number | null; netSalary: number | null } | undefined;
  loading: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-shadow hover:shadow-md">
      <div className="h-1 w-full" style={{ backgroundColor: adaptiveProfileColor(profile.color) }} aria-hidden="true" />
      <div className="flex items-start gap-3.5 p-5 pb-4">
        <ProfileDot color={profile.color} name={profile.name} size="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-base font-semibold text-foreground">{profile.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Desde {formatSince(profile.createdAt)}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Opciones de ${profile.name}`} className="-mr-1.5 text-muted-foreground" />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onClick={onEdit} className="gap-2"><Pencil className="size-4" /> Editar</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} variant="destructive" className="gap-2"><Trash2 className="size-4" /> Eliminar</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <dl className="mx-5 grid grid-cols-2 divide-x divide-border rounded-lg border border-border bg-muted/30">
        <div className="px-3.5 py-3">
          <dt className="text-[11px] font-medium text-muted-foreground">Nóminas</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
            {loading ? <Skeleton className="mt-1 h-5 w-8" /> : total ?? 0}
          </dd>
        </div>
        <div className="min-w-0 px-3.5 py-3">
          <dt className="truncate text-[11px] font-medium text-muted-foreground">
            {latest ? `Neto · ${formatPeriod(latest.periodMonth, latest.periodYear)}` : "Última nómina"}
          </dt>
          <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums text-foreground">
            {loading ? <Skeleton className="mt-1 h-5 w-20" /> : latest ? formatCurrency(latest.netSalary) : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-1 p-3 pt-4">
        <a href={`/app/payslips?perfil=${profile.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "flex-1 gap-1.5 text-muted-foreground hover:text-foreground")}>
          <FileText className="size-3.5" /> Nóminas
        </a>
        <a href={`/app/analytics?perfil=${profile.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "flex-1 gap-1.5 text-muted-foreground hover:text-foreground")}>
          <BarChart3 className="size-3.5" /> Analítica
        </a>
        <a href={`/app/upload?perfil=${profile.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "flex-1 gap-1.5 text-muted-foreground hover:text-foreground")}>
          <Upload className="size-3.5" /> Subir
        </a>
      </div>
    </article>
  );
}

function ProfileCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-20" /></div>
      </div>
      <Skeleton className="mt-5 h-16 w-full rounded-lg" />
      <Skeleton className="mt-4 h-8 w-full" />
    </div>
  );
}

// ─── Vista ──────────────────────────────────────────────────────
function ProfilesManager() {
  const queryClient = useQueryClient();
  const { data: profiles = [], isLoading, error } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });

  // Una consulta ligera por perfil: total de nóminas + la más reciente.
  const summaries = useQueries({
    queries: profiles.map((p) => ({
      queryKey: ["payslips", p.id, "summary"],
      queryFn: () => getPayslips({ profileId: p.id, sortBy: "period", sortDir: "desc", page: 1, limit: 1 }),
    })),
  });

  const [dialog, setDialog] = useState<{ open: boolean; profile: Profile | null; key: number }>({ open: false, profile: null, key: 0 });
  const [toDelete, setToDelete] = useState<Profile | null>(null);

  const openDialog = (profile: Profile | null) => setDialog((d) => ({ open: true, profile, key: d.key + 1 }));

  const deleteMut = useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      toast.success("Perfil eliminado");
    },
    onError: () => toast.error("No se pudo eliminar el perfil"),
  });

  const newButton = (
    <Button onClick={() => openDialog(null)} className="gap-1.5">
      <Plus className="size-4" /> Nuevo perfil
    </Button>
  );

  const totalPayslips = summaries.reduce((s, q) => s + (q.data?.total ?? 0), 0);

  return (
    <div>
      {isLoading ? (
        <>
          <PageHeaderSkeleton />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <ProfileCardSkeleton key={i} />)}
          </div>
        </>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="No se pudieron cargar los perfiles" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["profiles"] })}>Reintentar</Button>
        </EmptyState>
      ) : (
        <>
          <PageHeader
            title="Perfiles"
            description={
              profiles.length > 0
                ? `${profiles.length} ${profiles.length === 1 ? "perfil" : "perfiles"} · ${totalPayslips} ${totalPayslips === 1 ? "nómina" : "nóminas"} en total. Cada perfil tiene su propio histórico y analítica.`
                : "Las personas cuyas nóminas gestionas: tú, tu pareja, otra fuente de ingresos…"
            }
            actions={profiles.length > 0 ? newButton : undefined}
          />

          {profiles.length === 0 ? (
            <EmptyState icon={Users} title="Crea tu primer perfil" description="Un perfil agrupa las nóminas de una persona. Puedes crear varios y compararlos en el dashboard.">
              {newButton}
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((p, i) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  total={summaries[i]?.data?.total}
                  latest={summaries[i]?.data?.data[0]}
                  loading={!!summaries[i]?.isLoading}
                  onEdit={() => openDialog(p)}
                  onDelete={() => setToDelete(p)}
                />
              ))}
              <button
                type="button"
                onClick={() => openDialog(null)}
                className="flex min-h-40 cursor-pointer sm:min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-6 text-center transition-colors outline-none hover:border-primary-500/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-border bg-card">
                  <Plus className="size-5 text-primary-600 dark:text-primary" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">Añadir perfil</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">Otra persona u otra fuente de ingresos</span>
                </span>
              </button>
            </div>
          )}
        </>
      )}

      {/* key: remonta el formulario con los valores del perfil a editar */}
      <ProfileDialog
        key={dialog.key}
        open={dialog.open}
        profile={dialog.profile}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar perfil"
        message={`¿Eliminar el perfil "${toDelete?.name ?? ""}" y todas sus nóminas? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (toDelete) deleteMut.mutate(toDelete.id); setToDelete(null); }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

export default function ProfilesPage() {
  return (
    <Providers>
      <ProfilesManager />
    </Providers>
  );
}
