import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAttendeeTicket } from "@/lib/ticket-verify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  ticket: z.string().min(1).max(500),
});

/**
 * Verify an event ticket for talent-show signup.
 * Does not check the guest in, change voting entitlements, or list other party members.
 * (Party mates are loaded only via the private management credential.)
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`ticket-verify:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many verification attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const result = await verifyAttendeeTicket(parsed.data.ticket, { includeParty: false });

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

    return NextResponse.json({
      ok: true,
      attendee: result.attendee,
    });
  } catch (err) {
    console.error("ticket verify failed", err);
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}
