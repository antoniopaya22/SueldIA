import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { submitOcrText, type Payslip } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * «Leer con OCR» para una nómina escaneada (sin texto). El OCR corre en el
 * navegador: el PDF no sale del dispositivo, solo el texto leído. Sin `file`
 * (p. ej. desde el detalle), pide elegir el PDF otra vez: no lo guardamos.
 */
export function OcrButton({ payslipId, file, onDone, size = "sm" }: {
  payslipId: number;
  file?: File;
  onDone?: (payslip: Payslip) => void;
  size?: "sm" | "default";
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ progress: number; label: string } | null>(null);

  const run = async (pdf: File) => {
    setStatus({ progress: 0, label: "Cargando el lector (unos MB, solo la primera vez)…" });
    try {
      const { ocrPdf } = await import("@/lib/ocr");
      const text = await ocrPdf(pdf, setStatus);
      if (text.replace(/\s/g, "").length < 20) throw new Error("No se ha podido leer texto en el PDF. ¿Está muy borroso o girado?");
      const updated = await submitOcrText(payslipId, text);
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["payslip", payslipId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(updated.parsingStatus === "parsed" ? "Nómina leída con OCR" : "Leída con OCR: revisa los conceptos, el escaneo puede tener errores");
      onDone?.(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo leer la nómina");
    } finally {
      setStatus(null);
    }
  };

  if (status) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {status.label} {status.progress > 0 && status.progress < 1 ? `${Math.round(status.progress * 100)} %` : ""}
      </span>
    );
  }
  return (
    <>
      {!file && (
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
        />
      )}
      <Button variant="outline" size={size} className="gap-1.5" onClick={() => (file ? void run(file) : inputRef.current?.click())}>
        <ScanText className="size-4" /> Leer con OCR
      </Button>
    </>
  );
}
