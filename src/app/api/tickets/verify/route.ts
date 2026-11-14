import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAttendeeTicket } from "@/lib/ticket-verify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  ticket: z.string().min(1).max(500),
  /** When true (leader verification), include other ISSUED attendees on the same registration. */
  includeParty: z.boolean().optional(),
});

/**
 * Verify an event ticket for talent-show signup.
 * Does not check the guest in or change voting entitlements.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`ticket-verify:${ip}`, 40, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many verification attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const result = await verifyAttendeeTicket(parsed.data.ticket, {
      includeParty: parsed.data.includeParty === true,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          registerUrl: result.registerUrl,
        },
        { status: result.status },
      );
    }

    // Minimum fields only — never ticket tokens, contact, or manager credentials.
    return NextResponse.json({
      ok: true,
      attendee: result.attendee,
      partyAttendees: parsed.data.includeParty ? result.partyAttendees : [],
    });
  } catch (err) {
    console.error("ticket verify failed", err);
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}
