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

// ─── Errores ────────────────────────────────────────────────────
/** Error de la API con el código HTTP (0 = sin conexión) y un mensaje siempre en español. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mensaje legible a partir de la respuesta: el del servidor si lo trae, si no uno según el código. */
export function apiErrorMessage(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error.trim()) return error;
  if (status === 0) return "No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
  if (status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (status === 403) return "No tienes permiso para hacer esto.";
  if (status === 404) return "No se encontró lo que buscabas.";
  if (status === 409) return "No se puede hacer: entra en conflicto con otros datos.";
  if (status === 413) return "El archivo o la petición es demasiado grande.";
  if (status === 429) return "Demasiadas peticiones seguidas. Espera un momento y vuelve a intentarlo.";
  if (status >= 500) return "Error del servidor. Inténtalo de nuevo en unos segundos.";
  return "No se pudo completar la acción.";
}

// Varias peticiones en vuelo pueden recibir 401 a la vez: una sola salida.
let signingOut: Promise<void> | null = null;
async function handleUnauthorized() {
  if (!signingOut) {
    signingOut = clearAuth().finally(() => {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    });
  }
  return signingOut;
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

  // Escrituras con keepalive: si la pestaña se cierra justo después (p. ej.
  // un borrado con «Deshacer» que se confirma al salir), la petición llega
  // igualmente. El navegador lo limita a cuerpos de 64 KB.
  const method = (options?.method ?? "GET").toUpperCase();
  const bodySize = typeof options?.body === "string" ? options.body.length : 0;
  const keepalive = options?.keepalive ?? (method !== "GET" && bodySize < 60_000);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      keepalive,
      headers,
    });
  } catch (err) {
    // Cancelada por React Query (cambio de filtro…): se propaga tal cual.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, apiErrorMessage(0, null));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) void handleUnauthorized();
    throw new ApiError(res.status, apiErrorMessage(res.status, body), (body as { details?: Record<string, string[]> } | null)?.details);
  }
  if (res.status === 204) return undefined as T;
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
  request<{ ok: boolean; identityDeleted?: boolean }>("/auth/me", { method: "DELETE" });

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
  /** 12 o 14 pagas al año (null = sin indicar). */
  paymentsPerYear: 12 | 14 | null;
  /** % de jornada (100 = completa; null = sin indicar). */
  workdayPercent: number | null;
  employer: string | null;
  /** Comunidad autónoma, código INE (ver lib/regions.ts). */
  region: string | null;
}

export type ProfileInput = Pick<Profile, "name" | "color"> & Partial<Pick<Profile, "paymentsPerYear" | "workdayPercent" | "employer" | "region">>;

export const getProfiles = () =>
  request<Paginated<Profile>>("/profiles").then((r) => r.data);

export const createProfile = (data: ProfileInput) =>
  request<Profile>("/profiles", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateProfile = (id: number, data: ProfileInput) =>
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
  /** Tipo semántico: irpf, ss_contingencias, ss_desempleo, ss_formacion, ss_mei, ss_otros, salario_base, complemento, paga_extra, horas_extra, especie, dieta, otros. */
  kind?: string | null;
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
  /** true si se corrigió a mano: el reprocesado masivo no la toca. */
  manuallyEdited?: boolean;
  createdAt: string;
  rawText?: string | null;
  concepts?: PayslipConcept[];
  /** Solo en la lista (GET /payslips). */
  tags?: Tag[];
  /** Solo presente en la respuesta de /payslips/upload: id de otra nómina ya
   *  existente con el mismo perfil, periodo y tipo, o null si no hay ninguna. */
  duplicateOfId?: number | null;
  /** Solo en /payslips/upload: el mismo PDF ya estaba subido en este perfil y no se ha guardado otra vez. */
  alreadyUploaded?: boolean;
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
  tagId?: number;
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
  if (filters.tagId) params.set("tagId", String(filters.tagId));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  params.set("page", String(filters.page ?? 1));
  params.set("limit", String(filters.limit ?? 20));
  return request<Paginated<Payslip>>(`/payslips?${params}`);
};

