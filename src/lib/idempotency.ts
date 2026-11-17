import { prisma } from "@/lib/db";

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Store / replay JSON registration responses by client idempotency key.
 * Uses RateLimitBucket.id namespace `idem:register:<key>` with count unused;
 * response body kept in a dedicated IdempotencyRecord table when available.
 */

export async function getIdempotentResponse(
  key: string,
): Promise<Record<string, unknown> | null> {
  const id = `idem:register:${key}`;
  try {
    const row = await prisma.idempotencyRecord.findUnique({ where: { id } });
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > TTL_MS) {
      await prisma.idempotencyRecord.delete({ where: { id } }).catch(() => undefined);
      return null;
    }
    return JSON.parse(row.responseJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveIdempotentResponse(
  key: string,
  response: Record<string, unknown>,
): Promise<void> {
  const id = `idem:register:${key}`;
  const responseJson = JSON.stringify(response);
  try {
    await prisma.idempotencyRecord.upsert({
      where: { id },
      create: { id, responseJson },
      update: { responseJson },
    });
  } catch (err) {
    console.error("idempotency save failed", err);
  }
}
