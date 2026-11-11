import { db } from "../db/index.js";
import { payslips, payslipConcepts, profiles } from "../db/schema.js";
import { eq, and, sql, inArray } from "drizzle-orm";
import { round } from "../utils/math.js";
import { currentYearMonth } from "../utils/dates.js";
import { isIrpfAmount } from "../parsers/concept-classifier.js";

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
    (c) => isIrpfAmount(c),
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

/**
 * `paymentsPerYear`: pagas al año del perfil (si se mira uno solo y se conoce):
 * con 14, la proyección cuenta también las extras que aún no han llegado.
 */
export function buildAnnualSummaries(filtered: Payslip[], allConcepts: Concept[], paymentsPerYear?: number | null) {
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
      const monthlyAvgGross = months > 0 ? regularGross / months : 0;
      const monthlyAvgNet = months > 0 ? regularNet / months : 0;
      // Proyección del AÑO completo: 12 mensualidades a la media, más las extras
      // cobradas y, si el perfil dice cuántas pagas tiene, las que faltan
      // (estimadas como una mensualidad media). Antes, en el año en curso solo
      // proyectaba hasta el mes actual y nunca contaba las pagas extra.
      const expectedExtras = paymentsPerYear ? Math.max(0, paymentsPerYear - 12) : extras.length;
      const missingExtras = Math.max(0, expectedExtras - extras.length);

      const yearPayslipIds = new Set(ps.map((p) => p.id));
      const yearIrpf = allConcepts
        .filter((c) => yearPayslipIds.has(c.payslipId) && isIrpfAmount(c))
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
        projectedAnnualGross: round(monthlyAvgGross * 12 + extraGross + missingExtras * monthlyAvgGross),
        projectedAnnualNet: round(monthlyAvgNet * 12 + extraNet + missingExtras * monthlyAvgNet),
        pagasExtra: extras.length,
        extraGross: round(extraGross),
        extraNet: round(extraNet),
        retentionRate: totalGross > 0 ? round((totalNet / totalGross) * 100) : 0,
      };
    });
}

/* ───────── Hogar (varios perfiles) ──────────────────────────── */

export interface HouseholdMember {
  profileId: number;
  name: string;
  color: string;
  payslips: number;
  totalGross: number;
  totalNet: number;
  totalIrpf: number;
  avgMonthlyNet: number;
  projectedAnnualNet: number;
  /** % del neto del hogar en el año (0–100). */
  shareOfNet: number;
}

export interface HouseholdYear {
  year: number;
  totalGross: number;
  totalNet: number;
  totalIrpf: number;
  /** Suma de la proyección de cada perfil, cada uno con sus pagas. */
  projectedAnnualNet: number;
  members: HouseholdMember[];
}

/**
 * Ingresos del hogar por año y cuánto aporta cada perfil. Solo tiene sentido
 * con dos o más perfiles con nóminas: si no, devuelve [] y la vista no sale.
 */
export function buildHousehold(
  filtered: Payslip[],
  allConcepts: Concept[],
  profileMap: Map<number, Pick<Profile, "id" | "name" | "color"> & { paymentsPerYear?: number | null }>,
): HouseholdYear[] {
  const byProfile = new Map<number, Payslip[]>();
  for (const p of filtered) {
    if (!byProfile.has(p.profileId)) byProfile.set(p.profileId, []);
    byProfile.get(p.profileId)!.push(p);
  }
  if (byProfile.size < 2) return [];

  const conceptsByPayslip = new Map<number, Concept[]>();
  for (const c of allConcepts) {
    if (!conceptsByPayslip.has(c.payslipId)) conceptsByPayslip.set(c.payslipId, []);
    conceptsByPayslip.get(c.payslipId)!.push(c);
  }

  const years = new Map<number, Omit<HouseholdMember, "shareOfNet">[]>();
  for (const [profileId, ps] of byProfile) {
    const profile = profileMap.get(profileId);
    const concepts = ps.flatMap((p) => conceptsByPayslip.get(p.id) ?? []);
    for (const s of buildAnnualSummaries(ps, concepts, profile?.paymentsPerYear ?? null)) {
      if (!years.has(s.year)) years.set(s.year, []);
      years.get(s.year)!.push({
        profileId,
        name: profile?.name ?? `Perfil ${profileId}`,
        color: profile?.color ?? "#2e3a48",
        payslips: ps.filter((p) => (p.periodYear ?? 0) === s.year).length,
        totalGross: s.totalGross,
        totalNet: s.totalNet,
        totalIrpf: s.totalIrpf,
        avgMonthlyNet: s.avgMonthlyNet,
        projectedAnnualNet: s.projectedAnnualNet,
      });
    }
  }

  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, members]) => {
      const totalNet = members.reduce((s, m) => s + m.totalNet, 0);
      return {
        year,
        totalGross: round(members.reduce((s, m) => s + m.totalGross, 0)),
        totalNet: round(totalNet),
        totalIrpf: round(members.reduce((s, m) => s + m.totalIrpf, 0)),
        projectedAnnualNet: round(members.reduce((s, m) => s + m.projectedAnnualNet, 0)),
        members: members
          .map((m) => ({ ...m, shareOfNet: totalNet > 0 ? round((m.totalNet / totalNet) * 100) : 0 }))
          .sort((a, b) => b.totalNet - a.totalNet),
      };
    });
}

/* ───────── IRPF Evolution ───────────────────────────────────── */

export function buildIrpfEvolution(filtered: Payslip[], allConcepts: Concept[]) {
  const regular = filtered.filter((p) => p.payslipType !== "extra");
  const irpfConcepts = allConcepts.filter(
    (c) => isIrpfAmount(c),
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
