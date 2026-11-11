import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { shareInvites, shares, users } from "../db/schema.js";
import { AppError } from "../middleware/error-handler.js";

/* ───────── Compartir en solo lectura ────────────────────────────
 * El titular crea una invitación (código de un solo uso, 7 días) y se la
 * pasa a quien quiera; al aceptarla, esa persona puede ver sus datos con la
 * cabecera X-View-As (middleware/auth.ts), sin poder cambiar nada.
 */

export const INVITE_DAYS = 7;
export const MAX_ACTIVE_INVITES = 5;
export const MAX_VIEWERS = 5;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createInvite(ownerUserId: number): Promise<{ id: number; token: string; expiresAt: Date }> {
  // Las caducadas no cuentan (y se limpian de paso).
  await db.delete(shareInvites).where(and(eq(shareInvites.ownerUserId, ownerUserId), lt(shareInvites.expiresAt, new Date())));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shareInvites)
    .where(eq(shareInvites.ownerUserId, ownerUserId));
  if (n >= MAX_ACTIVE_INVITES) throw new AppError(409, `Ya tienes ${MAX_ACTIVE_INVITES} invitaciones sin usar: cancela alguna`);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const [row] = await db.insert(shareInvites).values({ ownerUserId, tokenHash: hash(token), expiresAt }).returning({ id: shareInvites.id });
  return { id: row.id, token, expiresAt };
}

export async function acceptInvite(viewerUserId: number, token: string): Promise<{ id: number; name: string }> {
  const [invite] = await db
    .select()
    .from(shareInvites)
    .where(and(eq(shareInvites.tokenHash, hash(token)), gt(shareInvites.expiresAt, new Date())));
  if (!invite) throw new AppError(404, "La invitación no existe, ya se usó o ha caducado");
  if (invite.ownerUserId === viewerUserId) throw new AppError(400, "Esa invitación es tuya: compártela con otra persona");
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shares)
    .where(eq(shares.ownerUserId, invite.ownerUserId));
  if (n >= MAX_VIEWERS) throw new AppError(409, "Esa persona ya comparte sus datos con el máximo de gente");
  await db.transaction(async (tx) => {
    await tx.insert(shares).values({ ownerUserId: invite.ownerUserId, viewerUserId }).onConflictDoNothing();
    // Un solo uso.
    await tx.delete(shareInvites).where(eq(shareInvites.id, invite.id));
  });
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, invite.ownerUserId));
  return { id: owner.id, name: owner.name ?? "" };
}

/** ¿Puede `viewerUserId` ver los datos de `ownerUserId`? Devuelve el email del titular. */
export async function findShare(viewerUserId: number, ownerUserId: number): Promise<{ email: string } | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(shares)
    .innerJoin(users, eq(users.id, shares.ownerUserId))
    .where(and(eq(shares.viewerUserId, viewerUserId), eq(shares.ownerUserId, ownerUserId)));
  return row ?? null;
}

export async function getSharing(userId: number) {
  const [sharedWithMe, myViewers, invites] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, email: users.email, since: shares.createdAt })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.ownerUserId))
      .where(eq(shares.viewerUserId, userId)),
    db
      .select({ userId: users.id, name: users.name, email: users.email, since: shares.createdAt })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.viewerUserId))
      .where(eq(shares.ownerUserId, userId)),
    db
      .select({ id: shareInvites.id, expiresAt: shareInvites.expiresAt, createdAt: shareInvites.createdAt })
      .from(shareInvites)
      .where(and(eq(shareInvites.ownerUserId, userId), gt(shareInvites.expiresAt, new Date()))),
  ]);
  return { sharedWithMe, myViewers, invites };
}

export async function deleteInvite(ownerUserId: number, id: number): Promise<boolean> {
  const rows = await db.delete(shareInvites).where(and(eq(shareInvites.id, id), eq(shareInvites.ownerUserId, ownerUserId))).returning({ id: shareInvites.id });
  return rows.length > 0;
}

/** Quita un acceso: el titular a quien ve sus datos, o quien ve a sí mismo. */
export async function removeShare(ownerUserId: number, viewerUserId: number): Promise<boolean> {
  const rows = await db
    .delete(shares)
    .where(and(eq(shares.ownerUserId, ownerUserId), eq(shares.viewerUserId, viewerUserId)))
    .returning({ id: shares.id });
  return rows.length > 0;
}
