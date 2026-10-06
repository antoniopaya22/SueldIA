import { useMemo } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { FinanceAnalyticsCategoryItem } from "../../../lib/api";
import { buildTreemap, sumSize, type TreemapNode } from "../../../lib/analytics-charts";
import { formatCurrency, formatPct } from "../../../lib/format";
import { ChartEmpty, ChartLegend, paletteColor } from "../finance-ui";

interface Props {
  categories: FinanceAnalyticsCategoryItem[];
  metric: "expense" | "income";
  expanded: boolean;
}

interface TileProps {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  name: string;
  value?: number;
  root?: { name: string };
  colorOf: Map<string, string>;
  total: number;
}

function Tile({ x, y, width, height, depth, name, value, root, colorOf, total }: TileProps) {
  if (depth === 0 || width <= 0 || height <= 0) return null;
  const group = depth === 1 ? name : root?.name ?? name;
  const color = colorOf.get(group) ?? "var(--chart-2)";
  const showText = width > 64 && height > 34;
  if (depth === 1) {
    // Solo el contorno entre grupos: su nombre iría tapado por sus propias categorías (va en la leyenda y el tooltip).
    return <rect x={x} y={y} width={width} height={height} fill="none" stroke="var(--card)" strokeWidth={3} />;
  }
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={`color-mix(in srgb, ${color} 72%, #000)`} stroke="var(--card)" strokeWidth={1.5} rx={2} />
      {showText && (
        <>
          <text x={x + 8} y={y + height - 22} fontSize={11} fontWeight={500} fill="#fff" style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.45)" }}>
            {name.length > Math.floor(width / 7) ? `${name.slice(0, Math.max(3, Math.floor(width / 7) - 1))}…` : name}
          </text>
          <text x={x + 8} y={y + height - 8} fontSize={10} fill="#fff" fillOpacity={0.9} style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.45)" }}>
            {formatCurrency(value ?? 0)}{total > 0 && width > 110 ? ` · ${formatPct(((value ?? 0) / total) * 100)}` : ""}
          </text>
        </>
      )}
    </g>
  );
}

function TreemapTooltip({ active, payload, total }: { active?: boolean; payload?: { payload: { name: string; value?: number; root?: { name: string } } }[]; total: number }) {
  if (!active || !payload?.length) return null;
  const node = payload[0].payload;
  const value = node.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {node.root && <p className="text-muted-foreground">{node.root.name}</p>}
      <p className="font-medium text-foreground">{node.name}</p>
      <p className="mt-0.5 tabular-nums text-foreground">{formatCurrency(value)}{total > 0 && <span className="text-muted-foreground"> · {formatPct((value / total) * 100)}</span>}</p>
    </div>
  );
}

/** Mapa de bloques: cada grupo contiene sus categorías y el tamaño es el importe. */
export function TreemapChart({ categories, metric, expanded }: Props) {
  const { nodes, colorOf, total } = useMemo(() => {
    const items = categories.filter((c) => c.type === metric).map((c) => ({ groupName: c.groupName, categoryName: c.categoryName, total: c.total }));
    const nodes: TreemapNode[] = buildTreemap(items);
    return {
      nodes,
      colorOf: new Map(nodes.map((n, i) => [n.name, paletteColor(i)])),
      total: nodes.reduce((s, n) => s + sumSize(n), 0),
    };
  }, [categories, metric]);

  if (nodes.length === 0) return <ChartEmpty message="No hay datos para esta selección." height={expanded ? 420 : 300} />;

  return (
    <div>
      <div className={expanded ? "h-[30rem]" : "h-80"}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={nodes as never}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          isAnimationActive={false}
          content={<Tile {...({ colorOf, total } as TileProps)} />}
        >
          <Tooltip content={<TreemapTooltip total={total} />} />
        </Treemap>
      </ResponsiveContainer>
      </div>
      <ChartLegend items={nodes.map((n) => ({ color: `color-mix(in srgb, ${colorOf.get(n.name) ?? "var(--chart-2)"} 72%, #000)`, label: `${n.name} · ${formatCurrency(sumSize(n))}` }))} />
    </div>
  );
}
