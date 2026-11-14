import { NextResponse } from "next/server";
import { z } from "zod";
import { VotingState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  state: z.nativeEnum(VotingState),
  resolveTieGroupId: z.string().optional(),
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
    const includeTotals = event.talentVotingState === "REVEALED";

    const tallies = includeTotals
      ? await prisma.audienceVote.groupBy({
          by: ["groupId"],
          _count: { _all: true },
        })
      : [];

    const groups = await prisma.talentGroup.findMany({
      where: { status: "APPROVED" },
      select: { id: true, groupName: true, performanceTitle: true, performanceOrder: true },
      orderBy: [{ performanceOrder: "asc" }, { groupName: "asc" }],
    });
    const nameById = Object.fromEntries(
      groups.map((g) => [g.id, { name: g.groupName, title: g.performanceTitle }]),
    );

    const results = tallies
      .map((t) => ({
        groupId: t.groupId,
        groupName: nameById[t.groupId]?.name || t.groupId,
        performanceTitle: nameById[t.groupId]?.title || "",
        votes: t._count._all,
      }))
      .sort((a, b) => b.votes - a.votes);

    const tie = detectTie(results);

    const legacyCount = await prisma.legacyKingQueenVote.count();

    return NextResponse.json({
      talentVotingState: event.talentVotingState,
      resultsLabel: "Audience Choice",
      results: includeTotals ? results : null,
      ties: includeTotals ? tie : null,
      voteCount: await prisma.audienceVote.count(),
      approvedGroups: groups,
      legacyKingQueenVoteCount: legacyCount,
      note: "Audience Choice is the audience favorite poll — not declared as the overall talent-show winner unless organizers state that separately.",
    });
  } catch (err) {
    console.error("voting status failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}

function detectTie(rows: { groupId: string; groupName: string; votes: number }[]) {
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
      const tallies = await prisma.audienceVote.groupBy({
        by: ["groupId"],
        _count: { _all: true },
      });
      const sorted = [...tallies].sort((a, b) => b._count._all - a._count._all);
      if (sorted.length >= 2 && sorted[0]._count._all === sorted[1]._count._all) {
        if (!parsed.data.resolveTieGroupId) {
          return NextResponse.json(
            {
              error: "Tie detected for Audience Choice. Provide resolveTieGroupId.",
              tied: sorted
                .filter((s) => s._count._all === sorted[0]._count._all)
                .map((s) => s.groupId),
            },
            { status: 409 },
          );
        }
        const ok = sorted.some(
          (s) =>
            s.groupId === parsed.data.resolveTieGroupId &&
            s._count._all === sorted[0]._count._all,
        );
        if (!ok) {
          return NextResponse.json({ error: "Invalid tie resolution group." }, { status: 400 });
        }
        await writeAudit({
          actorId: session.staffId,
          actorLabel: session.username,
          action: "audience_vote.tie_resolved",
          entityType: "AudienceChoice",
          entityId: parsed.data.resolveTieGroupId,
          detail: `winnerGroup=${parsed.data.resolveTieGroupId}`,
        });
      }
    }

    await prisma.eventConfig.update({
      where: { id: "default" },
      data: { talentVotingState: parsed.data.state },
    });

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "audience_vote.state_change",
      entityType: "AudienceChoice",
      detail: `state=${parsed.data.state}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("voting patch failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
