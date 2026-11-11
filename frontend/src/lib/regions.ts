// Comunidades y ciudades autónomas (código INE), igual que `REGIONS` del backend.
export const REGIONS = [
  ["AN", "Andalucía"], ["AR", "Aragón"], ["AS", "Asturias"], ["IB", "Illes Balears"], ["CN", "Canarias"],
  ["CB", "Cantabria"], ["CL", "Castilla y León"], ["CM", "Castilla-La Mancha"], ["CT", "Cataluña"],
  ["VC", "Comunitat Valenciana"], ["EX", "Extremadura"], ["GA", "Galicia"], ["MD", "Comunidad de Madrid"],
  ["MC", "Región de Murcia"], ["NC", "Navarra"], ["PV", "País Vasco"], ["RI", "La Rioja"], ["CE", "Ceuta"], ["ML", "Melilla"],
] as const;

export type RegionCode = (typeof REGIONS)[number][0];

export const regionName = (code: string | null | undefined): string | null =>
  REGIONS.find(([c]) => c === code)?.[1] ?? null;
