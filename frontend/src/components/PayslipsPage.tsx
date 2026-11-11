import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, CircleDollarSign,
  Download, FileSearch, FileText, Gift, Landmark, Loader2, Search, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deletePayslip, exportData, getDashboard, getPayslip, getPayslips, getProfiles, reprocessPayslip,
  type PayslipSortField,
} from "../lib/api";
import { formatCurrency } from "../lib/format";
import { setUrlParams, useUrlEnumParam, useUrlIntParam, useUrlParam } from "../lib/url-state";
import { useSelectedProfile } from "../hooks/use-selected-profile";
import { Providers } from "./Providers";
import {
  PageHeader, PageHeaderSkeleton, SectionCard, StatCard, StatCardSkeleton, StatGrid, ListCardSkeleton,
} from "./app";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import { ProfileSelector } from "./ui/ProfileSelector";
import { PayslipDetail, type PayslipWithConcepts } from "./payroll/PayslipDetail";
import { ExtraBadge, MONTHS_FULL, MONTHS_SHORT, StatusBadge, formatPeriod } from "./payroll/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

const ALL = "__all__";
const PAGE_SIZE = 20;
// El backend no filtra por mes: con ese filtro se trae el máximo por página
// y se filtra en cliente, para no limitarlo a las 20 filas de la página actual.
const MONTH_FILTER_LIMIT = 100;

const STATUS_OPTIONS = [
  { value: "parsed", label: "Procesadas" },
  { value: "review", label: "Para revisar" },
  { value: "pending", label: "Procesando" },
  { value: "error", label: "Con error" },
];
const TYPE_OPTIONS = [
  { value: "ordinal", label: "Mensuales" },
  { value: "extra", label: "Pagas extra" },
];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SortHeader({ label, field, sortField, sortDir, onSort, align = "left" }: {
  label: string;
  field: PayslipSortField;
  sortField: PayslipSortField;
  sortDir: "asc" | "desc";
  onSort: (f: PayslipSortField) => void;
  align?: "left" | "right";
}) {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        align === "right" && "w-full justify-end",
        active && "text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", !active && "opacity-40")} aria-hidden="true" />
    </button>
  );
}

function FilterSelect({ value, onChange, placeholder, options, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL || v === null ? "" : v)}>
      <SelectTrigger size="sm" className={cn("min-w-28", value && "border-primary-500/40 bg-primary/5", className)} aria-label={placeholder}>
        <SelectValue>{(v: string) => options.find((o) => o.value === v)?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}: todos</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const SORT_FIELDS: readonly PayslipSortField[] = ["period", "fileName", "grossSalary", "netSalary", "parsingStatus"];

