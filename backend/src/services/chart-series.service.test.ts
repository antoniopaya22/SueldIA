import { describe, expect, it } from "vitest";
import { AMOUNT_BUCKET_EDGES, fillBuckets } from "./chart-series.service.js";

describe("fillBuckets", () => {
  it("devuelve un tramo por cada límite más uno, con ceros donde no hay datos", () => {
    const out = fillBuckets([]);
    expect(out).toHaveLength(AMOUNT_BUCKET_EDGES.length + 1);
    expect(out.every((b) => b.count === 0 && b.total === 0)).toBe(true);
  });

  it("coloca cada tramo en su sitio y redondea el total", () => {
    const out = fillBuckets([
      { bucket: 0, count: 3, total: 7.4999 },
      { bucket: 8, count: 1, total: 2500 },
    ]);
    expect(out[0]).toEqual({ count: 3, total: 7.5 });
    expect(out[8]).toEqual({ count: 1, total: 2500 });
    expect(out[4]).toEqual({ count: 0, total: 0 });
  });

  it("ignora tramos fuera de rango", () => {
    const out = fillBuckets([{ bucket: 99, count: 5, total: 1 }, { bucket: -1, count: 5, total: 1 }]);
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});
