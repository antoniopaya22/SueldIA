import { supabase } from "./supabase";

const BASE = "/api";

// ─── Auth Token Management ──────────────────────────────────────
// La sesión (incluido el refresco del token) la gestiona el cliente de
// Supabase — aquí solo se lee el access_token vigente en cada petición.
export async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function clearAuth() {
  await supabase.auth.signOut();
}

// ─── HTTP Client ────────────────────────────────────────────────
async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const token = await getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await clearAuth();
      window.location.href = "/login";
    }
    throw new Error(body.error ?? (res.status === 401 ? "No autorizado" : `HTTP ${res.status}`));
  }
  return res.json();
}

// ─── Common Types ───────────────────────────────────────────────
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Auth ───────────────────────────────────────────────────────
export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

export const getMe = () => request<AuthUser>("/auth/me");

export const updateUserProfile = (data: { name: string }) =>
  request<AuthUser>("/auth/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });

// Elimina la cuenta de usuario y todos sus datos (derecho de supresión
// RGPD) — irreversible. No cierra la sesión por sí sola: quien llame a esto
// debe hacer clearAuth() y redirigir después. (No confundir con
// deleteAccount, que borra una cuenta bancaria del módulo de finanzas.)
export const deleteMyAccount = () =>
  request<{ ok: boolean }>("/auth/me", { method: "DELETE" });

// Exporta todos los datos de la cuenta como un único JSON (derecho de
// portabilidad RGPD) y dispara la descarga en el navegador.
export const exportAllData = async () => {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export/all`, { headers });
  if (!res.ok) throw new Error("No se pudo exportar los datos");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sueldia-datos.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── Profiles ───────────────────────────────────────────────────
export interface Profile {
  id: number;
  name: string;
  color: string;
  createdAt: string;
}

export const getProfiles = () =>
  request<Paginated<Profile>>("/profiles").then((r) => r.data);

export const createProfile = (data: { name: string; color?: string }) =>
  request<Profile>("/profiles", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateProfile = (id: number, data: { name: string; color?: string }) =>
  request<Profile>(`/profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteProfile = (id: number) =>
  request<{ ok: boolean }>(`/profiles/${id}`, { method: "DELETE" });

// ─── Payslips ───────────────────────────────────────────────────
export interface PayslipConcept {
  id: number;
  payslipId: number;
  category: "devengo" | "deduccion" | "otros";
  name: string;
  amount: number;
  isPercentage: boolean;
}

export interface Payslip {
  id: number;
  profileId: number;
  fileName: string;
  periodMonth: number | null;
  periodYear: number | null;
  company: string | null;
  grossSalary: number | null;
  netSalary: number | null;
  parsingStatus: string;
  payslipType: "ordinal" | "extra";
  createdAt: string;
  rawText?: string | null;
  concepts?: PayslipConcept[];
  /** Solo presente en la respuesta de /payslips/upload: id de otra nómina ya
   *  existente con el mismo perfil, periodo y tipo, o null si no hay ninguna. */
  duplicateOfId?: number | null;
  /** Solo presente en el detalle (GET /payslips/:id). */
  linkedTransaction?: PayslipLinkCandidate | null;
  warnings?: PayslipWarning[];
}

export interface PayslipWarning {
  code: "amount_mismatch" | "gross_mismatch" | "below_smi";
  message: string;
}

export interface PayslipLinkCandidate {
  id: number;
  accountId: number;
  accountName: string;
  amount: number;
  date: string;
  payee: string | null;
}

export type PayslipSortField = "period" | "fileName" | "grossSalary" | "netSalary" | "parsingStatus";
export type ApiSortDirection = "asc" | "desc";

export interface PayslipFilters {
  profileId?: number;
  year?: number;
  search?: string;
  status?: string;
  type?: "ordinal" | "extra";
  sortBy?: PayslipSortField;
  sortDir?: ApiSortDirection;
  page?: number;
  limit?: number;
}

export const getPayslips = (filters: PayslipFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.profileId) params.set("profileId", String(filters.profileId));
  if (filters.year) params.set("year", String(filters.year));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 20));
  return request<Paginated<Payslip>>(`/payslips?${params}`);
};

export const getPayslip = (id: number) =>
  request<Payslip & { concepts: PayslipConcept[] }>(`/payslips/${id}`);

export const getPayslipLinkSuggestions = (id: number) =>
  request<{ data: PayslipLinkCandidate[] }>(`/payslips/${id}/link-suggestions`);

/** `transactionId: null` desvincula la nómina de cualquier transacción. */
export const linkPayslipTransaction = (id: number, transactionId: number | null) =>
  request<{ ok: boolean }>(`/payslips/${id}/link`, {
    method: "PUT",
    body: JSON.stringify({ transactionId }),
  });

