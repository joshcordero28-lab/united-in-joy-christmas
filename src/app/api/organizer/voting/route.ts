import { NextResponse } from "next/server";
import { z } from "zod";
import { VoteCategory, VotingState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  category: z.nativeEnum(VoteCategory),
  state: z.nativeEnum(VotingState),
  allowSelfVote: z.boolean().optional(),
  resolveTieWinnerId: z.string().optional(),
});

export async function GET() {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const event = await getEventConfig();
    const includeTotals =
      event.kingVotingState === "REVEALED" || event.queenVotingState === "REVEALED";

    const tallies = includeTotals
      ? await prisma.vote.groupBy({
          by: ["category", "nomineeId"],
          _count: { _all: true },
        })
      : [];

    const nominees = await prisma.attendee.findMany({
      where: { id: { in: tallies.map((t) => t.nomineeId) } },
      select: { id: true, fullName: true },
    });
    const nameById = Object.fromEntries(nominees.map((n) => [n.id, n.fullName]));

    const results = {
      KING: tallies
        .filter((t) => t.category === "KING")
        .map((t) => ({
          nomineeId: t.nomineeId,
          fullName: nameById[t.nomineeId] || t.nomineeId,
          votes: t._count._all,
        }))
        .sort((a, b) => b.votes - a.votes),
      QUEEN: tallies
        .filter((t) => t.category === "QUEEN")
        .map((t) => ({
          nomineeId: t.nomineeId,
          fullName: nameById[t.nomineeId] || t.nomineeId,
          votes: t._count._all,
        }))
        .sort((a, b) => b.votes - a.votes),
    };

    return NextResponse.json({
      kingVotingState: event.kingVotingState,
      queenVotingState: event.queenVotingState,
      allowSelfVote: event.allowSelfVote,
      results:
        event.kingVotingState === "REVEALED" || event.queenVotingState === "REVEALED"
          ? {
              KING: event.kingVotingState === "REVEALED" ? results.KING : null,
              QUEEN: event.queenVotingState === "REVEALED" ? results.QUEEN : null,
            }
          : null,
      ties: {
        KING: detectTie(results.KING),
        QUEEN: detectTie(results.QUEEN),
      },
      voteCounts: {
        KING: await prisma.vote.count({ where: { category: "KING" } }),
        QUEEN: await prisma.vote.count({ where: { category: "QUEEN" } }),
      },
    });
  } catch (err) {
    console.error("voting status failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}

function detectTie(rows: { nomineeId: string; fullName: string; votes: number }[]) {
  if (rows.length < 2) return null;
  const top = rows[0].votes;
  const tied = rows.filter((r) => r.votes === top && top > 0);
  if (tied.length > 1) return tied;
  return null;
}

export async function PATCH(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (parsed.data.state === "REVEALED") {
      const tallies = await prisma.vote.groupBy({
        by: ["nomineeId"],
        where: { category: parsed.data.category },
        _count: { _all: true },
      });
      const sorted = [...tallies].sort((a, b) => b._count._all - a._count._all);
      if (sorted.length >= 2 && sorted[0]._count._all === sorted[1]._count._all) {
        if (!parsed.data.resolveTieWinnerId) {
          return NextResponse.json(
            {
              error: "Tie detected. Provide resolveTieWinnerId to declare a winner.",
              tied: sorted
                .filter((s) => s._count._all === sorted[0]._count._all)
                .map((s) => s.nomineeId),
            },
            { status: 409 },
          );
        }
        const ok = sorted.some(
          (s) =>
            s.nomineeId === parsed.data.resolveTieWinnerId &&
            s._count._all === sorted[0]._count._all,
        );
        if (!ok) {
          return NextResponse.json({ error: "Invalid tie resolution nominee." }, { status: 400 });
        }
        await writeAudit({
          actorId: session.staffId,
          actorLabel: session.username,
          action: "voting.tie_resolved",
          entityType: "VoteCategory",
          entityId: parsed.data.category,
          detail: `winner=${parsed.data.resolveTieWinnerId}`,
        });
      }
    }

    const data =
      parsed.data.category === "KING"
        ? { kingVotingState: parsed.data.state }
        : { queenVotingState: parsed.data.state };

    await prisma.eventConfig.update({
      where: { id: "default" },
      data: {
        ...data,
        ...(parsed.data.allowSelfVote !== undefined
          ? { allowSelfVote: parsed.data.allowSelfVote }
          : {}),
      },
    });

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "voting.state_change",
      entityType: "VoteCategory",
      entityId: parsed.data.category,
      detail: `state=${parsed.data.state}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("voting patch failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
