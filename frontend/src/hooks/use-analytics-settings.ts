import { useMemo } from "react";
import { DEFAULT_PANEL_SETTINGS, normalizePanelSettings, type PanelSettings } from "../lib/analytics-settings";
import { usePreference } from "./use-preference";

type Setters = { [K in keyof PanelSettings as `set${Capitalize<K & string>}`]: (value: PanelSettings[K]) => void };

/**
 * Lo que recuerda cada panel de la analítica (tipo de gráfico, métrica, «Top
 * N»), guardado en la cuenta y validado al leerlo. Devuelve cada ajuste y su
 * función de cambio con el mismo nombre que tenían en la página (trendMetric /
 * setTrendMetric…); antes eran ~80 líneas de declaraciones repetidas.
 */
export function useAnalyticsSettings(): PanelSettings & Setters {
  const [stored, setStored] = usePreference<unknown>("analytics-settings", DEFAULT_PANEL_SETTINGS);
  return useMemo(() => {
    const settings = normalizePanelSettings(stored);
    const setters = Object.fromEntries(
      (Object.keys(settings) as Array<keyof PanelSettings>).map((key) => [
        `set${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`,
        (value: unknown) => setStored((prev: unknown) => ({ ...normalizePanelSettings(prev), [key]: value })),
      ]),
    ) as Setters;
    return { ...settings, ...setters };
  }, [stored, setStored]);
}
