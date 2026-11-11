import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, LogOut, Monitor, Moon, ShieldCheck, Sun, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Providers } from "./Providers";
import { useAuth } from "./AuthProvider";
import {
  clearAuth, deleteMyAccount, exportAllData, exportData, getMe, getProfiles, previewBackup, restoreBackup, updateUserProfile,
  type BackupCounts, type BackupPreview,
} from "../lib/api";
import { plural } from "../lib/format";
import { disablePush, enablePush, getPushState, isPushSupported, needsInstallForPush, type PushState } from "../lib/push";
import { canPromptInstall, isStandalone, onInstallAvailabilityChange, promptInstall } from "../lib/install-prompt";
import { sendTestPush } from "../lib/api";
import { Switch } from "@/components/ui/switch";
import { supabase } from "../lib/supabase";
import { PageHeader, SectionCard } from "./app";
import { ProfileDot } from "./payroll/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { usePreference } from "@/hooks/use-preference";
import { useHydrated } from "@/hooks/use-hydrated";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";
import { CHART_PALETTES, DEFAULT_CHART_PALETTE, isChartPaletteId, previewColors } from "@/lib/chart-palettes";
import { cn } from "cn";

// Fila de ajustes: descripción a la izquierda, control a la derecha (apila en móvil).
function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-xs">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="w-full sm:max-w-sm">{children}</div>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

// Miniatura del tema: sidebar + tarjeta con gráfico, pintada con colores fijos
// a propósito (muestra cómo se verá cada tema, independientemente del activo).
const PREVIEW = {
  light: { frame: "#f3f1ec", line: "rgb(46 58 72 / 0.18)", accent: "#42af78", card: "#ffffff", ink: "rgb(46 58 72 / 0.45)" },
  dark: { frame: "#10151c", line: "rgb(255 255 255 / 0.16)", accent: "#40d880", card: "#1a212b", ink: "rgb(255 255 255 / 0.45)" },
} as const;