export const uploadPayslips = async (profileId: number, files: File[], payslipType: "ordinal" | "extra" = "ordinal") => {
  const formData = new FormData();
  formData.append("profileId", String(profileId));
  formData.append("payslipType", payslipType);
  files.forEach((f) => formData.append("files", f));

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/payslips/upload`, {
    method: "POST",
    body: formData,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await clearAuth();
      window.location.href = "/login";
    }
    throw new Error(body.error ?? "Error al subir los archivos");
  }
  return res.json() as Promise<Payslip[]>;
};

export const updatePayslipConcepts = (
  id: number,
  data: {
    concepts: Array<{
      category: string;
      name: string;
      amount: number;
      isPercentage?: boolean;
    }>;
    grossSalary?: number;
    netSalary?: number;
    periodMonth?: number;
    periodYear?: number;
    company?: string;
  }
) =>
  request<{ ok: boolean }>(`/payslips/${id}/concepts`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const reprocessPayslip = (id: number) =>
  request<Payslip & { concepts: PayslipConcept[] }>(`/payslips/${id}/reprocess`, {
    method: "POST",
  });

export const deletePayslip = (id: number) =>
  request<{ ok: boolean }>(`/payslips/${id}`, { method: "DELETE" });

export const updatePayslipType = (id: number, type: "ordinal" | "extra") =>
  request<Payslip>(`/payslips/${id}/type`, {
    method: "PATCH",
    body: JSON.stringify({ type }),
  });

// ─── Dashboard ──────────────────────────────────────────────────
export interface AnnualSummary {
  year: number;
  months: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  totalIrpf: number;
  avgMonthlyGross: number;
  avgMonthlyNet: number;
  projectedAnnualGross: number;
  projectedAnnualNet: number;
  pagasExtra: number;
  extraGross: number;
  extraNet: number;
  retentionRate: number;
}

export interface DashboardData {
  kpis: {
    totalPayslips: number;
    avgGross: number;
    avgNet: number;
    totalGrossYear: number;
    totalNetYear: number;
    avgIrpf: number;
    extrasCount: number;
    extrasTotalGross: number;
    extrasTotalNet: number;
  };
  evolution: Record<string, Array<{ month: string; gross: number | null; net: number | null }>>;
  conceptBreakdown: Array<{
    name: string;
    category: string;
    total: number;
    average: number;
    count: number;
  }>;
  annualSummaries: AnnualSummary[];
  irpfEvolution: Array<{ month: string; amount: number; rate: number }>;
  monthlySavings: Array<{ month: string; gross: number; net: number; deductions: number; retentionRate: number }>;
  profiles: Array<{ id: number; name: string; color: string }>;
}

export const getDashboard = (profileIds?: number[], from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (profileIds?.length) params.set("profileId", profileIds.join(","));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return request<DashboardData>(`/dashboard?${params}`);
};

// ─── Analytics ──────────────────────────────────────────────────
export interface AnalyticsData {
  trends: {
    gross: Array<{ month: string; value: number }>;
    net: Array<{ month: string; value: number }>;
    yoyGross: Array<{ month: string; current: number; previous: number; change: number }>;
    yoyNet: Array<{ month: string; current: number; previous: number; change: number }>;
    conceptTrends: Record<string, Array<{ month: string; value: number }>>;
  };
  predictions: Array<{ month: string; predictedGross: number; predictedNet: number }>;
  anomalies: Array<{
    type: string;
    severity: "info" | "warning" | "critical";
    month: string;
    message: string;
    value: number;
    expected: number;
  }>;
  alerts: Array<{
    type: string;
    severity: "info" | "warning" | "critical";
    message: string;
  }>;
  extras: Array<{
    year: number;
    count: number;
    totalGross: number;
    totalNet: number;
  }>;
}

export const getAnalytics = (profileId: number) =>
  request<AnalyticsData>(`/analytics?profileId=${profileId}`);

// ─── Export ─────────────────────────────────────────────────────
export const exportData = async (profileId: number, year?: number, format: "csv" | "json" = "csv") => {
  const params = new URLSearchParams({ profileId: String(profileId), format });
  if (year) params.set("year", String(year));

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export?${params}`, { headers });
  if (!res.ok) throw new Error("Export failed");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nominas_${profileId}${year ? `_${year}` : ""}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── Notes ──────────────────────────────────────────────────────
export interface Note {
  id: number;
  payslipId: number;
  content: string;
  createdAt: string;
}

