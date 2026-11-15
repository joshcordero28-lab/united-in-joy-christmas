import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { fingerprintToken } from "@/lib/crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { extractTicketToken, qrDataUrl, ticketUrl } from "@/lib/tickets";

const schema = z.object({
  ticket: z.string().min(8).max(500),
});

/** Resolve ticket display data from a bearer token (never put the token in the URL path). */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`ticket-view:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ticket." }, { status: 400 });
    }

    const token = extractTicketToken(parsed.data.ticket);
    if (token.length < 16) {
      return NextResponse.json({ error: "Invalid ticket." }, { status: 400 });
    }

    const attendee = await prisma.attendee.findUnique({ where: { ticketToken: token } });
    if (!attendee) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    const event = await getEventConfig();
    const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
    const voteCode =
      attendee.status === "ISSUED" ? attendee.votingCredentialPlain : null;
    const link = ticketUrl(baseUrl, token, voteCode);
    const qr =
      attendee.status === "ISSUED" ? await qrDataUrl(link) : null;
    const staffRef = fingerprintToken(token).toUpperCase().slice(0, 8);

    return NextResponse.json({
      fullName: attendee.fullName,
      status: attendee.status,
      dateLabel: event.dateLabel,
      venueLabel: event.venueLabel,
      checkedInAt: attendee.checkedInAt?.toISOString() || null,
      qr,
      link,
      staffRef,
      /// Present when this ticket's QR embeds Audience Choice autofill.
      votingCredential: voteCode,
    });
  } catch (err) {
    console.error("ticket view failed", err);
    return NextResponse.json({ error: "Could not load ticket." }, { status: 500 });
  }
}
