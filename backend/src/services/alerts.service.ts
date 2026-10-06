import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { alertHistory, alertRules, payslipConcepts, payslips, profiles } from "../db/schema.js";
import { logger } from "../logger.js";
import {
  evalCategoryOverspent, evalLowBalance, evalOverduePending, financeAlertConfigSchemas,
} from "./finance-alerts.service.js";

/* ───────── Config por tipo de regla ─────────────────────────────
 * Cada tipo de `alert_rules.type` tiene su propia forma de `config`.
 * Se valida tanto al crear/editar la regla (routes/alerts.ts) como aquí, al
 * evaluarla — así una regla creada antes de endurecer el esquema no puede
 * tirar el motor entero.
 */
export const alertConfigSchemas = {
  salary_drop: z.object({
    profileId: z.number().int().positive().optional(),
    thresholdPercent: z.number().positive().max(100).default(10),
  }),
  missing_payslip: z.object({
    profileId: z.number().int().positive().optional(),
    graceDays: z.number().int().min(0).max(60).default(10),
  }),
  concept_change: z.object({
    profileId: z.number().int().positive().optional(),
    conceptName: z.string().min(1).max(100),
    thresholdPercent: z.number().positive().max(1000).default(15),
  }),
  custom_threshold: z.object({
    profileId: z.number().int().positive().optional(),
    metric: z.enum(["net", "gross"]),
    comparator: z.enum(["below", "above"]),
    value: z.number().nonnegative(),
  }),
  // Alertas de finanzas (ver finance-alerts.service.ts)
  ...financeAlertConfigSchemas,
} as const;

export type AlertRuleType = keyof typeof alertConfigSchemas;

type Rule = typeof alertRules.$inferSelect;
type ParsedPayslip = typeof payslips.$inferSelect;

interface Candidate {
  severity: "info" | "warning" | "critical";
  message: string;
  payslipId: number | null;
  dedupeKey: string;
}

/** Perfiles en los que aplica la regla: el suyo si `profileId` está en el config, si no todos los del usuario. */
async function scopedProfiles(userId: number, configProfileId: number | undefined) {
  const rows = await db
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (configProfileId == null) return rows;
  return rows.filter((p) => p.id === configProfileId);
}

async function parsedOrdinalPayslips(profileId: number): Promise<ParsedPayslip[]> {
  return db
    .select()
    .from(payslips)
    .where(
      and(
        eq(payslips.profileId, profileId),
        eq(payslips.parsingStatus, "parsed"),
        eq(payslips.payslipType, "ordinal"),
      ),
    )
    .orderBy(asc(payslips.periodYear), asc(payslips.periodMonth));
}

export function nextPeriod(year: number, month: number): { year: number; month: number } {
  return month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/* ───────── Evaluadores por tipo ─────────────────────────────────
 * Cada uno devuelve como mucho un candidato por perfil — el motor los
 * inserta con ON CONFLICT DO NOTHING sobre (rule_id, dedupe_key), así que
 * repetir la evaluación (cron diario + tras cada nómina nueva) es seguro:
 * nunca duplica una alerta ya emitida para la misma condición.
 */

async function evalMissingPayslip(
  rule: Rule,
  config: z.infer<typeof alertConfigSchemas.missing_payslip>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const profile of await scopedProfiles(rule.userId, config.profileId)) {
    const history = await parsedOrdinalPayslips(profile.id);
    const latest = history.at(-1);
    if (!latest?.periodYear || !latest.periodMonth) continue; // sin nóminas previas, nada que echar en falta

    const expected = nextPeriod(latest.periodYear, latest.periodMonth);
    const alreadyHasExpected = history.some(
      (p) => p.periodYear === expected.year && p.periodMonth === expected.month,
    );
    if (alreadyHasExpected) continue;

    const deadline = new Date(expected.year, expected.month - 1, 1 + config.graceDays);
    if (new Date() < deadline) continue;

    const monthLabel = new Date(expected.year, expected.month - 1, 1).toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
    });
    candidates.push({
      severity: "info",
      message: `No se ha subido la nómina de ${profile.name} de ${monthLabel} (han pasado más de ${config.graceDays} días).`,
      payslipId: null,
      dedupeKey: `missing:${profile.id}:${expected.year}-${expected.month}`,
    });
  }
  return candidates;
}

async function evalSalaryDrop(
  rule: Rule,
  config: z.infer<typeof alertConfigSchemas.salary_drop>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const profile of await scopedProfiles(rule.userId, config.profileId)) {
    const history = await parsedOrdinalPayslips(profile.id);
    const latest = history.at(-1);
    const previous = history.slice(-4, -1); // hasta 3 nóminas anteriores a la última
    if (!latest?.netSalary || previous.length === 0) continue;

    const baseline = previous.reduce((sum, p) => sum + (p.netSalary ?? 0), 0) / previous.length;
    if (baseline <= 0) continue;
    const dropPercent = ((baseline - latest.netSalary) / baseline) * 100;
    if (dropPercent <= config.thresholdPercent) continue;

    candidates.push({
      severity: dropPercent > config.thresholdPercent * 2 ? "critical" : "warning",
      message: `El neto de ${profile.name} ha bajado un ${dropPercent.toFixed(1)}% respecto a la media de las nóminas anteriores.`,
      payslipId: latest.id,
      dedupeKey: `salary_drop:${rule.id}:${latest.id}`,
    });
  }
  return candidates;
}

