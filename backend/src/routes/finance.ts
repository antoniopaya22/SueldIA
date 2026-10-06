import { Router } from "express";
import { z } from "zod";
import {
  getFinanceSummary,
  getMonthlyTrends,
  getCategoryBreakdown,
  getAccountsWithBalance,
  getTopPayees,
  getFinanceAnalytics,
} from "../services/finance.service.js";
import { getMonthReport } from "../services/month-report.service.js";
import { getBalanceHistory } from "../services/balance-history.service.js";
import { getForecast } from "../services/forecast.service.js";
import { getTodayIsoDate } from "../services/recurring-transactions.service.js";

export const financeRouter = Router();

const financeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").optional(),
  accountId: z.coerce.number().int().positive().optional(),
  groupId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
}).refine((data) => !data.from || !data.to || data.from <= data.to, {
  message: "La fecha final debe ser posterior o igual a la inicial",
  path: ["to"],
});

// Financial KPIs summary
financeRouter.get("/summary", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const summary = await getFinanceSummary(userId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Monthly income vs expenses trends
financeRouter.get("/trends", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = financeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const trends = await getMonthlyTrends({
      userId,
      from: parsed.data.from,
      to: parsed.data.to,
      accountId: parsed.data.accountId,
      groupId: parsed.data.groupId,
      categoryId: parsed.data.categoryId,
    });
    res.json({ data: trends });
  } catch (err) {
    next(err);
  }
});

// Spending breakdown by category
financeRouter.get("/breakdown", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = financeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const breakdown = await getCategoryBreakdown({
      userId,
      from: parsed.data.from,
      to: parsed.data.to,
      accountId: parsed.data.accountId,
      groupId: parsed.data.groupId,
      categoryId: parsed.data.categoryId,
    });
    res.json({ data: breakdown });
  } catch (err) {
    next(err);
  }
});

// Summary per account
financeRouter.get("/by-account", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const accs = await getAccountsWithBalance(userId);
    res.json({ data: accs });
  } catch (err) {
    next(err);
  }
});

// Top payees by spending
financeRouter.get("/by-payee", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = financeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const payees = await getTopPayees({
      userId,
      from: parsed.data.from,
      to: parsed.data.to,
      accountId: parsed.data.accountId,
      groupId: parsed.data.groupId,
      categoryId: parsed.data.categoryId,
    });
    res.json({ data: payees });
  } catch (err) {
    next(err);
  }
});

// Aggregated finance analytics dashboard
financeRouter.get("/analytics", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = financeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const analytics = await getFinanceAnalytics({
      userId,
      from: parsed.data.from,
      to: parsed.data.to,
      accountId: parsed.data.accountId,
      groupId: parsed.data.groupId,
      categoryId: parsed.data.categoryId,
    });

    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// Informe del mes: este mes frente a la media de los 6 anteriores, lo inusual y lo nuevo.
const reportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Formato YYYY-MM").optional(),
});

financeRouter.get("/report", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parámetros de consulta inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await getMonthReport(userId, parsed.data.month ?? getTodayIsoDate().slice(0, 7)));
  } catch (err) {
    next(err);
  }
});

// Saldo al final de cada mes (por cuenta y total).
financeRouter.get("/balance-history", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = z.object({ months: z.coerce.number().int().min(2).max(60).default(12) }).safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parámetros de consulta inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await getBalanceHistory(userId, parsed.data.months));
  } catch (err) {
    next(err);
  }
});

// Saldo previsto con lo ya programado (pendientes y recurrentes).
financeRouter.get("/forecast", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }).safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parámetros de consulta inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await getForecast(userId, parsed.data.days));
  } catch (err) {
    next(err);
  }
});
