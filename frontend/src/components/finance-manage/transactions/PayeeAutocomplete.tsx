import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { getPayeeSuggestions, type PayeeSuggestion } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { Input } from "@/components/ui/input";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Se llama al elegir una sugerencia (no al escribir): para autocompletar categoría, importe, cuenta. */
  onPick: (suggestion: PayeeSuggestion) => void;
  /** Sin tipo (traspasos) no hay sugerencias. */
  type: "expense" | "income" | null;
  placeholder?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Beneficiario con sugerencias de los ya usados. Elegir uno rellena el resto
 * del formulario (ver `onPick`); escribir un nombre nuevo sigue funcionando.
 */
export function PayeeAutocomplete({ id, value, onChange, onPick, type, placeholder }: Props) {
  const q = useDebounced(value.trim(), 200);
  const { data: suggestions = [] } = useQuery({
    queryKey: ["payee-suggestions", type, q],
    queryFn: () => getPayeeSuggestions({ q, type: type ?? undefined }),
    enabled: type !== null,
    placeholderData: (prev) => prev,
  });

  // Si ya coincide exactamente con lo escrito, no hay nada que sugerir.
  const items = useMemo(
    () => suggestions.filter((s) => s.payee.toLowerCase() !== value.trim().toLowerCase()),
    [suggestions, value],
  );

  return (
    <Autocomplete.Root
      items={items}
      filteredItems={items}
      value={value}
      itemToStringValue={(s: PayeeSuggestion) => s.payee}
      onValueChange={(next, details) => {
        onChange(next);
        if (details.reason === "item-press") {
          const picked = items.find((s) => s.payee === next);
          if (picked) onPick(picked);
        }
      }}
    >
      <Autocomplete.Input
        render={<Input id={id} autoComplete="off" placeholder={placeholder} />}
      />
      {items.length > 0 && (
        <Autocomplete.Portal>
          <Autocomplete.Positioner sideOffset={4} className="isolate z-50 outline-none">
            <Autocomplete.Popup className="w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
              <Autocomplete.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-0">
                {(item: PayeeSuggestion) => (
                  <Autocomplete.Item
                    key={`${item.type}:${item.payee}`}
                    value={item}
                    className="flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    <span className="min-w-0 truncate">{item.payee}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(item.amount)}
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      )}
    </Autocomplete.Root>
  );
}
