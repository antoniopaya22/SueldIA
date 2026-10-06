import { describe, expect, it } from "vitest";
import { escapeLike } from "./payee-suggestions.service.js";

describe("escapeLike", () => {
  it("escapa los comodines para buscarlos literalmente", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("deja intacto el resto", () => {
    expect(escapeLike("Mercadona")).toBe("Mercadona");
  });
});