/** Texto leído con OCR en el navegador (nómina escaneada, sin texto). */
export const submitOcrText = (id: number, text: string) =>
  request<Payslip & { concepts: PayslipConcept[] }>(`/payslips/${id}/ocr-text`, { method: "POST", body: JSON.stringify({ text }) });

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
    /** null = vacío (desconocido), no 0. */
    grossSalary?: number | null;
    netSalary?: number | null;
    periodMonth?: number;
    periodYear?: number;
    company?: string | null;
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

/** Dar por buena una nómina «para revisar» sin editarla (requiere periodo). */
export const markPayslipReviewed = (id: number) =>
  request<Payslip>(`/payslips/${id}/reviewed`, { method: "PATCH" });

/** Mover una nómina a otro perfil del usuario. */
export const movePayslipToProfile = (id: number, profileId: number) =>
  request<Payslip>(`/payslips/${id}/profile`, { method: "PATCH", body: JSON.stringify({ profileId }) });

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
  /** Vista de hogar: vacía con menos de dos perfiles con nóminas. */
  household: HouseholdYear[];
  profiles: Array<{ id: number; name: string; color: string }>;
}

export interface HouseholdYear {
  year: number;
  totalGross: number;
  totalNet: number;
  totalIrpf: number;
  projectedAnnualNet: number;
  members: Array<{
    profileId: number;
    name: string;
    color: string;
    payslips: number;
    totalGross: number;
    totalNet: number;
    totalIrpf: number;
    avgMonthlyNet: number;
    projectedAnnualNet: number;
    shareOfNet: number;
  }>;
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
export const exportData = async (profileId: number, year?: number, format: "csv" | "json" | "xlsx" = "csv") => {
  const params = new URLSearchParams({ profileId: String(profileId), format });
  if (year) params.set("year", String(year));

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export?${params}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "No se pudo exportar. Inténtalo de nuevo.");

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

export const updateNote = (id: number, content: string) =>
  request<Note>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify({ content }) });

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

export const updateTag = (id: number, data: { name?: string; color?: string }) =>
  request<Tag>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(data) });

// ─── Nóminas en lote y reprocesado ──────────────────────────────
export type PayslipBatchAction =
  | { action: "delete"; ids: number[] }
  | { action: "set-type"; ids: number[]; type: "ordinal" | "extra" }
  | { action: "add-tag" | "remove-tag"; ids: number[]; tagId: number };

export const batchPayslips = (input: PayslipBatchAction) =>
  request<{ ok: boolean; affected: number }>("/payslips/batch", { method: "POST", body: JSON.stringify(input) });

export interface ReparseSnapshot {
  grossSalary: number | null;
  netSalary: number | null;
  periodMonth: number | null;
  periodYear: number | null;
  concepts: number;
  status: string;
}
export interface ReparsePreview {
  changes: Array<{ id: number; fileName: string; before: ReparseSnapshot; after: ReparseSnapshot }>;
  unchanged: number;
  /** Corregidas a mano: no se tocan. */
  skippedEdited: number;
}

/** Qué cambiaría al reprocesar (todas, o las de `ids`), sin cambiar nada. */
export const previewReparse = (ids?: number[]) =>
  request<ReparsePreview>("/payslips/reparse?dryRun=true", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });

export const reparsePayslips = (ids?: number[]) =>
  request<{ ok: boolean; reparsed: number; errors: number; skippedEdited: number }>("/payslips/reparse", {
    method: "POST",
    body: JSON.stringify(ids ? { ids } : {}),
  });

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
  | "salary_drop" | "missing_payslip" | "concept_change" | "custom_threshold" | "irpf_change"
  | "category_overspent" | "low_balance" | "overdue_pending"
  | "low_balance_forecast" | "subscription_price_increase" | "duplicate_charge" | "unusual_category_spend";

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
export interface IrpfChangeConfig {
  profileId?: number;
  /** Puntos porcentuales de cambio del tipo efectivo (por defecto 2). */
  thresholdPoints?: number;
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
  /** Aviso previo al llegar a este % del presupuesto. */
  warnAtPercent?: number;
}
export interface LowBalanceForecastConfig { threshold?: number; days?: number }
export interface SubscriptionPriceIncreaseConfig { thresholdPercent?: number }
export interface DuplicateChargeConfig { windowDays?: number; minAmount?: number }
export interface UnusualCategorySpendConfig { categoryId?: number; factor?: number; minDifference?: number }
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
  | IrpfChangeConfig
  | CategoryOverspentConfig
  | LowBalanceConfig
  | OverduePendingConfig
  | LowBalanceForecastConfig
  | SubscriptionPriceIncreaseConfig
  | DuplicateChargeConfig
  | UnusualCategorySpendConfig;

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
  /** Nómina que lo provocó (alertas de nóminas); null en las de finanzas. */
  payslipId?: number | null;
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
  /** Última conciliación con el extracto del banco. */
  lastReconciledAt?: string | null;
  lastReconciledBalance?: number | null;
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

