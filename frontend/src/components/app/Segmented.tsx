import type { ElementType } from "react";
import { cn } from "cn";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ElementType;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  "aria-label": string;
  className?: string;
  /** Solo iconos (label pasa a ser aria-label/tooltip). */
  iconOnly?: boolean;
}

// Selector segmentado accesible (radiogroup) — tipo de gráfico, tema, periodo...
export function Segmented<T extends string>({ value, onChange, options, size = "sm", iconOnly, className, ...rest }: SegmentedProps<T>) {
  const keys = radioGroupKeys(options.map((o) => o.value), value, onChange);
  return (
    <div role="radiogroup" aria-label={rest["aria-label"]} className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5", className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={keys.tabIndex(opt.value)}
            onKeyDown={keys.onKeyDown}
            aria-label={iconOnly ? opt.label : undefined}
            title={iconOnly ? opt.label : undefined}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              size === "sm" ? "h-7 px-2.5 text-xs pointer-coarse:h-9" : "h-8 px-3 text-sm pointer-coarse:h-10",
              iconOnly && (size === "sm" ? "w-7 px-0 pointer-coarse:w-9" : "w-8 px-0 pointer-coarse:w-10"),
              selected ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
            {!iconOnly && opt.label}
          </button>
        );
      })}
    </div>
  );
}
