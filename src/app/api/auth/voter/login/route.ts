import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyVotingCredential } from "@/lib/crypto";
import { getVoterSession } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isBookingRefInput, normalizeTicketNumber } from "@/lib/booking-ref";
import { extractManagerToken, parseAppTicketCredential } from "@/lib/tickets";

const schema = z.object({
  /**
   * Private Guest Code path: opaque individual ticket token/link alone is enough.
   * Group manager codes are recognized but do not open a personal voter session.
   */
  guestCode: z.string().min(8).max(500).optional(),
  /// Opaque token, ticket URL/QR, or printed ticket number (legacy / QR path).
  ticketToken: z.string().min(8).max(500).optional(),
  /// Required for ticket-number path; optional when guestCode/ticketToken is opaque.
  votingCredential: z.string().min(4).max(40).optional(),
});

const INVALID = "Invalid private guest code or ticket.";

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

    const guestCode = (parsed.data.guestCode || "").trim();
    const ticketRaw = (parsed.data.ticketToken || "").trim();
    const voteCode = (parsed.data.votingCredential || "").trim();
    const raw = guestCode || ticketRaw;

    if (!raw) {
      return NextResponse.json({ error: "Enter your Private Guest Code or ticket." }, { status: 400 });
    }

    // Public sequential refs are not private guest codes.
    if (isBookingRefInput(raw)) {
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }

    const ticketNumber = normalizeTicketNumber(raw);
    if (ticketNumber) {
      if (voteCode.length < 4) {
        return NextResponse.json(
          {
            error:
              "A ticket number needs your voting code. Prefer your Private Guest Code or ticket link.",
            code: "needs_voting_code",
          },
          { status: 401 },
        );
      }
      const byNumber = await prisma.attendee.findUnique({ where: { ticketNumber } });
      return finishLogin(byNumber, voteCode, { requireVoteCode: true });
    }

    // Individual opaque ticket token / link (Private Guest Code for one attendee).
    const ticketToken = parseAppTicketCredential(raw);
    if (ticketToken.length >= 16) {
      const byToken = await prisma.attendee.findUnique({ where: { ticketToken } });
      if (byToken && byToken.status !== "REMOVED") {
        // Opaque ticket token is a bearer secret — voting code optional.
        // If provided, it must match (shared validation with QR/link path).
        return finishLogin(byToken, voteCode, { requireVoteCode: false });
      }
    }

    // Group Private Guest Code (managerToken) — never opens a personal voter session.
    // Controlled group casting remains on /manage with the existing manager vote API.
    const managerToken = extractManagerToken(raw);
    if (managerToken.length >= 16) {
      const party = await prisma.registrationParty.findFirst({
        where: { managerToken },
        select: { id: true },
      });
      if (party) {
        return NextResponse.json(
          {
            error:
              "That Private Guest Code opens your group tickets, not a single voter. Open My Tickets to cast each attendee’s vote, or enter an individual attendee’s Private Guest Code.",
            code: "group_private_code",
            managePath: "/manage",
          },
          { status: 403 },
        );
      }
    }

    return NextResponse.json({ error: INVALID }, { status: 401 });
  } catch (err) {
    console.error("voter login failed", err);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}

async function finishLogin(
  attendee: {
    id: string;
    fullName: string;
    status: string;
    checkedInAt: Date | null;
    ticketToken: string;
    ticketNumber: string;
    votingCredentialHash: string;
  } | null,
  voteCode: string,
  opts: { requireVoteCode: boolean },
) {
  if (!attendee || attendee.status !== "ISSUED") {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const event = await getEventConfig();
  if (event.votingEnabledAfterCheckIn && !attendee.checkedInAt) {
    return NextResponse.json(
      { error: "Check in at the entrance first." },
      { status: 403 },
    );
  }

  if (opts.requireVoteCode || voteCode.length >= 4) {
    if (voteCode.length < 4) {
      return NextResponse.json({ error: "Invalid voting code." }, { status: 401 });
    }
    const ok = await verifyVotingCredential(voteCode, attendee.votingCredentialHash);
    if (!ok) {
      return NextResponse.json({ error: "Invalid voting code." }, { status: 401 });
    }
  }

  const session = await getVoterSession();
  session.attendeeId = attendee.id;
  session.attendeeName = attendee.fullName;
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.json({
    ok: true,
    fullName: attendee.fullName,
    ticketToken: attendee.ticketToken,
    ticketNumber: attendee.ticketNumber,
  });
}
