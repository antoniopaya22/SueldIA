import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  getAccounts, importBankCsv, inspectBankCsv,
  type BankCsvInspect, type BankCsvMapping, type BankCsvResult,
} from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";
import { plural } from "../../lib/format";
import { usePreference } from "../../hooks/use-preference";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { PreviewTable } from "./PreviewTable";

// Mapeos guardados por «firma» de la cabecera: la segunda vez que se sube un
// extracto del mismo banco, las columnas ya vienen elegidas.
type SavedMappings = Record<string, BankCsvMapping>;
const signatureOf = (header: string[]) => header.map((h) => h.trim().toLowerCase()).join("|");

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30";

function ColumnSelect({ id, label, value, onChange, header, optional }: {
  id: string;
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  header: string[];
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {optional && <option value="">— Ninguna —</option>}
        {header.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
      </select>
    </div>
  );
}

export function BankImport({ onImported }: { onImported: (batchId: string) => void }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const activeAccounts = accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<BankCsvInspect | null>(null);
  const [mapping, setMapping] = useState<BankCsvMapping | null>(null);
  const [preview, setPreview] = useState<BankCsvResult | null>(null);
  const [result, setResult] = useState<BankCsvResult | null>(null);
  const [saved, setSaved] = usePreference<SavedMappings>("bank-csv-mappings", {});

  const reset = () => {
    setFile(null);
    setInspect(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
  };

  const inspectMut = useMutation({
    mutationFn: inspectBankCsv,
    onSuccess: (data) => {
      setInspect(data);
      setMapping(saved[signatureOf(data.header)] ?? data.mapping);
      setPreview(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewMut = useMutation({
    mutationFn: () => importBankCsv(file!, Number(accountId), inspect!.headerIndex, mapping!, true),
    onSuccess: setPreview,
    onError: (e: Error) => toast.error(e.message),
  });

  const importMut = useMutation({
    mutationFn: () => importBankCsv(file!, Number(accountId), inspect!.headerIndex, mapping!, false),
    onSuccess: (data) => {
      setResult(data);
      setSaved((prev) => ({ ...prev, [signatureOf(inspect!.header)]: mapping! }));
      invalidateFinance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      if (data.batchId) onImported(data.batchId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = (patch: Partial<BankCsvMapping>) => {
    setMapping((m) => (m ? { ...m, ...patch } : m));
    setPreview(null);
  };
  const amountMode = mapping?.amountColumn != null ? "single" : "split";
  const known = useMemo(() => (inspect ? !!saved[signatureOf(inspect.header)] : false), [inspect, saved]);
  const busy = inspectMut.isPending || previewMut.isPending || importMut.isPending;

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">{plural(result.summary.transactions, "movimiento importado", "movimientos importados")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[
                result.summary.categorized ? `${plural(result.summary.categorized, "categorizado", "categorizados")} con tus reglas` : null,
                result.summary.duplicates ? `${plural(result.summary.duplicates, "ya existía", "ya existían")}` : null,
              ].filter(Boolean).join(" · ") || "Listos en Transacciones."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <a href={`/app/transactions?cuenta=${accountId}&sin_categoria=1`} className={cn(buttonVariants(), "gap-1.5")}>
            Categorizar lo que falta <ArrowRight className="size-4" />
          </a>
          <Button variant="ghost" onClick={reset} className="gap-1.5 text-muted-foreground"><RotateCcw className="size-4" /> Importar otro extracto</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Paso 1: cuenta y archivo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bank-account">Cuenta en la que importar</Label>
          <select id="bank-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Elige una cuenta…</option>
            {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {activeAccounts.length === 0 && (
            <p className="text-xs text-muted-foreground">Primero crea la cuenta en <a href="/app/accounts" className="underline">Cuentas</a>.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bank-file">Extracto (CSV o TXT)</Label>
          <input
            id="bank-file"
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setInspect(null);
              setMapping(null);
              setPreview(null);
              if (f) inspectMut.mutate(f);
            }}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
          />
        </div>
      </div>

      {inspectMut.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Leyendo el archivo…</p>}

      {/* Paso 2: columnas */}
      {inspect && mapping && (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <div className="flex items-start gap-2">
            <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">¿Qué es cada columna?</p>
              <p className="text-xs text-muted-foreground">
                {known ? "Usamos las columnas que elegiste la última vez para este banco." : "Las hemos propuesto a partir de la cabecera; corrígelas si hace falta."}
                {" "}{plural(inspect.totalLines, "fila", "filas")} en el archivo.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>{inspect.header.map((h, i) => <th key={i} scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">{h || `Columna ${i + 1}`}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inspect.sample.slice(0, 3).map((row, r) => (
                  <tr key={r}>{inspect.header.map((_, i) => <td key={i} className="max-w-48 truncate px-2 py-1.5 whitespace-nowrap">{row[i]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ColumnSelect id="map-date" label="Fecha" value={mapping.dateColumn} onChange={(v) => v != null && update({ dateColumn: v })} header={inspect.header} />
            <div className="space-y-1.5">
              <Label htmlFor="map-date-format">Formato de fecha</Label>
              <select id="map-date-format" className={selectClass} value={mapping.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as BankCsvMapping["dateFormat"] })}>
                <option value="DD/MM/YYYY">Día/mes/año (31/12/2026)</option>
                <option value="YYYY-MM-DD">Año-mes-día (2026-12-31)</option>
                <option value="MM/DD/YYYY">Mes/día/año (12/31/2026)</option>
              </select>
            </div>
            <ColumnSelect id="map-payee" label="Concepto o beneficiario" value={mapping.payeeColumn} onChange={(v) => v != null && update({ payeeColumn: v })} header={inspect.header} />
            <ColumnSelect id="map-memo" label="Nota (opcional)" value={mapping.memoColumn} onChange={(v) => update({ memoColumn: v })} header={inspect.header} optional />
            <div className="space-y-1.5">
              <Label htmlFor="map-amount-mode">Importe</Label>
              <select
                id="map-amount-mode"
                className={selectClass}
                value={amountMode}
                onChange={(e) =>
                  e.target.value === "single"
                    ? update({ amountColumn: mapping.debitColumn ?? 0, debitColumn: null, creditColumn: null })
                    : update({ amountColumn: null, debitColumn: mapping.amountColumn ?? 0, creditColumn: mapping.amountColumn ?? 0 })
                }
              >
                <option value="single">Una columna con signo (−12,50)</option>
                <option value="split">Dos columnas: cargo y abono</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-decimal">Decimales</Label>
              <select id="map-decimal" className={selectClass} value={mapping.decimal} onChange={(e) => update({ decimal: e.target.value as BankCsvMapping["decimal"] })}>
                <option value="comma">Coma (1.234,56)</option>
                <option value="dot">Punto (1,234.56)</option>
              </select>
            </div>
            {amountMode === "single" ? (
              <ColumnSelect id="map-amount" label="Columna del importe" value={mapping.amountColumn} onChange={(v) => v != null && update({ amountColumn: v })} header={inspect.header} />
            ) : (
              <>
                <ColumnSelect id="map-debit" label="Columna de cargos" value={mapping.debitColumn} onChange={(v) => v != null && update({ debitColumn: v })} header={inspect.header} />
                <ColumnSelect id="map-credit" label="Columna de abonos" value={mapping.creditColumn} onChange={(v) => v != null && update({ creditColumn: v })} header={inspect.header} />
              </>
            )}
          </div>

          {!preview && (
            <div className="flex justify-end">
              <Button onClick={() => previewMut.mutate()} disabled={busy || accountId === ""} className="gap-1.5">
                {previewMut.isPending && <Loader2 className="size-4 animate-spin" />} Ver vista previa
              </Button>
            </div>
          )}
          {accountId === "" && <p className="text-right text-xs text-muted-foreground">Elige la cuenta para continuar.</p>}
        </div>
      )}

      {/* Paso 3: vista previa */}
      {preview && (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{plural(preview.summary.transactions, "movimiento nuevo", "movimientos nuevos")}</span>
            {preview.summary.duplicates > 0 && <span className="text-muted-foreground"> · {plural(preview.summary.duplicates, "ya existe", "ya existen")} y se omitirá{preview.summary.duplicates === 1 ? "" : "n"}</span>}
          </p>
          {preview.errors && preview.errors.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm" role="status">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <AlertCircle className="size-4" aria-hidden="true" /> {plural(preview.summary.errors, "fila no se puede leer", "filas no se pueden leer")} y no se importará{preview.summary.errors === 1 ? "" : "n"}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {preview.errors.slice(0, 5).map((e) => <li key={e.line}>Línea {e.line}: {e.reason}</li>)}
              </ul>
            </div>
          )}
          {preview.sample && <PreviewTable rows={preview.sample} hideAccount />}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy} className="text-muted-foreground">Cambiar columnas</Button>
            <Button onClick={() => importMut.mutate()} disabled={busy || preview.summary.transactions === 0} className="gap-1.5">
              {importMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Importar {plural(preview.summary.transactions, "movimiento", "movimientos")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
