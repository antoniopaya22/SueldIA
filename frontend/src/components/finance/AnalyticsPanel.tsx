import { Fragment, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChartColumn, Maximize2, Table2 } from "lucide-react";
import { SectionCard } from "../app";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ExportTable } from "../../lib/export-utils";
import { ChartExportMenu } from "../app/ChartExportMenu";
import { formatCompact, formatCurrency } from "../../lib/format";
import { ChartEmpty, tint } from "./finance-ui";
import { cn } from "cn";

export interface PanelConfig {
  title: string;
  description: string;
  controls?: ReactNode;
  render: (expanded: boolean) => ReactNode;
  /** Datos del panel tal y como se ven, para descargarlos en CSV. Sin él, el panel no ofrece CSV. */
  exportTable?: () => ExportTable | null;
}

// En pantallas estrechas un Segmented de muchas opciones no cabe: que haga
// scroll horizontal en vez de desbordar la card o partir las etiquetas.
const CONTROLS_CLASS =
  "flex flex-wrap items-center gap-2 [&_[role=radiogroup]]:max-w-full [&_[role=radiogroup]]:overflow-x-auto [&_[role=radio]]:shrink-0 [&_[role=radio]]:whitespace-nowrap";

/** Menú de descarga de un panel (PNG del gráfico y CSV de sus datos). */
function PanelExportMenu({ panel, rootRef, note }: { panel: PanelConfig; rootRef: RefObject<HTMLDivElement | null>; note?: string }) {
  return <ChartExportMenu title={panel.title} rootRef={rootRef} exportTable={panel.exportTable} note={note} />;
}