export const getNotes = (payslipId: number) =>
  request<Note[]>(`/notes/${payslipId}`);

export const createNote = (payslipId: number, content: string) =>
  request<Note>("/notes", {
    method: "POST",
    body: JSON.stringify({ payslipId, content }),
  });

export const deleteNote = (id: number) =>
  request<{ ok: boolean }>(`/notes/${id}`, { method: "DELETE" });

// ─── Tags ───────────────────────────────────────────────────────
export interface Tag {
  id: number;
  name: string;
  color: string;
}

export const getTags = () => request<Tag[]>("/tags");

export const createTag = (name: string, color: string) =>
  request<Tag>("/tags", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });

export const deleteTag = (id: number) =>
  request<{ ok: boolean }>(`/tags/${id}`, { method: "DELETE" });

export const getPayslipTags = (payslipId: number) =>
  request<Tag[]>(`/tags/payslip/${payslipId}`);

export const assignTag = (payslipId: number, tagId: number) =>
  request<{ ok: boolean }>(`/tags/assign`, {
    method: "POST",
    body: JSON.stringify({ payslipId, tagId }),
  });

export const removeTag = (payslipId: number, tagId: number) =>
  request<{ ok: boolean }>(`/tags/assign/${payslipId}/${tagId}`, { method: "DELETE" });

export const putBudgetTarget = (categoryId: number, target: BudgetTargetInput) =>
  request<{ id: number }>("/budgets/targets", {
    method: "PUT",
    body: JSON.stringify({ categoryId, ...target }),
  });

export const deleteBudgetTarget = (categoryId: number) =>
  request<{ ok: boolean }>(`/budgets/targets/${categoryId}`, { method: "DELETE" });

export type AutoAssignMode = "copy-previous" | "average-3" | "targets";

/** Asignar de golpe: `total` es lo que sube lo asignado y `categories` a cuántas categorías afecta. */
export const autoAssignBudget = (month: string, mode: AutoAssignMode) =>
  request<{ categories: number; total: number }>("/budgets/auto-assign", {
    method: "POST",
    body: JSON.stringify({ month, mode }),
  });

/** Pasar dinero disponible de una categoría a otra (cubrir un sobregasto). */
export const moveBudget = (month: string, fromCategoryId: number, toCategoryId: number, amount: number) =>
  request<{ ok: boolean }>("/budgets/move", {
    method: "POST",
    body: JSON.stringify({ month, fromCategoryId, toCategoryId, amount }),
  });

// ─── Alerts ─────────────────────────────────────────────────────
export type AlertRuleType =
  | "salary_drop" | "missing_payslip" | "concept_change" | "custom_threshold"
  | "category_overspent" | "low_balance" | "overdue_pending";

// Formas de `config` por tipo de regla — deben reflejar
// backend/src/services/alerts.service.ts (alertConfigSchemas).
export interface SalaryDropConfig {
  profileId?: number;
  thresholdPercent?: number;
}
export interface MissingPayslipConfig {
  profileId?: number;
  graceDays?: number;
}
export interface ConceptChangeConfig {
  profileId?: number;
  conceptName: string;
  thresholdPercent?: number;
}
export interface CustomThresholdConfig {
  profileId?: number;
  metric: "net" | "gross";
  comparator: "below" | "above";
  value: number;
}
// Alertas de finanzas (backend/src/services/finance-alerts.service.ts)
export interface CategoryOverspentConfig {
  categoryId?: number;
}
export interface LowBalanceConfig {
  accountId?: number;
  threshold: number;
}
export interface OverduePendingConfig {
  graceDays?: number;
}
export type AlertRuleConfig =
  | SalaryDropConfig
  | MissingPayslipConfig
  | ConceptChangeConfig
  | CustomThresholdConfig
  | CategoryOverspentConfig
  | LowBalanceConfig
  | OverduePendingConfig;

export interface AlertRule {
  id: number;
  name: string;
  type: AlertRuleType;
  config: AlertRuleConfig;
  enabled: boolean;
  createdAt: string;
}

export interface AlertHistoryItem {
  id: number;
  ruleId: number | null;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  read: boolean;
  createdAt: string;
}

export const getAlertRules = () => request<AlertRule[]>("/alerts/rules");

