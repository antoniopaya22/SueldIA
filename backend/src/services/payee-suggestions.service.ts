import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export interface PayeeSuggestion {
  payee: string;
  type: "expense" | "income";
  categoryId: number | null;
  accountId: number;
  amount: number;
  /** Cuántas veces aparece este beneficiario (para ordenar por uso). */
  count: number;
}

/** Escapa los comodines de LIKE para que «50%» o «a_b» se busquen literalmente. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Beneficiarios ya usados por el usuario, con los datos de su último
 * movimiento (categoría, cuenta, importe) para autocompletar el formulario.
 * Sin texto devuelve los más usados; con texto, primero los que empiezan por
 * él y luego los que lo contienen. Ignora traspasos y movimientos sin
 * beneficiario.
 */
export async function suggestPayees(
  userId: number,
  opts: { q?: string; type?: "expense" | "income"; limit?: number },
): Promise<PayeeSuggestion[]> {
  const q = opts.q?.trim() ?? "";
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  const rows = await db.execute<{
    payee: string;
    type: "expense" | "income";
    category_id: number | null;
    account_id: number;
    amount: number;
    n: number;
  }>(sql`
    select payee, type, category_id, account_id, amount, n
    from (
      select
        t.payee, t.type, t.category_id, t.account_id, t.amount,
        row_number() over (partition by lower(t.payee), t.type order by t.date desc, t.id desc) as rn,
        count(*) over (partition by lower(t.payee), t.type)::int as n
      from transactions t
      where t.user_id = ${userId}
        and t.type in ('expense', 'income')
        and t.payee is not null and t.payee <> ''
        ${opts.type ? sql`and t.type = ${opts.type}` : sql``}
        ${q ? sql`and t.payee ilike ${contains}` : sql``}
    ) ranked
    where rn = 1
    order by ${q ? sql`(payee ilike ${prefix}) desc,` : sql``} n desc, payee asc
    limit ${limit}
  `);

  return Array.from(rows).map((r) => ({
    payee: r.payee,
    type: r.type,
    categoryId: r.category_id,
    accountId: r.account_id,
    amount: Number(r.amount),
    count: r.n,
  }));
}
