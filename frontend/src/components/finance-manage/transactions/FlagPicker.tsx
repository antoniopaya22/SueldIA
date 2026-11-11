import { Ban } from "lucide-react";
import { FLAGS } from "@/lib/flags";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";
import { cn } from "cn";

/** Marca de color de un movimiento: ninguna o uno de los seis colores. */
export function FlagPicker({ value, onChange, id }: { value: string; onChange: (flag: string) => void; id?: string }) {
  const values = ["", ...FLAGS.map((f) => f.value)];
  const keys = radioGroupKeys(values, value, onChange);
  return (
    <div id={id} role="radiogroup" aria-label="Marca" className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => {
        const meta = FLAGS.find((f) => f.value === v);
        const selected = value === v;
        return (
          <button
            key={v || "none"}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={meta ? `Marca ${meta.label.toLowerCase()}` : "Sin marca"}
            title={meta ? meta.label : "Sin marca"}
            tabIndex={keys.tabIndex(v)}
            onKeyDown={keys.onKeyDown}
            onClick={() => onChange(v)}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-ring/50",
              selected ? "border-foreground/60 bg-muted" : "border-transparent hover:bg-muted",
            )}
          >
            {meta ? <span className={cn("size-3.5 rounded-full", meta.dot)} /> : <Ban className="size-3.5 text-muted-foreground" />}
          </button>
        );
      })}
    </div>
  );
}

/** Punto de color de la marca (en listas). */
export function FlagDot({ flag, className }: { flag: string | null | undefined; className?: string }) {
  const meta = FLAGS.find((f) => f.value === flag?.toLowerCase());
  if (!meta) return null;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", meta.dot, className)} role="img" aria-label={`Marca ${meta.label.toLowerCase()}`} title={`Marca ${meta.label.toLowerCase()}`} />;
}
