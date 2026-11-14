import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractTicketToken } from "@/lib/tickets";
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

    const token = extractTicketToken(parsed.data.ticket);
    if (token.length < 16) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    const attendee = await prisma.attendee.findUnique({
      where: { ticketToken: token },
      select: { id: true, fullName: true, status: true },
    });
    if (!attendee || attendee.status !== "ISSUED") {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    return NextResponse.json({
      id: attendee.id,
      fullName: attendee.fullName,
    });
  } catch (err) {
    console.error("from-ticket failed", err);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}
