import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { getTaxSummary } from "../../lib/api";
import { formatCurrency, formatPct } from "../../lib/format";
import { SectionCard } from "../app";
import { MONTHS_SHORT } from "./shared";
import { cn } from "cn";

/**
 * Resumen de un año para la declaración de la Renta: lo que la empresa
 * debería reflejar en el certificado de retenciones (bruto, retenciones de
 * IRPF y cotizaciones), con los meses que faltan por subir.
 */
export function TaxSummaryCard({ profileId, years }: { profileId: number; years: number[] }) {
  const [year, setYear] = useState(years[0]);
  const activeYear = years.includes(year) ? year : years[0];
  const { data } = useQuery({
    queryKey: ["tax-summary", profileId, activeYear],
    queryFn: () => getTaxSummary(profileId, activeYear),
    enabled: !!activeYear,
  });
  if (!activeYear) return null;

  return (
    <SectionCard
      title="Para la declaración de la Renta"
      icon={Landmark}
      description="Compáralo con el certificado de retenciones que te da la empresa."
      action={
        years.length > 1 ? (
          <select
            aria-label="Año"
            value={activeYear}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        ) : undefined
      }
    >
      {!data ? (
        <p className="text-sm text-muted-foreground">Calculando…</p>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Retribuciones íntegras (bruto)</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(data.grossTotal)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Retenciones de IRPF</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(data.irpfWithheld)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cotizaciones a la Seguridad Social</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(data.socialSecurity)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tipo medio de retención</dt><dd className="font-medium tabular-nums text-foreground">{data.effectiveIrpfRate != null ? formatPct(data.effectiveIrpfRate) : "—"}</dd></div>
            {data.inKind > 0 && (
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Retribución en especie</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(data.inKind)}</dd></div>
            )}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Neto cobrado</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(data.netTotal)}</dd></div>
          </dl>
          {data.estimate && (
            <div
              className={cn(
                "mt-4 rounded-lg border px-3 py-2.5 text-sm",
                data.estimate.verdict === "short" ? "border-amber-500/30 bg-amber-500/5" : data.estimate.verdict === "long" ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30",
              )}
            >
              <p className="font-medium text-foreground">
                {data.estimate.verdict === "short"
                  ? `Tu retención parece ir corta: en la Renta podrías tener que pagar unos ${formatCurrency(data.estimate.difference)}.`
                  : data.estimate.verdict === "long"
                    ? `Tu retención parece ir larga: en la Renta podrían devolverte unos ${formatCurrency(-data.estimate.difference)}.`
                    : "Tu retención parece ajustada a lo que te tocaría pagar."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.estimate.complete ? "Con el año completo" : `Proyectando al año lo cobrado hasta ahora (${formatCurrency(data.estimate.projectedGross)} brutos)`}: impuesto estimado {formatCurrency(data.estimate.estimatedTax)} ({formatPct(data.estimate.estimatedRate)}) frente a {formatCurrency(data.estimate.projectedWithheld)} retenidos.
                {" "}Estimación aproximada con la escala general de {data.estimate.paramsYear}: no tiene en cuenta tu comunidad autónoma, situación familiar, deducciones ni otros ingresos.
              </p>
            </div>
          )}
          {data.missingMonths.length > 0 && (
            <p className="mt-4 rounded-lg bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Faltan nóminas de {data.missingMonths.map((m) => MONTHS_SHORT[m - 1]).join(", ")}: las cifras solo cuentan lo subido.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Sumado a partir de tus nóminas ({data.payslips}). Es una referencia: la cifra oficial es la del certificado de la empresa.
          </p>
        </>
      )}
    </SectionCard>
  );
}
