import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Bell, BellRing, Check, Inbox, Pencil, Plus, Power, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createAlertRule, deleteAlertRule, getAccounts, getAlertHistory, getAlertRules, getCategories, getProfiles,
  markAllAlertsRead, markAlertRead, updateAlertRule,
  type Account, type AlertRule, type AlertRuleConfig, type AlertRuleType, type CategoryGroup,
  type CategoryOverspentConfig, type ConceptChangeConfig, type CustomThresholdConfig, type LowBalanceConfig,
  type MissingPayslipConfig, type OverduePendingConfig, type Profile, type SalaryDropConfig,
} from "../lib/api";
import { formatCurrency, formatRelativeDate } from "../lib/format";
import { Providers } from "./Providers";
import {
  PageHeader, PageHeaderSkeleton, SectionCard, StatCard, StatGrid, ListCardSkeleton,
} from "./app";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AccountSelect, CategorySelect } from "./finance-manage/transactions/shared";
import { cn } from "cn";

// ─── Metadatos por tipo de regla ────────────────────────────────
const RULE_TYPE_GROUPS: { label: string; types: AlertRuleType[] }[] = [
  { label: "Nóminas", types: ["salary_drop", "missing_payslip", "concept_change", "custom_threshold"] },
  { label: "Finanzas", types: ["category_overspent", "low_balance", "overdue_pending"] },
];

const FINANCE_TYPES: AlertRuleType[] = ["category_overspent", "low_balance", "overdue_pending"];
const isFinanceType = (t: AlertRuleType) => FINANCE_TYPES.includes(t);

const RULE_TYPE_META: Record<AlertRuleType, { label: string; description: string }> = {
  salary_drop: {
    label: "Bajada de salario",
    description: "Se dispara si el neto de la última nómina baja más de un % respecto a la media de las 3 anteriores.",
  },
  missing_payslip: {
    label: "Nómina no subida",
    description: "Se dispara si han pasado más días de los indicados desde que tocaba la siguiente nómina y no se ha subido.",
  },
  concept_change: {
    label: "Cambio en un concepto",
    description: "Se dispara si el importe de un concepto (ej. «IRPF») cambia más de un % entre las dos últimas nóminas.",
  },
  custom_threshold: {
    label: "Umbral personalizado",
    description: "Se dispara si el neto o bruto de la última nómina queda por debajo o por encima de un valor en euros.",
  },
  category_overspent: {
    label: "Categoría pasada de presupuesto",
    description: "Se dispara si una categoría con presupuesto este mes ha gastado más de lo que tenía disponible. Un aviso por categoría y mes.",
  },
  low_balance: {
    label: "Saldo bajo",
    description: "Se dispara si el saldo de una cuenta (o de todas, salvo tarjetas de crédito) cae por debajo de un importe. Un aviso al mes por cuenta.",
  },
  overdue_pending: {
    label: "Movimientos pendientes con retraso",
    description: "Se dispara si tienes movimientos sin liquidar pasados unos días de su fecha. Un resumen como mucho por semana.",
  },
};

type Severity = "info" | "warning" | "critical";

const SEVERITY_META: Record<Severity, { label: string; className: string }> = {
  info: { label: "Aviso", className: "text-muted-foreground bg-muted" },
  warning: { label: "Atención", className: "text-amber-700 bg-amber-500/10 dark:text-amber-400" },
  critical: { label: "Importante", className: "text-red-700 bg-red-500/10 dark:text-red-400" },
};

const ALL_PROFILES = "__all__";

// Config unificado (todas las claves posibles, opcionales) para poder leer
// `rule.config` sin importar el tipo concreto al precargar el formulario.
type AnyRuleConfig = Partial<
  SalaryDropConfig & MissingPayslipConfig & ConceptChangeConfig & CustomThresholdConfig
  & CategoryOverspentConfig & LowBalanceConfig & OverduePendingConfig
>;

function profileLabel(profileId: number | undefined, profiles: Profile[]): string {
  if (profileId == null) return "Todos los perfiles";
  const profile = profiles.find((p) => p.id === profileId);
  return profile ? `Perfil: ${profile.name}` : "Perfil eliminado";
}

