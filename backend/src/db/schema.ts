import { pgTable, text, integer, serial, boolean, doublePrecision, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Nota: las columnas de dinero usan doublePrecision (float8) en vez de numeric.
// numeric devuelve string en el driver de Postgres (para no perder precisión
// decimal exacta), lo que rompería en silencio las sumas (`+`) que hacen
// dashboard/analytics/finance sobre estos campos. SQLite's `real` ya era un
// float8 sin precisión decimal exacta, así que esto no es una regresión.

// ─── Users ──────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  supabaseUserId: text("supabase_user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Profiles ───────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payslips = pgTable(
  "payslips",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    periodMonth: integer("period_month"),
    periodYear: integer("period_year"),
    company: text("company"),
    grossSalary: doublePrecision("gross_salary"),
    netSalary: doublePrecision("net_salary"),
    rawText: text("raw_text"),
    parsingStatus: text("parsing_status", {
      enum: ["pending", "parsed", "error", "review"],
    })
      .notNull()
      .default("pending"),
    payslipType: text("payslip_type", {
      enum: ["ordinal", "extra"],
    })
      .notNull()
      .default("ordinal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Listado por perfil (siempre filtrado así) y detección de posibles
    // duplicados (mismo perfil + periodo, ver routes/payslips.ts).
    profilePeriodIdx: index("payslips_profile_period_idx").on(
      table.profileId,
      table.periodYear,
      table.periodMonth,
    ),
  }),
);

export const payslipConcepts = pgTable(
  "payslip_concepts",
  {
    id: serial("id").primaryKey(),
    payslipId: integer("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: ["devengo", "deduccion", "otros"],
    }).notNull(),
    name: text("name").notNull(),
    amount: doublePrecision("amount").notNull(),
    isPercentage: boolean("is_percentage").notNull().default(false),
  },
  (table) => ({
    // Toda pantalla que muestra una nómina carga sus conceptos por payslipId.
    payslipIdx: index("payslip_concepts_payslip_idx").on(table.payslipId),
  }),
);

// ─── Payslip Notes (document management) ────────────────────────
export const payslipNotes = pgTable("payslip_notes", {
  id: serial("id").primaryKey(),
  payslipId: integer("payslip_id")
    .notNull()
    .references(() => payslips.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Tags (document organization) ──────────────────────────────
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
});

export const payslipTags = pgTable(
  "payslip_tags",
  {
    id: serial("id").primaryKey(),
    payslipId: integer("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => ({
    // Evita asignar la misma etiqueta dos veces a la misma nómina (p. ej. un
    // doble clic en "asignar").
    payslipTagIdx: uniqueIndex("payslip_tags_payslip_tag_idx").on(table.payslipId, table.tagId),
  }),
);

// ─── Alert Rules (automation) ───────────────────────────────────
export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", {
    enum: [
      "salary_drop", "missing_payslip", "concept_change", "custom_threshold",
      "category_overspent", "low_balance", "overdue_pending",
    ],
  }).notNull(),
  config: text("config").notNull().default("{}"), // JSON config
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Alert History ──────────────────────────────────────────────
export const alertHistory = pgTable(
  "alert_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    payslipId: integer("payslip_id").references(() => payslips.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    message: text("message").notNull(),
    read: boolean("read").notNull().default(false),
    // Identifica la condición concreta que disparó la alerta (p. ej. el mes
    // evaluado, o `payslipId` como texto) para que el motor de evaluación no
    // vuelva a insertar la misma alerta cada vez que se re-evalúan las
    // reglas (cron diario + tras cada nómina nueva).
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ruleDedupeIdx: uniqueIndex("alert_history_rule_dedupe_idx").on(table.ruleId, table.dedupeKey),
  }),
);

