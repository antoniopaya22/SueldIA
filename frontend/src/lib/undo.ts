import { toast } from "sonner";

/**
 * Acción con ventana para deshacer: se aplica en la interfaz al momento y la
 * petición se envía pasados `delayMs` salvo que se pulse «Deshacer». Si la
 * pestaña se cierra antes, se envía en ese momento (pagehide), así que lo que
 * el usuario ve siempre acaba ocurriendo.
 */
export function deferWithUndo({
  message,
  commit,
  onUndo,
  onCommitted,
  onError,
  delayMs = 6000,
}: {
  message: string;
  commit: () => Promise<unknown>;
  onUndo: () => void;
  onCommitted?: () => void;
  onError?: (e: Error) => void;
  delayMs?: number;
}): void {
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;

  const run = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    window.removeEventListener("pagehide", run);
    commit().then(
      () => onCommitted?.(),
      (e: unknown) => onError?.(e instanceof Error ? e : new Error(String(e))),
    );
  };

  timer = setTimeout(run, delayMs);
  window.addEventListener("pagehide", run);

  toast(message, {
    duration: delayMs,
    action: {
      label: "Deshacer",
      onClick: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("pagehide", run);
        onUndo();
      },
    },
  });
}

/** Agrupa ids por un valor previo (para deshacer una acción en lote con una petición por valor). */
export function groupIdsBy<T>(items: Array<{ id: number; value: T }>): Map<T, number[]> {
  const map = new Map<T, number[]>();
  for (const { id, value } of items) map.set(value, [...(map.get(value) ?? []), id]);
  return map;
}
