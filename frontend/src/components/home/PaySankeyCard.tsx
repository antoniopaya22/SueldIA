import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Waypoints } from "lucide-react";
import { getDashboard, getFinanceAnalytics } from "@/lib/api";
import { buildPaySankey, type SankeyData } from "@/lib/analytics-charts";
import { formatCurrency } from "@/lib/format";
import { todayIso } from "@/lib/dates";
import { SectionCard, chartColors } from "../app";
import { SankeyView } from "../finance/charts/SankeyChart";

const COLORS: Record<string, string> = {
  Bruto: chartColors.secondary,
  Neto: chartColors.primary,
  "Impuestos y cotizaciones": chartColors.tax,
  IRPF: chartColors.tax,
  "Cotizaciones": `color-mix(in srgb, ${chartColors.tax} 60%, ${chartColors.secondary})`,
  "Otros ingresos y ahorros": chartColors.secondary,
};
const colorOf = (n: SankeyData["nodes"][number]) => COLORS[n.name];

/**
 * «Del bruto al bolsillo»: en lo que va de año, cómo el bruto de las nóminas
 * se queda en impuestos y cotizaciones y cómo el neto se va en gastos o se
 * ahorra. Une Nóminas y Finanzas; sin datos de los dos, no se pinta.
 */
export function PaySankeyCard() {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const { data: payroll } = useQuery({ queryKey: ["dashboard"], queryFn: () => getDashboard() });
  const { data: analytics } = useQuery({
    queryKey: ["finance-analytics", "pay-sankey", year],
    queryFn: () => getFinanceAnalytics({ from: `${year}-01-01`, to: today }),
  });

  const pay = useMemo(() => {
    const years = (payroll?.annualSummaries ?? []).filter((s) => s.year === year);
    const gross = years.reduce((s, y) => s + y.totalGross, 0);
    const net = years.reduce((s, y) => s + y.totalNet, 0);
    const irpf = years.reduce((s, y) => s + y.totalIrpf, 0);
    const deductions = years.reduce((s, y) => s + y.totalDeductions, 0);
    return { gross, net, irpf, otherDeductions: Math.max(0, deductions - irpf) };
  }, [payroll, year]);
  const groups = useMemo(
    () => (analytics?.groups ?? []).filter((g) => g.type === "expense").map((g) => ({ name: g.groupName || "Sin grupo", total: g.total })),
    [analytics],
  );
  const data = useMemo(() => buildPaySankey(pay, groups, 6), [pay, groups]);

  if (pay.gross <= 0 || groups.length === 0) return null;
  const spent = groups.reduce((s, g) => s + g.total, 0);
  return (
    <SectionCard
      className="mt-6"
      title="Del bruto al bolsillo"
      icon={Waypoints}
      description={`En ${year}: de ${formatCurrency(pay.gross)} brutos te llegaron ${formatCurrency(pay.net)}, y gastaste ${formatCurrency(spent)}.`}
    >
      <SankeyView data={data} expanded={false} colorOf={colorOf} />
    </SectionCard>
  );
}
