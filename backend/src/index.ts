import "./zod-es.js";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { env } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { corsMiddleware } from "./middleware/cors.js";
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
import { clientErrorsRouter } from "./routes/client-errors.js";
import { pushRouter } from "./routes/push.js";
import { savingsGoalsRouter } from "./routes/savings-goals.js";
import { demoRouter } from "./routes/demo.js";
import { activityRouter } from "./routes/activity.js";
import { sharingRouter } from "./routes/sharing.js";
import { activityMiddleware } from "./services/activity.service.js";
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
// Mismo origen siempre; otros orígenes, solo los de CORS_ORIGIN (ver middleware/cors.ts).
const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
app.use(corsMiddleware(allowedOrigins));
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

// El login lo hace Supabase, no esta API: /api/auth solo tiene GET/PUT/DELETE
// /me. El límite estricto se aplica a las escrituras (cambiar nombre, borrar
// la cuenta); GET /me se pide en cada carga de página y con el límite de 20
// cada 15 min un uso normal acababa en 429 (sin nombre en la interfaz y el
// login atascado tras volver de Google).
const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
  message: { error: "Demasiadas peticiones, intenta más tarde" },
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

// Registro de actividad: apunta lo que cambia cuando la petición termina bien.
app.use("/api", activityMiddleware);

app.use("/api/auth", authWriteLimiter, authRouter);
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
app.use("/api/push", authMiddleware, pushRouter);
app.use("/api/savings-goals", authMiddleware, savingsGoalsRouter);
app.use("/api/demo", authMiddleware, demoRouter);
app.use("/api/activity", authMiddleware, activityRouter);
app.use("/api/sharing", authMiddleware, sharingRouter);
app.use("/api/client-errors", authMiddleware, clientErrorsRouter);

// ─── Error handler (must be last) ──────────────────────────────
app.use(errorHandler);

// En Vercel el servicio "backend" importa `app` directamente (vercel.json) —
// solo se abre un puerto en desarrollo local.
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

// Tras una excepción no capturada el proceso queda en un estado indefinido:
// se registra y se termina (Vercel levanta otra instancia; en local, tsx watch
// o quien lo arranque). Antes se ignoraba y la instancia seguía atendiendo.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — cerrando el proceso");
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled rejection (non-fatal)");
});

export default app;