export const createAlertRule = (data: { name: string; type: AlertRuleType; config: AlertRuleConfig; enabled?: boolean }) =>
  request<AlertRule>("/alerts/rules", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAlertRule = (
  id: number,
  data: Partial<{ name: string; type: AlertRuleType; config: AlertRuleConfig; enabled: boolean }>,
) =>
  request<AlertRule>(`/alerts/rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteAlertRule = (id: number) =>
  request<{ ok: boolean }>(`/alerts/rules/${id}`, { method: "DELETE" });

export const getAlertHistory = (filters: { unread?: boolean } = {}) => {
  const params = new URLSearchParams();
  if (filters.unread) params.set("unread", "true");
  const qs = params.toString();
  return request<AlertHistoryItem[]>(`/alerts/history${qs ? `?${qs}` : ""}`);
};

export const markAlertRead = (id: number) =>
  request<{ ok: boolean }>(`/alerts/history/${id}/read`, { method: "PUT" });

export const markAllAlertsRead = () =>
  request<{ ok: boolean }>("/alerts/history/read-all", { method: "PUT" });

// ─── Financial Accounts ─────────────────────────────────────────
export interface Account {
  id: number;
  name: string;
  type: "bank" | "credit_card" | "cash" | "investment" | "other";
  currency: string;
  initialBalance: number;
  color: string;
  icon: string | null;
  archived: boolean;
  /** Posición elegida por el usuario (a igualdad, por nombre). */
  sortOrder: number;
  /** Saldo liquidado (lo que ya refleja el banco). */
  balance: number;
  /** Movimientos sin liquidar hasta hoy, con signo. */
  unclearedBalance: number;
  unclearedCount: number;
  /** Liquidado + sin liquidar. */
  workingBalance: number;
  createdAt: string;
}

export const getAccounts = () =>
  request<{ data: Account[] }>("/accounts").then((r) => r.data);

/** Guarda el orden de las cuentas: `ids` en el orden deseado. */
export const reorderAccounts = (ids: number[]) =>
  request<{ ok: boolean }>("/accounts/order", { method: "PUT", body: JSON.stringify({ ids }) });

export const createAccount = (data: {
  name: string;
  type?: string;
  currency?: string;
  initialBalance?: number;
  color?: string;
  icon?: string | null;
}) => request<Account>("/accounts", { method: "POST", body: JSON.stringify(data) });

export const updateAccount = (
  id: number,
  data: { name: string; type?: string; color?: string; initialBalance?: number; icon?: string | null },
) => request<Account>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteAccount = (id: number) =>
  request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" });

export const toggleAccountArchive = (id: number) =>
  request<Account>(`/accounts/${id}/archive`, { method: "PATCH" });

// ─── Categories ─────────────────────────────────────────────────
export interface Category {
  id: number;
  groupId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
}

export interface CategoryGroup {
  id: number;
  name: string;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  categories: Category[];
}

export const getCategories = () =>
  request<{ data: CategoryGroup[] }>("/categories").then((r) => r.data);

export const createCategoryGroup = (data: { name: string; icon?: string | null }) =>
  request<CategoryGroup>("/categories/groups", { method: "POST", body: JSON.stringify(data) });

export const updateCategoryGroup = (id: number, data: { name: string; icon?: string | null }) =>
  request<CategoryGroup>(`/categories/groups/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteCategoryGroup = (id: number) =>
  request<{ ok: boolean }>(`/categories/groups/${id}`, { method: "DELETE" });

export const createCategory = (data: { groupId: number; name: string }) =>
  request<Category>("/categories", { method: "POST", body: JSON.stringify(data) });

export const updateCategory = (id: number, data: { name?: string; groupId?: number }) =>
  request<Category>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteCategory = (id: number) =>
  request<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" });

// ─── Transactions ───────────────────────────────────────────────
export interface Transaction {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  date: string;
  recurringTransactionId: number | null;
  scheduledFor: string | null;
  payee: string | null;
  memo: string | null;
  cleared: boolean;
  transferId: number | null;
  targetAccountId: number | null;
  targetAccountName: string;
  transferDirection: "outflow" | "inflow" | null;
  flag: string | null;
  importedFrom: string | null;
  payslipId: number | null;
  /** Mismo valor en todas las partes de un gasto dividido; null si no está dividido. */
  splitGroupId: string | null;
  createdAt: string;
}

export interface TransactionFilters {
  accountId?: number;
  categoryId?: number;
  groupId?: number;
  from?: string;
  to?: string;
  type?: "expense" | "income" | "transfer";
  cleared?: "true" | "false";
  payee?: string;
  search?: string;
  /** Solo gastos/ingresos sin categoría. */
  uncategorized?: boolean;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: "date" | "payee" | "category" | "amount" | "type";
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export const getTransactions = (filters: TransactionFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", String(filters.accountId));
  if (filters.categoryId) params.set("categoryId", String(filters.categoryId));
  if (filters.groupId) params.set("groupId", String(filters.groupId));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.type) params.set("type", filters.type);
  if (filters.cleared) params.set("cleared", filters.cleared);
  if (filters.payee) params.set("payee", filters.payee);
  if (filters.search) params.set("search", filters.search);
  if (filters.uncategorized) params.set("uncategorized", "true");
  if (filters.minAmount !== undefined) params.set("minAmount", String(filters.minAmount));
  if (filters.maxAmount !== undefined) params.set("maxAmount", String(filters.maxAmount));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 50));
  return request<TransactionsPage>(`/transactions?${params}`);
};

