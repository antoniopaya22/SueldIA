import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, LogOut, Monitor, Moon, ShieldCheck, Sun, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Providers } from "./Providers";
import { useAuth } from "./AuthProvider";
import { clearAuth, deleteMyAccount, exportAllData, exportData, getMe, getProfiles, updateUserProfile } from "../lib/api";
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

function DataSection() {
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });
  const [busy, setBusy] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const handleExport = async (profileId: number, format: "csv" | "json") => {
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
              {(["csv", "json"] as const).map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport(p.id, format)}
                  disabled={busy !== null}
                  className="gap-1.5"
                  aria-label={`Exportar ${p.name} en ${format.toUpperCase()}`}
                >
                  {busy === `${p.id}-${format}` ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {format.toUpperCase()}
                </Button>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-border pt-5">
        <SettingRow
          title="Exportar todos mis datos"
          description="Toda la información de tu cuenta en un único archivo JSON: perfiles, nóminas, conceptos, notas, cuentas, categorías, movimientos y alertas. Es tu derecho de portabilidad."
        >
          <div className="flex sm:justify-end">
            <Button variant="outline" onClick={handleExportAll} disabled={exportingAll} className="gap-1.5">
              {exportingAll ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar todos mis datos
            </Button>
          </div>
        </SettingRow>
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
      await deleteMyAccount();
      await clearAuth();
      window.location.href = "/";
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
