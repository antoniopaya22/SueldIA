import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { env } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { profilesRouter } from "./routes/profiles.js";
import { payslipsRouter } from "./routes/payslips.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { analyticsRouter } from "./routes/analytics.js";
import { exportRouter } from "./routes/export.js";
import { alertsRouter } from "./routes/alerts.js";
import { notesRouter } from "./routes/notes.js";
import { tagsRouter } from "./routes/tags.js";
import { accountsRouter } from "./routes/accounts.js";
import { categoriesRouter } from "./routes/categories.js";
import { categoryRulesRouter } from "./routes/category-rules.js";
import { preferencesRouter } from "./routes/preferences.js";
import { transactionsRouter } from "./routes/transactions.js";
import { recurringTransactionsRouter } from "./routes/recurring-transactions.js";
import { importRouter } from "./routes/import.js";
import { financeRouter } from "./routes/finance.js";
import { budgetsRouter } from "./routes/budgets.js";
import { cronRouter } from "./routes/cron.js";
import { db, client } from "./db/index.js";

const app = express();

// Vercel es el único proxy entre el cliente y esta app — confiar en un solo
// salto hace que `req.ip` (y por tanto express-rate-limit, que lo usa como
// clave) lea la IP real del cliente desde X-Forwarded-For en vez de la IP
// del propio proxy. Sin esto, express-rate-limit rechaza arrancar en cuanto
// detecta X-Forwarded-For sin trust proxy configurado (from v7), porque
// confiar en esa cabecera a ciegas permite falsearla.
app.set("trust proxy", 1);

// ─── Global middleware ──────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);
// El frontend siempre llama a /api en el mismo origen (rewrite de Vercel), así
// que CORS solo protege frente a otros orígenes — se restringe a una lista
// explícita (CORS_ORIGIN admite varios separados por comas) en vez de aceptar
// cualquier origen en producción.
const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Sin cabecera Origin (curl, health checks, llamadas servidor-servidor): permitir.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("No permitido por CORS"));
    },
  })
);
app.use(express.json());
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => (req as express.Request).url === "/api/health" } }));

// Rate limiting — en memoria: cada instancia de la función lleva su propia
// cuenta, así que el límite real es "max por instancia activa", no un tope
// global estricto (en Vercel puede haber varias instancias a la vez bajo
// carga). Para un tope compartido de verdad haría falta un almacén externo
// (Redis/Upstash) — no lo añado aquí porque es una dependencia nueva de
// infraestructura, no una corrección de código.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones, intenta más tarde" },
});
app.use("/api", globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de login, intenta más tarde" },
});

// ─── Public routes ──────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", version: "2.0.0" });
  } catch {
    res.status(503).json({ status: "error", message: "Base de datos no disponible" });
  }
});

app.use("/api/auth", authLimiter, authRouter);
// Sin authMiddleware: la invoca Vercel Cron (sin JWT de usuario), protegida
// por su propio CRON_SECRET — ver routes/cron.ts.
app.use("/api/cron", cronRouter);

// ─── Protected routes ───────────────────────────────────────────
app.use("/api/profiles", authMiddleware, profilesRouter);
app.use("/api/payslips", authMiddleware, payslipsRouter);
app.use("/api/dashboard", authMiddleware, dashboardRouter);
app.use("/api/analytics", authMiddleware, analyticsRouter);
app.use("/api/accounts", authMiddleware, accountsRouter);
app.use("/api/categories", authMiddleware, categoriesRouter);
app.use("/api/category-rules", authMiddleware, categoryRulesRouter);
app.use("/api/preferences", authMiddleware, preferencesRouter);
app.use("/api/recurring-transactions", authMiddleware, recurringTransactionsRouter);
app.use("/api/transactions", authMiddleware, transactionsRouter);
app.use("/api/import", authMiddleware, importRouter);
app.use("/api/finance", authMiddleware, financeRouter);
app.use("/api/budgets", authMiddleware, budgetsRouter);
app.use("/api/export", authMiddleware, exportRouter);
app.use("/api/alerts", authMiddleware, alertsRouter);
app.use("/api/notes", authMiddleware, notesRouter);
app.use("/api/tags", authMiddleware, tagsRouter);

// ─── Error handler (must be last) ──────────────────────────────
app.use(errorHandler);

// En Vercel la app se importa como función (ver api/index.ts) — solo escucha
// un puerto en desarrollo local.
if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    logger.info(`🚀 Backend running on http://localhost:${env.PORT}`);
  });

  function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down`);
    client.end().finally(() => process.exit(0));
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception (non-fatal)");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled rejection (non-fatal)");
});

export default app;