/** Cifra con miles agrupados; con dos decimales si la columna los tiene (importes), sin ellos si no (recuentos). */
// es-ES no agrupa miles en cifras de 4 dígitos por defecto ("2150"): como en formatCurrency.
const numberFmt = (digits: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
const DECIMAL_FMT = numberFmt(2);
const INTEGER_FMT = numberFmt(0);
const cellText = (v: string | number | null, decimals: boolean) =>
  v === null || v === undefined ? "—" : typeof v === "number" ? (decimals ? DECIMAL_FMT : INTEGER_FMT).format(v) : v;

/**
 * Los datos del panel como tabla: la alternativa al gráfico para lectores de
 * pantalla, y para quien prefiere leer cifras exactas.
 */
function PanelDataTable({ panel }: { panel: PanelConfig }) {
  const table = panel.exportTable?.();
  if (!table || table.rows.length === 0) return <ChartEmpty message="No hay datos con esta configuración." height={160} />;
  const decimals = table.headers.map((_, i) => table.rows.some((row) => typeof row[i] === "number" && !Number.isInteger(row[i])));
  return (
    <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{panel.title}</caption>
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {table.headers.map((h, i) => (
              <th key={h} scope="col" className={cn("px-3 py-2 text-xs font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, i) =>
                i === 0
                  ? <th key={i} scope="row" className="px-3 py-1.5 text-left font-normal text-foreground">{cellText(v, decimals[i])}</th>
                  : <td key={i} className="px-3 py-1.5 text-right tabular-nums">{cellText(v, decimals[i])}</td>,
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Alterna entre el gráfico y sus datos en tabla (solo si el panel expone sus datos). */
function TableToggle({ panel, asTable, onToggle }: { panel: PanelConfig; asTable: boolean; onToggle: () => void }) {
  if (!panel.exportTable) return null;
  const label = asTable ? `Ver «${panel.title}» como gráfico` : `Ver «${panel.title}» como tabla`;
  return (
    <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-pressed={asTable} aria-label={label} title={asTable ? "Ver como gráfico" : "Ver como tabla"}>
      {asTable ? <ChartColumn className="size-4 text-muted-foreground" /> : <Table2 className="size-4 text-muted-foreground" />}
    </Button>
  );
}

/** Card de la analítica: cabecera, fila de controles, descarga y botón para ampliar. */
export function AnalyticsPanel({ panel, onExpand, className, exportNote }: { panel: PanelConfig; onExpand: () => void; className?: string; exportNote?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [asTable, setAsTable] = useState(false);
  return (
    <SectionCard
      className={className}
      title={panel.title}
      description={panel.description}
      action={
        <div className="flex items-center">
          <TableToggle panel={panel} asTable={asTable} onToggle={() => setAsTable((v) => !v)} />
          <PanelExportMenu panel={panel} rootRef={bodyRef} note={exportNote} />
          <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label={`Ampliar «${panel.title}»`} title="Ampliar">
            <Maximize2 className="size-4 text-muted-foreground" />
          </Button>
        </div>
      }
    >
      {panel.controls && <div className={cn("mb-5", CONTROLS_CLASS)}>{panel.controls}</div>}
      <div ref={bodyRef}>{asTable ? <PanelDataTable panel={panel} /> : panel.render(false)}</div>
    </SectionCard>
  );
}

/** Vista ampliada de un panel, con los mismos controles. */
export function ExpandedPanelDialog({ panel, onClose, exportNote }: { panel: PanelConfig | null; onClose: () => void; exportNote?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [asTable, setAsTable] = useState(false);
  return (
    <Dialog open={panel !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        {panel && (
          <>
            <div className="border-b border-border px-6 py-5 pr-14">
              <DialogTitle className="text-lg font-semibold">{panel.title}</DialogTitle>
              <DialogDescription className="mt-1">{panel.description}</DialogDescription>
              <div className={cn("mt-4", CONTROLS_CLASS)}>
                {panel.controls}
                <span className="ml-auto flex items-center">
                  <TableToggle panel={panel} asTable={asTable} onToggle={() => setAsTable((v) => !v)} />
                  <PanelExportMenu panel={panel} rootRef={bodyRef} note={exportNote} />
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5"><div ref={bodyRef}>{asTable ? <PanelDataTable panel={panel} /> : panel.render(true)}</div></div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Título de bloque dentro de la página de analítica. */
export function AnalyticsSection({ title, description, children, className }: { title: string; description: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-10", className)}>
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export interface MatrixRow {
  key: string;
  label: string;
  total: number;
  values: Array<{ month: string; label: string; value: number }>;
}

/** Mapa de calor serie × mes. La intensidad se mezcla con color-mix para seguir el tema. */
export function MatrixHeatmap({ months, rows, color, expanded }: {
  months: Array<{ month: string; label: string }>;
  rows: MatrixRow[];
  color: string;
  expanded: boolean;
}) {
  if (!rows.length) {
    return <ChartEmpty message="No hay datos suficientes para construir la matriz temporal." height={expanded ? 480 : 300} />;
  }

  const maxValue = Math.max(...rows.flatMap((row) => row.values.map((v) => v.value)), 0);
  const cell = expanded ? 76 : 60;

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `minmax(150px, 190px) repeat(${months.length}, minmax(${cell}px, 1fr))`,
          minWidth: `${190 + months.length * (cell + 4)}px`,
        }}
      >
        <div />
        {months.map((m) => (
          <div key={m.month} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">{m.label}</div>
        ))}
        {rows.map((row) => (
          <Fragment key={row.key}>
            <div className="flex flex-col justify-center pr-3">
              <p className="truncate text-sm font-medium text-foreground" title={row.label}>{row.label}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{formatCurrency(row.total)}</p>
            </div>
            {row.values.map((v) => {
              const intensity = maxValue > 0 ? v.value / maxValue : 0;
              return (
                <div
                  key={v.month}
                  title={`${row.label} · ${v.label}: ${formatCurrency(v.value)}`}
                  className={cn(
                    "flex items-center justify-center rounded-md text-[11px] tabular-nums",
                    expanded ? "h-14" : "h-11",
                    v.value > 0 ? "font-medium text-foreground" : "border border-dashed border-border text-muted-foreground/50",
                  )}
                  style={v.value > 0 ? { backgroundColor: tint(color, 12 + intensity * 60) } : undefined}
                >
                  {v.value > 0 ? formatCompact(v.value) : "—"}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
