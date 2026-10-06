import { describe, it, expect } from "vitest";
import { avg, round, stdDev, linearSlope, calculateTrend, median } from "./math.js";

describe("avg", () => {
  it("returns 0 for empty array", () => {
    expect(avg([])).toBe(0);
  });

  it("calculates average of numbers", () => {
    expect(avg([10, 20, 30])).toBe(20);
  });

  it("handles single value", () => {
    expect(avg([5])).toBe(5);
  });
});

describe("round", () => {
  it("rounds to 2 decimal places", () => {
    expect(round(3.14159)).toBe(3.14);
    expect(round(2.005)).toBe(2.01);
    expect(round(10)).toBe(10);
  });
});

describe("stdDev", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });

  it("calculates standard deviation", () => {
    const result = stdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2, 0);
  });
});

describe("linearSlope", () => {
  it("returns 0 for constant y", () => {
    expect(linearSlope([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it("calculates positive slope", () => {
    expect(linearSlope([0, 1, 2], [0, 1, 2])).toBeCloseTo(1);
  });
});

describe("calculateTrend", () => {
  it("returns stable for fewer than 2 values", () => {
    expect(calculateTrend([100])).toEqual({ direction: "stable", slopePercent: 0, slope: 0 });
  });

  it("detects upward trend", () => {
    const result = calculateTrend([100, 200, 300, 400]);
    expect(result.direction).toBe("up");
    expect(result.slope).toBeGreaterThan(0);
  });

  it("detects downward trend", () => {
    const result = calculateTrend([400, 300, 200, 100]);
    expect(result.direction).toBe("down");
    expect(result.slope).toBeLessThan(0);
  });

  it("detects stable values", () => {
    const result = calculateTrend([100, 100, 100, 100]);
    expect(result.direction).toBe("stable");
  });
});

describe("median", () => {
  it("devuelve 0 para una lista vacía", () => {
    expect(median([])).toBe(0);
  });

  it("toma el valor central (sin depender del orden)", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("promedia los dos centrales si hay un número par", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("no se deja arrastrar por un valor extremo", () => {
    expect(median([10, 11, 12, 13, 5000])).toBe(12);
  });
});
