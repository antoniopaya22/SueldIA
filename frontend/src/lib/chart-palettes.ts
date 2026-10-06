// Paletas de los gráficos. Todos los gráficos leen `--chart-1..5` (ver
// app/chart-theme.ts), así que cambiar la paleta es sobrescribir esas cinco
// variables en <html>: sin tocar ningún gráfico y con modo claro/oscuro.

export type ChartPaletteId = "brand" | "vivid" | "colorblind" | "mono";

interface ChartPalette {
  id: ChartPaletteId;
  label: string;
  description: string;
  /** null = los colores de marca definidos en global.css. */
  light: readonly string[] | null;
  dark: readonly string[] | null;
}

export const CHART_PALETTES: ChartPalette[] = [
  { id: "brand", label: "SueldIA", description: "Verde y pizarra de la marca", light: null, dark: null },
  {
    id: "vivid",
    label: "Vivos",
    description: "Colores bien separados",
    light: ["#2563eb", "#16a34a", "#f59e0b", "#ec4899", "#8b5cf6"],
    dark: ["#60a5fa", "#4ade80", "#fbbf24", "#f472b6", "#a78bfa"],
  },
  {
    id: "colorblind",
    label: "Daltonismo",
    description: "Distinguibles con cualquier tipo de daltonismo",
    light: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9"],
    dark: ["#56B4E9", "#F0E442", "#009E73", "#E69F00", "#CC79A7"],
  },
  {
    id: "mono",
    label: "Un solo color",
    description: "Tonos de verde, sobrio",
    light: ["#14532d", "#15803d", "#22c55e", "#4ade80", "#86efac"],
    dark: ["#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#15803d"],
  },
];

export const DEFAULT_CHART_PALETTE: ChartPaletteId = "brand";

export function isChartPaletteId(value: unknown): value is ChartPaletteId {
  return typeof value === "string" && CHART_PALETTES.some((p) => p.id === value);
}

/** Los colores de una paleta para el tema dado (null = los de la marca). */
export function paletteColors(id: ChartPaletteId, theme: "light" | "dark"): readonly string[] | null {
  const palette = CHART_PALETTES.find((p) => p.id === id);
  return (theme === "dark" ? palette?.dark : palette?.light) ?? null;
}

// Los colores de marca (global.css), para poder previsualizarlos sin leer el DOM.
const BRAND_PREVIEW = {
  light: ["#42af78", "#2e3a48", "#7fd4a8", "#64748b", "#226b47"],
  dark: ["#40d880", "#94a3b8", "#7fd4a8", "#475569", "#2a8558"],
} as const;

/** Colores para pintar la vista previa de una paleta en el tema dado. */
export function previewColors(id: ChartPaletteId, theme: "light" | "dark"): readonly string[] {
  return paletteColors(id, theme) ?? BRAND_PREVIEW[theme];
}

/** Aplica (o quita) la paleta sobre <html>. */
export function applyChartPalette(id: ChartPaletteId, theme: "light" | "dark") {
  const colors = paletteColors(id, theme);
  const style = document.documentElement.style;
  for (let i = 0; i < 5; i++) {
    if (colors) style.setProperty(`--chart-${i + 1}`, colors[i]);
    else style.removeProperty(`--chart-${i + 1}`);
  }
}
