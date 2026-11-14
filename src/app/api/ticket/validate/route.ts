import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { fingerprintToken } from "@/lib/crypto";

const schema = z.object({
  token: z.string().min(16).max(200),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`ticket-validate:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many validation attempts." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ valid: false, error: "Invalid token." }, { status: 400 });
    }

    const attendee = await prisma.attendee.findUnique({
      where: { ticketToken: parsed.data.token },
      select: {
        id: true,
        fullName: true,
        status: true,
        checkedInAt: true,
        ticketToken: true,
      },
    });

    if (!attendee) {
      return NextResponse.json({
        valid: false,
        error: "Ticket not found.",
        fingerprint: fingerprintToken(parsed.data.token),
      });
    }

    if (attendee.status === "REVOKED") {
      return NextResponse.json({
        valid: false,
        error: "Ticket revoked.",
        attendeeId: attendee.id,
        fullName: attendee.fullName,
        status: attendee.status,
      });
    }

    if (attendee.status === "PENDING") {
      return NextResponse.json({
        valid: false,
        error: "Ticket not yet issued.",
        attendeeId: attendee.id,
        fullName: attendee.fullName,
        status: attendee.status,
      });
    }

    return NextResponse.json({
      valid: true,
      attendeeId: attendee.id,
      fullName: attendee.fullName,
      status: attendee.status,
      checkedIn: Boolean(attendee.checkedInAt),
      checkedInAt: attendee.checkedInAt,
    });
  } catch (err) {
    console.error("ticket validate failed", err);
    return NextResponse.json({ error: "Validation failed." }, { status: 500 });
  }
}
