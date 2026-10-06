import { describe, expect, it } from "vitest";
import { MAX_SPLIT_PARTS, validateSplit } from "./transaction-split.service.js";

const parts = (...amounts: number[]) => amounts.map((amount) => ({ amount }));

describe("validateSplit", () => {
  it("acepta partes que suman el total", () => {
    expect(validateSplit(100, parts(60, 40))).toEqual({ ok: true });
    expect(validateSplit(45.5, parts(30, 10.25, 5.25))).toEqual({ ok: true });
  });

  it("no se despista con los decimales binarios (0,1 + 0,2 = 0,3)", () => {
    expect(validateSplit(0.3, parts(0.1, 0.2))).toEqual({ ok: true });
    expect(validateSplit(33.33, parts(11.11, 11.11, 11.11))).toEqual({ ok: true });
  });

  it("exige al menos dos partes", () => {
    expect(validateSplit(100, parts(100))).toMatchObject({ ok: false });
    expect(validateSplit(100, [])).toMatchObject({ ok: false });
  });

  it("dice cuánto te pasas o te falta, al céntimo", () => {
    const over = validateSplit(100, parts(60, 41));
    expect(over).toMatchObject({ ok: false });
    expect((over as { error: string }).error).toContain("te pasas 1,00 €");
    const under = validateSplit(100, parts(60, 39.5));
    expect((under as { error: string }).error).toContain("te faltan 0,50 €");
  });

  it("rechaza partes a cero o negativas y un exceso de partes", () => {
    expect(validateSplit(100, parts(100, 0))).toMatchObject({ ok: false });
    expect(validateSplit(100, parts(120, -20))).toMatchObject({ ok: false });
    expect(validateSplit(100, parts(...Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => 1)))).toMatchObject({ ok: false });
  });
});
