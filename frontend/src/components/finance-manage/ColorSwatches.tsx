import { Check } from "lucide-react";
import { cn } from "cn";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";

// Paleta elegible para cuentas/grupos: verde y navy de marca primero.
export const SWATCH_COLORS = [
  "#2a8558", "#2e3a48", "#3b82f6", "#8b5cf6",
  "#ec4899", "#ef4444", "#f59e0b", "#6366f1",
  "#14b8a6", "#06b6d4",
];

interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
  label?: string;
}

export function ColorSwatches({ value, onChange, colors = SWATCH_COLORS, label = "Color" }: ColorSwatchesProps) {
  const marked = colors.find((c) => c.toLowerCase() === value.toLowerCase()) ?? colors[0];
  const keys = radioGroupKeys(colors, marked, onChange);
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const selected = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Color ${c}`}
            tabIndex={keys.tabIndex(c)}
            onKeyDown={keys.onKeyDown}
            onClick={() => onChange(c)}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-full outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected ? "scale-110 ring-2 ring-foreground/80 ring-offset-2 ring-offset-background" : "hover:scale-105",
            )}
            style={{ backgroundColor: c }}
          >
            {selected && <Check className="size-3.5 text-white" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
