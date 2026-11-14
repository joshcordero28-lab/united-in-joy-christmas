import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { summarizePartyEntitlements } from "@/lib/vote-entitlements";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  managerToken: z.string().min(16).max(200),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`manage-view:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 400 });
    }

    const party = await prisma.registrationParty.findUnique({
      where: { managerToken: parsed.data.managerToken },
      include: {
        attendees: {
          orderBy: [{ fullName: "asc" }, { id: "asc" }],
          select: {
            id: true,
            fullName: true,
            status: true,
            ticketToken: true,
            checkedInAt: true,
            issuedAt: true,
          },
        },
      },
    });

    if (!party) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 401 });
    }

    const gate = await getPublicVotingGate();
    const event = await getEventConfig();

    const attendees = party.attendees.map((a) => ({
      id: a.id,
      fullName: a.fullName,
      status: a.status,
      checkedIn: Boolean(a.checkedInAt),
      ticketToken: a.status === "ISSUED" ? a.ticketToken : null,
    }));

    const payload: Record<string, unknown> = {
      partyId: party.id,
      managerName: party.managerName,
      attendees,
    };

    // Voting balance only after organizer reveals — never before.
    if (gate.visible) {
      const summary = await summarizePartyEntitlements(
        party.id,
        event.votingEnabledAfterCheckIn,
      );
      payload.voting = {
        open: gate.open,
        resultsPublished: gate.resultsPublished,
        eligible: summary.eligible,
        used: summary.used,
        remaining: summary.remaining,
        remainingAttendees: summary.remainingAttendees.map((a) => ({
          id: a.id,
          fullName: a.fullName,
        })),
        usedVotes: summary.usedVotes.map((v) => ({
          attendeeId: v.attendeeId,
          fullName: v.fullName,
          groupId: v.groupId,
          groupName: v.groupName,
          castBy: v.castBy,
        })),
      };

      if (gate.open || gate.resultsPublished) {
        const groups = await prisma.talentGroup.findMany({
          where: { status: "APPROVED" },
          orderBy: [{ performanceOrder: "asc" }, { groupName: "asc" }],
          select: {
            id: true,
            groupName: true,
            performanceTitle: true,
            talentType: true,
            performanceOrder: true,
          },
        });
        payload.groups = groups;
      }
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error("manage view failed", err);
    return NextResponse.json({ error: "Could not load registration." }, { status: 500 });
  }
}
