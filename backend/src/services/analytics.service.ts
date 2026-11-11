import { db } from "../db/index.js";
import { payslips, payslipConcepts, profiles } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { avg, round, stdDev, calculateTrend, predictNext } from "../utils/math.js";
import { currentYearMonth } from "../utils/dates.js";
import { conceptKind } from "../parsers/concept-classifier.js";

/* ───────── Types ────────────────────────────────────────────── */

type Payslip = typeof payslips.$inferSelect;
type Concept = { payslipId: number; category: string; name: string; amount: number };

interface MonthlyDatum {
  month: string;
  gross: number;
  net: number;
  year: number;
}

interface Anomaly {
  type: string;
  severity: "info" | "warning" | "critical";
  month: string;
  message: string;
  value: number;
  expected: number;
}

interface Alert {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

/* ───────── Data fetching ────────────────────────────────────── */

export async function fetchAnalyticsData(userProfileIds: number[], profileId?: number) {
  const conditions = [eq(payslips.parsingStatus, "parsed")];
  if (profileId) {
    conditions.push(eq(payslips.profileId, profileId));
  } else {
    conditions.push(
      sql`${payslips.profileId} IN (${sql.join(userProfileIds.map((id) => sql`${id}`), sql`, `)})`,
    );
  }

  const allPayslips = await db
    .select()
    .from(payslips)
    .where(and(...conditions))
    .orderBy(payslips.periodYear, payslips.periodMonth);

  if (allPayslips.length === 0) return { allPayslips: [], allConcepts: [] };

  const payslipIds = allPayslips.map((p) => p.id);
  const allConcepts: Concept[] = await db
    .select({
      payslipId: payslipConcepts.payslipId,
      category: payslipConcepts.category,
      name: payslipConcepts.name,
      amount: payslipConcepts.amount,
    })
    .from(payslipConcepts)
    .where(
      sql`${payslipConcepts.payslipId} IN (${sql.join(
        payslipIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  return { allPayslips, allConcepts };
}

/* ───────── Monthly data transform ───────────────────────────── */

export function toMonthlyData(allPayslips: Payslip[]): MonthlyDatum[] {
  return allPayslips
    .filter((p) => p.payslipType !== "extra")
    .map((p) => ({
      month: `${p.periodYear}-${String(p.periodMonth ?? 0).padStart(2, "0")}`,
      gross: p.grossSalary ?? 0,
      net: p.netSalary ?? 0,
      year: p.periodYear ?? 0,
    }));
}

/* ───────── Trends ───────────────────────────────────────────── */

export function buildTrends(monthlyData: MonthlyDatum[], allPayslips: Payslip[], allConcepts: Concept[]) {
  const regularPayslips = allPayslips.filter((p) => p.payslipType !== "extra");
  const grossValues = monthlyData.map((d) => d.gross);
  const netValues = monthlyData.map((d) => d.net);

  const grossTrend = calculateTrend(grossValues);
  const netTrend = calculateTrend(netValues);

  const grossSeries = monthlyData.map((d) => ({ month: d.month, value: round(d.gross) }));
  const netSeries = monthlyData.map((d) => ({ month: d.month, value: round(d.net) }));

  // Year-over-year comparison
  const currentYear = Math.max(...monthlyData.map((d) => d.year));
  const prevYear = currentYear - 1;
  const currentYearData = monthlyData.filter((d) => d.year === currentYear);
  const prevYearData = monthlyData.filter((d) => d.year === prevYear);

  const yoyGross: Array<{ month: string; current: number; previous: number; change: number }> = [];
  const yoyNet: Array<{ month: string; current: number; previous: number; change: number }> = [];

  if (prevYearData.length > 0) {
    for (const cur of currentYearData) {
      const monthNum = cur.month.split("-")[1];
      const prev = prevYearData.find((d) => d.month.split("-")[1] === monthNum);
      if (prev) {
        yoyGross.push({
          month: cur.month,
          current: round(cur.gross),
          previous: round(prev.gross),
          change: round(cur.gross - prev.gross),
        });
        yoyNet.push({
          month: cur.month,
          current: round(cur.net),
          previous: round(prev.net),
          change: round(cur.net - prev.net),
        });
      }
    }
  }

  // Concept trends
  const conceptsByMonth = new Map<string, Map<string, number>>();
  for (const c of allConcepts) {
    const p = regularPayslips.find((ps) => ps.id === c.payslipId);
    if (!p) continue;
    const month = `${p.periodYear}-${String(p.periodMonth ?? 0).padStart(2, "0")}`;
    if (!conceptsByMonth.has(c.name)) conceptsByMonth.set(c.name, new Map());
    const monthMap = conceptsByMonth.get(c.name)!;
    monthMap.set(month, (monthMap.get(month) ?? 0) + c.amount);
  }

  const conceptTrends: Record<string, Array<{ month: string; value: number }>> = {};
  for (const [name, monthMap] of conceptsByMonth.entries()) {
    const values = Array.from(monthMap.values());
    if (avg(values) > 10) {
      conceptTrends[name] = Array.from(monthMap.entries())
        .map(([month, value]) => ({ month, value: round(value) }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }
  }

  return {
    trends: { gross: grossSeries, net: netSeries, yoyGross: yoyGross, yoyNet: yoyNet, conceptTrends },
    grossTrend,
    netTrend,
    yoyNet,
    currentYear,
    currentYearData,
  };
}

/* ───────── Anomaly Detection ────────────────────────────────── */

export function detectAnomalies(
  monthlyData: MonthlyDatum[],
  allPayslips: Payslip[],
  allConcepts: Concept[],
): Anomaly[] {
  const regularPayslips = allPayslips.filter((p) => p.payslipType !== "extra");
  const anomalies: Anomaly[] = [];
  const grossValues = monthlyData.map((d) => d.gross);
  const grossMean = avg(grossValues);
  const grossStd = stdDev(grossValues);

  for (const d of monthlyData) {
    if (grossStd > 0 && Math.abs(d.gross - grossMean) > 2 * grossStd) {
      anomalies.push({
        type: "salary_anomaly",
        severity: Math.abs(d.gross - grossMean) > 3 * grossStd ? "critical" : "warning",
        month: d.month,
        message: d.gross > grossMean
          ? `Salario bruto inusualmente alto`
          : `Salario bruto inusualmente bajo`,
        value: round(d.gross),
        expected: round(grossMean),
      });
    }
  }

  // IRPF rate changes
  const irpfConcepts = allConcepts.filter((c) => conceptKind(c) === "irpf");
  if (irpfConcepts.length >= 2) {
    const irpfByPayslip = new Map<number, number>();
    for (const c of irpfConcepts) {
      irpfByPayslip.set(c.payslipId, (irpfByPayslip.get(c.payslipId) ?? 0) + c.amount);
    }
    const irpfRates = regularPayslips
      .filter((p) => irpfByPayslip.has(p.id) && p.grossSalary && p.grossSalary > 0)
      .map((p) => ({
        month: `${p.periodYear}-${String(p.periodMonth ?? 0).padStart(2, "0")}`,
        rate: round(((irpfByPayslip.get(p.id) ?? 0) / p.grossSalary!) * 100),
      }));

    for (let i = 1; i < irpfRates.length; i++) {
      const diff = Math.abs(irpfRates[i].rate - irpfRates[i - 1].rate);
      if (diff > 2) {
        anomalies.push({
          type: "irpf_change",
          severity: diff > 5 ? "critical" : "warning",
          month: irpfRates[i].month,
          message: `Cambio significativo en tipo IRPF: ${irpfRates[i - 1].rate}% → ${irpfRates[i].rate}%`,
          value: irpfRates[i].rate,
          expected: irpfRates[i - 1].rate,
        });
      }
    }
  }

  return anomalies;
}

/* ───────── Alerts ───────────────────────────────────────────── */

export function buildAlerts(
  monthlyData: MonthlyDatum[],
  netTrend: ReturnType<typeof calculateTrend>,
  currentYear: number,
  currentYearData: MonthlyDatum[],
  yoyNet: Array<{ current: number; previous: number }>,
): Alert[] {
  const alerts: Alert[] = [];
  const grossValues = monthlyData.map((d) => d.gross);
  const netValues = monthlyData.map((d) => d.net);
  const grossMean = avg(grossValues);

  if (netTrend.direction === "down" && Math.abs(netTrend.slopePercent) > 1) {
    alerts.push({
      type: "net_decreasing",
      severity: Math.abs(netTrend.slopePercent) > 3 ? "critical" : "warning",
      message: `Tu salario neto tiene tendencia a la baja (${netTrend.slopePercent.toFixed(1)}% mensual)`,
    });
  }

  if (currentYearData.length > 0) {
    // `currentYear` es el último año CON datos, no el del calendario: si no es
    // el año en curso, se esperan sus 12 meses (antes se comparaba siempre con
    // el mes actual del calendario y el mensaje salía falso).
    const today = currentYearMonth();
    const expectedMonths = currentYear === today.year ? today.month : 12;
    const actualMonths = currentYearData.length;
    if (actualMonths < expectedMonths - 1) {
      alerts.push({
        type: "missing_payslips",
        severity: "info",
        message: `Faltan nóminas de ${currentYear}: tienes ${actualMonths} de ${expectedMonths} meses esperados`,
      });
    }
  }

  // "Retención" aquí sigue la convención de esta app (net/gross, lo que
  // realmente llega al bolsillo — ver DashboardPage.tsx "Te llega el X%"),
  // NO el sentido fiscal habitual (importe retenido). Por eso el aviso se
  // dispara con una retención BAJA (< 65%, se descuenta más de lo normal),
  // no alta — el mensaje debe reflejar eso, no lo contrario.
  const retentionRate = grossMean > 0 ? (avg(netValues) / grossMean) * 100 : 0;
  if (retentionRate < 65 && retentionRate > 0) {
    alerts.push({
      type: "low_retention",
      severity: "warning",
      message: `Tu tasa de retención es del ${retentionRate.toFixed(1)}%, por debajo de lo habitual — se te descuenta más de lo normal`,
    });
  }

  if (yoyNet.length > 0) {
    const avgCurrentNet = avg(yoyNet.map((d) => d.current));
    const avgPrevNet = avg(yoyNet.map((d) => d.previous));
    if (avgPrevNet > 0) {
      const changePercent = round(((avgCurrentNet - avgPrevNet) / avgPrevNet) * 100);
      if (changePercent < -5) {
        alerts.push({
          type: "yoy_decrease",
          severity: "warning",
          message: `Tu salario neto medio bajó un ${Math.abs(changePercent).toFixed(1)}% respecto al año anterior`,
        });
      }
    }
  }

  return alerts;
}

/* ───────── Extras Summary ───────────────────────────────────── */

export function buildExtrasSummary(allPayslips: Payslip[]) {
  const extras = allPayslips.filter((p) => p.payslipType === "extra");
  if (extras.length === 0) return [];

  const byYear = new Map<number, Payslip[]>();
  for (const p of extras) {
    const y = p.periodYear ?? 0;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(p);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, ps]) => ({
      year,
      count: ps.length,
      totalGross: round(ps.reduce((s, p) => s + (p.grossSalary ?? 0), 0)),
      totalNet: round(ps.reduce((s, p) => s + (p.netSalary ?? 0), 0)),
    }));
}
