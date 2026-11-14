import { createHash } from "crypto";
import { prisma } from "./db";

type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

type BucketRow = {
  id: string;
  count: number;
  windowStart: Date;
};

/**
 * DB-backed fixed-window rate limiter with row lock so parallel requests cannot
 * all read a sub-limit count and slip through.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<BucketRow[]>`
      SELECT id, count, "windowStart"
      FROM "RateLimitBucket"
      WHERE id = ${key}
      FOR UPDATE
    `;

    const bucket = existing[0];
    const windowExpired =
      !bucket || now.getTime() - new Date(bucket.windowStart).getTime() >= windowMs;

    if (windowExpired) {
      await tx.rateLimitBucket.upsert({
        where: { id: key },
        create: { id: key, count: 1, windowStart: now },
        update: { count: 1, windowStart: now },
      });
      return { ok: true as const };
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.ceil(
        (windowMs - (now.getTime() - new Date(bucket.windowStart).getTime())) / 1000,
      );
      return {
        ok: false as const,
        retryAfterSeconds: Math.max(retryAfterSeconds, 1),
      };
    }

    await tx.rateLimitBucket.update({
      where: { id: key },
      data: { count: { increment: 1 } },
    });
    return { ok: true as const };
  });
}

/**
 * Rate-limit identity. Never trust client-controlled X-Real-IP or the left-most
 * X-Forwarded-For value. Use only the right-most forwarded hop (proxy-appended).
 */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  const ua = request.headers.get("user-agent") || "unknown";
  const digest = createHash("sha256").update(ua).digest("hex").slice(0, 16);
  return `ua:${digest}`;
}
