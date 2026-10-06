import { describe, expect, it } from "vitest";
import { detectSubscriptions, type SubscriptionRow } from "./subscriptions.service.js";

let nextId = 1;
const tx = (date: string, amount: number, payee: string, extra: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: nextId++, date, amount, payee, categoryId: 7, accountId: 1, recurringTransactionId: null, ...extra,
});

const TODAY = "2025-04-20";

const rows: SubscriptionRow[] = [
  // Netflix: mensual, importe estable → suscripción
  tx("2025-01-15", 11.99, "Netflix"), tx("2025-02-15", 11.99, "Netflix"), tx("2025-03-15", 11.99, "NETFLIX"), tx("2025-04-15", 12.49, "Netflix"),
  // Gimnasio: mensual pero ya hay una regla recurrente activa
  tx("2025-01-03", 30, "GYM FIT"), tx("2025-02-03", 30, "GYM FIT"), tx("2025-03-03", 30, "GYM FIT"), tx("2025-04-03", 30, "GYM FIT"),
  // Spotify: se dejó de cobrar hace meses
  tx("2024-09-10", 9.99, "Spotify"), tx("2024-10-10", 9.99, "Spotify"), tx("2024-11-10", 9.99, "Spotify"),
  // Amazon: mensual pero con importes que no se parecen
  tx("2025-01-20", 10, "Amazon"), tx("2025-02-20", 80, "Amazon"), tx("2025-03-20", 25, "Amazon"),
  // Mercadona: compras semanales, no mensuales
  tx("2025-03-04", 40, "Mercadona"), tx("2025-03-11", 42, "Mercadona"), tx("2025-03-18", 39, "Mercadona"), tx("2025-03-25", 41, "Mercadona"),
  // Seguro: solo dos cargos
  tx("2025-02-01", 60, "Seguro Hogar"), tx("2025-03-01", 60, "Seguro Hogar"),
  // Ya generado por una regla recurrente
  tx("2025-02-08", 5, "Dropbox", { recurringTransactionId: 3 }), tx("2025-03-08", 5, "Dropbox", { recurringTransactionId: 3 }),
  tx("2025-04-08", 5, "Dropbox", { recurringTransactionId: 3 }),
];

describe("detectSubscriptions", () => {
  const found = detectSubscriptions(rows, ["Gym Fit"], TODAY);

  it("propone solo lo mensual, estable y activo que aún no está programado", () => {
    expect(found.map((s) => s.payee)).toEqual(["Netflix"]);
  });

  it("calcula importe típico, último cargo y el siguiente", () => {
    expect(found[0]).toMatchObject({
      amount: 11.99, occurrences: 4, lastDate: "2025-04-15", nextDate: "2025-05-15", categoryId: 7, accountId: 1,
    });
  });

  it("no propone lo que ya cubre una recurrente activa", () => {
    expect(detectSubscriptions(rows, [], TODAY).map((s) => s.payee)).toContain("GYM FIT");
  });

  it("el siguiente cargo respeta el fin de mes más corto", () => {
    const r = [tx("2025-01-31", 10, "Cuota"), tx("2025-02-28", 10, "Cuota"), tx("2025-03-31", 10, "Cuota")];
    expect(detectSubscriptions(r, [], "2025-04-10")[0].nextDate).toBe("2025-04-30");
  });

  it("necesita al menos tres cargos, y descarta lo caducado, lo irregular y lo semanal", () => {
    const payees = detectSubscriptions(rows, [], TODAY).map((s) => s.payee);
    expect(payees).not.toContain("Seguro Hogar"); // 2 cargos
    expect(payees).not.toContain("Spotify");      // el último fue hace meses
    expect(payees).not.toContain("Amazon");       // importes muy distintos
    expect(payees).not.toContain("Mercadona");    // semanal
    expect(payees).not.toContain("Dropbox");      // ya viene de una regla
  });
});
