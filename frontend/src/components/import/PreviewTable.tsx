import type { ImportPreviewRow } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { cn } from "cn";

function formatRangeDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
  return new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_LABEL: Record<ImportPreviewRow["status"], { label: string; className: string }> = {
  new: { label: "Nuevo", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  duplicate: { label: "Ya existe", className: "bg-muted text-muted-foreground" },
  skipped: { label: "Importe 0", className: "bg-muted text-muted-foreground" },
};

/** Muestra de filas de la vista previa: antes la revisión eran cuatro contadores. */
export function PreviewTable({ rows, hideAccount }: { rows: ImportPreviewRow[]; hideAccount?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Primeras filas del archivo y qué se hará con cada una</caption>
          <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Beneficiario</th>
              {!hideAccount && <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Cuenta · categoría</th>}
              <th scope="col" className="px-3 py-2 text-right font-medium">Importe</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={cn(r.status !== "new" && "text-muted-foreground")}>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatRangeDate(r.date)}</td>
                <td className="max-w-40 truncate px-3 py-2">{r.payee || "—"}</td>
                {!hideAccount && <td className="hidden max-w-56 truncate px-3 py-2 text-xs text-muted-foreground sm:table-cell">{[r.account, r.category].filter(Boolean).join(" · ")}</td>}
                <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", r.amount > 0 && "text-emerald-700 dark:text-emerald-400")}>
                  {r.amount > 0 ? "+" : ""}{formatCurrency(r.amount)}
                </td>
                <td className="px-3 py-2">
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", STATUS_LABEL[r.status].className)}>
                    {STATUS_LABEL[r.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 100 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Se muestran las 100 primeras filas.</p>}
    </div>
  );
}

