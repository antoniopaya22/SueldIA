import { useState } from "react";
import { Home } from "lucide-react";
import type { HouseholdYear } from "../../lib/api";
import { formatCurrency, formatPct, plural } from "../../lib/format";
import { SectionCard, Segmented } from "../app";
import { ProfileDot, adaptiveProfileColor } from "./shared";

/**
 * Vista de hogar: lo que entra en casa entre todos los perfiles y cuánto
 * aporta cada uno. Solo sale con dos o más perfiles con nóminas.
 */
export function HouseholdCard({ household, className }: { household: HouseholdYear[]; className?: string }) {
  const years = household.slice(0, 4);
  const [yearKey, setYearKey] = useState(String(years[0]?.year ?? ""));
  const year = years.find((y) => String(y.year) === yearKey) ?? years[0];
  if (!year) return null;

  const isCurrent = year.year === new Date().getFullYear();
  const showProjection = isCurrent && year.projectedAnnualNet > year.totalNet;

  return (
    <SectionCard
      className={className}
      icon={Home}
      title="Hogar"
      description="Lo que entra en casa entre todos y cuánto aporta cada uno"
      action={
        years.length > 1 ? (
          <Segmented
            aria-label="Año"
            value={String(year.year)}
            onChange={setYearKey}
            options={years.map((y) => ({ value: String(y.year), label: String(y.year) }))}
          />
        ) : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <p className="text-xs text-muted-foreground">Neto del hogar en {year.year}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{formatCurrency(year.totalNet)}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Bruto</dt>
              <dd className="tabular-nums text-foreground">{formatCurrency(year.totalGross)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">IRPF retenido</dt>
              <dd className="tabular-nums text-foreground">{formatCurrency(year.totalIrpf)}</dd>
            </div>
            {showProjection && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Previsto para el año</dt>
                <dd className="font-medium tabular-nums text-foreground">{formatCurrency(year.projectedAnnualNet)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          {/* Reparto del neto: una barra apilada con el color de cada perfil. */}
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={year.members.map((m) => `${m.name}: ${formatPct(m.shareOfNet)}`).join(", ")}>
            {year.members.map((m) => (
              <div key={m.profileId} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${m.shareOfNet}%`, backgroundColor: adaptiveProfileColor(m.color) }} />
            ))}
          </div>
          <ul className="mt-4 divide-y divide-border">
            {year.members.map((m) => (
              <li key={m.profileId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <ProfileDot color={m.color} name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(m.payslips, "nómina", "nóminas")} · {formatCurrency(m.avgMonthlyNet)} netos al mes
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(m.totalNet)}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{formatPct(m.shareOfNet)} del hogar</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
