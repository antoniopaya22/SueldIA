// «1.500,00 €» siempre: en es-ES, Intl no agrupa los miles de los números de
// cuatro cifras («1500,00 €») salvo con useGrouping "always" (igual que el
// formatCurrency del frontend).
const eurFmt = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
} as unknown as Intl.NumberFormatOptions);

export const formatEur = (n: number): string => eurFmt.format(n);
