import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyVotingCredential } from "@/lib/crypto";
import { getVoterSession } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveAttendeeByCredential } from "@/lib/resolve-attendee";

const schema = z.object({
  /// Opaque token/URL/QR, or printed ticket number UIJ2026-#####-NN.
  ticketToken: z.string().min(8).max(500),
  votingCredential: z.string().min(4).max(40),
});

export async function POST(request: Request) {
  try {
    const gate = await getPublicVotingGate();
    if (!gate.visible) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const ip = clientIp(request);
    const limited = await rateLimit(`voter-login:${ip}`, 15, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid login details." }, { status: 400 });
    }

    const resolved = await resolveAttendeeByCredential(parsed.data.ticketToken);
    if (!resolved.ok) {
      return NextResponse.json({ error: "Invalid ticket." }, { status: 401 });
    }

    const event = await getEventConfig();

    const attendee = await prisma.attendee.findUnique({
      where: { id: resolved.attendeeId },
    });

    if (!attendee || attendee.status !== "ISSUED") {
      return NextResponse.json({ error: "Invalid ticket." }, { status: 401 });
    }

    if (event.votingEnabledAfterCheckIn && !attendee.checkedInAt) {
      return NextResponse.json(
        { error: "Check in at the entrance first." },
        { status: 403 },
      );
    }

    const ok = await verifyVotingCredential(
      parsed.data.votingCredential,
      attendee.votingCredentialHash,
    );
    if (!ok) {
      return NextResponse.json({ error: "Invalid voting code." }, { status: 401 });
    }

    const session = await getVoterSession();
    session.attendeeId = attendee.id;
    session.attendeeName = attendee.fullName;
    session.isLoggedIn = true;
    await session.save();

    return NextResponse.json({
      ok: true,
      fullName: attendee.fullName,
      ticketToken: resolved.ticketToken,
      ticketNumber: resolved.ticketNumber,
    });
  } catch (err) {
    console.error("voter login failed", err);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
