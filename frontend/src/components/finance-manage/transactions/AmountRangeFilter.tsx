import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

interface Props {
  min?: number;
  max?: number;
  onChange: (range: { minAmount?: number; maxAmount?: number }) => void;
}

const toNumber = (v: string): number | undefined => {
  const n = Number(v.replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Rango de importe (mín – máx). Se escribe sin disparar una consulta por
 * tecla: el cambio sale hacia fuera 400 ms después de dejar de escribir, y
 * si el filtro cambia desde fuera (p. ej. "Limpiar filtros") se resincroniza.
 */
export function AmountRangeFilter({ min, max, onChange }: Props) {
  const [minText, setMinText] = useState(min === undefined ? "" : String(min));
  const [maxText, setMaxText] = useState(max === undefined ? "" : String(max));

  useEffect(() => {
    setMinText((t) => (toNumber(t) === min ? t : min === undefined ? "" : String(min)));
    setMaxText((t) => (toNumber(t) === max ? t : max === undefined ? "" : String(max)));
  }, [min, max]);

  useEffect(() => {
    const nextMin = toNumber(minText);
    const nextMax = toNumber(maxText);
    if (nextMin === min && nextMax === max) return;
    const t = setTimeout(() => onChange({ minAmount: nextMin, maxAmount: nextMax }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minText, maxText]);

  const field = (value: string, set: (v: string) => void, label: string, placeholder: string) => (
    <div className="relative w-[5.25rem]">
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-7 pr-6 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
    </div>
  );

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Rango de importe">
      {field(minText, setMinText, "Importe mínimo", "Desde")}
      <span className="text-xs text-muted-foreground">–</span>
      {field(maxText, setMaxText, "Importe máximo", "Hasta")}
    </div>
  );
}
