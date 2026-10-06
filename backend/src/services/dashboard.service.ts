import { db } from "../db/index.js";
import { payslips, payslipConcepts, profiles } from "../db/schema.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { round } from "../utils/math.js";

/* ───────── Types ────────────────────────────────────────────── */

interface DashboardFilters {
  userProfileIds: number[];
  requestedProfileIds?: number[];
  from?: string;
  to?: string;
}

type Payslip = typeof payslips.$inferSelect;
type Concept = { id: number; payslipId: number; category: string; name: string; amount: number; isPercentage: boolean };
type Profile = typeof profiles.$inferSelect;

/* ───────── Data fetching ────────────────────────────────────── */

export async function fetchDashboardData(filters: DashboardFilters) {
  const { userProfileIds, from, to } = filters;

  const profileIds = filters.requestedProfileIds
    ? filters.requestedProfileIds.filter((n) => userProfileIds.includes(n))
    : userProfileIds;

  // Sin perfiles válidos no hay nada que mostrar. Importante devolver aquí:
  // sin condición de perfil la consulta traería las nóminas de TODOS los
  // usuarios (p. ej. con ?profileId=<id ajeno> tras filtrar por propiedad).
  if (profileIds.length === 0) return { filtered: [], allConcepts: [], profileIds };

  const conditions = [eq(payslips.parsingStatus, "parsed"), inArray(payslips.profileId, profileIds)];

  if (from) {
    const [y, m] = from.split("-").map(Number);
    conditions.push(
      sql`(${payslips.periodYear} > ${y} OR (${payslips.periodYear} = ${y} AND ${payslips.periodMonth} >= ${m}))`,
    );
  }
  if (to) {
    const [y, m] = to.split("-").map(Number);
    conditions.push(
      sql`(${payslips.periodYear} < ${y} OR (${payslips.periodYear} = ${y} AND ${payslips.periodMonth} <= ${m}))`,
    );
  }

  const allPayslips = await db
    .select()
    .from(payslips)
    .where(and(...conditions))
    .orderBy(payslips.periodYear, payslips.periodMonth);

  const filtered = allPayslips;

  const payslipIds = filtered.map((p) => p.id);
  let allConcepts: Concept[] = [];

  if (payslipIds.length > 0) {
    allConcepts = await db
      .select()
      .from(payslipConcepts)
      .where(
        sql`${payslipConcepts.payslipId} IN (${sql.join(
          payslipIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
  }

  return { filtered, allConcepts, profileIds };
}

/* ───────── KPIs ─────────────────────────────────────────────── */

export function buildKpis(filtered: Payslip[], allConcepts: Concept[]) {
  const totalPayslips = filtered.length;
  const avgGross =
    totalPayslips > 0
      ? filtered.reduce((s, p) => s + (p.grossSalary ?? 0), 0) / totalPayslips
      : 0;
  const avgNet =
    totalPayslips > 0
      ? filtered.reduce((s, p) => s + (p.netSalary ?? 0), 0) / totalPayslips
      : 0;
  const totalGrossYear = filtered.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
  const totalNetYear = filtered.reduce((s, p) => s + (p.netSalary ?? 0), 0);

  const irpfConcepts = allConcepts.filter(
    (c) => c.category === "deduccion" && c.name.toLowerCase().includes("irpf"),
  );
  const avgIrpf =
    irpfConcepts.length > 0
      ? irpfConcepts.reduce((s, c) => s + c.amount, 0) / irpfConcepts.length
      : 0;

  return {
    totalPayslips,
    avgGross: round(avgGross),
    avgNet: round(avgNet),
    totalGrossYear: round(totalGrossYear),
    totalNetYear: round(totalNetYear),
    avgIrpf: round(avgIrpf),
  };
}

/* ───────── Evolution ────────────────────────────────────────── */

export function buildEvolution(
  filtered: Payslip[],
  profileMap: Map<number, Profile>,
) {
  const regular = filtered.filter((p) => p.payslipType !== "extra");
  const evolution: Record<string, Array<{ month: string; gross: number | null; net: number | null }>> = {};

  for (const p of regular) {
    const profile = profileMap.get(p.profileId);
    const key = profile?.name ?? `Perfil ${p.profileId}`;
    if (!evolution[key]) evolution[key] = [];
    evolution[key].push({
      month: `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
      gross: p.grossSalary,
      net: p.netSalary,
    });
  }

  return evolution;
}

