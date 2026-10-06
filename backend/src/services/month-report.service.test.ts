import { describe, expect, it } from "vitest";
import { buildMonthReport, type ReportRow } from "./month-report.service.js";

let nextId = 1;
const row = (
  date: string, type: "income" | "expense", amount: number, payee: string,
  categoryId: number | null, categoryName = "Sin categoría", groupName = "Sin grupo",
): ReportRow => ({ id: nextId++, date, type, amount, categoryId, categoryName, groupName, payee });

const SUPER = [1, "Supermercado", "Comida"] as const;
const OCIO = [2, "Ocio", "Vida"] as const;
const NEW = [3, "Compras", "Vida"] as const;
const exp = (date: string, amount: number, payee: string, cat: readonly [number, string, string]) =>
  row(date, "expense", amount, payee, cat[0], cat[1], cat[2]);

const rows: ReportRow[] = [
  // enero
  exp("2025-01-05", 100, "Mercadona", SUPER), exp("2025-01-20", 100, "Mercadona", SUPER), exp("2025-01-10", 40, "Cine", OCIO),
  // febrero
  exp("2025-02-05", 120, "Mercadona", SUPER), exp("2025-02-12", 40, "Cine", OCIO), row("2025-02-20", "expense", 10, "Kiosko", null),
  // marzo (el mes del informe)
  row("2025-03-01", "income", 2000, "Empresa", null),
  exp("2025-03-06", 250, "Costco", SUPER), exp("2025-03-15", 150, "Mercadona", SUPER),
  exp("2025-03-10", 20, "Cine", OCIO), exp("2025-03-18", 60, "Nuevo Sitio", NEW),
];

describe("buildMonthReport", () => {
  const report = buildMonthReport(rows, "2025-03");
  const cat = (id: number | null) => report.categories.find((c) => c.categoryId === id)!;

  it("totales del mes y del anterior", () => {
    expect(report.totals).toEqual({ income: 2000, expense: 480, net: 1520, savingsRate: 76 });
    expect(report.previousMonth).toBe("2025-02");
    expect(report.previousTotals).toEqual({ income: 0, expense: 170, net: -170, savingsRate: null });
    expect(report.historyMonths).toBe(2);
  });

  it("compara cada categoría con la media de los meses anteriores con datos", () => {
    // Supermercado: (200 + 120) / 2 meses = 160; este mes 400.
    expect(cat(1)).toMatchObject({ spent: 400, average: 160, diff: 240, diffPct: 150, previous: 120 });
    // Ocio: (40 + 40) / 2 = 40; este mes 20.
    expect(cat(2)).toMatchObject({ spent: 20, average: 40, diff: -20, diffPct: -50 });
  });

  it("una categoría nueva no tiene media con la que comparar (diffPct null)", () => {
    expect(cat(3)).toMatchObject({ spent: 60, average: 0, diff: 60, diffPct: null });
  });

  it("separa subidas y bajadas, de mayor a menor, ignorando importes minúsculos", () => {
    expect(report.increases.map((c) => c.name)).toEqual(["Supermercado", "Compras"]);
    expect(report.decreases.map((c) => c.name)).toEqual(["Ocio"]);
    // "Sin categoría" (media 5 €, gasto 0) no llega al mínimo de 10 € para ser noticia.
    expect([...report.increases, ...report.decreases].some((c) => c.categoryId === null)).toBe(false);
  });

  it("señala el gasto muy por encima de lo típico de su categoría", () => {
    // Mediana previa de Supermercado = 100; 250 = 2,5× → inusual. 150 no.
    expect(report.unusual).toHaveLength(1);
    expect(report.unusual[0]).toMatchObject({ payee: "Costco", amount: 250, typical: 100, ratio: 2.5 });
  });

  it("detecta beneficiarios que no aparecían antes", () => {
    expect(report.newPayees.map((p) => [p.payee, p.total])).toEqual([["Costco", 250], ["Nuevo Sitio", 60]]);
  });

  it("sin historial no inventa comparaciones ni novedades", () => {
    const first = buildMonthReport(rows.filter((r) => r.date.startsWith("2025-03")), "2025-03");
    expect(first.historyMonths).toBe(0);
    expect(first.increases).toEqual([]);
    expect(first.decreases).toEqual([]);
    expect(first.unusual).toEqual([]);
    expect(first.newPayees).toEqual([]);
    expect(first.categories.every((c) => c.average === 0 && c.diffPct === null)).toBe(true);
  });
});

describe("buildMonthReport · beneficiarios nuevos", () => {
  it("una variante de un beneficiario conocido no es nuevo", () => {
    const rs = [
      exp("2025-02-05", 50, "Mercadona", SUPER),
      exp("2025-03-05", 40, "Mercadona Centro", SUPER),   // contiene a "Mercadona"
      exp("2025-03-06", 90, "Tienda Nueva", SUPER),
    ];
    expect(buildMonthReport(rs, "2025-03").newPayees.map((p) => p.payee)).toEqual(["Tienda Nueva"]);
  });
});

describe("buildMonthReport · mes en curso", () => {
  it("un mes a medias no lista bajadas (aún no se sabe), pero sí subidas", () => {
    const partial = buildMonthReport(rows, "2025-03", "2025-03-10");
    expect(partial.partial).toBe(true);
    expect(partial.decreases).toEqual([]);
    expect(partial.increases.map((c) => c.name)).toEqual(["Supermercado", "Compras"]);
  });

  it("un mes ya cerrado es completo y sí lista bajadas", () => {
    const closed = buildMonthReport(rows, "2025-03", "2025-04-02");
    expect(closed.partial).toBe(false);
    expect(closed.decreases.map((c) => c.name)).toEqual(["Ocio"]);
  });
});