/** Lo que se vería afectado al borrar una categoría o un grupo. */
export interface CategoryUsage {
  transactions: number;
  recurring: number;
  budgetMonths: number;
  rules: number;
  targets: number;
  /** Solo para grupos: número de categorías que contiene. */
  categories?: number;
}

export const getCategoryGroupUsage = (id: number) => request<CategoryUsage>(`/categories/groups/${id}/usage`);
export const getCategoryUsage = (id: number) => request<CategoryUsage>(`/categories/${id}/usage`);

/** Con `reassignTo`, mueve antes movimientos, recurrentes, reglas y presupuesto a esa categoría. */
export const deleteCategoryGroup = (id: number, reassignTo?: number) =>
  request<{ ok: boolean }>(`/categories/groups/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ""}`, { method: "DELETE" });

export const createCategory = (data: { groupId: number; name: string }) =>
  request<Category>("/categories", { method: "POST", body: JSON.stringify(data) });

export const updateCategory = (id: number, data: { name?: string; groupId?: number }) =>
  request<Category>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteCategory = (id: number, reassignTo?: number) =>
  request<{ ok: boolean }>(`/categories/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ""}`, { method: "DELETE" });

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
  /** Liquidado y comprobado contra el extracto del banco. */
  reconciled?: boolean;
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
  flag?: "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "any";
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
  if (filters.flag) params.set("flag", filters.flag);
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
  | { action: "set-flag"; ids: number[]; flag: string | null }
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

// Con el valor explícito, un reintento de red no deshace el cambio.
export const setCleared = (id: number, cleared: boolean) =>
  request<Transaction>(`/transactions/${id}/clear`, { method: "PATCH", body: JSON.stringify({ cleared }) });

// ─── Recurring Transactions ────────────────────────────────────
export type RecurringCadence = "weekly" | "monthly" | "yearly";