async function evalConceptChange(
  rule: Rule,
  config: z.infer<typeof alertConfigSchemas.concept_change>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const needle = config.conceptName.trim().toLowerCase();
  if (!needle) return candidates;

  for (const profile of await scopedProfiles(rule.userId, config.profileId)) {
    const history = await parsedOrdinalPayslips(profile.id);
    const latest = history.at(-1);
    const prior = history.at(-2);
    if (!latest || !prior) continue;

    const concepts = await db
      .select()
      .from(payslipConcepts)
      .where(inArray(payslipConcepts.payslipId, [latest.id, prior.id]));

    const latestAmount = concepts.find((c) => c.payslipId === latest.id && c.name.toLowerCase().includes(needle))?.amount;
    const priorAmount = concepts.find((c) => c.payslipId === prior.id && c.name.toLowerCase().includes(needle))?.amount;
    if (latestAmount == null || priorAmount == null || priorAmount === 0) continue;

    const changePercent = ((latestAmount - priorAmount) / priorAmount) * 100;
    if (Math.abs(changePercent) <= config.thresholdPercent) continue;

    candidates.push({
      severity: "warning",
      message: `"${config.conceptName}" ha cambiado un ${changePercent.toFixed(1)}% en la última nómina de ${profile.name} (${priorAmount.toFixed(2)} € → ${latestAmount.toFixed(2)} €).`,
      payslipId: latest.id,
      dedupeKey: `concept_change:${rule.id}:${latest.id}`,
    });
  }
  return candidates;
}

async function evalCustomThreshold(
  rule: Rule,
  config: z.infer<typeof alertConfigSchemas.custom_threshold>,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const profile of await scopedProfiles(rule.userId, config.profileId)) {
    const history = await parsedOrdinalPayslips(profile.id);
    const latest = history.at(-1);
    const value = config.metric === "net" ? latest?.netSalary : latest?.grossSalary;
    if (!latest || value == null) continue;

    const crosses = config.comparator === "below" ? value < config.value : value > config.value;
    if (!crosses) continue;

    const metricLabel = config.metric === "net" ? "neto" : "bruto";
    const comparatorLabel = config.comparator === "below" ? "por debajo de" : "por encima de";
    candidates.push({
      severity: "warning",
      message: `El ${metricLabel} de ${profile.name} (${value.toFixed(2)} €) está ${comparatorLabel} ${config.value.toFixed(2)} €.`,
      payslipId: latest.id,
      dedupeKey: `custom_threshold:${rule.id}:${latest.id}`,
    });
  }
  return candidates;
}

async function evaluateRule(rule: Rule): Promise<Candidate[]> {
  const schema = alertConfigSchemas[rule.type as AlertRuleType];
  if (!schema) return [];
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(rule.config);
  } catch {
    logger.warn({ ruleId: rule.id }, "alert_rules.config no es JSON válido, se ignora la regla");
    return [];
  }
  const parsed = schema.safeParse(rawConfig);
  if (!parsed.success) {
    logger.warn({ ruleId: rule.id, issues: parsed.error.issues }, "Config de regla de alerta inválida, se ignora");
    return [];
  }

  switch (rule.type as AlertRuleType) {
    case "missing_payslip":
      return evalMissingPayslip(rule, parsed.data as z.infer<typeof alertConfigSchemas.missing_payslip>);
    case "salary_drop":
      return evalSalaryDrop(rule, parsed.data as z.infer<typeof alertConfigSchemas.salary_drop>);
    case "concept_change":
      return evalConceptChange(rule, parsed.data as z.infer<typeof alertConfigSchemas.concept_change>);
    case "custom_threshold":
      return evalCustomThreshold(rule, parsed.data as z.infer<typeof alertConfigSchemas.custom_threshold>);
    case "category_overspent":
      return evalCategoryOverspent(rule.userId, rule.id, parsed.data as z.infer<typeof alertConfigSchemas.category_overspent>);
    case "low_balance":
      return evalLowBalance(rule.userId, rule.id, parsed.data as z.infer<typeof alertConfigSchemas.low_balance>);
    case "overdue_pending":
      return evalOverduePending(rule.userId, rule.id, parsed.data as z.infer<typeof alertConfigSchemas.overdue_pending>);
    default:
      return [];
  }
}

async function insertCandidates(rule: Rule, candidates: Candidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows = await db
    .insert(alertHistory)
    .values(
      candidates.map((c) => ({
        userId: rule.userId,
        ruleId: rule.id,
        payslipId: c.payslipId,
        type: rule.type,
        severity: c.severity,
        message: c.message,
        dedupeKey: c.dedupeKey,
      })),
    )
    .onConflictDoNothing({ target: [alertHistory.ruleId, alertHistory.dedupeKey] })
    .returning({ id: alertHistory.id });
  return rows.length;
}

/** Evalúa todas las reglas activas de un usuario. Devuelve cuántas alertas nuevas se emitieron. */
export async function evaluateRulesForUser(userId: number): Promise<number> {
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.userId, userId), eq(alertRules.enabled, true)));

  let created = 0;
  for (const rule of rules) {
    try {
      const candidates = await evaluateRule(rule);
      created += await insertCandidates(rule, candidates);
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, "Error evaluando regla de alerta");
    }
  }
  return created;
}

/** Evalúa las reglas de todos los usuarios — pensado para el cron diario. */
export async function evaluateAllRules(): Promise<{ usersEvaluated: number; alertsCreated: number }> {
  const userIds = await db
    .selectDistinct({ userId: alertRules.userId })
    .from(alertRules)
    .where(eq(alertRules.enabled, true));

  let alertsCreated = 0;
  for (const { userId } of userIds) {
    alertsCreated += await evaluateRulesForUser(userId);
  }
  return { usersEvaluated: userIds.length, alertsCreated };
}
