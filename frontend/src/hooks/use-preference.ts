import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPreferences, removePreference, savePreference } from "../lib/api";

// Preferencias de interfaz que siguen al usuario entre dispositivos.
//  - Se guardan en el servidor (`/api/preferences`) y se reflejan en localStorage:
//    la copia local pinta al instante y vale si no hay red.
//  - Si el servidor ya tiene valor, manda sobre el local.
//  - El guardado va con retraso (varios cambios seguidos = una sola petición).
//  - Un valor guardado que ya no encaja (cambió la forma de los datos) se
//    ignora y se usa el valor por defecto: `validate` lo decide.

const LOCAL_PREFIX = "sueldia:pref:";
const SAVE_DELAY_MS = 600;
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function readLocal(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: unknown | undefined) {
  try {
    if (value === undefined) window.localStorage.removeItem(LOCAL_PREFIX + key);
    else window.localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado…): solo queda el servidor.
  }
}

export function usePreference<T>(
  key: string,
  defaultValue: T,
  validate?: (value: unknown) => value is T,
): [T, (next: T | ((prev: T) => T)) => void, { loaded: boolean; reset: () => void }] {
  const queryClient = useQueryClient();
  // Con el valor por defecto en el primer pintado (también en el prerender estático): sin desajustes de hidratación.
  const [value, setValueState] = useState<T>(defaultValue);
  const valueRef = useRef(value);
  valueRef.current = value;

  const { data: server, isSuccess } = useQuery({ queryKey: ["preferences"], queryFn: getPreferences, staleTime: 5 * 60_000 });

  const accept = useCallback(
    (candidate: unknown): candidate is T => candidate !== undefined && (validate ? validate(candidate) : true),
    [validate],
  );

  // 1) Copia local al montar. 2) Cuando llega el servidor, manda él.
  useEffect(() => {
    const local = readLocal(key);
    if (accept(local)) setValueState(local);
  }, [key, accept]);

  useEffect(() => {
    if (!server) return;
    const remote = server[key];
    if (accept(remote)) {
      setValueState(remote);
      writeLocal(key, remote);
    }
  }, [server, key, accept]);

  const persist = useCallback(
    (next: T | undefined) => {
      writeLocal(key, next);
      queryClient.setQueryData<Record<string, unknown>>(["preferences"], (cur) => {
        const copy = { ...(cur ?? {}) };
        if (next === undefined) delete copy[key];
        else copy[key] = next;
        return copy;
      });
      const timer = pendingSaves.get(key);
      if (timer) clearTimeout(timer);
      pendingSaves.set(
        key,
        setTimeout(() => {
          pendingSaves.delete(key);
          (next === undefined ? removePreference(key) : savePreference(key, next)).catch(() => {
            // El valor local se conserva; se reintentará con el siguiente cambio.
          });
        }, SAVE_DELAY_MS),
      );
    },
    [key, queryClient],
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(valueRef.current) : next;
      setValueState(resolved);
      persist(resolved);
    },
    [persist],
  );

  const reset = useCallback(() => {
    setValueState(defaultValue);
    persist(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  return [value, setValue, { loaded: isSuccess, reset }];
}
