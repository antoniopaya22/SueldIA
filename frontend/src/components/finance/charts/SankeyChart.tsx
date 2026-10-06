import { useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { buildSankey, type SankeyData } from "../../../lib/analytics-charts";
import { formatCurrency } from "../../../lib/format";
import { ChartEmpty, paletteColor } from "../finance-ui";

interface Props {
  income: number;
  groups: { name: string; total: number }[];
  limit: number;
  expanded: boolean;
}

function colorFor(kind: SankeyData["nodes"][number]["kind"], groupIndex: number): string {
  if (kind === "source") return "var(--chart-1)";
  if (kind === "saving") return "#16a34a";
  return paletteColor(groupIndex + 1);
}

/** Diagrama de flujo: de dónde viene el dinero (ingresos) y a dónde va (grupos de gasto y ahorro). */
export function SankeyChart({ income, groups, limit, expanded }: Props) {
  const data = useMemo(() => buildSankey(income, groups, limit), [income, groups, limit]);
  const nodeColors = useMemo(() => {
    let g = 0;
    return data.nodes.map((n) => colorFor(n.kind, n.kind === "group" ? g++ : 0));
  }, [data]);

  if (data.links.length === 0) return <ChartEmpty message="No hay ingresos ni gastos en este periodo." height={expanded ? 420 : 320} />;

  return (
    <div className={expanded ? "h-[28rem]" : "h-80"}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={data as never}
          nodePadding={expanded ? 28 : 20}
          nodeWidth={12}
          linkCurvature={0.5}
          margin={{ top: 8, right: 130, bottom: 8, left: 8 }}
          node={(props: { x: number; y: number; width: number; height: number; index: number; payload: { name: string; value: number } }) => {
            const { x, y, width, height, index, payload } = props;
            return (
              <g>
                <rect x={x} y={y} width={width} height={height} fill={nodeColors[index]} rx={2} />
                {(
                  <text
                    x={x + width + 8}
                    y={y + height / 2}
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="var(--foreground)"
                  >
                    <tspan fontWeight={600}>{payload.name}</tspan>
                    <tspan fill="var(--muted-foreground)" dx={6}>{formatCurrency(payload.value)}</tspan>
                  </text>
                )}
              </g>
            );
          }}
          link={(props: {
            sourceX: number; targetX: number; sourceY: number; targetY: number;
            sourceControlX: number; targetControlX: number; linkWidth: number; index: number;
          }) => {
            const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index } = props;
            // El destino se busca en nuestros datos por el índice del enlace: Recharts no rellena `target.index`.
            const targetIndex = data.links[index]?.target ?? 0;
            return (
              <path
                d={`M${sourceX},${sourceY + linkWidth / 2} C${sourceControlX},${sourceY + linkWidth / 2} ${targetControlX},${targetY + linkWidth / 2} ${targetX},${targetY + linkWidth / 2}`}
                fill="none"
                stroke={nodeColors[targetIndex]}
                strokeOpacity={0.35}
                strokeWidth={Math.max(linkWidth, 1)}
              />
            );
          }}
        >
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const item = payload[0].payload as { source?: { name: string }; target?: { name: string }; name?: string; value: number };
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <p className="text-muted-foreground">{item.source && item.target ? `${item.source.name} → ${item.target.name}` : item.name}</p>
                  <p className="mt-0.5 font-medium tabular-nums text-foreground">{formatCurrency(item.value)}</p>
                </div>
              );
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
