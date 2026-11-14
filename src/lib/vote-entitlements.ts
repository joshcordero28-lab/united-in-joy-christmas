import { Prisma, TicketStatus, VoteCastBy } from "@prisma/client";
import { prisma } from "./db";

export type EntitlementSummary = {
  eligible: number;
  used: number;
  remaining: number;
  remainingAttendees: { id: string; fullName: string; checkedInAt: Date | null }[];
  usedVotes: {
    attendeeId: string;
    fullName: string;
    groupId: string;
    groupName: string;
    castBy: VoteCastBy;
    createdAt: Date;
  }[];
};

type Db = Prisma.TransactionClient | typeof prisma;

/** Whether this attendee currently holds a voting entitlement (eligible pool). */
export function attendeeIsEligible(
  attendee: { status: TicketStatus; checkedInAt: Date | null },
  votingEnabledAfterCheckIn: boolean,
): boolean {
  if (attendee.status !== TicketStatus.ISSUED) return false;
  if (votingEnabledAfterCheckIn && !attendee.checkedInAt) return false;
  return true;
}

export async function summarizePartyEntitlements(
  partyId: string,
  votingEnabledAfterCheckIn: boolean,
  db: Db = prisma,
): Promise<EntitlementSummary> {
  const attendees = await db.attendee.findMany({
    where: { registrationPartyId: partyId },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fullName: true,
      status: true,
      checkedInAt: true,
      audienceVotes: {
        select: {
          groupId: true,
          castBy: true,
          createdAt: true,
          group: { select: { groupName: true } },
        },
      },
    },
  });

  const eligiblePool = attendees.filter((a) =>
    attendeeIsEligible(a, votingEnabledAfterCheckIn),
  );

  const usedVotes = eligiblePool.flatMap((a) =>
    a.audienceVotes.map((v) => ({
      attendeeId: a.id,
      fullName: a.fullName,
      groupId: v.groupId,
      groupName: v.group.groupName,
      castBy: v.castBy,
      createdAt: v.createdAt,
    })),
  );

  const usedIds = new Set(usedVotes.map((v) => v.attendeeId));
  const remainingAttendees = eligiblePool
    .filter((a) => !usedIds.has(a.id))
    .map((a) => ({
      id: a.id,
      fullName: a.fullName,
      checkedInAt: a.checkedInAt,
    }));

  return {
    eligible: eligiblePool.length,
    used: usedVotes.length,
    remaining: remainingAttendees.length,
    remainingAttendees,
    usedVotes,
  };
}

/**
 * Atomically assign remaining entitlements to approved groups.
 * Rejects the entire submission if any allocation is invalid or over remaining capacity.
 */
export async function castManagerAllocations(args: {
  partyId: string;
  votingEnabledAfterCheckIn: boolean;
  allocations: { groupId: string; votes: number }[];
}): Promise<{ voteIds: string[]; assigned: { attendeeId: string; fullName: string; groupId: string }[] }> {
  const { partyId, votingEnabledAfterCheckIn, allocations } = args;

  const cleaned = allocations
    .map((a) => ({ groupId: a.groupId, votes: Math.floor(a.votes) }))
    .filter((a) => a.votes > 0);

  if (cleaned.length === 0) {
    throw Object.assign(new Error("No votes to cast."), { status: 400 });
  }

  const totalRequested = cleaned.reduce((s, a) => s + a.votes, 0);
  if (totalRequested < 1) {
    throw Object.assign(new Error("No votes to cast."), { status: 400 });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const summary = await summarizePartyEntitlements(
        partyId,
        votingEnabledAfterCheckIn,
        tx,
      );

      if (totalRequested > summary.remaining) {
        throw Object.assign(
          new Error(
            `Only ${summary.remaining} vote${summary.remaining === 1 ? "" : "s"} remaining. Submission rejected — no votes were recorded.`,
          ),
          { status: 409 },
        );
      }

      const groupIds = [...new Set(cleaned.map((a) => a.groupId))];
      const groups = await tx.talentGroup.findMany({
        where: { id: { in: groupIds } },
      });
      if (groups.length !== groupIds.length) {
        throw Object.assign(
          new Error("One or more selected performing groups were not found."),
          { status: 400 },
        );
      }
      const unapproved = groups.filter((g) => g.status !== "APPROVED");
      if (unapproved.length > 0) {
        throw Object.assign(
          new Error("You can only vote for approved performing groups. No votes were recorded."),
          { status: 400 },
        );
      }

      const pool = [...summary.remainingAttendees];
      const assigned: { attendeeId: string; fullName: string; groupId: string }[] = [];
      const voteIds: string[] = [];

      for (const alloc of cleaned) {
        for (let i = 0; i < alloc.votes; i++) {
          const next = pool.shift();
          if (!next) {
            throw Object.assign(
              new Error("Not enough remaining votes. No votes were recorded."),
              { status: 409 },
            );
          }
          try {
            const vote = await tx.audienceVote.create({
              data: {
                voterId: next.id,
                groupId: alloc.groupId,
                castBy: VoteCastBy.MANAGER,
                castByPartyId: partyId,
              },
            });
            voteIds.push(vote.id);
            assigned.push({
              attendeeId: next.id,
              fullName: next.fullName,
              groupId: alloc.groupId,
            });
          } catch (e: unknown) {
            const code =
              typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
            if (code === "P2002") {
              throw Object.assign(
                new Error(
                  "One or more votes were already cast (possibly at the same time). No votes from this submission were recorded.",
                ),
                { status: 409 },
              );
            }
            throw e;
          }
        }
      }

      return { voteIds, assigned };
    });
  } catch (e: unknown) {
    // Prisma rolls back the interactive transaction on throw; rethrow status errors.
    throw e;
  }
}