/** Cifras de la selección actual: salen del servidor con los mismos filtros que la lista. */
export interface TransactionsSummary {
  income: number;
  expense: number;
  net: number;
  /** Pendientes de liquidar dentro de la selección (ignorando el filtro de estado). */
  pending: number;
  /** Gastos sin categoría en toda la cuenta del usuario, con o sin filtros (un ingreso sin categoría es normal). */
  uncategorizedExpenses: number;
}

export type TransactionsPage = Paginated<Transaction> & { summary: TransactionsSummary };

export type TransactionBatch =
  | { action: "set-category"; ids: number[]; categoryId: number | null }
  | { action: "set-cleared"; ids: number[]; cleared: boolean }
  | { action: "delete"; ids: number[] };

/** Categorizar, liquidar o borrar varios movimientos. `skipped` = los que no se podían tocar (traspasos, recurrentes…). */
export const batchTransactions = (body: TransactionBatch) =>
  request<{ updated: number; skipped: number }>("/transactions/batch", { method: "POST", body: JSON.stringify(body) });

export interface PayeeSuggestion {
  payee: string;
  type: "expense" | "income";
  categoryId: number | null;
  accountId: number;
  amount: number;
  count: number;
}

/** Beneficiarios ya usados (con la categoría/cuenta/importe de su último movimiento) para autocompletar. */
export const getPayeeSuggestions = (opts: { q?: string; type?: "expense" | "income"; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.type) params.set("type", opts.type);
  if (opts.limit) params.set("limit", String(opts.limit));
  return request<{ data: PayeeSuggestion[] }>(`/transactions/payees?${params}`).then((r) => r.data);
};

export const createTransaction = (data: {
  accountId: number;
  categoryId?: number | null;
  type: "expense" | "income" | "transfer";
  amount: number;
  date: string;
  payee?: string | null;
  memo?: string | null;
  cleared?: boolean;
  flag?: string | null;
  targetAccountId?: number;
}) => request<Transaction>("/transactions", { method: "POST", body: JSON.stringify(data) });

