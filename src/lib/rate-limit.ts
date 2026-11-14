import { createHash } from "crypto";
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
 * Rate-limit identity. Never trust client-controlled X-Real-IP or the left-most
 * X-Forwarded-For value. Behind Cursor/hosting the edge appends the connecting
 * IP, so we use only the right-most forwarded hop. If none is present, fall back
 * to a coarse UA fingerprint (not spoofable as a unique IP).
 */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Right-most entry is typically appended by the trusted reverse proxy.
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  const ua = request.headers.get("user-agent") || "unknown";
  const digest = createHash("sha256").update(ua).digest("hex").slice(0, 16);
  return `ua:${digest}`;
}
