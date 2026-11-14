import { NextResponse } from "next/server";
import { z } from "zod";
import { VotingState, VotingVisibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  /// HIDDEN | REVEALED — whether attendees may access the ballot at all.
  visibility: z.nativeEnum(VotingVisibility).optional(),
  /// CLOSED | OPEN — whether votes are accepted (OPEN only meaningful when revealed).
  state: z.enum(["CLOSED", "OPEN"]).optional(),
  /// Publish Audience Choice tallies to attendees (requires visibility REVEALED).
  resultsPublished: z.boolean().optional(),
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
    const tallies = await prisma.audienceVote.groupBy({
      by: ["groupId"],
      _count: { _all: true },
    });

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

    const recentVotes = await prisma.audienceVote.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        castBy: true,
        createdAt: true,
        voter: { select: { fullName: true, registrationPartyId: true } },
        group: { select: { groupName: true } },
        castByParty: { select: { managerName: true } },
      },
    });

    return NextResponse.json({
      visibility: event.talentVotingVisibility,
      talentVotingState:
        event.talentVotingState === "OPEN" ? "OPEN" : "CLOSED",
      resultsPublished: event.talentResultsPublished,
      resultsLabel: "Audience Choice",
      // Organizer always sees private tallies in dashboard (not public).
      privateResults: results,
      ties: detectTie(results),
      voteCount: await prisma.audienceVote.count(),
      approvedGroups: groups,
      ballotAudit: recentVotes.map((v) => ({
        id: v.id,
        attendeeName: v.voter.fullName,
        groupName: v.group.groupName,
        castBy: v.castBy,
        managerName: v.castByParty?.managerName || null,
        partyId: v.voter.registrationPartyId,
        createdAt: v.createdAt,
      })),
      legacyKingQueenVoteCount: await prisma.legacyKingQueenVote.count(),
      publicPhase: describePhase(event),
      note: "Audience Choice is separate from any judged overall talent-show winner unless you announce otherwise.",
    });
  } catch (err) {
    console.error("voting status failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}

function describePhase(event: {
  talentVotingVisibility: VotingVisibility;
  talentVotingState: VotingState;
  talentResultsPublished: boolean;
}) {
  if (event.talentVotingVisibility === "HIDDEN") return "hidden";
  if (event.talentVotingState === "OPEN") return "open";
  if (event.talentResultsPublished) return "closed_results_published";
  return "revealed_but_closed";
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

    const current = await getEventConfig();
    const nextVisibility = parsed.data.visibility ?? current.talentVotingVisibility;
    const nextState = parsed.data.state ?? (current.talentVotingState === "OPEN" ? "OPEN" : "CLOSED");
    let nextResults =
      parsed.data.resultsPublished ?? current.talentResultsPublished;

    // Hiding from the public always unpublishes attendee-facing results first.
    if (nextVisibility === "HIDDEN") {
      nextResults = false;
    }

    if (nextResults && nextVisibility !== "REVEALED") {
      return NextResponse.json(
        { error: "Reveal voting to attendees before publishing results." },
        { status: 400 },
      );
    }

    if (parsed.data.resultsPublished === true) {
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
        });
      }
    }

    await prisma.eventConfig.update({
      where: { id: "default" },
      data: {
        talentVotingVisibility: nextVisibility,
        talentVotingState: nextState,
        talentResultsPublished: nextResults,
      },
    });

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "audience_vote.config_change",
      entityType: "AudienceChoice",
      detail: `visibility=${nextVisibility}; state=${nextState}; resultsPublished=${nextResults}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("voting patch failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
