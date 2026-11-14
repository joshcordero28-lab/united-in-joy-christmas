import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAttendeeTicket } from "@/lib/ticket-verify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  ticket: z.string().min(8).max(500),
});

/** Resolve the current guest from their saved ticket (no token returned). */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`from-ticket:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const result = await verifyAttendeeTicket(parsed.data.ticket, { includeParty: false });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, registerUrl: result.registerUrl },
        { status: result.status === 400 ? 404 : result.status },
      );
    }

    return NextResponse.json({
      id: result.attendee.id,
      fullName: result.attendee.fullName,
    });
  } catch (err) {
    console.error("from-ticket failed", err);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}
