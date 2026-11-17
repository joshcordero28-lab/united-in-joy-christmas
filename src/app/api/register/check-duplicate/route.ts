import { NextResponse } from "next/server";
import { z } from "zod";
import { findPossibleDuplicate } from "@/lib/duplicate-check";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  managerName: z.string().trim().min(2).max(80).optional(),
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  attendees: z
    .array(z.object({ fullName: z.string().trim().min(2).max(80) }))
    .max(8)
    .optional(),
});

/**
 * Soft duplicate probe for the registration UI.
 * Never returns booking refs, tokens, or other guests' private details.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`register-dup:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid details." }, { status: 400 });
    }

    const result = await findPossibleDuplicate({
      fullName: parsed.data.managerName || parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      attendeeNames: parsed.data.attendees?.map((a) => a.fullName),
    });

    return NextResponse.json({
      possibleDuplicate: result.possibleDuplicate,
      matchKind: result.matchKind ?? null,
      message: result.possibleDuplicate
        ? "It looks like you may already be registered for United in Joy Christmas 2026."
        : null,
    });
  } catch (err) {
    console.error("duplicate check failed", err);
    return NextResponse.json({ error: "Could not check registration." }, { status: 500 });
  }
}
