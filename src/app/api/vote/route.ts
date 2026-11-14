import { NextResponse } from "next/server";
import { z } from "zod";
import { VoteCategory, VotingState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getVoterSession } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { writeAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  category: z.nativeEnum(VoteCategory),
  nomineeId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
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
    const state =
      parsed.data.category === "KING" ? event.kingVotingState : event.queenVotingState;
    if (state !== VotingState.OPEN) {
      return NextResponse.json({ error: "Voting is not open for this category." }, { status: 403 });
    }

    const voter = await prisma.attendee.findUnique({ where: { id: session.attendeeId } });
    if (!voter || voter.status !== "ISSUED") {
      return NextResponse.json({ error: "Voter ticket invalid." }, { status: 403 });
    }
    if (event.votingEnabledAfterCheckIn && !voter.checkedInAt) {
      return NextResponse.json({ error: "Check-in required before voting." }, { status: 403 });
    }

    const nominee = await prisma.attendee.findUnique({ where: { id: parsed.data.nomineeId } });
    if (!nominee || nominee.status !== "ISSUED" || !nominee.checkedInAt) {
      return NextResponse.json(
        { error: "Nominee must be a checked-in attendee." },
        { status: 400 },
      );
    }

    if (!event.allowSelfVote && nominee.id === voter.id) {
      return NextResponse.json({ error: "Self-voting is disabled." }, { status: 403 });
    }

    try {
      const vote = await prisma.vote.create({
        data: {
          category: parsed.data.category,
          voterId: voter.id,
          nomineeId: nominee.id,
        },
      });

      await writeAudit({
        actorLabel: voter.fullName,
        action: "vote.cast",
        entityType: "Vote",
        entityId: vote.id,
        detail: `category=${parsed.data.category}`,
      });

      return NextResponse.json({ ok: true, category: parsed.data.category });
    } catch (e: unknown) {
      const code = typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return NextResponse.json(
          { error: "You already voted in this category." },
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
  const session = await getVoterSession();
  if (!session.isLoggedIn || !session.attendeeId) {
    return NextResponse.json({ error: "Voting login required." }, { status: 401 });
  }

  const event = await getEventConfig();
  const myVotes = await prisma.vote.findMany({
    where: { voterId: session.attendeeId },
    select: { category: true, nomineeId: true, createdAt: true },
  });

  const nominees = await prisma.attendee.findMany({
    where: { status: "ISSUED", checkedInAt: { not: null } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  return NextResponse.json({
    voter: { id: session.attendeeId, fullName: session.attendeeName },
    allowSelfVote: event.allowSelfVote,
    kingVotingState: event.kingVotingState,
    queenVotingState: event.queenVotingState,
    myVotes,
    nominees,
  });
}
