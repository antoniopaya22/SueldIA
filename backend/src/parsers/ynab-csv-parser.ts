/**
 * Parser for YNAB TSV export files.
 *
 * The export uses tab-separated values with double-quote qualifiers.
 * Amounts use European format: "20,99€" → 20.99
 * Dates use DD/MM/YYYY → YYYY-MM-DD
 */

export interface YnabRawRow {
  account: string;
  flag: string;
  date: string; // YYYY-MM-DD (already converted)
  payee: string;
  categoryGroup: string;
  category: string;
  memo: string;
  outflow: number;
  inflow: number;
  cleared: boolean;
}

export interface YnabParseResult {
  rows: YnabRawRow[];
  accounts: string[];
  categoryGroups: Map<string, Set<string>>; // group → Set<category>
  dateRange: { from: string; to: string };
  totalTransactions: number;
  totalTransfers: number;
  totalExpenses: number;
  totalIncome: number;
}

/** Strip quotes and trim */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse European amount "20,99€" or "1.234,56€" → number */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[€\s"]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : num;
}

/** Convert DD/MM/YYYY → YYYY-MM-DD */
function parseDate(raw: string): string {
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Check if a row represents an internal transfer */
export function isTransfer(payee: string): boolean {
  return payee.startsWith("Transfer : ");
}

/** Extract the target account name from a transfer payee */
export function getTransferTarget(payee: string): string {
  return payee.replace(/^Transfer : /, "");
}

/** Check if a row is an inflow category (YNAB special) */
export function isInflowCategory(categoryGroup: string): boolean {
  return categoryGroup === "Inflow" || categoryGroup === "";
}

export function parseYnabCsv(content: string): YnabParseResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("El archivo CSV está vacío o no tiene datos");
  }

  // Skip header line
  const dataLines = lines.slice(1);

  const rows: YnabRawRow[] = [];
  const accountSet = new Set<string>();
  const categoryGroups = new Map<string, Set<string>>();
  let transfers = 0;

  for (const line of dataLines) {
    // TSV with quoted fields — split by tab
    const parts = line.split("\t");
    if (parts.length < 11) continue;

    const account = unquote(parts[0]);
    const flag = unquote(parts[1]);
    const dateRaw = unquote(parts[2]);
    const payee = unquote(parts[3]);
    // parts[4] = "Category Group/Category" — skip, we use parts[5] and parts[6]
    const catGroup = unquote(parts[5]);
    const category = unquote(parts[6]);
    const memo = unquote(parts[7]);
    const outflow = parseAmount(parts[8]);
    const inflow = parseAmount(parts[9]);
    // "Reconciled" es un paso más allá de "Cleared" en YNAB: también está liquidado.
    const clearedStatus = unquote(parts[10]);
    const cleared = clearedStatus === "Cleared" || clearedStatus === "Reconciled";

    const date = parseDate(dateRaw);

    accountSet.add(account);

    // Track categories (skip transfers and inflows without category)
    if (!isTransfer(payee) && catGroup && !isInflowCategory(catGroup)) {
      if (!categoryGroups.has(catGroup)) {
        categoryGroups.set(catGroup, new Set());
      }
      if (category) {
        categoryGroups.get(catGroup)!.add(category);
      }
    }

    if (isTransfer(payee)) {
      transfers++;
    }

    rows.push({
      account,
      flag,
      date,
      payee,
      categoryGroup: catGroup,
      category,
      memo,
      outflow,
      inflow,
      cleared,
    });
  }

  // Sort by date
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const dates = rows.map((r) => r.date).filter(Boolean);
  const dateRange = {
    from: dates[0] ?? "",
    to: dates[dates.length - 1] ?? "",
  };

  const totalExpenses = rows
    .filter((r) => r.outflow > 0 && !isTransfer(r.payee))
    .reduce((sum, r) => sum + r.outflow, 0);
  const totalIncome = rows
    .filter((r) => r.inflow > 0 && !isTransfer(r.payee))
    .reduce((sum, r) => sum + r.inflow, 0);

  return {
    rows,
    accounts: Array.from(accountSet).sort(),
    categoryGroups,
    dateRange,
    totalTransactions: rows.length,
    totalTransfers: transfers,
    totalExpenses,
    totalIncome,
  };
}
