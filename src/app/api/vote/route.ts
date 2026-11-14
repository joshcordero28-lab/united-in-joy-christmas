import { NextResponse } from "next/server";
import { z } from "zod";
import { VoteCastBy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getVoterSession } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { writeAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  groupId: z.string().min(1),
});

/** Opaque response when voting is not revealed — no ballot/config leakage. */
function unavailable() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    const gate = await getPublicVotingGate();
    if (!gate.visible) return unavailable();
    if (!gate.open) {
      return NextResponse.json({ error: "Voting is closed." }, { status: 403 });
    }

    const session = await getVoterSession();
    if (!session.isLoggedIn || !session.attendeeId) {
      return NextResponse.json({ error: "Voting login required." }, { status: 401 });
    }

    const ip = clientIp(request);
    const limited = await rateLimit(`vote:${session.attendeeId}:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid vote." }, { status: 400 });
    }

    const event = await getEventConfig();

    try {
      const result = await prisma.$transaction(async (tx) => {
        const voter = await tx.attendee.findUnique({ where: { id: session.attendeeId } });
        if (!voter || voter.status !== "ISSUED") {
          return { status: 403 as const, error: "Voter ticket invalid." };
        }
        if (event.votingEnabledAfterCheckIn && !voter.checkedInAt) {
          return { status: 403 as const, error: "Check-in required before voting." };
        }

        const group = await tx.talentGroup.findUnique({
          where: { id: parsed.data.groupId },
        });
        if (!group || group.status !== "APPROVED") {
          return {
            status: 400 as const,
            error: "You can only vote for an approved performing group.",
          };
        }

        // Re-check status immediately before insert so soft-remove wins races.
        const stillIssued = await tx.attendee.findFirst({
          where: { id: voter.id, status: "ISSUED" },
          select: { id: true, fullName: true },
        });
        if (!stillIssued) {
          return { status: 403 as const, error: "Voter ticket invalid." };
        }

        const vote = await tx.audienceVote.create({
          data: {
            voterId: voter.id,
            groupId: group.id,
            castBy: VoteCastBy.SELF,
            castByPartyId: null,
          },
        });

        return {
          status: 200 as const,
          voteId: vote.id,
          groupId: group.id,
          groupName: group.groupName,
          voterName: stillIssued.fullName,
        };
      });

      if (result.status !== 200) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      await writeAudit({
        actorLabel: result.voterName,
        action: "audience_vote.cast",
        entityType: "AudienceVote",
        entityId: result.voteId,
        detail: `group=${result.groupName};by=SELF`,
      });

      return NextResponse.json({ ok: true, groupId: result.groupId });
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return NextResponse.json(
          { error: "This attendee’s vote was already cast." },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (err) {
    console.error("vote failed", err);
    return NextResponse.json({ error: "Vote failed." }, { status: 500 });
  }
}

export async function GET() {
  const gate = await getPublicVotingGate();
  if (!gate.visible) return unavailable();

  const session = await getVoterSession();
  if (!session.isLoggedIn || !session.attendeeId) {
    return NextResponse.json({ error: "Voting login required." }, { status: 401 });
  }

  const myVoteRow = await prisma.audienceVote.findUnique({
    where: { voterId: session.attendeeId },
    select: { groupId: true, createdAt: true, castBy: true, voidedAt: true },
  });
  const myVote =
    myVoteRow && !myVoteRow.voidedAt
      ? {
          groupId: myVoteRow.groupId,
          createdAt: myVoteRow.createdAt,
          castBy: myVoteRow.castBy,
        }
      : null;

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

  let results: { groupId: string; groupName: string; votes: number }[] | null = null;
  if (gate.resultsPublished) {
    const tallies = await prisma.audienceVote.groupBy({
      by: ["groupId"],
      where: { voidedAt: null },
      _count: { _all: true },
    });
    const nameById = Object.fromEntries(groups.map((g) => [g.id, g.groupName]));
    results = tallies
      .map((t) => ({
        groupId: t.groupId,
        groupName: nameById[t.groupId] || t.groupId,
        votes: t._count._all,
      }))
      .sort((a, b) => b.votes - a.votes);
  }

  return NextResponse.json({
    voter: { id: session.attendeeId, fullName: session.attendeeName },
    open: gate.open,
    resultsPublished: gate.resultsPublished,
    myVote,
    groups,
    results,
    resultsLabel: gate.resultsPublished ? "Audience Choice" : null,
  });
}