/* ───────── Concept Breakdown ────────────────────────────────── */

export function buildConceptBreakdown(allConcepts: Concept[]) {
  const breakdown: Record<string, { total: number; count: number; category: string }> = {};
  for (const c of allConcepts) {
    if (!breakdown[c.name]) {
      breakdown[c.name] = { total: 0, count: 0, category: c.category };
    }
    breakdown[c.name].total += c.amount;
    breakdown[c.name].count += 1;
  }

  return Object.entries(breakdown).map(([name, data]) => ({
    name,
    category: data.category,
    total: round(data.total),
    average: round(data.total / data.count),
    count: data.count,
  }));
}

/* ───────── Annual Summaries ─────────────────────────────────── */

export function buildAnnualSummaries(filtered: Payslip[], allConcepts: Concept[]) {
  const byYear = new Map<number, Payslip[]>();
  for (const p of filtered) {
    const y = p.periodYear ?? 0;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(p);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, ps]) => {
      const regular = ps.filter((p) => p.payslipType !== "extra");
      const extras = ps.filter((p) => p.payslipType === "extra");

      const regularGross = regular.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
      const regularNet = regular.reduce((s, p) => s + (p.netSalary ?? 0), 0);
      const extraGross = extras.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
      const extraNet = extras.reduce((s, p) => s + (p.netSalary ?? 0), 0);

      const totalGross = regularGross + extraGross;
      const totalNet = regularNet + extraNet;
      const totalDeductions = totalGross - totalNet;
      const months = regular.length;
      const currentMonth = new Date().getMonth() + 1;
      const currentFullYear = new Date().getFullYear();
      const isCurrentYear = year === currentFullYear;
      const projectedMonths = isCurrentYear ? Math.max(months, currentMonth) : 12;
      const monthlyAvgGross = months > 0 ? regularGross / months : 0;
      const monthlyAvgNet = months > 0 ? regularNet / months : 0;

      const yearPayslipIds = new Set(ps.map((p) => p.id));
      const yearIrpf = allConcepts
        .filter((c) => yearPayslipIds.has(c.payslipId) && c.category === "deduccion" && c.name.toLowerCase().includes("irpf"))
        .reduce((s, c) => s + c.amount, 0);

      return {
        year,
        months,
        totalGross: round(totalGross),
        totalNet: round(totalNet),
        totalDeductions: round(totalDeductions),
        totalIrpf: round(yearIrpf),
        avgMonthlyGross: round(monthlyAvgGross),
        avgMonthlyNet: round(monthlyAvgNet),
        projectedAnnualGross: round(monthlyAvgGross * projectedMonths),
        projectedAnnualNet: round(monthlyAvgNet * projectedMonths),
        pagasExtra: extras.length,
        extraGross: round(extraGross),
        extraNet: round(extraNet),
        retentionRate: totalGross > 0 ? round((totalNet / totalGross) * 100) : 0,
      };
    });
}

/* ───────── IRPF Evolution ───────────────────────────────────── */

export function buildIrpfEvolution(filtered: Payslip[], allConcepts: Concept[]) {
  const regular = filtered.filter((p) => p.payslipType !== "extra");
  const irpfConcepts = allConcepts.filter(
    (c) => c.category === "deduccion" && c.name.toLowerCase().includes("irpf"),
  );
  const irpfByPayslip = new Map<number, number>();
  for (const c of irpfConcepts) {
    irpfByPayslip.set(c.payslipId, (irpfByPayslip.get(c.payslipId) ?? 0) + c.amount);
  }

  return regular
    .filter((p) => p.grossSalary && p.grossSalary > 0)
    .map((p) => ({
      month: `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
      amount: round(irpfByPayslip.get(p.id) ?? 0),
      rate: round(((irpfByPayslip.get(p.id) ?? 0) / p.grossSalary!) * 100),
    }));
}

/* ───────── Monthly Savings ──────────────────────────────────── */

export function buildMonthlySavings(filtered: Payslip[]) {
  const regular = filtered.filter((p) => p.payslipType !== "extra");
  return regular
    .filter((p) => p.grossSalary && p.grossSalary > 0)
    .map((p) => ({
      month: `${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
      gross: round(p.grossSalary!),
      net: round(p.netSalary ?? 0),
      deductions: round((p.grossSalary ?? 0) - (p.netSalary ?? 0)),
      retentionRate: round(((p.netSalary ?? 0) / p.grossSalary!) * 100),
    }));
}