// ─── Vista ──────────────────────────────────────────────────────
function PayslipsList() {
  const queryClient = useQueryClient();
  const { data: profiles = [], isLoading: profilesLoading, error: profilesError, refetch: refetchProfiles } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });

  const [selectedProfile, setSelectedProfile] = useSelectedProfile(profiles.map((p) => p.id));
  // Todo el estado de la vista vive en la URL: se puede compartir, sobrevive a
  // una recarga, y Atrás vuelve del detalle a la lista con los filtros intactos.
  const [nominaParam] = useUrlIntParam("nomina", 0);
  const selectedPayslip = nominaParam || null;
  const [search, setSearchParam] = useUrlParam("buscar");
  const [searchInput, setSearchInput] = useState(search);
  const [yearFilter, setYearParam] = useUrlParam("anio");
  const [monthFilter, setMonthParam] = useUrlParam("mes");
  const [statusFilter, setStatusParam] = useUrlParam("estado");
  const [typeFilter, setTypeParam] = useUrlParam("tipo");
  const [sortField, setSortFieldParam] = useUrlEnumParam<PayslipSortField>("orden", SORT_FIELDS, "period");
  const [sortDir, setSortDirParam] = useUrlEnumParam("dir", ["asc", "desc"] as const, "desc");
  const [page, setPageParam] = useUrlIntParam("pagina", 1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  // ¿Se abrió el detalle desde la lista (hay una entrada de historial a la que volver)?
  const openedFromList = useRef(false);

  // Cualquier filtro nuevo vuelve a la primera página.
  const setPage = (p: number) => setPageParam(p);
  const setFilter = (set: (v: string) => void) => (v: string) => { setUrlParams({ pagina: null }); set(v); };
  const setYearFilter = setFilter(setYearParam);
  const setMonthFilter = setFilter(setMonthParam);
  const setStatusFilter = setFilter(setStatusParam);
  const setTypeFilter = setFilter(setTypeParam);

  // Búsqueda con retardo: antes se lanzaba una petición por cada tecla.
  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setUrlParams({ buscar: searchInput.trim() || null, pagina: null }), 250);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const profileId = selectedProfile ?? profiles[0]?.id;
  const profile = profiles.find((p) => p.id === profileId);
  const pageSize = monthFilter ? MONTH_FILTER_LIMIT : PAGE_SIZE;

  const { data: payslipsData, isLoading, isFetching, error: payslipsError, refetch: refetchPayslips } = useQuery({
    queryKey: ["payslips", profileId, yearFilter, search, statusFilter, typeFilter, sortField, sortDir, monthFilter ? 1 : page, pageSize],
    queryFn: () =>
      getPayslips({
        profileId,
        year: yearFilter ? Number(yearFilter) : undefined,
        search: search || undefined,
        status: statusFilter || undefined,
        type: (typeFilter as "ordinal" | "extra") || undefined,
        sortBy: sortField,
        sortDir,
        page: monthFilter ? 1 : page,
        limit: pageSize,
      }),
    enabled: !!profileId,
    placeholderData: (prev) => prev,
  });

  // Resumen del perfil (independiente de filtros y paginación).
  const { data: summary } = useQuery({
    queryKey: ["dashboard", [profileId]],
    queryFn: () => getDashboard([profileId!]),
    enabled: !!profileId,
  });
  const { data: reviewData } = useQuery({
    queryKey: ["payslips", profileId, "review-count"],
    queryFn: () => getPayslips({ profileId, status: "review", limit: 1 }),
    enabled: !!profileId,
  });

  const [editingDetail, setEditingDetail] = useState(false);
  const { data: detail, isLoading: detailLoading, error: detailError, refetch: refetchDetail } = useQuery({
    queryKey: ["payslip", selectedPayslip],
    queryFn: () => getPayslip(selectedPayslip!) as Promise<PayslipWithConcepts>,
    enabled: !!selectedPayslip,
    // Mientras se edita no se refresca al volver a la pestaña: quien edita
    // suele ir a mirar el PDF original a otra ventana.
    refetchOnWindowFocus: !editingDetail,
  });

  const openPayslip = (id: number | null) => {
    setEditingDetail(false);
    if (id === null && openedFromList.current) {
      // Volver = la entrada de historial anterior (la lista, con sus filtros).
      openedFromList.current = false;
      window.history.back();
    } else {
      openedFromList.current = id !== null;
      setUrlParams({ nomina: id }, { push: id !== null });
    }
    // El contenedor con scroll es el de AppShell, no window.
    document.getElementById("app-scroll")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };

  const deleteMut = useMutation({
    mutationFn: deletePayslip,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      openPayslip(null);
      toast.success("Nómina eliminada");
    },
    onError: () => toast.error("No se pudo eliminar la nómina"),
  });

  const reprocessMut = useMutation({
    mutationFn: reprocessPayslip,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["payslip", updated.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(updated.parsingStatus === "parsed" ? "Nómina reprocesada" : "Reprocesada: revisa los conceptos");
    },
    onError: () => toast.error("No se pudo reprocesar la nómina"),
  });

  const handleSort = (field: PayslipSortField) => {
    if (sortField === field) {
      setUrlParams({ pagina: null, dir: sortDir === "asc" ? null : "asc" });
    } else {
      const dir = field === "fileName" || field === "parsingStatus" ? "asc" : "desc";
      setUrlParams({ pagina: null, orden: field === "period" ? null : field, dir: dir === "desc" ? null : dir });
    }
  };

  const handleExport = async (format: "csv" | "json") => {
    if (!profileId) return;
    setExporting(true);
    try {
      await exportData(profileId, yearFilter ? Number(yearFilter) : undefined, format);
    } catch {
      toast.error("No se pudo exportar. Inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  const rows = useMemo(() => {
    const data = payslipsData?.data ?? [];
    return monthFilter ? data.filter((p) => p.periodMonth === Number(monthFilter)) : data;
  }, [payslipsData, monthFilter]);

  const total = payslipsData?.total ?? 0;
  const totalPages = monthFilter ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Años desde el resumen anual del perfil: si salen de la página actual,
  // al filtrar por un año el desplegable se quedaba solo con ese año.
  const years = (summary?.annualSummaries ?? []).map((s) => s.year).sort((a, b) => b - a);
  const hasFilters = Boolean(search || yearFilter || monthFilter || statusFilter || typeFilter);
  const clearFilters = () => {
    setSearchInput("");
    setUrlParams({ buscar: null, anio: null, mes: null, estado: null, tipo: null, pagina: null });
  };

  // ─── Detalle ──────────────────────────────────────────────────
  if (selectedPayslip) {
    return (
      <>
        {detailError && !detail ? (
          <EmptyState
            icon={AlertTriangle}
            title="No encontramos esta nómina"
            description="Puede que se haya eliminado o que el enlace no sea correcto."
          >
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => refetchDetail()}>Reintentar</Button>
              <Button onClick={() => openPayslip(null)}>Volver a mis nóminas</Button>
            </div>
          </EmptyState>
        ) : detailLoading || !detail ? (
          <div>
            <PageHeaderSkeleton />
            <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <ListCardSkeleton rows={6} className="lg:col-span-2" />
              <ListCardSkeleton rows={3} />
            </div>
          </div>
        ) : (
          <PayslipDetail
            // Solo se remonta al cambiar de nómina: con la marca de tiempo de
            // la query, un refresco al volver a la pestaña tiraba la edición.
            key={detail.id}
            payslip={detail}
            profileName={profiles.find((p) => p.id === detail.profileId)?.name}
            profiles={profiles}
            onBack={() => openPayslip(null)}
            onDelete={() => setDeleteTarget({ id: detail.id, label: formatPeriod(detail.periodMonth, detail.periodYear, true) })}
            onReprocess={() => reprocessMut.mutate(detail.id)}
            isReprocessing={reprocessMut.isPending}
            onEditingChange={setEditingDetail}
            onOpen={(id) => setUrlParams({ nomina: id })}
          />
        )}
        <ConfirmModal
          open={!!deleteTarget}
          title="Eliminar nómina"
          message={`¿Eliminar la nómina de ${deleteTarget?.label ?? ""}? Se borrarán también sus conceptos y notas. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          variant="danger"
          onConfirm={() => { if (deleteTarget) deleteMut.mutate(deleteTarget.id); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      </>
    );
  }

  // ─── Listado ──────────────────────────────────────────────────
  if (profilesLoading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
        <ListCardSkeleton rows={8} className="mt-6" />
      </div>
    );
  }

  if (profilesError) {
    return (
      <>
        <PageHeader title="Mis nóminas" description="Todas tus nóminas, con sus conceptos, en un solo sitio." />
        <EmptyState icon={AlertTriangle} title="No se pudieron cargar tus perfiles" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => refetchProfiles()}>Reintentar</Button>
        </EmptyState>
      </>
    );
  }

  if (profiles.length === 0) {
    return (
      <>
        <PageHeader title="Mis nóminas" description="Todas tus nóminas, con sus conceptos, en un solo sitio." />
        <EmptyState icon={FileText} title="Aún no tienes perfiles" description="Crea un perfil y sube tus primeras nóminas para verlas aquí." actionLabel="Crear perfil" actionHref="/app/profiles" />
      </>
    );
  }

  const kpis = summary?.kpis;
  const reviewCount = reviewData?.total ?? 0;
  const isEmptyProfile = !isLoading && total === 0 && !hasFilters;

  return (
    <div>
      <PageHeader
        title="Mis nóminas"
        description={
          kpis
            ? `${kpis.totalPayslips} ${kpis.totalPayslips === 1 ? "nómina procesada" : "nóminas procesadas"} de ${profile?.name ?? "este perfil"}${kpis.extrasCount ? `, ${kpis.extrasCount} ${kpis.extrasCount === 1 ? "paga extra" : "pagas extra"}` : ""}.`
            : "Todas tus nóminas, con sus conceptos, en un solo sitio."
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5" disabled={exporting || isEmptyProfile} />}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{yearFilter ? `Nóminas de ${yearFilter}` : "Todo el histórico"}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handleExport("csv")}>CSV (Excel, Numbers…)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>JSON</DropdownMenuItem>
              </DropdownMenuGroup>
              {!yearFilter && years.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <p className="px-1.5 py-1 text-[11px] text-muted-foreground">Filtra por año para exportar solo ese año.</p>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {profiles.length > 1 && (
          <ProfileSelector
            profiles={profiles}
            value={profileId ?? 0}
            onChange={(v) => { setSelectedProfile(v as number); setUrlParams({ pagina: null, anio: null }); }}
          />
        )}
      </PageHeader>

      {payslipsError && !isFetching ? (
        <EmptyState icon={AlertTriangle} title="No se pudieron cargar las nóminas" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => refetchPayslips()}>Reintentar</Button>
        </EmptyState>
      ) : isEmptyProfile ? (
        <EmptyState
          icon={Upload}
          title={`${profile?.name ?? "Este perfil"} aún no tiene nóminas`}
          description="Sube los PDF y en unos segundos verás aquí cada nómina con sus devengos y deducciones."
          actionLabel="Subir nóminas"
          actionHref={`/app/upload?perfil=${profileId}`}
          actionIcon={Upload}
        />
      ) : (
        <>
          <StatGrid>
            {kpis ? (
              <>
                <StatCard label="Neto medio" value={formatCurrency(kpis.avgNet)} icon={CircleDollarSign} emphasis hint="Por nómina" />
                <StatCard label="Bruto medio" value={formatCurrency(kpis.avgGross)} icon={Landmark} hint="Por nómina" />
                <StatCard
                  className="hidden sm:flex"
                  label="Pagas extra"
                  value={kpis.extrasCount}
                  icon={Gift}
                  hint={kpis.extrasCount ? `${formatCurrency(kpis.extrasTotalNet)} netos en total` : "Ninguna registrada"}
                />
                <StatCard
                  className="hidden sm:flex"
                  label="Para revisar"
                  value={reviewCount}
                  icon={FileSearch}
                  hint={reviewCount ? "Faltan conceptos por completar" : "Todo procesado correctamente"}
                />
              </>
            ) : (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            )}
          </StatGrid>

          <SectionCard
            className="mt-6"
            flush
            footer={
              rows.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    {monthFilter
                      ? `${rows.length} ${rows.length === 1 ? "nómina" : "nóminas"} de ${MONTHS_FULL[Number(monthFilter) - 1]}${total > MONTH_FILTER_LIMIT ? ` (entre las ${MONTH_FILTER_LIMIT} más recientes)` : ""}`
                      : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} de ${total}`}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Página anterior">
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="px-2 tabular-nums">{page} / {totalPages}</span>
                      <Button variant="ghost" size="icon-sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} aria-label="Página siguiente">
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ) : undefined
            }
          >
            {/* Filtros */}
            <div className="flex flex-col gap-2.5 border-b border-border p-4 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar por empresa o archivo…"
                  aria-label="Buscar nóminas"
                  className="h-8 pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {years.length > 0 && (
                  <FilterSelect
                    value={yearFilter}
                    onChange={setYearFilter}
                    placeholder="Año"
                    options={years.map((y) => ({ value: String(y), label: String(y) }))}
                  />
                )}
                <FilterSelect
                  value={monthFilter}
                  onChange={setMonthFilter}
                  placeholder="Mes"
                  options={MONTHS_FULL.map((m, i) => ({ value: String(i + 1), label: capitalize(m) }))}
                />
                <FilterSelect value={statusFilter} onChange={setStatusFilter} placeholder="Estado" options={STATUS_OPTIONS} />
                <FilterSelect value={typeFilter} onChange={setTypeFilter} placeholder="Tipo" options={TYPE_OPTIONS} />
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
                    <X className="size-3.5" /> Limpiar
                  </Button>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60" />)}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState compact icon={Search} title="Ninguna nómina coincide" description="Prueba con otros filtros o límpialos para ver todas.">
                <Button variant="outline" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
              </EmptyState>
            ) : (
              <div className={cn("transition-opacity", isFetching && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-xs" aria-sort={sortField === "period" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label="Periodo" field="period" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="hidden text-xs md:table-cell" aria-sort={sortField === "fileName" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label="Empresa · archivo" field="fileName" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="hidden text-right text-xs sm:table-cell" aria-sort={sortField === "grossSalary" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label="Bruto" field="grossSalary" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
                      </TableHead>
                      <TableHead className="text-right text-xs" aria-sort={sortField === "netSalary" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label="Neto" field="netSalary" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden text-xs lg:table-cell" aria-sort={sortField === "parsingStatus" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                        <SortHeader label="Estado" field="parsingStatus" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="w-10 pr-5"><span className="sr-only">Abrir</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((p) => {
                      const needsAttention = p.parsingStatus !== "parsed";
                      return (
                        <TableRow
                          key={p.id}
                          onClick={() => openPayslip(p.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPayslip(p.id); } }}
                          tabIndex={0}
                          aria-label={`Abrir nómina de ${formatPeriod(p.periodMonth, p.periodYear, true)}`}
                          className="group cursor-pointer outline-none focus-visible:bg-muted/60"
                        >
                          <TableCell className="py-3 pl-5">
                            <div className="flex items-center gap-3">
                              <div className="hidden size-9 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-muted/40 leading-none sm:flex">
                                <span className="text-[10px] font-medium uppercase text-muted-foreground">{p.periodMonth ? MONTHS_SHORT[p.periodMonth - 1] : "—"}</span>
                                <span className="mt-0.5 text-[11px] font-semibold tabular-nums text-foreground">{p.periodYear ? String(p.periodYear).slice(2) : ""}</span>
                              </div>
                              <div className="min-w-0">
                                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                  {capitalize(formatPeriod(p.periodMonth, p.periodYear, true))}
                                  {p.payslipType === "extra" && <ExtraBadge />}
                                </p>
                                <p className="truncate text-xs text-muted-foreground md:hidden">
                                  {p.company ?? p.fileName}
                                </p>
                                {needsAttention && <StatusBadge status={p.parsingStatus} className="mt-1 h-5 lg:hidden" />}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden max-w-64 py-3 md:table-cell">
                            <p className="truncate text-sm text-foreground">{p.company ?? "Empresa sin detectar"}</p>
                            <p className="truncate text-xs text-muted-foreground" title={p.fileName}>{p.fileName}</p>
                          </TableCell>
                          <TableCell className="hidden py-3 text-right text-sm tabular-nums text-muted-foreground sm:table-cell">{formatCurrency(p.grossSalary)}</TableCell>
                          <TableCell className="py-3 text-right text-sm font-semibold tabular-nums text-foreground">{formatCurrency(p.netSalary)}</TableCell>
                          <TableCell className="hidden py-3 lg:table-cell"><StatusBadge status={p.parsingStatus} /></TableCell>
                          <TableCell className="py-3 pr-5 text-right">
                            <ChevronRight className="ml-auto size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          {reviewCount > 0 && !statusFilter && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                {reviewCount} {reviewCount === 1 ? "nómina necesita" : "nóminas necesitan"} revisión: no se detectaron todos sus conceptos.
              </p>
              <Button variant="outline" size="sm" onClick={() => setStatusFilter("review")}>Ver cuáles</Button>
            </div>
          )}
        </>
      )}

    </div>
  );
}

export default function PayslipsPage() {
  return (
    <Providers>
      <PayslipsList />
    </Providers>
  );
}
