import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDecimalInput, parseDecimal } from "../../lib/format";

/**
 * Campo de importe que acepta coma decimal y puede quedar vacío mientras se
 * escribe. Un `<input type="number">` con `Number(e.target.value)` no deja
 * borrar (vuelve a 0 al instante) y rechaza "12,50" según el navegador.
 *
 * `value`: número, `null` (vacío) o `NaN` (texto que no es un número —
 * el formulario decide cómo avisarlo).
 */
export function DecimalInput({
  value, onValueChange, ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(() => formatDecimalInput(value));
  const lastEmitted = useRef<number | null>(value);

  // Si el valor cambia desde fuera (cancelar, reprocesar…), se refleja; si es
  // el eco de lo que se acaba de teclear, se respeta el texto tal cual.
  useEffect(() => {
    const same = Object.is(value, lastEmitted.current) || (value === lastEmitted.current);
    if (!same) {
      setDraft(formatDecimalInput(value));
      lastEmitted.current = value;
    }
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseDecimal(e.target.value);
        lastEmitted.current = parsed;
        onValueChange(parsed);
      }}
    />
  );
}
