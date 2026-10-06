import { describe, expect, it } from "vitest";
import { buildBalanceHistory, monthKeys } from "./balance-history.service.js";

describe("monthKeys", () => {
  it("devuelve meses consecutivos terminando en el indicado", () => {
    expect(monthKeys("2025-03", 3)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(monthKeys("2025-02", 4)).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });
});

describe("buildBalanceHistory", () => {
  const months = ["2025-01", "2025-02", "2025-03"];
  const accounts = [
    { id: 1, name: "BBVA", color: "#000000", type: "bank", archived: false, initialBalance: 100 },
    { id: 2, name: "Vieja", color: "#111111", type: "bank", archived: true, initialBalance: 1000 },
    { id: 3, name: "Efectivo", color: "#222222", type: "cash", archived: false, initialBalance: 0 },
  ];
  const nets = [
    { accountId: 1, month: "2024-12", net: 50 },   // anterior a la ventana: parte del saldo de partida
    { accountId: 1, month: "2025-01", net: 10 },
    { accountId: 1, month: "2025-02", net: -30 },
    { accountId: 1, month: "2025-03", net: 5 },
    { accountId: 1, month: "2025-04", net: 7 },    // posterior (liquidado con fecha futura): cuenta en el último mes
    { accountId: 3, month: "2025-02", net: 20 },
  ];
  const history = buildBalanceHistory(accounts, nets, months);
  const series = (id: number) => history.accounts.find((a) => a.id === id)!.series;

  it("acumula desde el saldo inicial, incluido lo anterior a la ventana", () => {
    expect(series(1)).toEqual([160, 130, 142]);
  });

  it("el último punto incluye lo posterior, para coincidir con el saldo actual", () => {
    expect(series(1)[2]).toBe(100 + 50 + 10 - 30 + 5 + 7);
  });

  it("una cuenta sin movimientos mantiene su saldo", () => {
    expect(series(2)).toEqual([1000, 1000, 1000]);
    expect(series(3)).toEqual([0, 20, 20]);
  });

  it("el total no cuenta las cuentas archivadas", () => {
    expect(history.total).toEqual([160, 150, 162]);
  });
});
