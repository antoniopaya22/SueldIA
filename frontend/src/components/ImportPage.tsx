import { useState, useCallback } from "react";
import { plural } from "../lib/format";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, ArrowRight, AlertTriangle,
  Eye, X, Landmark, Tags, Receipt, CalendarRange, Check, RotateCcw,
} from "lucide-react";
import { importYnab, type ImportResult } from "../lib/api";
import { Providers } from "./Providers";
import { invalidateFinance } from "../lib/finance-cache";
import { toast } from "sonner";
import { PageHeader, SectionCard } from "./app";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Archivo" },
  { n: 2, label: "Revisión" },
  { n: 3, label: "Listo" },
];

function formatRangeDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  return new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Pasos de la importación">
      {STEPS.map((s, i) => {
        const done = step > s.n;
        const current = step === s.n;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-2 last:flex-none" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                current && "border-primary/50 bg-primary/10 text-primary-700 dark:text-primary",
                !done && !current && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : s.n}
            </span>
            <span className={cn("text-sm", current ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
            {i < STEPS.length - 1 && <span className={cn("mx-1 h-px flex-1", done ? "bg-primary/50" : "bg-border")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function SummaryTiles({ summary }: { summary: ImportResult["summary"] }) {
  const tiles = [
    { label: "Cuentas", value: summary.accounts, icon: Landmark, hint: summary.accounts === 1 ? "cuenta" : "cuentas" },
    { label: "Categorías", value: summary.categoryGroups + summary.categories, icon: Tags, hint: `${plural(summary.categoryGroups, "grupo", "grupos")} · ${plural(summary.categories, "categoría", "categorías")}` },
    { label: "Transacciones", value: summary.transactions, icon: Receipt, hint: "movimientos" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {t.label}
            <t.icon className="size-3.5" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{t.value.toLocaleString("es-ES")}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.hint}</p>
        </div>
      ))}
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          Periodo
          <CalendarRange className="size-3.5" aria-hidden="true" />
        </div>
        <p className="mt-2 text-sm font-semibold text-foreground">{formatRangeDate(summary.dateRange.from)}</p>
        <p className="text-sm font-semibold text-foreground">→ {formatRangeDate(summary.dateRange.to)}</p>
      </div>
    </div>
  );
}

function DuplicatesNote({ count, done }: { count: number; done: boolean }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5" role="status">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="text-sm text-amber-900 dark:text-amber-200">
        {done ? (
          <>Se omitieron <strong>{count}</strong> movimientos que ya tenías importados.</>
        ) : (
          <>
            <strong>{count}</strong> movimientos ya existen (misma fecha, importe, cuenta y beneficiario) y se omitirán, así
            que puedes reimportar un export más reciente sin duplicar.
          </>
        )}
      </p>
    </div>
  );
}

function ImportView() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMut = useMutation({
    mutationFn: (f: File) => importYnab(f, true),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setPreview(null);
    },
  });

  const importMut = useMutation({
    mutationFn: (f: File) => importYnab(f, false),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      setFile(null);
      toast.success("Importación completada correctamente");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateFinance(queryClient);
    },
    onError: (err: Error) => {
      setError(err.message);
      toast.error("Error al importar datos");
    },
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setFile(accepted[0]);
      setResult(null);
      setPreview(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/tab-separated-values": [".tsv"],
    },
    multiple: false,
    noClick: !!file,
    onDropRejected: () => setError("El archivo debe ser un CSV o TSV exportado desde YNAB."),
  });

  const handlePreview = () => {
    if (!file) return;
    setError(null);
    previewMut.mutate(file);
  };

  const handleImport = () => {
    if (!file) return;
    setError(null);
    importMut.mutate(file);
  };

  const step: Step = result ? 3 : preview ? 2 : 1;
  const busy = previewMut.isPending || importMut.isPending;

  return (
    <div>
      <PageHeader
        title="Importar"
        accent="desde YNAB."
        description="Trae tus cuentas, categorías y transacciones a partir del CSV que exporta YNAB. Puedes revisar el resultado antes de confirmar."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard>
          <Stepper step={step} />

          <div className="mt-6 space-y-5">
            {/* Paso 1 — archivo */}
            {step === 1 && (
              <>
                <div
                  {...getRootProps()}
                  aria-label="Zona de carga de archivos CSV"
                  className={cn(
                    "relative flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                    file ? "border-border bg-muted/20" : "cursor-pointer",
                    isDragActive ? "border-primary/60 bg-primary/5" : !file && "border-border hover:border-primary/40 hover:bg-primary/[0.03]",
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
                    <div className="absolute inset-0 rounded-2xl bg-primary/5" />
                    <FileSpreadsheet className="relative size-6 text-primary-600 dark:text-primary" aria-hidden="true" />
                  </div>
                  {file ? (
                    <>
                      <p className="font-medium text-foreground">{file.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">{formatSize(file.size)}</p>
                      <div className="mt-4 flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={open} disabled={busy}>Cambiar archivo</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy} className="gap-1 text-muted-foreground">
                          <X className="size-3.5" /> Quitar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-foreground">{isDragActive ? "Suelta el archivo aquí" : "Arrastra tu CSV de YNAB"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        o <span className="font-medium text-primary-700 underline-offset-4 hover:underline dark:text-primary">elige un archivo</span> (.csv, .tsv)
                      </p>
                    </>
                  )}
                </div>

                {file && (
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={handleImport} disabled={busy} className="gap-1.5">
                      {importMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {importMut.isPending ? "Importando…" : "Importar sin revisar"}
                    </Button>
                    <Button onClick={handlePreview} disabled={busy} className="gap-1.5">
                      {previewMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                      {previewMut.isPending ? "Analizando…" : "Revisar antes de importar"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* Paso 2 — revisión */}
            {step === 2 && preview && (
              <>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Esto es lo que se va a importar</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Desde <span className="font-medium text-foreground">{file?.name}</span>. Todavía no se ha guardado nada.
                  </p>
                </div>
                <SummaryTiles summary={preview.summary} />
                <DuplicatesNote count={preview.summary.duplicates ?? 0} done={false} />
                <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={reset} disabled={busy} className="gap-1.5 text-muted-foreground">
                    <RotateCcw className="size-4" /> Elegir otro archivo
                  </Button>
                  <Button onClick={handleImport} disabled={busy} className="gap-1.5">
                    {importMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {importMut.isPending ? "Importando…" : "Confirmar importación"}
                  </Button>
                </div>
              </>
            )}

            {/* Paso 3 — listo */}
            {step === 3 && result && (
              <>
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                    <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Importación completada</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">Tus datos ya están disponibles en Finanzas.</p>
                  </div>
                </div>
                <SummaryTiles summary={result.summary} />
                <DuplicatesNote count={result.summary.duplicates ?? 0} done />
                <div className="flex flex-wrap gap-2 border-t border-border pt-5">
                  <a href="/app/transactions" className={cn(buttonVariants(), "gap-1.5")}>
                    Ver transacciones <ArrowRight className="size-4" />
                  </a>
                  <a href="/app/accounts" className={buttonVariants({ variant: "outline" })}>Ver cuentas</a>
                  <Button variant="ghost" onClick={reset} className="gap-1.5 text-muted-foreground">
                    <RotateCcw className="size-4" /> Importar otro archivo
                  </Button>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-destructive">No se pudo procesar el archivo</p>
                  <p className="mt-0.5 text-sm text-destructive/80">{error}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Comprueba que es el CSV de transacciones exportado desde YNAB, sin modificar.</p>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <aside className="space-y-4">
          <SectionCard title="Cómo exportar desde YNAB">
            <ol className="space-y-3">
              {[
                "Abre YNAB y entra en tu presupuesto.",
                "En una cuenta o en «Todas las cuentas», pulsa Exportar.",
                "Elige formato CSV y descarga el archivo.",
                "Súbelo aquí y revisa el resultado antes de confirmar.",
              ].map((text, i) => (
                <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-[11px] font-semibold text-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
          <SectionCard title="Qué se importa">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Las cuentas y categorías que no existan se crean automáticamente.</li>
              <li>Los movimientos que ya tengas se omiten: puedes reimportar sin duplicar.</li>
              <li>El archivo no se guarda: solo se leen sus movimientos.</li>
            </ul>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}

export default function ImportPage() {
  return (
    <Providers>
      <ImportView />
    </Providers>
  );
}