function summarizeRule(rule: AlertRule, profiles: Profile[], accounts: Account[], groups: CategoryGroup[]): string {
  const config = rule.config as AnyRuleConfig;
  const scope = profileLabel(config.profileId, profiles);
  switch (rule.type) {
    case "category_overspent": {
      const name = groups.flatMap((g) => g.categories).find((c) => c.id === config.categoryId)?.name;
      return config.categoryId == null ? "Todas las categorías con presupuesto" : `Categoría: ${name ?? "eliminada"}`;
    }
    case "low_balance": {
      const account = accounts.find((a) => a.id === config.accountId);
      return `Saldo por debajo de ${formatCurrency(config.threshold ?? 0)} · ${config.accountId == null ? "Todas las cuentas (sin tarjetas)" : `Cuenta: ${account?.name ?? "eliminada"}`}`;
    }
    case "overdue_pending":
      return `Pendientes con más de ${config.graceDays ?? 3} días de retraso`;
    case "salary_drop":
      return `Bajada de salario > ${config.thresholdPercent ?? 10}% · ${scope}`;
    case "missing_payslip":
      return `Nómina no subida tras ${config.graceDays ?? 10} días · ${scope}`;
    case "concept_change":
      return `"${config.conceptName}" cambia > ${config.thresholdPercent ?? 15}% · ${scope}`;
    case "custom_threshold": {
      const metricLabel = config.metric === "gross" ? "Bruto" : "Neto";
      const comparatorLabel = config.comparator === "above" ? "por encima de" : "por debajo de";
      return `${metricLabel} ${comparatorLabel} ${formatCurrency(config.value ?? 0)} · ${scope}`;
    }
    default:
      return scope;
  }
}

