import { NextResponse } from "next/server";
import { z } from "zod";
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
    const voter = await prisma.attendee.findUnique({ where: { id: session.attendeeId } });
    if (!voter || voter.status !== "ISSUED") {
      return NextResponse.json({ error: "Voter ticket invalid." }, { status: 403 });
    }
    if (event.votingEnabledAfterCheckIn && !voter.checkedInAt) {
      return NextResponse.json({ error: "Check-in required before voting." }, { status: 403 });
    }

    const group = await prisma.talentGroup.findUnique({
      where: { id: parsed.data.groupId },
    });
    if (!group || group.status !== "APPROVED") {
      return NextResponse.json(
        { error: "You can only vote for an approved performing group." },
        { status: 400 },
      );
    }

    try {
      const vote = await prisma.audienceVote.create({
        data: { voterId: voter.id, groupId: group.id },
      });

      await writeAudit({
        actorLabel: voter.fullName,
        action: "audience_vote.cast",
        entityType: "AudienceVote",
        entityId: vote.id,
        detail: `group=${group.groupName}`,
      });

      return NextResponse.json({ ok: true, groupId: group.id });
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return NextResponse.json(
          { error: "You already cast your vote." },
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

  const myVote = await prisma.audienceVote.findUnique({
    where: { voterId: session.attendeeId },
    select: { groupId: true, createdAt: true },
  });

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
    groups: gate.open || gate.resultsPublished || myVote ? groups : groups,
    // Always list approved groups once visibility is revealed (needed for closed-but-revealed UX).
    results,
    resultsLabel: gate.resultsPublished ? "Audience Choice" : null,
  });
}
