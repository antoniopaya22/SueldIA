import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false en el prerender y durante la hidratación; true después. Para lo que
 * depende del navegador (APIs, localStorage…) y no debe cambiar el HTML que
 * se hidrata: si no, React descarta el HTML estático y avisa de un desajuste.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
