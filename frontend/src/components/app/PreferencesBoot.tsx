import { useEffect } from "react";
import { usePreference } from "@/hooks/use-preference";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_CHART_PALETTE, applyChartPalette, isChartPaletteId } from "@/lib/chart-palettes";

/** Aplica en cada página las preferencias que afectan a todo (de momento, la paleta de los gráficos). No pinta nada. */
export function PreferencesBoot() {
  const [palette] = usePreference("chart-palette", DEFAULT_CHART_PALETTE, isChartPaletteId);
  const { resolved } = useTheme();
  useEffect(() => applyChartPalette(palette, resolved), [palette, resolved]);
  return null;
}