// ─── Financial Accounts ─────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["bank", "credit_card", "cash", "investment", "other"],
  })
    .notNull()
    .default("bank"),
  currency: text("currency").notNull().default("EUR"),
  initialBalance: doublePrecision("initial_balance").notNull().default(0),
  color: text("color").notNull().default("#6366f1"),
  icon: text("icon"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Category Groups ────────────────────────────────────────────
export const categoryGroups = pgTable("category_groups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => categoryGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Financial Transactions ─────────────────────────────────────
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    type: text("type", {
      enum: ["expense", "income", "transfer"],
    }).notNull(),
    amount: doublePrecision("amount").notNull(),
    date: text("date").notNull(),
    recurringTransactionId: integer("recurring_transaction_id").references(
      () => recurringTransactions.id,
      { onDelete: "set null" },
    ),
    // Enlace manual nómina ↔ ingreso (el usuario lo confirma a mano desde el
    // detalle de la nómina, con una sugerencia automática de candidata —
    // nunca se crea ni se enlaza solo). Si se borra la nómina, la
    // transacción se queda, solo pierde el enlace.
    payslipId: integer("payslip_id").references(() => payslips.id, { onDelete: "set null" }),
    scheduledFor: text("scheduled_for"),
    payee: text("payee"),
    memo: text("memo"),
    cleared: boolean("cleared").notNull().default(false),
    transferId: integer("transfer_id"),
    flag: text("flag"),
    importedFrom: text("imported_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Patrón de consulta dominante: listar por usuario ordenado/filtrado por fecha.
    userDateIdx: index("transactions_user_date_idx").on(table.userId, table.date),
    // Balance por cuenta y listados filtrados por cuenta.
    accountIdx: index("transactions_account_idx").on(table.accountId),
    // Evita generar dos veces la misma ocurrencia de una recurrente si
    // syncRecurringTransactions se solapa (dos peticiones concurrentes) —
    // antes solo se evitaba comprobando en memoria, sin garantía atómica.
    recurringOccurrenceIdx: uniqueIndex("transactions_recurring_occurrence_idx")
      .on(table.recurringTransactionId, table.scheduledFor),
    // Una nómina no puede quedar enlazada a más de una transacción a la vez.
    payslipIdx: uniqueIndex("transactions_payslip_idx").on(table.payslipId),
    // Presupuesto (actividad por categoría) y filtros por categoría.
    categoryIdx: index("transactions_category_idx").on(table.categoryId),
  }),
);

// ─── Recurring Transactions ────────────────────────────────────
export const recurringTransactions = pgTable("recurring_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  type: text("type", {
    enum: ["expense", "income"],
  }).notNull(),
  amount: doublePrecision("amount").notNull(),
  cadence: text("cadence", {
    enum: ["weekly", "monthly", "yearly"],
  })
    .notNull()
    .default("monthly"),
  intervalCount: integer("interval_count").notNull().default(1),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  payee: text("payee"),
  memo: text("memo"),
  flag: text("flag"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Budgets (presupuesto por categoría y mes, estilo YNAB) ─────
export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    // "YYYY-MM" — mismo formato de texto que transactions.date, sin día.
    month: text("month").notNull(),
    assigned: doublePrecision("assigned").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Como mucho una asignación por categoría y mes — la mutación es upsert.
    categoryMonthIdx: uniqueIndex("budgets_category_month_idx").on(table.categoryId, table.month),
    userMonthIdx: index("budgets_user_month_idx").on(table.userId, table.month),
  }),
);

// ─── Objetivos por categoría (presupuesto) ──────────────────────
// Una categoría tiene como mucho un objetivo:
//  - monthly: asignar `amount` cada mes.
//  - by_date: tener `amount` disponible antes de `targetMonth` ("YYYY-MM"),
//    repartido en los meses que quedan.
export const categoryTargets = pgTable(
  "category_targets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["monthly", "by_date"] }).notNull(),
    amount: doublePrecision("amount").notNull(),
    targetMonth: text("target_month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: uniqueIndex("category_targets_category_idx").on(table.categoryId),
    userIdx: index("category_targets_user_idx").on(table.userId),
  }),
);
