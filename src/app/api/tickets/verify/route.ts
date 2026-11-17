import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAttendeeTicket } from "@/lib/ticket-verify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  ticket: z.string().min(1).max(500),
  /** Required when `ticket` is a printed ticket number (UIJ2026-#####-NN). */
  votingCredential: z.string().min(4).max(40).optional(),
});

/**
 * Verify an event ticket for talent-show signup.
 * Accepts opaque ticket links/tokens, or ticket number + voting code.
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

    const result = await verifyAttendeeTicket(parsed.data.ticket, {
      includeParty: false,
      votingCredential: parsed.data.votingCredential,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          registerUrl: result.registerUrl,
          findUrl: result.findUrl ?? null,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      attendee: result.attendee,
      // Opaque bearer for follow-on talent APIs when the guest typed a ticket number.
      ticketToken: result.ticketToken,
    });
  } catch (err) {
    console.error("ticket verify failed", err);
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}
