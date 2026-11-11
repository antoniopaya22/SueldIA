const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const currencyFmt = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // es-ES no agrupa miles en cifras de 4 dígitos por defecto ("1798,75 €").
  useGrouping: "always",
} as unknown as Intl.NumberFormatOptions);

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return currencyFmt.format(n);
}

export function formatCompact(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}${(abs / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })}k €`;
  return `${sign}${abs.toFixed(0)} €`;
}

const pctFmt = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Porcentaje a la española: "77,7 %". */
export function formatPct(n: number): string {
  return `${pctFmt.format(n)} %`;
}

/** Tipo de interés tal cual (hasta 3 decimales): 2,95 % no debe salir como «3,0 %». */
export function formatRate(n: number): string {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 3 })} %`;
}

export function formatMonthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${MONTH_NAMES[Number(mo) - 1]} ${y?.slice(2)}`;
}

export function formatPercent(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** Fecha relativa corta ("Hace 5 min", "Ayer", "12 sep") para historiales de actividad. */
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "Ahora mismo";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "Ayer";
  if (diffD < 7) return `Hace ${diffD} días`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/**
 * Lee un número tecleado a la española o a la inglesa: "1.234,56", "1234,56",
 * "1234.56", "12,5" → número; vacío → null; cualquier otra cosa → NaN.
 * Con coma, los puntos se toman como separador de miles; sin coma, un único
 * punto seguido de 1-2 cifras es el decimal ("12.50") y si no, de miles ("1.234").
 */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/\s|€/g, "");
  if (s === "") return null;
  let normalized: string;
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+\.\d{1,2}$/.test(s)) normalized = s;
  else normalized = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** Número para un campo editable: "1234,5" (coma decimal, sin miles). */
export function formatDecimalInput(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** "1 cuenta", "3 cuentas", "1.234 movimientos". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;
}

/** Iniciales de un nombre (máx. 2), solo de palabras que empiezan por letra: «Lucía (ejemplo)» → «LE». */
export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0] ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}