export interface RecurringTransaction {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  type: "expense" | "income" | "transfer";
  /** Traspasos: la cuenta que recibe. */
  targetAccountId?: number | null;
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

/** «Esta vez no»: borra esa ocurrencia pendiente y la regla no la vuelve a generar. */
export const skipRecurringOccurrence = (transactionId: number) =>
  request<{ ok: boolean }>("/recurring-transactions/skip-occurrence", { method: "POST", body: JSON.stringify({ transactionId }) });

export const getRecurringTransactions = () =>
  request<{ data: RecurringTransaction[] }>("/recurring-transactions").then((response) => response.data);

export const createRecurringTransaction = (data: {
  accountId: number;
  categoryId?: number | null;
  type: "expense" | "income" | "transfer";
  targetAccountId?: number | null;
  amount: number;
  cadence: RecurringCadence;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  payee?: string | null;
  memo?: string | null;
  flag?: string | null;
  autoSettle?: boolean;
  /** Con inicio pasado: false = no crear los movimientos anteriores a hoy. */
  backfill?: boolean;
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
    type: "expense" | "income" | "transfer";
    targetAccountId?: number | null;
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

export const exportTransactions = async (filters: Omit<TransactionFilters, "sortBy" | "sortDir" | "page" | "limit"> & { format?: "csv" | "json" | "xlsx" } = {}) => {
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
  if (filters.flag) params.set("flag", filters.flag);
  const fmt = filters.format ?? "csv";
  params.set("format", fmt);

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export/transactions?${params}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "No se pudieron exportar los movimientos. Inténtalo de nuevo.");

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
export interface ImportPreviewRow {
  date: string;
  account: string;
  payee: string;
  category: string;
  /** Con signo: positivo entra, negativo sale. */
  amount: number;
  status: "new" | "duplicate" | "skipped";
}

export interface ImportResult {
  ok: boolean;
  dryRun?: boolean;
  /** Solo en la importación real: identificador para deshacerla. */
  batchId?: string;
  summary: {
    accounts: number;
    categoryGroups: number;
    categories: number;
    /** Movimientos nuevos (los que se crean). */
    transactions: number;
    duplicates?: number;
    /** Filas con importe 0, que no se importan. */
    skippedZero?: number;
    dateRange: { from: string; to: string };
  };
  /** Solo en la vista previa. */
  newAccounts?: string[];
  sample?: ImportPreviewRow[];
}

export interface ImportBatch {
  batchId: string;
  importedAt: string;
  count: number;
  from: string;
  to: string;
}

export const getImportBatches = () => request<{ data: ImportBatch[] }>("/import/batches");
export const undoImportBatch = (batchId: string) =>
  request<{ ok: boolean; deleted: number }>(`/import/batches/${batchId}`, { method: "DELETE" });

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
  /** null = todas las cuentas. */
  accountId: number | null;
  /** «Si gasto lo presupuestado» (solo si se pidió y sin cuenta). */
  scenario: {
    points: Array<{ date: string; balance: number }>;
    endOfMonth: { date: string; balance: number };
    lowest: { date: string; balance: number };
    firstNegative: string | null;
    remainingByMonth: Array<{ month: string; amount: number }>;
  } | null;
}

export const getForecast = (days = 90, opts: { accountId?: number | null; budget?: boolean } = {}) => {
  const params = new URLSearchParams({ days: String(days) });
  if (opts.accountId) params.set("accountId", String(opts.accountId));
  if (opts.budget) params.set("budget", "true");
  return request<Forecast>(`/finance/forecast?${params}`);
};

export interface SubscriptionSuggestion {
  payee: string;
  cadence: "weekly" | "monthly" | "yearly";
  amount: number;
  /** Lo que supone al mes. */
  monthlyAmount: number;
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
  /** Dónde buscar el texto. */
  matchField: "payee" | "memo" | "any";
  transactionType: "expense" | "income" | null;
  minAmount: number | null;
  maxAmount: number | null;
  accountId: number | null;
  createdAt: string;
}

export type CategoryRuleInput = Pick<CategoryRule, "match" | "categoryId"> &
  Partial<Pick<CategoryRule, "matchField" | "transactionType" | "minAmount" | "maxAmount" | "accountId">>;

export const getCategoryRules = () => request<{ data: CategoryRule[] }>("/category-rules").then((r) => r.data);

export const createCategoryRule = (data: CategoryRuleInput) =>
  request<{ id: number }>("/category-rules", { method: "POST", body: JSON.stringify(data) });

export const updateCategoryRule = (id: number, data: CategoryRuleInput) =>
  request<{ id: number }>(`/category-rules/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const previewCategoryRule = (data: CategoryRuleInput) =>
  request<{ matched: number; uncategorized: number; sample: Array<{ id: number; date: string; payee: string | null; amount: number; type: string }> }>(
    "/category-rules/preview",
    { method: "POST", body: JSON.stringify(data) },
  );

// ─── Beneficiarios ──────────────────────────────────────────────
export interface PayeeSummary {
  payee: string;
  count: number;
  expense: number;
  income: number;
  lastDate: string;
}

export const getPayeeSummary = () => request<{ data: PayeeSummary[] }>("/transactions/payees/summary").then((r) => r.data);

export const renamePayees = (from: string[], to: string) =>
  request<{ ok: boolean; updated: number }>("/transactions/payees/rename", { method: "POST", body: JSON.stringify({ from, to }) });

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
  /** De dónde sale «Para presupuestar»: ingresos + saldos iniciales − asignado (todo hasta este mes). */
  readyBreakdown: { income: number; initialBalances: number; assigned: number };
  /** Gasto del mes sin categoría (en negativo). */
  uncategorizedActivity: number;
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

// ─── Conciliación ───────────────────────────────────────────────
export const getAccountClearedBalance = (accountId: number) =>
  request<{ clearedBalance: number }>(`/accounts/${accountId}/reconcile`);

/** Concilia la cuenta con el saldo del banco. Si no cuadra y no se pide ajuste, lanza ApiError 409. */
export const reconcileAccount = (accountId: number, statementBalance: number, createAdjustment: boolean) =>
  request<{ ok: true; difference: number; adjustmentId: number | null; reconciledCount: number }>(
    `/accounts/${accountId}/reconcile`,
    { method: "POST", body: JSON.stringify({ statementBalance, createAdjustment }) },
  );

// ─── Importar extracto bancario (CSV) ───────────────────────────
export interface BankCsvMapping {
  delimiter: ";" | "," | "\t" | "|";
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
  payeeColumn: number;
  memoColumn?: number | null;
  amountColumn?: number | null;
  debitColumn?: number | null;
  creditColumn?: number | null;
  decimal: "comma" | "dot";
}

export interface BankCsvInspect {
  delimiter: BankCsvMapping["delimiter"];
  headerIndex: number;
  header: string[];
  sample: string[][];
  totalLines: number;
  mapping: BankCsvMapping;
}

export interface BankCsvResult {
  ok: boolean;
  dryRun?: boolean;
  batchId?: string;
  summary: { transactions: number; duplicates: number; errors: number; categorized?: number };
  errors?: Array<{ line: number; reason: string }>;
  sample?: ImportPreviewRow[];
}

/** POST multipart con el mismo tratamiento de errores que request(). */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = await getAuthToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, apiErrorMessage(0, null));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) void handleUnauthorized();
    throw new ApiError(res.status, apiErrorMessage(res.status, body));
  }
  return res.json();
}

export const inspectBankCsv = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return postForm<BankCsvInspect>("/import/csv/inspect", form);
};

export const importBankCsv = (file: File, accountId: number, headerIndex: number, mapping: BankCsvMapping, dryRun: boolean) => {
  const form = new FormData();
  form.append("file", file);
  form.append("accountId", String(accountId));
  form.append("headerIndex", String(headerIndex));
  form.append("mapping", JSON.stringify(mapping));
  return postForm<BankCsvResult>(`/import/csv${dryRun ? "?dryRun=true" : ""}`, form);
};

// ─── Objetivos de ahorro ────────────────────────────────────────
export interface SavingsGoal {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  accountId: number | null;
  accountName: string | null;
  savedAmount: number;
  color: string;
  archived: boolean;
  progress: {
    saved: number;
    remaining: number;
    percent: number;
    monthsLeft: number | null;
    monthlyNeeded: number | null;
    status: "done" | "on-track" | "no-date" | "overdue";
  };
}
export type SavingsGoalInput = Partial<Pick<SavingsGoal, "name" | "targetAmount" | "targetDate" | "accountId" | "savedAmount" | "color" | "archived">>;

export const getSavingsGoals = () => request<{ data: SavingsGoal[] }>("/savings-goals").then((r) => r.data);
export const createSavingsGoal = (data: SavingsGoalInput) =>
  request<SavingsGoal>("/savings-goals", { method: "POST", body: JSON.stringify(data) });
export const updateSavingsGoal = (id: number, data: SavingsGoalInput) =>
  request<SavingsGoal>(`/savings-goals/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteSavingsGoal = (id: number) => request<{ ok: boolean }>(`/savings-goals/${id}`, { method: "DELETE" });

// ─── Informe anual ──────────────────────────────────────────────
export interface YearTotals { income: number; expense: number; net: number; savingsRate: number | null }
export interface YearReport {
  year: number;
  partial: boolean;
  throughMonth: number;
  totals: YearTotals;
  previousTotals: YearTotals;
  months: Array<{ month: string } & YearTotals>;
  bestMonth: { month: string; net: number } | null;
  worstMonth: { month: string; net: number } | null;
  categories: Array<{ categoryId: number | null; name: string; groupName: string; spent: number; previous: number; diffPct: number | null }>;
  topPayees: Array<{ payee: string; spent: number; count: number }>;
  biggestExpenses: Array<{ id: number; date: string; payee: string; amount: number; categoryName: string }>;
}
export const getYearReport = (year: number) => request<YearReport>(`/finance/report/year?year=${year}`);

// ─── Datos de ejemplo ───────────────────────────────────────────
export const getDemoStatus = () => request<{ loaded: boolean }>("/demo");
export const loadDemoData = () => request<{ loaded: boolean }>("/demo", { method: "POST" });
export const removeDemoData = () => request<{ loaded: boolean; removed: boolean }>("/demo", { method: "DELETE" });

// ─── Notificaciones push ────────────────────────────────────────
export const getPushKey = () => request<{ publicKey: string }>("/push/key");
export const savePushSubscription = (sub: PushSubscriptionJSON) =>
  request<{ ok: boolean }>("/push/subscriptions", { method: "POST", body: JSON.stringify(sub) });
export const deletePushSubscription = (endpoint: string) =>
  request<{ ok: boolean }>("/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) });
export const sendTestPush = () => request<{ sent: number }>("/push/test", { method: "POST" });

// ─── Restaurar una copia («Exportar todos mis datos») ───────────
export interface BackupCounts {
  profiles: number;
  payslips: number;
  accounts: number;
  categories: number;
  transactions: number;
  recurringTransactions: number;
  budgets: number;
  categoryRules: number;
  alertRules: number;
}
export interface BackupPreview {
  exportedAt: string | null;
  backup: BackupCounts;
  current: BackupCounts;
}

/** Vercel no admite peticiones de más de 4,5 MB: la copia va comprimida (un JSON baja ~10 veces). */
const MAX_BACKUP_UPLOAD = 4 * 1024 * 1024;

async function backupForm(file: File): Promise<FormData> {
  let blob: Blob = file;
  let name = file.name;
  if (typeof CompressionStream !== "undefined" && !name.toLowerCase().endsWith(".gz")) {
    blob = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    name += ".gz";
  }
  if (blob.size > MAX_BACKUP_UPLOAD) {
    throw new ApiError(413, "La copia es demasiado grande para subirla (más de 4 MB comprimida).");
  }
  const form = new FormData();
  form.append("file", blob, name);
  return form;
}

export const previewBackup = async (file: File) => postForm<BackupPreview>("/import/backup?dryRun=true", await backupForm(file));

/** Sustituye TODOS los datos de la cuenta por los de la copia. */
export const restoreBackup = async (file: File) =>
  postForm<{ restored: BackupCounts }>("/import/backup?replace=true", await backupForm(file));

// ─── Comparar nóminas y resumen para la Renta ───────────────────
export interface ConceptDiff {
  name: string;
  category: "devengo" | "deduccion" | "otros";
  current: number | null;
  other: number | null;
  change: number | null;
}

export interface PayslipComparison {
  id: number;
  periodYear: number;
  periodMonth: number;
  grossSalary: number | null;
  netSalary: number | null;
  concepts: ConceptDiff[];
}

export interface PayslipCompareResponse {
  previous: PayslipComparison | null;
  lastYear: PayslipComparison | null;
  prevId: number | null;
  nextId: number | null;
}

export const getPayslipComparison = (id: number) => request<PayslipCompareResponse>(`/payslips/${id}/compare`);

export interface TaxSummary {
  year: number;
  payslips: number;
  grossTotal: number;
  irpfWithheld: number;
  socialSecurity: number;
  netTotal: number;
  inKind: number;
  effectiveIrpfRate: number | null;
  missingMonths: number[];
  /** Estimación aproximada de la Renta (null con menos de 3 meses). */
  estimate: {
    paramsYear: number;
    complete: boolean;
    projectedGross: number;
    projectedWithheld: number;
    estimatedTax: number;
    estimatedRate: number;
    difference: number;
    verdict: "short" | "long" | "ok";
  } | null;
}

export const getTaxSummary = (profileId: number, year: number) =>
  request<TaxSummary>(`/payslips/tax-summary?profileId=${profileId}&year=${year}`);