function PreviewPane({ tone }: { tone: "light" | "dark" }) {
  const c = PREVIEW[tone];
  return (
    <div className="flex h-full w-full gap-1.5 p-1.5" style={{ backgroundColor: c.frame }}>
      <div className="flex w-[22%] flex-col gap-1 pt-0.5">
        <div className="h-1 w-full rounded-full" style={{ backgroundColor: c.line }} />
        <div className="h-1 w-4/5 rounded-full" style={{ backgroundColor: c.accent }} />
        <div className="h-1 w-3/5 rounded-full" style={{ backgroundColor: c.line }} />
        <div className="h-1 w-4/5 rounded-full" style={{ backgroundColor: c.line }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 rounded-[5px] p-1.5 shadow-sm" style={{ backgroundColor: c.card }}>
        <div className="h-1 w-2/5 rounded-full" style={{ backgroundColor: c.ink }} />
        <div className="flex flex-1 items-end gap-[3px]">
          {[35, 55, 42, 70, 60, 88].map((h, i) => (
            <div key={i} className="flex-1 rounded-[2px]" style={{ height: `${h}%`, backgroundColor: c.accent, opacity: 0.55 + i * 0.08 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ variant }: { variant: ThemePreference }) {
  if (variant !== "system") return <PreviewPane tone={variant} />;
  return (
    <div className="relative h-full w-full">
      <PreviewPane tone="light" />
      <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
        <PreviewPane tone="dark" />
      </div>
    </div>
  );
}

function ThemePicker() {
  const { preference, setPreference } = useTheme();
  const keys = radioGroupKeys(THEME_OPTIONS.map((o) => o.value), preference, setPreference);
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-3">
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tabIndex={keys.tabIndex(value)}
            onKeyDown={keys.onKeyDown}
            onClick={() => setPreference(value)}
            className="group cursor-pointer text-left outline-none"
          >
            <div
              className={cn(
                "relative aspect-[16/11] overflow-hidden rounded-lg border transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring/50",
                selected ? "border-primary-500 ring-2 ring-primary-500/25 dark:border-primary dark:ring-primary/25" : "border-border group-hover:border-foreground/25",
              )}
            >
              <ThemePreview variant={value} />
              {selected && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </div>
            <span className={cn("mt-2 flex items-center gap-1.5 text-xs font-medium", selected ? "text-foreground" : "text-muted-foreground")}>
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Paleta de los gráficos: se aplica al momento en toda la app y sigue al usuario entre dispositivos. */
function ChartPalettePicker() {
  const [palette, setPalette] = usePreference("chart-palette", DEFAULT_CHART_PALETTE, isChartPaletteId);
  const { resolved } = useTheme();
  const heights = [62, 88, 46, 74, 55];
  const keys = radioGroupKeys(CHART_PALETTES.map((p) => p.id), palette, setPalette);
  return (
    <div role="radiogroup" aria-label="Paleta de los gráficos" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CHART_PALETTES.map((p) => {
        const selected = palette === p.id;
        const colors = previewColors(p.id, resolved);
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={keys.tabIndex(p.id)}
            onKeyDown={keys.onKeyDown}
            onClick={() => setPalette(p.id)}
            className="group cursor-pointer text-left outline-none"
          >
            <div
              className={cn(
                "relative flex h-16 items-end gap-1 overflow-hidden rounded-lg border bg-card px-3 pt-2 transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring/50",
                selected ? "border-primary-500 ring-2 ring-primary-500/25 dark:border-primary dark:ring-primary/25" : "border-border group-hover:border-foreground/25",
              )}
            >
              {colors.map((color, i) => (
                <span key={i} className="flex-1 rounded-t-sm" style={{ backgroundColor: color, height: `${heights[i]}%` }} aria-hidden="true" />
              ))}
              {selected && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </div>
            <span className={cn("mt-2 block text-xs font-medium", selected ? "text-foreground" : "text-muted-foreground")}>{p.label}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{p.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProfileSection() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // /auth/me directamente: AuthProvider solo carga el usuario si hay sesión, y
  // el formulario se montaba antes de tenerlo (nombre y email salían vacíos).
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data: avatarUrl } = useQuery({
    queryKey: ["session-avatar"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      const meta = (data.session?.user.user_metadata ?? {}) as { avatar_url?: string; picture?: string };
      return meta.avatar_url ?? meta.picture ?? null;
    },
    staleTime: Infinity,
  });

  const current = me ?? user;
  // null = sin editar: el campo muestra el valor cargado sin pisar lo que se escriba.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? current?.name ?? "";
  const dirty = draft !== null && draft.trim() !== (current?.name ?? "") && draft.trim().length > 0;

  const updateMut = useMutation({
    mutationFn: () => updateUserProfile({ name: name.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      setDraft(null);
      toast.success("Perfil actualizado");
    },
    onError: () => toast.error("No se pudo actualizar el perfil"),
  });

  const initials = (current?.name || current?.email || "?").split(/[\s@]/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <SectionCard title="Perfil" description="Tus datos de cuenta. El email viene de tu cuenta de Google.">
      {isLoading && !current ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-52" /></div>
          </div>
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); if (dirty) updateMut.mutate(); }}
          className="divide-y divide-border"
        >
          <div className="flex items-center gap-4 pb-5">
            <Avatar className="size-14 rounded-full">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary-700 dark:text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{current?.name || "Sin nombre"}</p>
              <p className="truncate text-sm text-muted-foreground">{current?.email}</p>
            </div>
          </div>
          <SettingRow title="Nombre" description="Cómo te saludamos en el inicio.">
            <Label htmlFor="settings-name" className="sr-only">Nombre</Label>
            <Input id="settings-name" value={name} onChange={(e) => setDraft(e.target.value)} required maxLength={100} autoComplete="name" />
          </SettingRow>
          <SettingRow title="Email" description="No se puede cambiar desde aquí.">
            <Label htmlFor="settings-email" className="sr-only">Email</Label>
            <Input id="settings-email" type="email" value={current?.email ?? ""} disabled />
          </SettingRow>
          <div className="flex justify-end gap-2 pt-5">
            {draft !== null && (
              <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={updateMut.isPending}>
                Descartar
              </Button>
            )}
            <Button type="submit" disabled={!dirty || updateMut.isPending} className="gap-1.5">
              {updateMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Guardar cambios
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}

const BACKUP_ROWS: Array<{ key: keyof BackupCounts; label: string }> = [
  { key: "profiles", label: "Perfiles" },
  { key: "payslips", label: "Nóminas" },
  { key: "accounts", label: "Cuentas" },
  { key: "categories", label: "Categorías" },
  { key: "transactions", label: "Movimientos" },
  { key: "recurringTransactions", label: "Recurrentes" },
  { key: "budgets", label: "Asignaciones de presupuesto" },
  { key: "categoryRules", label: "Reglas de categoría" },
  { key: "alertRules", label: "Reglas de alerta" },
];

/** Restaurar una copia de «Exportar todos mis datos»: vista previa y confirmación antes de sustituir nada. */
function RestoreBackupRow() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; preview: BackupPreview } | null>(null);

  const previewMut = useMutation({
    mutationFn: (file: File) => previewBackup(file).then((preview) => ({ file, preview })),
    onSuccess: setPending,
    onError: (e: Error) => toast.error(e.message),
  });
  const restoreMut = useMutation({
    mutationFn: (file: File) => restoreBackup(file),
    onSuccess: ({ restored }) => {
      setPending(null);
      // Las preferencias tienen copia local: fuera, para que manden las de la copia.
      try {
        for (const key of Object.keys(window.localStorage)) if (key.startsWith("sueldia:pref:")) window.localStorage.removeItem(key);
      } catch {
        // Sin almacenamiento local: nada que limpiar.
      }
      void queryClient.invalidateQueries();
      toast.success(`Copia restaurada: ${plural(restored.payslips, "nómina", "nóminas")} y ${plural(restored.transactions, "movimiento", "movimientos")}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportedAt = pending?.preview.exportedAt ? new Date(pending.preview.exportedAt) : null;
  const busy = previewMut.isPending || restoreMut.isPending;

  return (
    <>
      <SettingRow
        title="Restaurar una copia"
        description="Carga un archivo de «Exportar todos mis datos» para recuperar tu cuenta o llevarla a otra. Antes de cambiar nada verás qué contiene."
      >
        <div className="flex sm:justify-end">
          <input
            ref={inputRef}
            type="file"
            accept=".json,.gz,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) previewMut.mutate(file);
            }}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy} className="gap-1.5">
            {previewMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Restaurar una copia…
          </Button>
        </div>
      </SettingRow>

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !restoreMut.isPending) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Sustituir tus datos por esta copia?</AlertDialogTitle>
            <AlertDialogDescription>
              {exportedAt && !Number.isNaN(exportedAt.getTime())
                ? <>Copia del {exportedAt.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}. </>
                : null}
              Se borrará todo lo que hay ahora en tu cuenta y se cargará lo de la copia. No se puede deshacer: si quieres conservar lo actual, expórtalo antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-medium">Datos</th>
                  <th className="py-1.5 text-right font-medium">Ahora</th>
                  <th className="py-1.5 text-right font-medium">En la copia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {BACKUP_ROWS.filter((r) => pending.preview.current[r.key] > 0 || pending.preview.backup[r.key] > 0).map((r) => (
                  <tr key={r.key}>
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{pending.preview.current[r.key].toLocaleString("es-ES")}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{pending.preview.backup[r.key].toLocaleString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={restoreMut.isPending}
              className="gap-1.5"
              onClick={(e) => {
                e.preventDefault();
                if (pending) restoreMut.mutate(pending.file);
              }}
            >
              {restoreMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Sustituir mis datos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** «Instalar la app» (o cómo hacerlo en iPhone); nada si ya está instalada. */
function InstallRow() {
  const [, force] = useState(0);
  const hydrated = useHydrated();
  useEffect(() => onInstallAvailabilityChange(() => force((n) => n + 1)), []);
  if (!hydrated || isStandalone()) return null;
  const canPrompt = canPromptInstall();
  const ios = needsInstallForPush();
  if (!canPrompt && !ios) return null;
  return (
    <SettingRow
      title="Instalar SueldIA"
      description={
        canPrompt
          ? "Como una app más: con su icono, a pantalla completa y desde ella puedes compartir los PDF de tus nóminas directamente."
          : "En iPhone y iPad: botón Compartir de Safari → «Añadir a pantalla de inicio». Así también podrás recibir avisos."
      }
    >
      {canPrompt && (
        <div className="flex sm:justify-end">
          <Button
            variant="outline"
            onClick={async () => {
              if (await promptInstall()) toast.success("SueldIA instalada");
            }}
          >
            Instalar
          </Button>
        </div>
      )}
    </SettingRow>
  );
}

/** Avisos de alertas en este dispositivo (Web Push). */
function NotificationsSection() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState("off"));
  }, []);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (on && next === "denied") toast.error("El navegador ha bloqueado los avisos. Puedes permitirlos en los ajustes del sitio.");
      if (on && next === "on") toast.success("Avisos activados en este dispositivo");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cambiar los avisos");
      setState(await getPushState().catch(() => "off" as const));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const { sent } = await sendTestPush();
      if (sent > 0) toast.success("Aviso de prueba enviado");
      else toast.error("No se pudo entregar el aviso. Desactívalos y vuelve a activarlos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar el aviso");
    } finally {
      setBusy(false);
    }
  };

  // Lo que admite el navegador se mira tras hidratar: en el prerender no hay
  // navegador y salía «Este navegador no admite avisos» un instante.
  const hydrated = useHydrated();
  const supported = !hydrated || isPushSupported();
  const install = hydrated && needsInstallForPush();
  const description = !supported
    ? install
      ? "En iPhone y iPad, primero añade SueldIA a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí."
      : "Este navegador no admite avisos."
    : state === "denied"
      ? "Has bloqueado los avisos de SueldIA en este navegador. Para activarlos, permítelos en los ajustes del sitio."
      : "Te avisamos cuando salta una alerta (bajada del neto, nómina sin subir, presupuesto superado…). El aviso solo dice qué regla saltó, nunca importes. Se activa en cada dispositivo por separado.";

  return (
    <SectionCard title="App y avisos">
      <InstallRow />
      <SettingRow title="Avisos en este dispositivo" description={description}>
        <div className="flex items-center justify-end gap-3">
          {state === "on" && (
            <Button variant="outline" size="sm" onClick={test} disabled={busy}>
              Enviar uno de prueba
            </Button>
          )}
          {state === "loading" || busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
          <Switch
            checked={state === "on"}
            disabled={!supported || state === "denied" || state === "loading" || busy}
            onCheckedChange={(checked) => void toggle(checked)}
            aria-label="Avisos en este dispositivo"
          />
        </div>
      </SettingRow>
    </SectionCard>
  );
}

function DataSection() {
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });
  const [busy, setBusy] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const handleExport = async (profileId: number, format: "xlsx" | "csv" | "json") => {
    setBusy(`${profileId}-${format}`);
    try {
      await exportData(profileId, undefined, format);
    } catch {
      toast.error("No se pudo exportar. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  const handleExportAll = async () => {
    setExportingAll(true);
    try {
      await exportAllData();
    } catch {
      toast.error("No se pudieron exportar tus datos. Inténtalo de nuevo.");
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <SectionCard title="Tus datos" description="Descarga el histórico de nóminas de cada perfil, o toda la información de tu cuenta.">
      {isLoading ? (
        <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no tienes perfiles con nóminas que exportar.</p>
      ) : (
        <ul className="divide-y divide-border">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0">
              <ProfileDot color={p.color} name={p.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.name}</span>
              {(["xlsx", "csv", "json"] as const).map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport(p.id, format)}
                  disabled={busy !== null}
                  className="gap-1.5"
                  aria-label={`Exportar ${p.name} en ${format === "xlsx" ? "Excel" : format.toUpperCase()}`}
                >
                  {busy === `${p.id}-${format}` ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {format === "xlsx" ? "Excel" : format.toUpperCase()}
                </Button>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-border pt-5">
        <SettingRow
          title="Exportar todos mis datos"
          description="Toda la información de tu cuenta en un único archivo JSON: perfiles, nóminas, conceptos, notas, cuentas, categorías, movimientos y alertas. Es tu derecho de portabilidad y te sirve de copia de seguridad (los PDF no se guardan)."
        >
          <div className="flex sm:justify-end">
            <Button variant="outline" onClick={handleExportAll} disabled={exportingAll} className="gap-1.5">
              {exportingAll ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar todos mis datos
            </Button>
          </div>
        </SettingRow>
      </div>
      <div className="mt-5 border-t border-border pt-5">
        <RestoreBackupRow />
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-600 dark:text-primary" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Los PDF se procesan en memoria y se descartan: solo guardamos los datos extraídos. Cada cuenta ve únicamente sus propios perfiles y nóminas.
        </p>
      </div>
    </SectionCard>
  );
}

function DangerZoneSection() {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await deleteMyAccount();
      await clearAuth();
      // Los datos ya están borrados; si la identidad de Google no se pudo
      // cerrar, se dice en la portada en vez de dar a entender que todo fue bien.
      window.location.href = result.identityDeleted === false ? "/?cuenta=datos-borrados" : "/?cuenta=eliminada";
    } catch {
      toast.error("No se pudo eliminar la cuenta. Inténtalo de nuevo.");
      setDeleting(false);
    }
  };

  return (
    <SectionCard title="Zona de peligro" description="Acciones permanentes sobre tu cuenta.">
      <SettingRow
        title="Eliminar mi cuenta"
        description="Borra tu cuenta y todos tus datos —nóminas, movimientos y ajustes— de forma permanente."
      >
        <div className="flex sm:justify-end">
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Eliminar mi cuenta
          </Button>
        </div>
      </SettingRow>

      <AlertDialog open={open} onOpenChange={(next) => { if (!deleting) setOpen(next); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mb-1 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-destructive/10">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <AlertDialogTitle>¿Eliminar tu cuenta definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán para siempre todas tus nóminas, movimientos, cuentas, categorías, alertas y ajustes. Esta
              acción no se puede deshacer y no hay forma de recuperar tus datos después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleDelete} className="gap-1.5">
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Eliminar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function SettingsView() {
  const { logout } = useAuth();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ajustes" description="Tu cuenta, la apariencia de la app y tus datos." />

      <div className="space-y-6">
        <ProfileSection />

        <SectionCard title="Apariencia">
          <SettingRow title="Tema" description="Claro, oscuro o el mismo que tu sistema. Se aplica al momento.">
            <ThemePicker />
          </SettingRow>
          <SettingRow title="Colores de los gráficos" description="Elige la paleta que mejor lees. Se aplica en todos los gráficos y la recordamos en tus otros dispositivos.">
            <ChartPalettePicker />
          </SettingRow>
        </SectionCard>

        <NotificationsSection />

        <DataSection />

        <SectionCard title="Sesión">
          <SettingRow title="Cerrar sesión" description="Saldrás de SueldIA en este navegador.">
            <div className="flex sm:justify-end">
              <Button variant="outline" onClick={logout} className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="size-4" />
                Cerrar sesión
              </Button>
            </div>
          </SettingRow>
        </SectionCard>

        <DangerZoneSection />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Providers>
      <SettingsView />
    </Providers>
  );
}
