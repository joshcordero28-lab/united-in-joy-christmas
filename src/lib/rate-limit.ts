import { prisma } from "./db";

type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Simple DB-backed fixed-window rate limiter for shared multi-instance safety.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { id: key } });

  if (!bucket || now.getTime() - bucket.windowStart.getTime() >= windowMs) {
    await prisma.rateLimitBucket.upsert({
      where: { id: key },
      create: { id: key, count: 1, windowStart: now },
      update: { count: 1, windowStart: now },
    });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.ceil(
      (windowMs - (now.getTime() - bucket.windowStart.getTime())) / 1000,
    );
    return { ok: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  await prisma.rateLimitBucket.update({
    where: { id: key },
    data: { count: { increment: 1 } },
  });
  return { ok: true };
}

/**
 * Client IP for rate limiting. Do not trust the left-most X-Forwarded-For entry
 * (client-spoofable). Prefer X-Real-IP from the edge, else the right-most
 * forwarded hop (typically appended by the trusted proxy).
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  return "unknown";
}
