import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { profiles } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  fetchDashboardData,
  buildKpis,
  buildEvolution,
  buildConceptBreakdown,
  buildAnnualSummaries,
  buildIrpfEvolution,
  buildMonthlySavings,
} from "../services/dashboard.service.js";

export const dashboardRouter = Router();

const dashboardQuerySchema = z.object({
  profileId: z.string().regex(/^\d+(,\d+)*$/, "IDs numéricos separados por coma").optional(),
  from: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM").optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM").optional(),
});

const EMPTY_DASHBOARD = {
  kpis: { totalPayslips: 0, avgGross: 0, avgNet: 0, totalGrossYear: 0, totalNetYear: 0, avgIrpf: 0 },
  evolution: {},
  conceptBreakdown: [],
  annualSummaries: [],
  irpfEvolution: [],
  monthlySavings: [],
  profiles: [],
};

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { userId } = req.user!;

    const userProfiles = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));
    const userProfileIds = userProfiles.map((p) => p.id);

    if (userProfileIds.length === 0) {
      return res.json(EMPTY_DASHBOARD);
    }

    const requestedProfileIds = parsed.data.profileId
      ? parsed.data.profileId.split(",").map(Number).filter((n) => userProfileIds.includes(n))
      : undefined;

    // Se pidieron perfiles, pero ninguno es del usuario: vacío, no "todos".
    if (requestedProfileIds && requestedProfileIds.length === 0) {
      return res.json({
        ...EMPTY_DASHBOARD,
        profiles: userProfiles.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      });
    }

    const { filtered, allConcepts } = await fetchDashboardData({
      userProfileIds,
      requestedProfileIds,
      from: parsed.data.from,
      to: parsed.data.to,
    });

    const profileMap = new Map(userProfiles.map((p) => [p.id, p]));

    res.json({
      kpis: buildKpis(filtered, allConcepts),
      evolution: buildEvolution(filtered, profileMap),
      conceptBreakdown: buildConceptBreakdown(allConcepts),
      annualSummaries: buildAnnualSummaries(filtered, allConcepts),
      irpfEvolution: buildIrpfEvolution(filtered, allConcepts),
      monthlySavings: buildMonthlySavings(filtered),
      profiles: userProfiles.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    });
  } catch (err) {
    next(err);
  }
});
