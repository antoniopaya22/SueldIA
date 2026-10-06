// ─── Shared math/stats utility functions ────────────────────────

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function linearSlope(x: number[], y: number[]): number {
  const n = x.length;
  const xMean = avg(x);
  const yMean = avg(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }
  return den !== 0 ? num / den : 0;
}

export function calculateTrend(values: number[]): {
  direction: "up" | "down" | "stable";
  slopePercent: number;
  slope: number;
} {
  if (values.length < 2) return { direction: "stable", slopePercent: 0, slope: 0 };

  const n = values.length;
  const x = values.map((_, i) => i);
  const xMean = avg(x);
  const yMean = avg(values);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - xMean) * (values[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }

  const slope = den !== 0 ? num / den : 0;
  const slopePercent = yMean !== 0 ? (slope / yMean) * 100 : 0;

  return {
    direction: slopePercent > 0.5 ? "up" : slopePercent < -0.5 ? "down" : "stable",
    slopePercent: round(slopePercent),
    slope: round(slope),
  };
}

export function predictNext(
  data: Array<{ month: string; gross: number; net: number }>,
  months: number,
): Array<{ month: string; predictedGross: number; predictedNet: number }> {
  if (data.length < 3) return [];

  const grossValues = data.map((d) => d.gross);
  const netValues = data.map((d) => d.net);

  const n = grossValues.length;
  const x = grossValues.map((_, i) => i);
  const grossSlope = linearSlope(x, grossValues);
  const netSlope = linearSlope(x, netValues);
  const grossIntercept = avg(grossValues) - grossSlope * avg(x);
  const netIntercept = avg(netValues) - netSlope * avg(x);

  const lastMonth = data[data.length - 1].month;
  const [lastY, lastM] = lastMonth.split("-").map(Number);

  const predictions: Array<{ month: string; predictedGross: number; predictedNet: number }> = [];
  for (let i = 1; i <= months; i++) {
    let m = lastM + i;
    let y = lastY;
    while (m > 12) { m -= 12; y++; }

    predictions.push({
      month: `${y}-${String(m).padStart(2, "0")}`,
      predictedGross: round(Math.max(0, grossIntercept + grossSlope * (n - 1 + i))),
      predictedNet: round(Math.max(0, netIntercept + netSlope * (n - 1 + i))),
    });
  }

  return predictions;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
