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
import { REGIONS, regionName } from "../lib/regions";
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

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30";

/** «14 pagas · Jornada 50 % · Acme S.L. · Madrid», con lo que haya. */
function profileDetails(p: Profile): string {
  return [
    p.paymentsPerYear ? `${p.paymentsPerYear} pagas` : null,
    p.workdayPercent != null && p.workdayPercent < 100 ? `Jornada ${p.workdayPercent} %` : null,
    p.employer,
    regionName(p.region),
  ].filter(Boolean).join(" · ");
}

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
  const [payments, setPayments] = useState<"" | "12" | "14">(profile?.paymentsPerYear ? String(profile.paymentsPerYear) as "12" | "14" : "");
  const [workday, setWorkday] = useState(profile?.workdayPercent != null ? String(profile.workdayPercent) : "");
  const [employer, setEmployer] = useState(profile?.employer ?? "");
  const [region, setRegion] = useState(profile?.region ?? "");
  const editing = profile !== null;
  const workdayNum = workday.trim() === "" ? null : Number(workday);
  const invalidWorkday = workdayNum !== null && (!Number.isInteger(workdayNum) || workdayNum < 1 || workdayNum > 100);
  const colorKeys = radioGroupKeys(COLORS, color, setColor);

  const saveMut = useMutation({
    mutationFn: () => {
      const data = {
        name: name.trim(),
        color,
        paymentsPerYear: payments ? (Number(payments) as 12 | 14) : null,
        workdayPercent: workdayNum,
        employer: employer.trim() || null,
        region: region || null,
      };
      return editing ? updateProfile(profile.id, data) : createProfile(data);
    },
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
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && !invalidWorkday) saveMut.mutate(); }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar perfil" : "Nuevo perfil"}</DialogTitle>
            <DialogDescription>
              {editing ? "Nombre, color y datos del contrato de este perfil." : "Cada perfil tiene su propio histórico de nóminas y su analítica."}
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

          <fieldset className="mt-6 space-y-4 border-t border-border pt-5">
            <legend className="sr-only">Datos del contrato</legend>
            <div>
              <p className="text-sm font-medium text-foreground">Datos del contrato <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <p className="mt-0.5 text-xs text-muted-foreground">Afinan la proyección anual y la comprobación del salario mínimo.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-payments">Pagas al año</Label>
                <select id="profile-payments" className={selectClass} value={payments} onChange={(e) => setPayments(e.target.value as "" | "12" | "14")}>
                  <option value="">No lo sé</option>
                  <option value="12">12 (extras prorrateadas)</option>
                  <option value="14">14 (con dos extras)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-workday">Jornada (%)</Label>
                <Input
                  id="profile-workday"
                  inputMode="numeric"
                  value={workday}
                  onChange={(e) => setWorkday(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  placeholder="100 = completa"
                  aria-invalid={invalidWorkday}
                  aria-describedby={invalidWorkday ? "profile-workday-error" : undefined}
                />
                {invalidWorkday && <p id="profile-workday-error" className="text-xs text-destructive">Entre 1 y 100.</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-employer">Empresa</Label>
              <Input id="profile-employer" value={employer} onChange={(e) => setEmployer(e.target.value)} placeholder="Para quién trabaja" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-region">Comunidad autónoma</Label>
              <select id="profile-region" className={selectClass} value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Sin indicar</option>
                {REGIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
          </fieldset>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!name.trim() || invalidWorkday || saveMut.isPending}>
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
          {profileDetails(profile) && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{profileDetails(profile)}</p>}
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
    onError: (e: Error) => toast.error("No se pudo eliminar el perfil", { description: e.message }),
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
