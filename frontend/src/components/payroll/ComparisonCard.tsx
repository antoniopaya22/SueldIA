import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, GitCompare } from "lucide-react";
import { getPayslipComparison, type PayslipComparison } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { SectionCard, Segmented } from "../app";
import { formatPeriod } from "./shared";
import { cn } from "cn";

type Against = "previous" | "lastYear";

function Change({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(value) < 0.005) return <span className="text-muted-foreground">=</span>;
  // En deducciones, subir es «malo» para el neto.
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 tabular-nums", good ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      <Icon className="size-3" aria-hidden="true" />
      {value > 0 ? "+" : "−"}{formatCurrency(Math.abs(value))}
    </span>
  );
}

/** Esta nómina frente a la del mes anterior o la del mismo mes del año pasado, concepto a concepto. */
export function ComparisonCard({ payslipId, netSalary, grossSalary }: { payslipId: number; netSalary: number | null; grossSalary: number | null }) {
  const { data } = useQuery({ queryKey: ["payslip-compare", payslipId], queryFn: () => getPayslipComparison(payslipId) });
  const [against, setAgainst] = useState<Against>("previous");
  if (!data || (!data.previous && !data.lastYear)) return null;
  const options = [
    ...(data.previous ? [{ value: "previous" as const, label: "Mes anterior" }] : []),
    ...(data.lastYear ? [{ value: "lastYear" as const, label: "Hace un año" }] : []),
  ];
  const active: Against = data[against] ? against : options[0].value;
  const other = data[active] as PayslipComparison;
  const changed = other.concepts.filter((c) => c.change == null || Math.abs(c.change) >= 0.005);

  return (
    <SectionCard
      title="Comparar"
      icon={GitCompare}
      description={`Frente a ${formatPeriod(other.periodMonth, other.periodYear, true)}`}
      action={options.length > 1 ? <Segmented aria-label="Comparar con" size="sm" value={active} onChange={setAgainst} options={options} /> : undefined}
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Neto</dt><dd className="font-medium"><Change value={netSalary != null && other.netSalary != null ? netSalary - other.netSalary : null} /></dd></div>
        <div><dt className="text-xs text-muted-foreground">Bruto</dt><dd className="font-medium"><Change value={grossSalary != null && other.grossSalary != null ? grossSalary - other.grossSalary : null} /></dd></div>
      </dl>
      {changed.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Los conceptos son iguales.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border text-sm">
          {changed.map((c) => (
            <li key={`${c.category}-${c.name}`} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-foreground">
                {c.name}
                {c.other == null && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary-700 dark:text-primary">Nuevo</span>}
                {c.current == null && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">Ya no está</span>}
              </span>
              {c.change != null ? <Change value={c.change} invert={c.category === "deduccion"} /> : (
                <span className="tabular-nums text-muted-foreground">{formatCurrency(c.current ?? c.other)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
