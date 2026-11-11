import type { KeyboardEvent } from "react";

/**
 * Teclado de un grupo de opciones (role="radiogroup"), según el patrón de
 * WAI-ARIA: una sola parada de tabulación (la opción marcada) y las flechas,
 * Inicio y Fin para cambiar de opción. Antes cada opción era una parada de
 * Tab y las flechas no hacían nada.
 *
 * Uso: `const keys = radioGroupKeys(values, value, onChange)` y en cada opción
 * `tabIndex={keys.tabIndex(v)} onKeyDown={keys.onKeyDown}`.
 */
export function radioGroupKeys<T>(
  values: readonly T[],
  value: T,
  onChange: (value: T) => void,
  isDisabled: (value: T) => boolean = () => false,
) {
  const enabled = values.map((v, i) => (isDisabled(v) ? -1 : i)).filter((i) => i >= 0);
  const marked = values.indexOf(value);
  const current = enabled.includes(marked) ? marked : (enabled[0] ?? 0);
  const pos = enabled.indexOf(current);
  return {
    tabIndex: (v: T) => (v === values[current] ? 0 : -1),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (enabled.length === 0) return;
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length];
      else if (e.key === "Home") next = enabled[0];
      else if (e.key === "End") next = enabled[enabled.length - 1];
      if (next === null) return;
      e.preventDefault();
      onChange(values[next]);
      // El foco sigue a la opción marcada.
      const group = e.currentTarget.closest('[role="radiogroup"]');
      requestAnimationFrame(() => (group?.querySelectorAll<HTMLElement>('[role="radio"]')[next!])?.focus());
    },
  };
}
