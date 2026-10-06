import { Fragment, useRef, useState, type ReactNode, type RefObject } from "react";
import { Download, FileSpreadsheet, ImageDown, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "../app";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadBlob, downloadCsv, fileSlug, findChartSvg, svgToPng, type ExportTable } from "../../lib/export-utils";
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

/**
 * Menú de descarga de un panel: imagen PNG (si tiene un gráfico de Recharts) y
 * datos CSV (si el panel los expone). `rootRef` apunta al contenido ya pintado.
 */
function PanelExportMenu({ panel, rootRef, note }: { panel: PanelConfig; rootRef: RefObject<HTMLDivElement | null>; note?: string }) {
  const [canImage, setCanImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasCsv = Boolean(panel.exportTable);

  const downloadImage = async () => {
    const svg = findChartSvg(rootRef.current);
    if (!svg) {
      toast.error("Este panel no tiene un gráfico que descargar como imagen");
      return;
    }
    setBusy(true);
    try {
      const blob = await svgToPng(svg, { title: panel.title, subtitle: note });
      downloadBlob(blob, `${fileSlug(panel.title)}.png`);
    } catch {
      toast.error("No se pudo generar la imagen");
    } finally {
      setBusy(false);
    }
  };

  const downloadData = () => {
    const table = panel.exportTable?.();
    if (!table || table.rows.length === 0) {
      toast.error("No hay datos que descargar con esta configuración");
      return;
    }
    downloadCsv(table, `${fileSlug(panel.title)}.csv`);
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) setCanImage(findChartSvg(rootRef.current) !== null); }}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Descargar «${panel.title}»`} title="Descargar" />}
      >
        <Download className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={!canImage} onClick={downloadImage}>
          <ImageDown aria-hidden="true" /> Imagen (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasCsv} onClick={downloadData}>
          <FileSpreadsheet aria-hidden="true" /> Datos (CSV)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Card de la analítica: cabecera, fila de controles, descarga y botón para ampliar. */
export function AnalyticsPanel({ panel, onExpand, className, exportNote }: { panel: PanelConfig; onExpand: () => void; className?: string; exportNote?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <SectionCard
      className={className}
      title={panel.title}
      description={panel.description}
      action={
        <div className="flex items-center">
          <PanelExportMenu panel={panel} rootRef={bodyRef} note={exportNote} />
          <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label={`Ampliar «${panel.title}»`} title="Ampliar">
            <Maximize2 className="size-4 text-muted-foreground" />
          </Button>
        </div>
      }
    >
      {panel.controls && <div className={cn("mb-5", CONTROLS_CLASS)}>{panel.controls}</div>}
      <div ref={bodyRef}>{panel.render(false)}</div>
    </SectionCard>
  );
}

/** Vista ampliada de un panel, con los mismos controles. */
export function ExpandedPanelDialog({ panel, onClose, exportNote }: { panel: PanelConfig | null; onClose: () => void; exportNote?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
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
                <span className="ml-auto"><PanelExportMenu panel={panel} rootRef={bodyRef} note={exportNote} /></span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5"><div ref={bodyRef}>{panel.render(true)}</div></div>
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
