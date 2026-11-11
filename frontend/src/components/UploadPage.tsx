import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  ArrowRight, Building2, CalendarDays, CheckCircle2, CircleAlert, Eye, FileText, FileUp, Gift,
  Loader2, Lock, RotateCcw, ScanLine, Sparkles, Upload, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { getProfiles, uploadPayslips, type Payslip } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useSelectedProfile } from "../hooks/use-selected-profile";
import { useLeaveGuard } from "../hooks/use-leave-guard";
import { Providers } from "./Providers";
import { PageHeader, PageHeaderSkeleton, SectionCard, Segmented } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { ProfileSelector } from "./ui/ProfileSelector";
import { StatusBadge, ExtraBadge, formatPeriod } from "./payroll/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";

// Debe coincidir con el límite del backend (middleware/upload.ts) — Vercel
// Functions rechaza cualquier petición de más de 4.5MB de cuerpo.
const MAX_SIZE = 4 * 1024 * 1024;

type ItemState = "queued" | "uploading" | "done" | "failed";

interface QueueItem {
  id: string;
  file: File;
  state: ItemState;
  result?: Payslip;
  error?: string;
  /** Perfil y tipo con los que se subió (o se intentó): «Reintentar» usa estos, no la selección actual. */
  profileId?: number;
  payslipType?: "ordinal" | "extra";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

// ─── Fila de la cola ────────────────────────────────────────────
function QueueRow({ item, onRemove, onRetry, disabled }: {
  item: QueueItem;
  onRemove: () => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  const r = item.result;
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border",
          item.state === "done" ? "bg-primary/10" : item.state === "failed" ? "bg-destructive/10" : "bg-muted/60",
        )}
      >
        {item.state === "uploading" ? (
          <Loader2 className="size-4 animate-spin text-primary-600 dark:text-primary" />
        ) : item.state === "done" ? (
          <CheckCircle2 className="size-4 text-primary-600 dark:text-primary" />
        ) : item.state === "failed" ? (
          <CircleAlert className="size-4 text-destructive" />
        ) : (
          <FileText className="size-4 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.file.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.state === "queued" && `${formatFileSize(item.file.size)} · en cola`}
          {item.state === "uploading" && "Extrayendo conceptos…"}
          {item.state === "failed" && (item.error ?? "No se pudo procesar")}
          {item.state === "done" && r && (
            <>
              {formatPeriod(r.periodMonth, r.periodYear)}
              {r.company && <> · {r.company}</>}
            </>
          )}
        </p>
        {item.state === "done" && r?.alreadyUploaded && (
          <p className="mt-1 text-xs text-muted-foreground">
            Este PDF ya estaba subido: no se ha guardado otra vez.{" "}
            <a href={`/app/payslips?nomina=${r.id}`} className="font-medium whitespace-nowrap text-foreground underline underline-offset-2">Ver nómina</a>
          </p>
        )}
        {item.state === "done" && r?.duplicateOfId && !r.alreadyUploaded && (
          // Antes era un aviso que desaparecía a los pocos segundos.
          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Ya tenías una nómina de {formatPeriod(r.periodMonth, r.periodYear)} en este perfil: puede ser un duplicado.{" "}
              <a href={`/app/payslips?nomina=${r.duplicateOfId}`} className="font-medium whitespace-nowrap underline underline-offset-2">Ver la anterior</a>
            </span>
          </p>
        )}
        {item.state === "uploading" && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-primary-500/30 via-primary-500 to-primary-500/30 dark:from-primary/30 dark:via-primary dark:to-primary/30" />
          </div>
        )}
      </div>

      {item.state === "done" && r && (
        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(r.netSalary)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">de {formatCurrency(r.grossSalary)}</p>
        </div>
      )}
      {item.state === "done" && r && <StatusBadge status={r.parsingStatus} className="hidden md:inline-flex" />}

      {item.state === "queued" && (
        <Button variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled} aria-label={`Quitar ${item.file.name}`} className="text-muted-foreground hover:text-destructive">
          <X className="size-4" />
        </Button>
      )}
      {item.state === "failed" && (
        <Button variant="ghost" size="sm" onClick={onRetry} disabled={disabled} className="gap-1.5">
          <RotateCcw className="size-3.5" /> Reintentar
        </Button>
      )}
      {item.state !== "uploading" && (
        // El PDF no se guarda en el servidor, pero mientras sigue aquí se puede
        // abrir desde el propio navegador para comparar con lo extraído.
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const url = URL.createObjectURL(item.file);
            window.open(url, "_blank", "noopener");
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
          aria-label={`Ver el PDF ${item.file.name}`}
          title="Ver el PDF (solo en este navegador, no se guarda)"
          className="text-muted-foreground"
        >
          <Eye className="size-4" />
        </Button>
      )}
      {item.state === "done" && r && (
        <a
          href={`/app/payslips?nomina=${r.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
          aria-label={`Ver nómina de ${formatPeriod(r.periodMonth, r.periodYear)}`}
        >
          <ArrowRight className="size-4" />
        </a>
      )}
    </li>
  );
}

// ─── Resumen de resultados ──────────────────────────────────────
function ResultsSummary({ items }: { items: QueueItem[] }) {
  const done = items.filter((i) => i.state === "done" && i.result && !i.result.alreadyUploaded);
  const review = done.filter((i) => i.result!.parsingStatus !== "parsed");
  const failed = items.filter((i) => i.state === "failed");
  if (done.length + failed.length === 0) return null;

  const ok = done.length - review.length;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="size-4 text-primary-600 dark:text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {ok > 0 ? `${ok} ${ok === 1 ? "nómina lista" : "nóminas listas"}` : "Subida terminada"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              review.length > 0 && `${review.length} para revisar`,
              failed.length > 0 && `${failed.length} con error`,
              review.length === 0 && failed.length === 0 && "Todo se ha extraído correctamente",
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {review.length > 0 ? (
          <a href="/app/payslips?estado=review" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Revisar {review.length === 1 ? "la pendiente" : `las ${review.length} pendientes`}
          </a>
        ) : (
          <a href="/app/payroll" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Ver dashboard</a>
        )}
        <a href="/app/payslips" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
          Mis nóminas <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

// ─── Vista ──────────────────────────────────────────────────────
function UploadManager() {
  const queryClient = useQueryClient();
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });

  const [selectedProfile, setSelectedProfile] = useSelectedProfile(profiles.map((p) => p.id));
  const [payslipType, setPayslipType] = useState<"ordinal" | "extra">("ordinal");
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const patch = (id: string, changes: Partial<QueueItem>) =>
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  // Un archivo por petición: progreso y resultado individuales, y un PDF
  // problemático no tumba al resto.
  const uploadMut = useMutation({
    mutationFn: async (items: QueueItem[]) => {
      if (!selectedProfile) return;
      for (const item of items) {
        // Se fija al empezar: cambiar el selector a mitad de tanda (o antes de
        // reintentar) ya no manda archivos a otro perfil sin querer.
        const profileId = item.profileId ?? selectedProfile;
        const type = item.payslipType ?? payslipType;
        patch(item.id, { state: "uploading", error: undefined, profileId, payslipType: type });
        try {
          const [result] = await uploadPayslips(profileId, [item.file], type);
          patch(item.id, { state: "done", result });
        } catch (err) {
          patch(item.id, { state: "failed", error: err instanceof Error ? err.message : "No se pudo procesar" });
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    if (accepted.length) {
      setQueue((q) => [
        // Una nueva tanda sustituye a los resultados ya terminados.
        ...q.filter((i) => i.state === "queued"),
        ...accepted.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, state: "queued" as const })),
      ]);
    }
    for (const r of rejected) {
      const tooBig = r.errors.some((e) => e.code === "file-too-large");
      toast.error(tooBig ? `${r.file.name} supera los 4 MB` : `${r.file.name} no es un PDF`);
    }
  }, []);

  const busy = uploadMut.isPending;
  // Salir a mitad de tanda cortaba la cola sin avisar.
  useLeaveGuard(busy, "Todavía se están subiendo nóminas. Si sales, las que faltan no se subirán. ¿Salir?");
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_SIZE,
    multiple: true,
    noClick: true,
    disabled: busy,
  });

  const pending = queue.filter((i) => i.state === "queued");
  const totalSize = useMemo(() => pending.reduce((s, i) => s + i.file.size, 0), [pending]);
  const doneCount = queue.filter((i) => i.state === "done" || i.state === "failed").length;
  const activeProfile = profiles.find((p) => p.id === selectedProfile);

  if (isLoading) {
    return (
      <>
        <PageHeaderSkeleton />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </>
    );
  }

  if (profiles.length === 0) {
    return (
      <>
        <PageHeader title="Sube tus" accent="nóminas." description="Arrastra los PDF de tus nóminas y extraemos cada concepto automáticamente." />
        <EmptyState
          icon={Users}
          title="Primero, crea un perfil"
          description="Las nóminas se guardan dentro de un perfil (tú, tu pareja…). Crea uno y vuelve aquí para subirlas."
          actionLabel="Crear perfil"
          actionHref="/app/profiles"
          actionIcon={ArrowRight}
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Sube tus"
        accent="nóminas."
        description="Arrastra los PDF digitales de tus nóminas: extraemos periodo, empresa, bruto, neto y cada concepto en segundos."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard>
            {/* Bloqueado mientras se sube: la tanda usa el perfil y el tipo del momento de empezar. */}
            <fieldset disabled={busy} className="grid gap-5 disabled:opacity-60 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Perfil</p>
                {profiles.length > 1 ? (
                  <ProfileSelector profiles={profiles} value={selectedProfile ?? profiles[0].id} onChange={(v) => setSelectedProfile(v as number)} />
                ) : (
                  <p className="text-sm font-medium text-foreground">{profiles[0].name}</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Tipo de nómina</p>
                <Segmented
                  aria-label="Tipo de nómina"
                  size="md"
                  value={payslipType}
                  onChange={setPayslipType}
                  options={[
                    { value: "ordinal", label: "Mensual", icon: CalendarDays },
                    { value: "extra", label: "Paga extra", icon: Gift },
                  ]}
                />
              </div>
            </fieldset>

            <div
              {...getRootProps()}
              aria-label="Zona para soltar archivos PDF"
              className={cn(
                "relative mt-6 overflow-hidden rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all duration-200",
                isDragActive ? "border-primary-500 bg-primary/5 dark:border-primary" : "border-border bg-muted/30",
                busy && "opacity-60",
              )}
            >
              <input {...getInputProps()} />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,var(--color-primary)_0%,transparent_60%)] opacity-[0.06]" aria-hidden="true" />
              <div
                className={cn(
                  "relative mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm transition-transform",
                  isDragActive && "scale-110",
                )}
              >
                <FileUp className="size-6 text-primary-600 dark:text-primary" aria-hidden="true" />
              </div>
              <p className="relative mt-4 text-base font-semibold text-foreground">
                {isDragActive ? "Suelta los archivos aquí" : "Arrastra tus nóminas en PDF"}
              </p>
              <p className="relative mt-1 text-sm text-muted-foreground">
                {activeProfile ? <>Se guardarán en <span className="font-medium text-foreground">{activeProfile.name}</span> · </> : null}
                varios a la vez · máx. 4 MB por archivo
              </p>
              <Button type="button" variant="outline" onClick={open} disabled={busy} className="relative mt-5 gap-1.5">
                <Upload className="size-4" /> Elegir archivos
              </Button>
            </div>
          </SectionCard>

          {queue.length > 0 && (
            <SectionCard
              title={busy ? `Procesando ${Math.min(doneCount + 1, queue.length)} de ${queue.length}` : pending.length > 0 ? `${pending.length} ${pending.length === 1 ? "archivo listo" : "archivos listos"} para subir` : "Resultado"}
              description={pending.length > 0 && !busy ? `${formatFileSize(totalSize)} en total` : undefined}
              action={
                !busy && pending.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setQueue((q) => q.filter((i) => i.state !== "queued"))} className="text-muted-foreground">
                    Vaciar
                  </Button>
                ) : undefined
              }
              flush
              footer={
                pending.length > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5"><Lock className="size-3.5" /> El PDF se descarta tras extraer los datos</span>
                    <Button onClick={() => uploadMut.mutate(pending)} disabled={busy || !selectedProfile} className="gap-1.5">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {busy ? "Procesando…" : `Subir ${pending.length} ${pending.length === 1 ? "nómina" : "nóminas"}`}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              <ul className="divide-y divide-border">
                {queue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    disabled={busy}
                    onRemove={() => setQueue((q) => q.filter((i) => i.id !== item.id))}
                    onRetry={() => uploadMut.mutate([item])}
                  />
                ))}
              </ul>
            </SectionCard>
          )}

          {!busy && <ResultsSummary items={queue} />}
        </div>

        <div className="space-y-6">
          <SectionCard title="Qué puedes subir">
            <ul className="space-y-4">
              {[
                { icon: FileText, title: "PDF digital", text: "El que descargas del portal del empleado o te envía la empresa." },
                { icon: Building2, title: "Empresa privada y organismos públicos", text: "Reconocemos los dos formatos más habituales en España." },
                { icon: ScanLine, title: "Sin fotos ni escaneos", text: "Leemos el texto del PDF directamente, sin OCR." },
              ].map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Después de subir">
            <ol className="space-y-3 text-sm">
              {[
                ["Procesada", "Lista para el dashboard y la analítica."],
                ["Revisar", "No se detectó algún concepto: ábrela y complétalo a mano."],
                ["Paga extra", "Si el PDF lo indica se marca sola; si no, cámbialo en el detalle."],
              ].map(([label, text], i) => (
                <li key={label} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary-700 dark:text-primary">{i + 1}</span>
                  <p className="text-muted-foreground"><span className="font-medium text-foreground">{label}.</span> {text}</p>
                </li>
              ))}
            </ol>
            {payslipType === "extra" && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <ExtraBadge /> Las nóminas de esta tanda se guardarán como paga extra.
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Providers>
      <UploadManager />
    </Providers>
  );
}
