import { useState, type RefObject } from "react";
import { Download, FileSpreadsheet, ImageDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadBlob, downloadCsv, fileSlug, findChartSvg, svgToPng, type ExportTable } from "@/lib/export-utils";

/**
 * Menú de descarga de un gráfico: imagen PNG (si hay un gráfico de Recharts
 * pintado dentro de `rootRef`) y datos CSV (si se pasan con `exportTable`).
 */
export function ChartExportMenu({ title, rootRef, exportTable, note }: {
  title: string;
  rootRef: RefObject<HTMLElement | null>;
  exportTable?: () => ExportTable | null;
  note?: string;
}) {
  const [canImage, setCanImage] = useState(false);
  const [busy, setBusy] = useState(false);

  const downloadImage = async () => {
    const svg = findChartSvg(rootRef.current);
    if (!svg) {
      toast.error("Este panel no tiene un gráfico que descargar como imagen");
      return;
    }
    setBusy(true);
    try {
      const blob = await svgToPng(svg, { title, subtitle: note });
      downloadBlob(blob, `${fileSlug(title)}.png`);
    } catch {
      toast.error("No se pudo generar la imagen");
    } finally {
      setBusy(false);
    }
  };

  const downloadData = () => {
    const table = exportTable?.();
    if (!table || table.rows.length === 0) {
      toast.error("No hay datos que descargar con esta configuración");
      return;
    }
    downloadCsv(table, `${fileSlug(title)}.csv`);
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) setCanImage(findChartSvg(rootRef.current) !== null); }}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Descargar «${title}»`} title="Descargar" />}
      >
        <Download className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={!canImage} onClick={downloadImage}>
          <ImageDown aria-hidden="true" /> Imagen (PNG)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!exportTable} onClick={downloadData}>
          <FileSpreadsheet aria-hidden="true" /> Datos (CSV)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
