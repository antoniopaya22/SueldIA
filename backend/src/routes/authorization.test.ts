import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describeDb, resetDb } from "../test/db.js";

// Autorización entre usuarios, contra la API real (Express + Postgres): el
// usuario B no puede leer, modificar ni borrar nada del usuario A por ninguna
// ruta que reciba un id. Es la clase de error que no se ve a simple vista y
// que hasta ahora dependía de que cada ruta repitiera el filtro a mano.
//
// Necesita TEST_DATABASE_URL (ver src/test/setup.ts).

describeDb("autorización entre usuarios (integración)", () => {
  let jwksServer: http.Server;
  let apiServer: http.Server;
  let api: string;
  let privateKey: CryptoKey;
  let issuer: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, number> = {};

  async function mint(sub: string): Promise<string> {
    return new SignJWT({ email: `${sub}@test.local`, role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }

  async function call(user: "a" | "b", method: string, path: string, body?: unknown) {
    const res = await fetch(`${api}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[user]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json: json as Record<string, unknown> & { data?: unknown[] } };
  }

  async function ok<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await call("a", method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json as T;
  }

  beforeAll(async () => {
    // JWKS propio: el middleware verifica los tokens contra él como si fuera Supabase.
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256", use: "sig" };
    jwksServer = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
    const supabaseUrl = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
    issuer = `${supabaseUrl}/auth/v1`;

    // Antes de importar la app: config.ts lee el entorno al cargarse, e
    // index.ts no abre su propio puerto con VERCEL definida.
    process.env.SUPABASE_URL = supabaseUrl;
    process.env.VERCEL = "1";
    await resetDb();
    const { default: app } = await import("../index.js");
    apiServer = app.listen(0, "127.0.0.1");
    await new Promise((r) => apiServer.once("listening", r));
    api = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

    tokens.a = await mint("user-a");
    tokens.b = await mint("user-b");

    // ─── Datos del usuario A ──────────────────────────────────────
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");

    ids.profile = (await ok<{ id: number }>("POST", "/profiles", { name: "A" })).id;
    const [payslip] = await db.insert(s.payslips).values({
      profileId: ids.profile, fileName: "a.pdf", periodMonth: 1, periodYear: 2026,
      grossSalary: 2000, netSalary: 1500, rawText: "SALARIO BASE 2.000,00", parsingStatus: "parsed",
    }).returning();
    ids.payslip = payslip.id;
    ids.account = (await ok<{ id: number }>("POST", "/accounts", { name: "Banco A", type: "bank" })).id;
    ids.account2 = (await ok<{ id: number }>("POST", "/accounts", { name: "Ahorro A", type: "bank" })).id;
    ids.group = (await ok<{ id: number }>("POST", "/categories/groups", { name: "Grupo A" })).id;
    ids.category = (await ok<{ id: number }>("POST", "/categories", { groupId: ids.group, name: "Cat A" })).id;
    ids.transaction = (await ok<{ id: number }>("POST", "/transactions", {
      accountId: ids.account, type: "expense", amount: 12.5, date: "2026-01-10", categoryId: ids.category, payee: "Tienda",
    })).id;
    ids.income = (await ok<{ id: number }>("POST", "/transactions", {
      accountId: ids.account, type: "income", amount: 1500, date: "2026-01-28", payee: "Empresa",
    })).id;
    ids.recurring = (await ok<{ id: number }>("POST", "/recurring-transactions", {
      accountId: ids.account, type: "expense", amount: 10, cadence: "monthly", intervalCount: 1, startDate: "2026-01-01",
    })).id;
    ids.rule = (await ok<{ id: number }>("POST", "/category-rules", { match: "tienda", categoryId: ids.category })).id;
    ids.tag = (await ok<{ id: number }>("POST", "/tags", { name: "Revisada" })).id;
    await ok("POST", "/tags/assign", { payslipId: ids.payslip, tagId: ids.tag });
    ids.note = (await ok<{ id: number }>("POST", "/notes", { payslipId: ids.payslip, content: "Nota de A" })).id;
    ids.alertRule = (await ok<{ id: number }>("POST", "/alerts/rules", {
      name: "Regla privada de A", type: "salary_drop", config: { thresholdPercent: 5 },
    })).id;
    const [hist] = await db.insert(s.alertHistory).values({
      userId: (await db.select().from(s.users)).find((u) => u.supabaseUserId === "user-a")!.id,
      type: "salary_drop", severity: "warning", message: "Aviso de A",
    }).returning();
    ids.alertHistory = hist.id;
    await ok("PUT", "/budgets", { categoryId: ids.category, month: "2026-01", assigned: 100 });
    await ok("PUT", "/budgets/targets", { categoryId: ids.category, type: "monthly", amount: 50 });

    // B existe (primera petición) y tiene lo mínimo para mandar cuerpos válidos.
    const bProfile = await call("b", "POST", "/profiles", { name: "B" });
    ids.bProfile = (bProfile.json as { id: number }).id;
    const bAccount = await call("b", "POST", "/accounts", { name: "Banco B", type: "bank" });
    ids.bAccount = (bAccount.json as { id: number }).id;
  }, 60_000);

  afterAll(async () => {
    await new Promise((r) => apiServer?.close(r));
    await new Promise((r) => jwksServer?.close(r));
    const { client } = await import("../db/index.js");
    await client.end();
  });

  // Cada caso: B intenta tocar algo de A. Ninguno puede acabar en 2xx.
  const attacks = (): Array<[string, string, unknown?]> => [
    ["GET", `/profiles/${ids.profile}`],
    ["PUT", `/profiles/${ids.profile}`, { name: "hack" }],
    ["DELETE", `/profiles/${ids.profile}`],
    ["GET", `/payslips/${ids.payslip}`],
    ["GET", `/payslips/${ids.payslip}/compare`],
    ["GET", `/payslips/tax-summary?profileId=${ids.profile}&year=2026`],
    ["PUT", `/payslips/${ids.payslip}/concepts`, { concepts: [] }],
    ["POST", `/payslips/${ids.payslip}/reprocess`],
    ["GET", `/payslips/${ids.payslip}/link-suggestions`],
    ["PUT", `/payslips/${ids.payslip}/link`, { transactionId: ids.income }],
    ["PATCH", `/payslips/${ids.payslip}/type`, { payslipType: "extra" }],
    ["PATCH", `/payslips/${ids.payslip}/reviewed`],
    ["PATCH", `/payslips/${ids.payslip}/profile`, { profileId: ids.bProfile }],
    ["DELETE", `/payslips/${ids.payslip}`],
    ["GET", `/accounts/${ids.account}`],
    ["PUT", `/accounts/${ids.account}`, { name: "hack", type: "bank" }],
    ["PATCH", `/accounts/${ids.account}/archive`],
    ["DELETE", `/accounts/${ids.account}`],
    ["GET", `/accounts/${ids.account}/reconcile`],
    ["POST", `/accounts/${ids.account}/reconcile`, { statementBalance: 0, createAdjustment: true }],
    ["PUT", `/categories/groups/${ids.group}`, { name: "hack" }],
    ["GET", `/categories/groups/${ids.group}/usage`],
    ["DELETE", `/categories/groups/${ids.group}`],
    ["PUT", `/categories/${ids.category}`, { name: "hack" }],
    ["GET", `/categories/${ids.category}/usage`],
    ["DELETE", `/categories/${ids.category}`],
    ["POST", `/categories`, { groupId: ids.group, name: "intrusa" }],
    ["GET", `/transactions/${ids.transaction}`],
    ["PUT", `/transactions/${ids.transaction}`, { amount: 1 }],
    ["PATCH", `/transactions/${ids.transaction}/clear`, { cleared: true }],
    ["POST", `/transactions/${ids.transaction}/split`, { parts: [{ categoryId: null, amount: 6 }, { categoryId: null, amount: 6.5 }] }],
    ["DELETE", `/transactions/${ids.transaction}`],
    ["POST", `/transactions`, { accountId: ids.account, type: "expense", amount: 1, date: "2026-01-01" }],
    ["POST", `/transactions`, { accountId: ids.bAccount, type: "expense", amount: 1, date: "2026-01-01", categoryId: ids.category }],
    ["POST", `/transactions`, { accountId: ids.bAccount, type: "transfer", amount: 1, date: "2026-01-01", targetAccountId: ids.account }],
    ["PUT", `/recurring-transactions/${ids.recurring}`, { accountId: ids.bAccount, type: "expense", amount: 1, cadence: "monthly", intervalCount: 1, startDate: "2026-01-01" }],
    ["PATCH", `/recurring-transactions/${ids.recurring}/active`, { active: false }],
    ["DELETE", `/recurring-transactions/${ids.recurring}`],
    ["POST", `/recurring-transactions`, { accountId: ids.account, type: "expense", amount: 1, cadence: "monthly", intervalCount: 1, startDate: "2026-01-01" }],
    ["POST", `/category-rules`, { match: "x", categoryId: ids.category }],
    ["DELETE", `/category-rules/${ids.rule}`],
    ["PUT", `/category-rules/${ids.rule}`, { match: "hack", categoryId: ids.category }],
    ["POST", `/category-rules`, { match: "cuenta-ajena", categoryId: ids.category, accountId: ids.account }],
    ["DELETE", `/tags/${ids.tag}`],
    ["POST", `/tags/assign`, { payslipId: ids.payslip, tagId: ids.tag }],
    ["DELETE", `/tags/assign/${ids.payslip}/${ids.tag}`],
    ["GET", `/tags/payslip/${ids.payslip}`],
    ["GET", `/notes/${ids.payslip}`],
    ["POST", `/notes`, { payslipId: ids.payslip, content: "intrusa" }],
    ["DELETE", `/notes/${ids.note}`],
    ["PUT", `/alerts/rules/${ids.alertRule}`, { name: "hack" }],
    ["DELETE", `/alerts/rules/${ids.alertRule}`],
    ["PUT", `/alerts/history/${ids.alertHistory}/read`],
    ["PUT", `/budgets`, { categoryId: ids.category, month: "2026-01", assigned: 1 }],
    ["PUT", `/budgets/targets`, { categoryId: ids.category, type: "monthly", amount: 1 }],
    ["DELETE", `/budgets/targets/${ids.category}`],
    ["POST", `/payslips/upload`],
  ];

  it("B no puede tocar ningún recurso de A por id", async () => {
    const leaks: string[] = [];
    for (const [method, path, body] of attacks()) {
      const r = await call("b", method, path, body);
      if (r.status < 300) leaks.push(`${method} ${path} → ${r.status}`);
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it("renombrar beneficiarios solo toca los propios", async () => {
    const r = await call("b", "POST", "/transactions/payees/rename", { from: ["Tienda"], to: "Hackeado" });
    expect(r.json).toMatchObject({ ok: true, updated: 0 });
    const summary = (await call("a", "GET", "/transactions/payees/summary")).json.data as Array<{ payee: string }>;
    expect(summary.map((p) => p.payee)).toContain("Tienda");
  });

  it("las operaciones en lote ignoran los ids de A", async () => {
    const batch = await call("b", "POST", "/transactions/batch", { action: "delete", ids: [ids.transaction] });
    expect(batch.status).toBeLessThan(300);
    expect(batch.json.updated ?? 0).toBe(0);
    await call("b", "POST", "/category-rules/apply", { ids: [ids.transaction] });
    await call("b", "PUT", "/accounts/order", { ids: [ids.account, ids.account2] });
  });

  it("los listados y exportaciones de B no contienen nada de A", async () => {
    const lists = [
      "/profiles", "/payslips", "/accounts", "/categories", "/transactions", "/recurring-transactions",
      "/category-rules", "/tags", "/transactions/payees/summary", "/alerts/rules", "/alerts/history", "/budgets?month=2026-01", "/export/all",
      `/payslips?profileId=${ids.profile}`, `/transactions?accountId=${ids.account}`, `/dashboard?profileId=${ids.profile}`,
      `/analytics?profileId=${ids.profile}`, "/finance/summary", "/finance/analytics", "/transactions/payees?q=Tien",
    ];
    const markers = ["Banco A", "Ahorro A", "Grupo A", "Cat A", "Tienda", "Empresa", "Revisada", "Regla privada de A", "Aviso de A", "a.pdf", "Nota de A"];
    const leaks: string[] = [];
    for (const path of lists) {
      const r = await call("b", "GET", path);
      const text = JSON.stringify(r.json);
      for (const m of markers) if (text.includes(m)) leaks.push(`${path} contiene «${m}»`);
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it("rechaza entradas que antes rompían datos (importes infinitos, fechas imposibles)", async () => {
    // JSON con 1e999 → Infinity al parsear: antes se guardaba y las sumas pasaban a Infinity.
    const raw = await fetch(`${api}/api/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.a}`, "Content-Type": "application/json" },
      body: `{"accountId":${ids.account},"type":"expense","amount":1e999,"date":"2026-01-01"}`,
    });
    expect(raw.status).toBe(400);
    expect((await call("a", "PUT", "/budgets", { categoryId: ids.category, month: "2026-13", assigned: 1 })).status).toBe(400);
    expect((await call("a", "POST", "/recurring-transactions", {
      accountId: ids.account, type: "expense", amount: 1, cadence: "weekly", intervalCount: 1, startDate: "2025-02-32",
    })).status).toBe(400);
    expect((await call("a", "POST", "/transactions/bulk", { transactions: [] })).status).toBe(404);
    expect((await call("a", "GET", "/transactions?limit=10000")).status).toBe(400);
    // A no puede mandar su nómina a un perfil de B.
    expect((await call("a", "PATCH", `/payslips/${ids.payslip}/profile`, { profileId: ids.bProfile })).status).toBe(404);
  });

  it("eliminar la cuenta borra los datos y lo dice si la identidad sigue viva", async () => {
    tokens.c = await mint("user-c");
    const created = await fetch(`${api}/api/profiles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.c}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "C" }),
    });
    expect(created.status).toBe(201);
    const del = await fetch(`${api}/api/auth/me`, { method: "DELETE", headers: { Authorization: `Bearer ${tokens.c}` } });
    // Sin SUPABASE_SERVICE_ROLE_KEY en tests: datos borrados, identidad no.
    expect(await del.json()).toEqual({ ok: true, identityDeleted: false });
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    expect(await db.select().from(s.users).where(eq(s.users.supabaseUserId, "user-c"))).toHaveLength(0);
    expect((await db.select().from(s.profiles)).map((p) => p.name)).not.toContain("C");
  });

  it("subir el mismo PDF dos veces no crea otra nómina", async () => {
    const pdf = minimalPdf(["ABRIL 2026", "SALARIO BASE   2.000,00"]);
    const upload = async () => {
      const form = new FormData();
      form.append("profileId", String(ids.profile));
      form.append("files", new Blob([pdf], { type: "application/pdf" }), "Nómina abril.pdf");
      const res = await fetch(`${api}/api/payslips/upload`, { method: "POST", headers: { Authorization: `Bearer ${tokens.a}` }, body: form });
      expect(res.status).toBe(201);
      return ((await res.json()) as Array<{ id: number; fileName: string; periodMonth: number; parsingStatus: string; alreadyUploaded: boolean; parseMs: number }>)[0];
    };
    const first = await upload();
    expect(first).toMatchObject({ fileName: "Nómina abril.pdf", periodMonth: 4, parsingStatus: "parsed", alreadyUploaded: false, parserFormat: "private-generic" });
    expect(first.parseMs).toBeGreaterThanOrEqual(0);
    const second = await upload();
    expect(second).toMatchObject({ id: first.id, alreadyUploaded: true });
  });

  it("importar de YNAB: vista previa coherente, duplicados por recuento y deshacer", async () => {
    const q = (v: string) => `"${v}"`;
    const row = (payee: string, amount: string, date = "10/03/2026") =>
      [q("Cuenta YNAB"), q(""), q(date), q(payee), q("Casa/Super"), q("Casa"), q("Super"), q(""), q(amount), q("0,00€"), q("Cleared")].join("\t");
    const tsv = ["cabecera", row("Café", "1,50€"), row("Café", "1,50€"), row("Super", "40,00€")].join("\n");
    const send = async (user: "a" | "b", dryRun: boolean) => {
      const form = new FormData();
      form.append("file", new Blob([tsv], { type: "text/tab-separated-values" }), "ynab.tsv");
      const res = await fetch(`${api}/api/import/ynab${dryRun ? "?dryRun=true" : ""}`, {
        method: "POST", headers: { Authorization: `Bearer ${tokens[user]}` }, body: form,
      });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };

    const preview = await send("a", true);
    expect(preview.body.summary).toMatchObject({ transactions: 3, duplicates: 0 });
    expect(preview.body.newAccounts).toEqual(["Cuenta YNAB"]);
    expect(preview.body.sample).toHaveLength(3);

    const first = await send("a", false);
    expect(first.status).toBe(201);
    expect(first.body.summary).toMatchObject({ transactions: 3, duplicates: 0 });

    // Reimportar el mismo fichero: los tres son duplicados (los dos cafés se
    // cuentan uno a uno, no como un único «Café»).
    const again = await send("a", true);
    expect(again.body.summary).toMatchObject({ transactions: 0, duplicates: 3 });

    const batches = (await call("a", "GET", "/import/batches")).json.data as Array<{ batchId: string; count: number }>;
    expect(batches[0]).toMatchObject({ batchId: first.body.batchId, count: 3 });
    // B no ve ni puede deshacer la importación de A.
    expect(((await call("b", "GET", "/import/batches")).json.data as unknown[])).toHaveLength(0);
    expect((await call("b", "DELETE", `/import/batches/${first.body.batchId}`)).status).toBe(404);
    // A sí.
    expect((await call("a", "DELETE", `/import/batches/${first.body.batchId}`)).json).toEqual({ ok: true, deleted: 3 });
    expect((await send("a", true)).body.summary).toMatchObject({ transactions: 3, duplicates: 0 });
  });

  it("importar un extracto bancario en CSV", async () => {
    const csv = "Movimientos de la cuenta\nFecha;Concepto;Importe;Saldo\n01/03/2026;MERCADONA;-45,30;100,00\n02/03/2026;NOMINA;2.000,00;2.100,00\n";
    const send = async (user: "a" | "b", path: string, fields: Record<string, string> = {}) => {
      const form = new FormData();
      form.append("file", new Blob([csv], { type: "text/csv" }), "extracto.csv");
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const res = await fetch(`${api}/api/import/${path}`, { method: "POST", headers: { Authorization: `Bearer ${tokens[user]}` }, body: form });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const inspect = await send("a", "csv/inspect");
    expect(inspect.body).toMatchObject({ delimiter: ";", headerIndex: 1, header: ["Fecha", "Concepto", "Importe", "Saldo"] });
    const fields = { accountId: String(ids.account), headerIndex: "1", mapping: JSON.stringify(inspect.body.mapping) };

    const preview = await send("a", "csv?dryRun=true", fields);
    expect(preview.body.summary).toEqual({ transactions: 2, duplicates: 0, errors: 0 });

    // B no puede importar en la cuenta de A.
    expect((await send("b", "csv", fields)).status).toBe(404);

    const done = await send("a", "csv", fields);
    expect(done.status).toBe(201);
    expect(done.body.summary).toMatchObject({ transactions: 2, duplicates: 0 });
    // Otra vez el mismo extracto: todo duplicado.
    expect((await send("a", "csv?dryRun=true", fields)).body.summary).toMatchObject({ transactions: 0, duplicates: 2 });
    await call("a", "DELETE", `/import/batches/${done.body.batchId}`);
  });

  it("restaurar una copia: vista previa, confirmación y solo en la propia cuenta", async () => {
    const backup = (await call("a", "GET", "/export/all")).json as Record<string, any>;
    expect(backup).toMatchObject({ format: "sueldia-backup", version: 1 });
    const send = async (user: "a" | "b", query: string) => {
      const form = new FormData();
      form.append("file", new Blob([JSON.stringify(backup)], { type: "application/json" }), "copia.json");
      const res = await fetch(`${api}/api/import/backup${query}`, { method: "POST", headers: { Authorization: `Bearer ${tokens[user]}` }, body: form });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const preview = await send("b", "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.body.backup).toMatchObject({ profiles: backup.profiles.length, transactions: backup.transactions.length });
    // Sin confirmar no se toca nada.
    expect((await send("b", "")).status).toBe(400);
    // B restaura en SU cuenta una copia de A: ids nuevos, A no cambia.
    const done = await send("b", "?replace=true");
    expect(done.status).toBe(200);
    const bAccounts = (await call("b", "GET", "/accounts")).json.data as Array<{ id: number; name: string }>;
    expect(bAccounts.map((x) => x.name)).toContain("Banco A");
    expect(bAccounts.map((x) => x.id)).not.toContain(ids.account);
  });

  it("los datos de A siguen intactos", async () => {
    expect((await call("a", "GET", `/profiles/${ids.profile}`)).json).toMatchObject({ name: "A" });
    expect((await call("a", "GET", `/accounts/${ids.account}`)).json).toMatchObject({ name: "Banco A", archived: false });
    expect((await call("a", "GET", `/transactions/${ids.transaction}`)).json).toMatchObject({ amount: 12.5, cleared: true });
    const payslip = (await call("a", "GET", `/payslips/${ids.payslip}`)).json;
    expect(payslip).toMatchObject({ payslipType: "ordinal" });
    const notes = (await call("a", "GET", `/notes/${ids.payslip}`)).json as unknown as unknown[];
    expect(notes).toHaveLength(1);
    const rules = (await call("a", "GET", "/alerts/rules")).json as unknown as Array<{ name: string }>;
    // Las tres reglas con las que empieza toda cuenta, más la suya.
    expect(rules.map((r) => r.name).sort()).toEqual(
      ["Bajada del neto", "Cambio en la retención de IRPF", "Nómina sin subir", "Regla privada de A"],
    );
    const recurring = (await call("a", "GET", "/recurring-transactions")).json.data as Array<{ active: boolean }>;
    expect(recurring[0].active).toBe(true);
    const cats = (await call("a", "GET", "/categories")).json.data as Array<{ name: string; categories: Array<{ name: string }> }>;
    const catNames = cats.flatMap((g) => g.categories.map((c) => c.name));
    expect(catNames).toContain("Cat A");
    expect(catNames).not.toContain("intrusa"); // B no pudo crear categorías en grupos de A
  });
});

/** PDF mínimo de una página con una línea de texto por elemento (Helvetica). */
function minimalPdf(lines: string[]): string {
  const text = lines.map((l, i) => `${i === 0 ? "" : "0 -20 Td "}(${l}) Tj`).join(" ");
  const stream = `BT /F1 12 Tf 72 720 Td ${text} ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return out; // ASCII puro: el Blob lo codifica tal cual
}
