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
 * On database failure, fail closed (deny) so limits cannot be bypassed.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
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
  } catch (err) {
    console.error("rateLimit failed; denying request", err);
    return { ok: false as const, retryAfterSeconds: 60 };
  }
}

/**
 * Increment a counter by `amount` within a fixed window (for seat quotas).
 * Fail closed on DB errors.
 */
export async function rateLimitConsume(
  key: string,
  amount: number,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (amount < 1) return { ok: true };
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
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
        if (amount > limit) {
          return { ok: false as const, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
        await tx.rateLimitBucket.upsert({
          where: { id: key },
          create: { id: key, count: amount, windowStart: now },
          update: { count: amount, windowStart: now },
        });
        return { ok: true as const };
      }

      if (bucket.count + amount > limit) {
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
        data: { count: { increment: amount } },
      });
      return { ok: true as const };
    });
  } catch (err) {
    console.error("rateLimitConsume failed; denying request", err);
    return { ok: false as const, retryAfterSeconds: 60 };
  }
}

/**
 * Rate-limit identity. Prefer the right-most X-Forwarded-For hop (proxy-appended).
 * Without a forwarded IP, use a shared anonymous bucket — never User-Agent
 * (client-controlled and would create a new bucket per request).
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
  return "anon";
}