export const updateTransaction = (
  id: number,
  data: Partial<{
    accountId: number;
    categoryId: number | null;
    type: "expense" | "income" | "transfer";
    amount: number;
    date: string;
    payee: string | null;
    memo: string | null;
    cleared: boolean;
    flag: string | null;
    targetAccountId: number;
  }>,
) => request<Transaction>(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteTransaction = (id: number) =>
  request<{ ok: boolean }>(`/transactions/${id}`, { method: "DELETE" });

export const toggleCleared = (id: number) =>
  request<Transaction>(`/transactions/${id}/clear`, { method: "PATCH" });

// ─── Recurring Transactions ────────────────────────────────────
export type RecurringCadence = "weekly" | "monthly" | "yearly";

export interface RecurringTransaction {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  type: "expense" | "income";
  amount: number;
  cadence: RecurringCadence;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  payee: string | null;
  memo: string | null;
  flag: string | null;
  active: boolean;
  /** Domiciliación: las ocurrencias se liquidan solas el día del cargo. */
  autoSettle: boolean;
  createdAt: string;
  nextOccurrence: string | null;
  /** Instancias sin liquidar (vencidas y futuras). */
  pendingCount: number;
  /** De ellas, las que ya han vencido: lo que de verdad hay que revisar. */
  overdueCount: number;
}

export const getRecurringTransactions = () =>
  request<{ data: RecurringTransaction[] }>("/recurring-transactions").then((response) => response.data);

export const createRecurringTransaction = (data: {
  accountId: number;
  categoryId?: number | null;
  type: "expense" | "income";
  amount: number;
  cadence: RecurringCadence;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  payee?: string | null;
  memo?: string | null;
  flag?: string | null;
  autoSettle?: boolean;
}) =>
  request<RecurringTransaction>("/recurring-transactions", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const setRecurringTransactionActive = (id: number, active: boolean) =>
  request<RecurringTransaction>(`/recurring-transactions/${id}/active`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });

export const deleteRecurringTransaction = (id: number) =>
  request<{ ok: boolean }>(`/recurring-transactions/${id}`, {
    method: "DELETE",
  });

export const updateRecurringTransaction = (
  id: number,
  data: {
    accountId: number;
    categoryId?: number | null;
    type: "expense" | "income";
    amount: number;
    cadence: RecurringCadence;
    intervalCount?: number;
    startDate: string;
    endDate?: string | null;
    payee?: string | null;
    memo?: string | null;
    flag?: string | null;
    autoSettle?: boolean;
  },
) =>
  request<RecurringTransaction>(`/recurring-transactions/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const exportTransactions = async (filters: Omit<TransactionFilters, "sortBy" | "sortDir" | "page" | "limit"> & { format?: "csv" | "json" } = {}) => {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", String(filters.accountId));
  if (filters.categoryId) params.set("categoryId", String(filters.categoryId));
  if (filters.groupId) params.set("groupId", String(filters.groupId));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.type) params.set("type", filters.type);
  if (filters.cleared) params.set("cleared", filters.cleared);
  if (filters.search) params.set("search", filters.search);
  if (filters.payee) params.set("payee", filters.payee);
  if (filters.uncategorized) params.set("uncategorized", "true");
  if (filters.minAmount !== undefined) params.set("minAmount", String(filters.minAmount));
  if (filters.maxAmount !== undefined) params.set("maxAmount", String(filters.maxAmount));
  const fmt = filters.format ?? "csv";
  params.set("format", fmt);

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export/transactions?${params}`, { headers });
  if (!res.ok) throw new Error("Error al exportar transacciones");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transacciones.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ─── Finance Dashboard ──────────────────────────────────────────
export interface FinanceSummary {
  totalBalance: number;
  monthExpenses: number;
  monthIncome: number;
  monthSavings: number;
}

export interface FinanceTrend {
  month: string;
  income: number;
  expenses: number;
  savings: number;
}

export interface FinanceBreakdown {
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  total: number;
  percentage: number;
}

export interface TopPayee {
  payee: string;
  total: number;
  count: number;
}

export interface FinanceAnalyticsFilters {
  from?: string;
  to?: string;
  accountId?: number;
  groupId?: number;
  categoryId?: number;
}

export interface FinanceAnalyticsSummary {
  totalBalance: number;
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
  monthlyAverageIncome: number;
  monthlyAverageExpenses: number;
  savingsRate: number;
  visibleMonths: number;
  transactionCount: number;
  topIncomeMonth: { month: string; total: number } | null;
  topExpenseMonth: { month: string; total: number } | null;
}

export interface FinanceAnalyticsMonth {
  month: string;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsCategoryItem {
  bucketKey: string;
  categoryId: number | null;
  categoryName: string;
  groupId: number | null;
  groupName: string;
  type: "income" | "expense";
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsGroupItem {
  bucketKey: string;
  groupId: number | null;
  groupName: string;
  type: "income" | "expense";
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsPayeeItem {
  bucketKey: string;
  payee: string;
  type: "income" | "expense";
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsAccountItem {
  accountId: number;
  accountName: string;
  color: string;
  balance: number;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsWeekdayItem {
  weekdayIndex: number;
  weekdayLabel: string;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsMonthBucket {
  month: string;
  bucketKey: string;
  bucketId: number | null;
  label: string;
  parentLabel: string | null;
  type: "income" | "expense";
  total: number;
}

export interface FinanceAnalyticsData {
  summary: FinanceAnalyticsSummary;
  monthly: FinanceAnalyticsMonth[];
  categories: FinanceAnalyticsCategoryItem[];
  groups: FinanceAnalyticsGroupItem[];
  payees: FinanceAnalyticsPayeeItem[];
  accounts: FinanceAnalyticsAccountItem[];
  weekdays: FinanceAnalyticsWeekdayItem[];
  monthlyCategories: FinanceAnalyticsMonthBucket[];
  monthlyGroups: FinanceAnalyticsMonthBucket[];
}

export const getFinanceSummary = () =>
  request<FinanceSummary>("/finance/summary");

export const getFinanceTrends = (filters?: FinanceAnalyticsFilters) => {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.accountId) params.set("accountId", String(filters.accountId));
  if (filters?.groupId) params.set("groupId", String(filters.groupId));
  if (filters?.categoryId) params.set("categoryId", String(filters.categoryId));
  return request<{ data: FinanceTrend[] }>(`/finance/trends?${params}`).then((r) => r.data);
};

export const getFinanceBreakdown = (filters?: FinanceAnalyticsFilters) => {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.accountId) params.set("accountId", String(filters.accountId));
  if (filters?.groupId) params.set("groupId", String(filters.groupId));
  if (filters?.categoryId) params.set("categoryId", String(filters.categoryId));
  return request<{ data: FinanceBreakdown[] }>(`/finance/breakdown?${params}`).then((r) => r.data);
};

export const getTopPayees = (filters?: FinanceAnalyticsFilters) => {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.accountId) params.set("accountId", String(filters.accountId));
  if (filters?.groupId) params.set("groupId", String(filters.groupId));
  if (filters?.categoryId) params.set("categoryId", String(filters.categoryId));
  return request<{ data: TopPayee[] }>(`/finance/by-payee?${params}`).then((r) => r.data);
};

export const getFinanceAnalytics = (filters?: FinanceAnalyticsFilters) => {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.accountId) params.set("accountId", String(filters.accountId));
  if (filters?.groupId) params.set("groupId", String(filters.groupId));
  if (filters?.categoryId) params.set("categoryId", String(filters.categoryId));
  return request<FinanceAnalyticsData>(`/finance/analytics?${params}`);
};

// ─── Import ─────────────────────────────────────────────────────
export interface ImportResult {
  ok: boolean;
  dryRun?: boolean;
  summary: {
    accounts: number;
    categoryGroups: number;
    categories: number;
    transactions: number;
    duplicates?: number;
    dateRange: { from: string; to: string };
  };
}

export const importYnab = async (file: File, dryRun = false): Promise<ImportResult> => {
  const formData = new FormData();
  formData.append("file", file);

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = dryRun ? `${BASE}/import/ynab?dryRun=true` : `${BASE}/import/ynab`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    headers,
  });
  if (!res.ok) {
    if (res.status === 401) {
      await clearAuth();
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Error al importar");
  }
  return res.json();
};

// ─── Informes, saldo histórico y previsión ──────────────────────
export interface ReportCategory {
  categoryId: number | null;
  name: string;
  groupName: string;
  spent: number;
  previous: number;
  /** Media mensual de los meses anteriores con datos. */
  average: number;
  diff: number;
  /** null si no había media con la que comparar. */
  diffPct: number | null;
}

export interface MonthTotals {
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
}

export interface MonthReport {
  month: string;
  previousMonth: string;
  /** El mes no ha terminado: no se listan bajadas ni conviene mostrar variaciones. */
  partial: boolean;
  totals: MonthTotals;
  previousTotals: MonthTotals;
  categories: ReportCategory[];
  increases: ReportCategory[];
  decreases: ReportCategory[];
  unusual: Array<{
    id: number; date: string; payee: string; amount: number;
    categoryId: number | null; categoryName: string; typical: number; ratio: number;
  }>;
  newPayees: Array<{ payee: string; total: number; count: number; firstDate: string }>;
  /** Meses anteriores con gasto usados para la media (0 = no hay con qué comparar). */
  historyMonths: number;
}

export const getMonthReport = (month?: string) =>
  request<MonthReport>(`/finance/report${month ? `?month=${month}` : ""}`);

export interface BalanceHistory {
  months: string[];
  accounts: Array<{ id: number; name: string; color: string; type: string; archived: boolean; series: number[] }>;
  /** Suma de las cuentas no archivadas. */
  total: number[];
}

export const getBalanceHistory = (months = 12) => request<BalanceHistory>(`/finance/balance-history?months=${months}`);

export interface ForecastItem {
  date: string;
  /** Con signo: ingreso +, gasto −. */
  amount: number;
  payee: string;
  source: "pending" | "recurring";
  overdue: boolean;
}

export interface Forecast {
  startBalance: number;
  today: string;
  days: number;
  points: Array<{ date: string; balance: number }>;
  upcoming: ForecastItem[];
  endOfMonth: { date: string; balance: number };
  lowest: { date: string; balance: number };
  firstNegative: string | null;
}

export const getForecast = (days = 90) => request<Forecast>(`/finance/forecast?days=${days}`);

export interface SubscriptionSuggestion {
  payee: string;
  amount: number;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  categoryId: number | null;
  accountId: number;
}

export const getSubscriptionSuggestions = () =>
  request<{ data: SubscriptionSuggestion[] }>("/recurring-transactions/suggestions").then((r) => r.data);

// ─── Reglas de categorización ───────────────────────────────────
export interface CategoryRule {
  id: number;
  /** Texto que debe contener el beneficiario (guardado en minúsculas y sin tildes). */
  match: string;
  categoryId: number;
  categoryName: string;
  groupName: string;
  createdAt: string;
}

export const getCategoryRules = () => request<{ data: CategoryRule[] }>("/category-rules").then((r) => r.data);

export const createCategoryRule = (data: { match: string; categoryId: number }) =>
  request<{ id: number }>("/category-rules", { method: "POST", body: JSON.stringify(data) });

export const deleteCategoryRule = (id: number) =>
  request<{ ok: boolean }>(`/category-rules/${id}`, { method: "DELETE" });

/** Categoriza movimientos sin categoría con las reglas y el historial. Sin `ids`, todos los gastos sin categoría. */
export const applyCategorySuggestions = (ids?: number[]) =>
  request<{ updated: number; skipped: number; byRule: number; byHistory: number }>("/category-rules/apply", {
    method: "POST",
    body: JSON.stringify(ids ? { ids } : {}),
  });

// ─── Budgets ────────────────────────────────────────────────────
export type BudgetTargetType = "monthly" | "by_date";

export interface BudgetTargetInput {
  type: BudgetTargetType;
  amount: number;
  /** "YYYY-MM"; solo en objetivos por fecha. */
  targetMonth: string | null;
}

export interface BudgetTarget extends BudgetTargetInput {
  /** Lo que habría que asignar este mes para ir según el objetivo. */
  needed: number;
  /** Lo que falta asignar este mes. */
  shortfall: number;
  funded: boolean;
}

export interface CategoryBudget {
  id: number;
  name: string;
  assigned: number;
  /** Gasto del mes, en negativo. */
  activity: number;
  available: number;
  /** Lo que ya había disponible al empezar el mes. */
  carryIn: number;
  target: BudgetTarget | null;
}

export interface CategoryGroupBudget {
  id: number;
  name: string;
  categories: CategoryBudget[];
}

export interface BudgetSummary {
  month: string;
  readyToAssign: number;
  /** Lo que falta asignar este mes para cumplir todos los objetivos. */
  targetsShortfall: number;
  groups: CategoryGroupBudget[];
}

export const getBudgetSummary = (month: string) =>
  request<BudgetSummary>(`/budgets?month=${month}`);

export const assignBudget = (categoryId: number, month: string, assigned: number) =>
  request<{ id: number }>("/budgets", {
    method: "PUT",
    body: JSON.stringify({ categoryId, month, assigned }),
  });

// ─── Dividir un gasto ───────────────────────────────────────────
export interface SplitPart {
  categoryId: number | null;
  amount: number;
  memo?: string | null;
}

/** Divide un gasto en varias categorías; las partes deben sumar el total. */
export const splitTransaction = (id: number, parts: SplitPart[]) =>
  request<{ groupId: string; ids: number[] }>(`/transactions/${id}/split`, {
    method: "POST",
    body: JSON.stringify({ parts }),
  });

/** Vuelve a dejar un gasto dividido como uno solo. */
export const unsplitTransaction = (id: number) =>
  request<{ id: number }>(`/transactions/${id}/unsplit`, { method: "POST" });

// ─── Categorías de partida ──────────────────────────────────────
/** Crea las categorías de partida (en español) que aún no existan. */
export const seedDefaultCategories = () =>
  request<{ groups: number; categories: number }>("/categories/seed-defaults", { method: "POST" });

// ─── Preferencias de interfaz ───────────────────────────────────
/** Todas las preferencias guardadas del usuario ({ clave: valor }). */
export const getPreferences = () => request<{ data: Record<string, unknown> }>("/preferences").then((r) => r.data);

export const savePreference = (key: string, value: unknown) =>
  request<{ ok: boolean }>(`/preferences/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) });

export const removePreference = (key: string) =>
  request<{ ok: boolean }>(`/preferences/${encodeURIComponent(key)}`, { method: "DELETE" });

// ─── Series para los gráficos de la analítica ───────────────────
export interface DailyPoint {
  date: string;
  income: number;
  expense: number;
  count: number;
}

const filterParams = (filters?: FinanceAnalyticsFilters) => {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.accountId) params.set("accountId", String(filters.accountId));
  if (filters?.groupId) params.set("groupId", String(filters.groupId));
  if (filters?.categoryId) params.set("categoryId", String(filters.categoryId));
  return params;
};

/** Ingresos y gastos de cada día con movimientos (los días sin movimientos no vienen). */
export const getDailySeries = (filters?: FinanceAnalyticsFilters) =>
  request<{ data: DailyPoint[] }>(`/finance/daily?${filterParams(filters)}`).then((r) => r.data);

export interface AmountDistribution {
  /** Límites de los tramos: <e0, e0–e1, … , ≥eN. */
  edges: number[];
  expense: Array<{ count: number; total: number }>;
  income: Array<{ count: number; total: number }>;
}

export const getAmountDistribution = (filters?: FinanceAnalyticsFilters) =>
  request<AmountDistribution>(`/finance/amounts?${filterParams(filters)}`);