// ─── Formulario (alta / edición) ────────────────────────────────
function AlertRuleDialog({
  open, rule, presetType, profiles, accounts, groups, onOpenChange,
}: {
  open: boolean;
  rule: AlertRule | null;
  /** Tipo con el que abrir una regla nueva (p. ej. desde el enlace del presupuesto). */
  presetType?: AlertRuleType;
  profiles: Profile[];
  accounts: Account[];
  groups: CategoryGroup[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const editing = rule !== null;
  const existingConfig = (rule?.config ?? {}) as AnyRuleConfig;

  const [name, setName] = useState(rule?.name ?? "");
  const [type, setType] = useState<AlertRuleType>(rule?.type ?? presetType ?? "salary_drop");
  const [profileId, setProfileId] = useState<string>(existingConfig.profileId != null ? String(existingConfig.profileId) : ALL_PROFILES);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [thresholdPercent, setThresholdPercent] = useState(existingConfig.thresholdPercent != null ? String(existingConfig.thresholdPercent) : "");
  const [graceDays, setGraceDays] = useState(existingConfig.graceDays != null ? String(existingConfig.graceDays) : "");
  const [conceptName, setConceptName] = useState(existingConfig.conceptName ?? "");
  const [metric, setMetric] = useState<"" | "net" | "gross">(existingConfig.metric ?? "");
  const [comparator, setComparator] = useState<"" | "below" | "above">(existingConfig.comparator ?? "");
  const [value, setValue] = useState(existingConfig.value != null ? String(existingConfig.value) : "");
  const [categoryId, setCategoryId] = useState<number | "">(existingConfig.categoryId ?? "");
  const [accountId, setAccountId] = useState<number | "">(existingConfig.accountId ?? "");
  const [threshold, setThreshold] = useState(existingConfig.threshold != null ? String(existingConfig.threshold) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleTypeChange = (next: AlertRuleType) => {
    setType(next);
    setThresholdPercent("");
    setGraceDays("");
    setConceptName("");
    setMetric("");
    setComparator("");
    setValue("");
    setCategoryId("");
    setAccountId("");
    setThreshold("");
    setErrors({});
  };

  function buildConfig(): AlertRuleConfig {
    const base: Record<string, unknown> = {};
    if (!isFinanceType(type) && profileId !== ALL_PROFILES) base.profileId = Number(profileId);
    switch (type) {
      case "category_overspent":
        if (categoryId !== "") base.categoryId = categoryId;
        return base as CategoryOverspentConfig;
      case "low_balance":
        if (accountId !== "") base.accountId = accountId;
        base.threshold = Number(threshold);
        return base as unknown as LowBalanceConfig;
      case "overdue_pending":
        if (graceDays.trim() !== "") base.graceDays = Number(graceDays);
        return base as OverduePendingConfig;
      case "salary_drop":
        if (thresholdPercent.trim() !== "") base.thresholdPercent = Number(thresholdPercent);
        return base as SalaryDropConfig;
      case "missing_payslip":
        if (graceDays.trim() !== "") base.graceDays = Number(graceDays);
        return base as MissingPayslipConfig;
      case "concept_change":
        base.conceptName = conceptName.trim();
        if (thresholdPercent.trim() !== "") base.thresholdPercent = Number(thresholdPercent);
        return base as unknown as ConceptChangeConfig;
      case "custom_threshold":
        base.metric = metric;
        base.comparator = comparator;
        base.value = Number(value);
        return base as unknown as CustomThresholdConfig;
      default:
        return base as unknown as AlertRuleConfig;
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "El nombre es obligatorio";
    if (type === "concept_change" && !conceptName.trim()) next.conceptName = "Indica el nombre del concepto";
    if (type === "low_balance" && (threshold.trim() === "" || Number.isNaN(Number(threshold)) || Number(threshold) < 0)) {
      next.threshold = "Indica un importe";
    }
    if (type === "custom_threshold") {
      if (!metric) next.metric = "Elige neto o bruto";
      if (!comparator) next.comparator = "Elige por debajo o por encima";
      if (value.trim() === "" || Number.isNaN(Number(value))) next.value = "Indica un importe";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), type, config: buildConfig(), enabled };
      return editing ? updateAlertRule(rule.id, payload) : createAlertRule(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      queryClient.invalidateQueries({ queryKey: ["alert-history"] });
      toast.success(editing ? "Regla actualizada" : "Regla creada");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar la regla"),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    saveMut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar regla" : "Nueva regla"}</DialogTitle>
            <DialogDescription>Define cuándo quieres que SueldIA te avise.</DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Nombre</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((er) => ({ ...er, name: "" })); }}
                placeholder="Ej.: Aviso de bajada de nómina"
                maxLength={100}
                autoFocus
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-type">Tipo de alerta</Label>
              <Select value={type} onValueChange={(v) => v && handleTypeChange(v as AlertRuleType)}>
                <SelectTrigger id="rule-type" className="w-full">
                  <SelectValue>{(v: string) => RULE_TYPE_META[v as AlertRuleType]?.label ?? "Elige un tipo"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RULE_TYPE_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.types.map((t) => (
                        <SelectItem key={t} value={t}>{RULE_TYPE_META[t].label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{RULE_TYPE_META[type].description}</p>
            </div>

            {!isFinanceType(type) && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-profile">Perfil</Label>
              <Select value={profileId} onValueChange={(v) => setProfileId(v ?? ALL_PROFILES)}>
                <SelectTrigger id="rule-profile" className="w-full">
                  <SelectValue>
                    {(v: string) => (v === ALL_PROFILES ? "Todos los perfiles" : profiles.find((p) => String(p.id) === v)?.name ?? "Todos los perfiles")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROFILES}>Todos los perfiles</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            )}

            {type === "category_overspent" && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-category">Categoría</Label>
                <CategorySelect id="rule-category" value={categoryId} onChange={setCategoryId} groups={groups} noneLabel="Todas las categorías con presupuesto" />
              </div>
            )}

            {type === "low_balance" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-account">Cuenta</Label>
                  <AccountSelect
                    id="rule-account"
                    value={accountId}
                    onChange={setAccountId}
                    accounts={accounts.filter((a) => !a.archived)}
                    placeholder="Todas (sin tarjetas de crédito)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-balance-threshold">Avisarme si el saldo baja de (€)</Label>
                  <Input
                    id="rule-balance-threshold"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={threshold}
                    onChange={(e) => { setThreshold(e.target.value); setErrors((er) => ({ ...er, threshold: "" })); }}
                    placeholder="Ej.: 300"
                    aria-invalid={!!errors.threshold}
                  />
                  {errors.threshold && <p className="text-xs text-destructive">{errors.threshold}</p>}
                </div>
              </>
            )}

            {type === "overdue_pending" && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-overdue-grace">Días de margen</Label>
                <Input
                  id="rule-overdue-grace"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  value={graceDays}
                  onChange={(e) => setGraceDays(e.target.value)}
                  placeholder="3"
                />
                <p className="text-xs text-muted-foreground">Déjalo en blanco para usar el valor por defecto (3 días).</p>
              </div>
            )}

            {(type === "salary_drop" || type === "concept_change") && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-threshold">Umbral de cambio (%)</Label>
                <Input
                  id="rule-threshold"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={thresholdPercent}
                  onChange={(e) => setThresholdPercent(e.target.value)}
                  placeholder={type === "salary_drop" ? "10" : "15"}
                />
                <p className="text-xs text-muted-foreground">Déjalo en blanco para usar el valor por defecto ({type === "salary_drop" ? "10" : "15"}%).</p>
              </div>
            )}

            {type === "concept_change" && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-concept">Concepto</Label>
                <Input
                  id="rule-concept"
                  value={conceptName}
                  onChange={(e) => { setConceptName(e.target.value); setErrors((er) => ({ ...er, conceptName: "" })); }}
                  placeholder="Ej.: IRPF"
                  maxLength={100}
                  aria-invalid={!!errors.conceptName}
                />
                {errors.conceptName && <p className="text-xs text-destructive">{errors.conceptName}</p>}
              </div>
            )}

            {type === "missing_payslip" && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-grace">Días de margen</Label>
                <Input
                  id="rule-grace"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  value={graceDays}
                  onChange={(e) => setGraceDays(e.target.value)}
                  placeholder="10"
                />
                <p className="text-xs text-muted-foreground">Déjalo en blanco para usar el valor por defecto (10 días).</p>
              </div>
            )}

            {type === "custom_threshold" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-metric">Métrica</Label>
                    <Select value={metric} onValueChange={(v) => { setMetric((v ?? "") as typeof metric); setErrors((er) => ({ ...er, metric: "" })); }}>
                      <SelectTrigger id="rule-metric" className="w-full" aria-invalid={!!errors.metric}>
                        <SelectValue>{(v: string) => (v === "net" ? "Neto" : v === "gross" ? "Bruto" : "Elige")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="net">Neto</SelectItem>
                        <SelectItem value="gross">Bruto</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.metric && <p className="text-xs text-destructive">{errors.metric}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-comparator">Comparación</Label>
                    <Select value={comparator} onValueChange={(v) => { setComparator((v ?? "") as typeof comparator); setErrors((er) => ({ ...er, comparator: "" })); }}>
                      <SelectTrigger id="rule-comparator" className="w-full" aria-invalid={!!errors.comparator}>
                        <SelectValue>{(v: string) => (v === "below" ? "Por debajo de" : v === "above" ? "Por encima de" : "Elige")}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="below">Por debajo de</SelectItem>
                        <SelectItem value="above">Por encima de</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.comparator && <p className="text-xs text-destructive">{errors.comparator}</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rule-value">Importe (€)</Label>
                  <Input
                    id="rule-value"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); setErrors((er) => ({ ...er, value: "" })); }}
                    placeholder="Ej.: 1500"
                    aria-invalid={!!errors.value}
                  />
                  {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Regla activa</p>
                <p className="text-xs text-muted-foreground">Si la desactivas, dejará de evaluarse.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Regla activa" />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saveMut.isPending}>
              {saveMut.isPending ? "Guardando…" : editing ? "Guardar cambios" : "Crear regla"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Vista ──────────────────────────────────────────────────────
function AlertsView() {
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading: rulesLoading, error: rulesError } = useQuery({ queryKey: ["alert-rules"], queryFn: getAlertRules });
  const { data: history = [], isLoading: historyLoading, error: historyError } = useQuery({ queryKey: ["alert-history"], queryFn: () => getAlertHistory() });
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: categoryGroups = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories });

  const [dialog, setDialog] = useState<{ open: boolean; rule: AlertRule | null; key: number; presetType?: AlertRuleType }>({ open: false, rule: null, key: 0 });
  const [toDelete, setToDelete] = useState<AlertRule | null>(null);

  const openDialog = (rule: AlertRule | null, presetType?: AlertRuleType) =>
    setDialog((d) => ({ open: true, rule, key: d.key + 1, presetType }));

  // ?tipo=category_overspent abre "Nueva regla" ya con ese tipo (enlace desde el presupuesto);
  // se consume y se quita de la URL para que un refresco no lo repita.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tipo");
    if (!requested) return;
    params.delete("tipo");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    if (RULE_TYPE_GROUPS.some((g) => g.types.includes(requested as AlertRuleType))) openDialog(null, requested as AlertRuleType);
  }, []);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    queryClient.invalidateQueries({ queryKey: ["alert-history"] });
  };

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateAlertRule(id, { enabled }),
    onSuccess: invalidateAll,
    onError: () => toast.error("No se pudo actualizar la regla"),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
      toast.success("Regla eliminada");
    },
    onError: () => toast.error("No se pudo eliminar la regla"),
  });

  const markReadMut = useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-history"] }),
    onError: () => toast.error("No se pudo marcar como leída"),
  });

  const markAllMut = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-history"] }),
    onError: () => toast.error("No se pudieron marcar las alertas como leídas"),
  });

  const isLoading = rulesLoading || historyLoading;
  const error = rulesError || historyError;

  const unreadCount = history.filter((h) => !h.read).length;
  const activeCount = rules.filter((r) => r.enabled).length;

  const newRuleButton = (
    <Button onClick={() => openDialog(null)} className="gap-1.5">
      <Plus className="size-4" /> Nueva regla
    </Button>
  );

  if (isLoading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <StatGrid className="grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />)}
        </StatGrid>
        <div className="mt-6 space-y-6">
          <ListCardSkeleton rows={3} />
          <ListCardSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudieron cargar las alertas" description="Vuelve a intentarlo en unos segundos.">
        <Button variant="outline" onClick={invalidateAll}>Reintentar</Button>
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        title="Alertas"
        description="Define reglas para que SueldIA te avise de bajadas de salario, nóminas que faltan, categorías que se pasan de presupuesto o saldos bajos."
        actions={newRuleButton}
      />

      <StatGrid className="grid-cols-1 sm:grid-cols-3">
        <StatCard label="Reglas" value={rules.length} icon={Bell} hint={rules.length === 1 ? "Regla configurada" : "Reglas configuradas"} />
        <StatCard label="Activas" value={activeCount} icon={Power} hint={`De ${rules.length} en total`} />
        <StatCard label="Sin leer" value={unreadCount} icon={BellRing} hint="En el historial" />
      </StatGrid>

      <SectionCard className="mt-6" title="Reglas" description="Cuándo y de qué te avisamos" flush>
        {rules.length === 0 ? (
          <EmptyState
            compact
            icon={Bell}
            title="Crea tu primera regla"
            description="Define cuándo quieres que te avisemos: bajadas de salario, nóminas que faltan, cambios en un concepto o un umbral concreto."
          >
            {newRuleButton}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{rule.name}</p>
                    <Badge variant="outline">{RULE_TYPE_META[rule.type]?.label ?? rule.type}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{summarizeRule(rule, profiles, accounts, categoryGroups)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(checked) => toggleMut.mutate({ id: rule.id, enabled: checked })}
                    aria-label={rule.enabled ? `Desactivar regla ${rule.name}` : `Activar regla ${rule.name}`}
                  />
                  <Button variant="ghost" size="icon-sm" aria-label={`Editar ${rule.name}`} onClick={() => openDialog(rule)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Eliminar ${rule.name}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setToDelete(rule)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        className="mt-6"
        title="Historial de alertas"
        description="Los avisos que han generado tus reglas"
        flush
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={unreadCount === 0 || markAllMut.isPending}
            onClick={() => markAllMut.mutate()}
          >
            Marcar todas como leídas
          </Button>
        }
      >
        {history.length === 0 ? (
          <EmptyState compact icon={Inbox} title="Sin alertas todavía" description="Aquí verás los avisos que generen tus reglas." />
        ) : (
          <ul className="divide-y divide-border">
            {history.map((item) => {
              const meta = SEVERITY_META[item.severity] ?? SEVERITY_META.info;
              return (
                <li key={item.id} className={cn("flex items-start gap-3 px-5 py-4", !item.read && "bg-primary/[0.03]")}>
                  <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm text-foreground", !item.read && "font-semibold")}>{item.message}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatRelativeDate(item.createdAt)}</span>
                      <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", meta.className)}>{meta.label}</span>
                    </p>
                  </div>
                  {!item.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => markReadMut.mutate(item.id)}
                    >
                      <Check className="size-3.5" /> Marcar leída
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <AlertRuleDialog
        key={dialog.key}
        open={dialog.open}
        rule={dialog.rule}
        presetType={dialog.presetType}
        profiles={profiles}
        accounts={accounts}
        groups={categoryGroups}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmModal
        open={!!toDelete}
        title="Eliminar regla"
        message={`¿Eliminar la regla "${toDelete?.name ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (toDelete) deleteMut.mutate(toDelete.id); setToDelete(null); }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Providers>
      <AlertsView />
    </Providers>
  );
}
