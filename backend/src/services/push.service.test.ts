import { describe, expect, it, vi } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...args: unknown[]) => sendNotification(...args) } }));
vi.mock("../config.js", async (orig) => {
  const mod = await orig<typeof import("../config.js")>();
  return { env: { ...mod.env, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" } };
});

describe("alertsPushMessage", () => {
  it("discreto: el nombre de la regla, sin cifras", async () => {
    const { alertsPushMessage } = await import("./push.service.js");
    expect(alertsPushMessage([])).toBeNull();
    expect(alertsPushMessage(["Bajada del neto"])).toMatchObject({ title: "Nueva alerta en SueldIA", body: "Bajada del neto", url: "/app/alerts" });
    expect(alertsPushMessage(["A", "A", "B", "C"])).toMatchObject({ title: "4 alertas nuevas en SueldIA", body: "A, B…" });
  });
});

describeDb("notifyUser (integración)", () => {
  it("envía a cada dispositivo y borra los caducados", async () => {
    const { db } = await import("../db/index.js");
    const { pushSubscriptions } = await import("../db/schema.js");
    const { notifyUser, saveSubscription } = await import("./push.service.js");
    await resetDb();
    const userId = await createUser("push");
    const keys = { p256dh: "B".repeat(87), auth: "C".repeat(22) };
    await saveSubscription(userId, { endpoint: "https://push.test/vivo", keys });
    await saveSubscription(userId, { endpoint: "https://push.test/caducado", keys });
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("caducado")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    const sent = await notifyUser(userId, { title: "t", body: "b", url: "/app" });
    expect(sent).toBe(1);
    expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://push.test/vivo"]);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ title: "t", body: "b", url: "/app" });
  });
});
