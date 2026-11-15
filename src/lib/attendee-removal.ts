import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "./db";
import {
  fingerprintToken,
  generateOpaqueToken,
  generateVotingCredential,
  hashVotingCredential,
} from "./crypto";

type Db = Prisma.TransactionClient;

export function ticketStaffRef(ticketToken: string | null | undefined): string | null {
  if (!ticketToken) return null;
  return fingerprintToken(ticketToken).toUpperCase().slice(0, 8);
}

export type RemovePreview = {
  attendeeId: string;
  fullName: string;
  ticketRef: string | null;
  status: TicketStatus;
  partyId: string;
  hasActiveVote: boolean;
  voteGroupName: string | null;
  resultsPublished: boolean;
  talentGroups: { id: string; groupName: string; isLeader: boolean }[];
  requiresOrganizer: boolean;
};

export async function previewAttendeeRemoval(attendeeId: string): Promise<RemovePreview | null> {
  const attendee = await prisma.attendee.findUnique({
    where: { id: attendeeId },
    select: {
      id: true,
      fullName: true,
      status: true,
      ticketToken: true,
      registrationPartyId: true,
      audienceVotes: {
        select: {
          voidedAt: true,
          group: { select: { groupName: true } },
        },
      },
      groupMemberships: {
        select: {
          group: {
            select: {
              id: true,
              groupName: true,
              leaderAttendeeId: true,
            },
          },
        },
      },
    },
  });
  if (!attendee) return null;

  const event = await prisma.eventConfig.findUnique({ where: { id: "default" } });
  const activeVote = attendee.audienceVotes.find((v) => !v.voidedAt) || null;

  return {
    attendeeId: attendee.id,
    fullName: attendee.fullName,
    ticketRef: ticketStaffRef(attendee.ticketToken),
    status: attendee.status,
    partyId: attendee.registrationPartyId,
    hasActiveVote: Boolean(activeVote),
    voteGroupName: activeVote?.group.groupName ?? null,
    resultsPublished: Boolean(event?.talentResultsPublished),
    talentGroups: attendee.groupMemberships.map((m) => ({
      id: m.group.id,
      groupName: m.group.groupName,
      isLeader: m.group.leaderAttendeeId === attendee.id,
    })),
    requiresOrganizer: Boolean(activeVote),
  };
}

export type SoftRemoveArgs = {
  attendeeId: string;
  reason: string;
  actorId: string;
  actorLabel: string;
  actorRole: "ORGANIZER" | "STAFF";
  confirmVoidBallot?: boolean;
};

export type SoftRemoveResult =
  | {
      ok: true;
      attendeeId: string;
      fullName: string;
      ticketRefBefore: string | null;
      voidedVoteId: string | null;
      resultsCorrectionPending: boolean;
      flaggedTalentGroupIds: string[];
      partyId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?:
        | "not_found"
        | "already_removed"
        | "invalid_status"
        | "requires_organizer"
        | "confirm_void"
        | "conflict";
      preview?: RemovePreview;
    };

/**
 * Soft-remove one attendee. Never deletes the registration party or other party members.
 * Invalidates QR by rotating ticketToken. Voids active ballots only with organizer confirm.
 */
export async function softRemoveAttendee(args: SoftRemoveArgs): Promise<SoftRemoveResult> {
  const reason = args.reason.trim();
  if (reason.length < 3) {
    return { ok: false, status: 400, error: "A removal reason is required (at least 3 characters)." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const attendee = await tx.attendee.findUnique({
        where: { id: args.attendeeId },
        include: {
          audienceVotes: {
            select: {
              id: true,
              voidedAt: true,
              group: { select: { groupName: true } },
            },
          },
          groupMemberships: {
            select: {
              groupId: true,
              group: {
                select: {
                  id: true,
                  groupName: true,
                  leaderAttendeeId: true,
                },
              },
            },
          },
        },
      });

      if (!attendee) {
        return { ok: false as const, status: 404, error: "Attendee not found.", code: "not_found" as const };
      }
      if (attendee.status === TicketStatus.REMOVED) {
        return {
          ok: false as const,
          status: 409,
          error: "Attendee is already removed.",
          code: "already_removed" as const,
        };
      }
      if (attendee.status === TicketStatus.REVOKED) {
        return {
          ok: false as const,
          status: 409,
          error: "Revoked tickets cannot be soft-removed. Use organizer restore only for REMOVED records.",
          code: "invalid_status" as const,
        };
      }

      const activeVote = attendee.audienceVotes.find((v) => !v.voidedAt) || null;
      const event = await tx.eventConfig.findUnique({ where: { id: "default" } });
      const resultsPublished = Boolean(event?.talentResultsPublished);

      if (activeVote) {
        if (args.actorRole !== "ORGANIZER") {
          return {
            ok: false as const,
            status: 403,
            error:
              "This attendee has already voted. Only an organizer can remove them and void the ballot.",
            code: "requires_organizer" as const,
            preview: {
              attendeeId: attendee.id,
              fullName: attendee.fullName,
              ticketRef: ticketStaffRef(attendee.ticketToken),
              status: attendee.status,
              partyId: attendee.registrationPartyId,
              hasActiveVote: true,
              voteGroupName: activeVote.group.groupName,
              resultsPublished,
              talentGroups: attendee.groupMemberships.map((m) => ({
                id: m.group.id,
                groupName: m.group.groupName,
                isLeader: m.group.leaderAttendeeId === attendee.id,
              })),
              requiresOrganizer: true,
            },
          };
        }
        if (!args.confirmVoidBallot) {
          return {
            ok: false as const,
            status: 409,
            error:
              "This attendee has already voted. Confirm voiding the ballot to proceed. Finalized public results will be unpublished for organizer correction.",
            code: "confirm_void" as const,
            preview: {
              attendeeId: attendee.id,
              fullName: attendee.fullName,
              ticketRef: ticketStaffRef(attendee.ticketToken),
              status: attendee.status,
              partyId: attendee.registrationPartyId,
              hasActiveVote: true,
              voteGroupName: activeVote.group.groupName,
              resultsPublished,
              talentGroups: attendee.groupMemberships.map((m) => ({
                id: m.group.id,
                groupName: m.group.groupName,
                isLeader: m.group.leaderAttendeeId === attendee.id,
              })),
              requiresOrganizer: true,
            },
          };
        }
      }

      const ticketRefBefore = ticketStaffRef(attendee.ticketToken);
      // Rotate ticket token so any existing QR / link is immediately invalid.
      const invalidatedToken = generateOpaqueToken(32);
      // Scramble voting credential so old codes cannot authenticate.
      const deadCredential = generateVotingCredential();
      const votingCredentialHash = await hashVotingCredential(deadCredential);

      const updated = await tx.attendee.updateMany({
        where: {
          id: attendee.id,
          status: attendee.status,
          // Block racing check-in from completing after we decide to remove:
          // if checkedInAt changed mid-flight we still allow remove (history preserved).
        },
        data: {
          status: TicketStatus.REMOVED,
          removedAt: new Date(),
          removalReason: reason,
          removedById: args.actorId,
          ticketToken: invalidatedToken,
          votingCredentialHash,
          votingCredentialPlain: null,
          votingCredentialHint: null,
        },
      });

      if (updated.count !== 1) {
        return {
          ok: false as const,
          status: 409,
          error: "Attendee changed concurrently. Retry removal.",
          code: "conflict" as const,
        };
      }

      let voidedVoteId: string | null = null;
      if (activeVote) {
        const voided = await tx.audienceVote.updateMany({
          where: { id: activeVote.id, voidedAt: null },
          data: {
            voidedAt: new Date(),
            voidedReason: `Attendee soft-removed: ${reason}`,
            voidedById: args.actorId,
          },
        });
        if (voided.count !== 1) {
          throw Object.assign(new Error("Ballot void race — aborting removal."), {
            status: 409,
          });
        }
        voidedVoteId = activeVote.id;
      }

      let resultsCorrectionPending = false;
      if (activeVote && resultsPublished) {
        await tx.eventConfig.update({
          where: { id: "default" },
          data: {
            talentResultsPublished: false,
            talentResultsCorrectionPending: true,
          },
        });
        resultsCorrectionPending = true;
      }

      const flaggedTalentGroupIds: string[] = [];
      for (const m of attendee.groupMemberships) {
        const note = `Member "${attendee.fullName}" soft-removed (${reason}). Review this act before showtime.`;
        await tx.talentGroup.update({
          where: { id: m.groupId },
          data: {
            needsMemberReview: true,
            memberReviewNote: note,
          },
        });
        flaggedTalentGroupIds.push(m.groupId);
      }

      await tx.auditLog.create({
        data: {
          actorId: args.actorId,
          actorLabel: args.actorLabel,
          action: "attendee.soft_remove",
          entityType: "Attendee",
          entityId: attendee.id,
          detail: [
            `reason=${reason}`,
            `ticketRef=${ticketRefBefore || "none"}`,
            `partyId=${attendee.registrationPartyId}`,
            voidedVoteId ? `voidedVote=${voidedVoteId}` : "noActiveVote",
            flaggedTalentGroupIds.length
              ? `flaggedGroups=${flaggedTalentGroupIds.join("|")}`
              : "noTalentGroups",
            resultsCorrectionPending ? "resultsCorrectionPending" : null,
          ]
            .filter(Boolean)
            .join("; "),
        },
      });

      return {
        ok: true as const,
        attendeeId: attendee.id,
        fullName: attendee.fullName,
        ticketRefBefore,
        voidedVoteId,
        resultsCorrectionPending,
        flaggedTalentGroupIds,
        partyId: attendee.registrationPartyId,
      };
    });
  } catch (e: unknown) {
    const status =
      typeof e === "object" && e && "status" in e ? Number((e as { status: number }).status) : 500;
    if (status === 409) {
      return {
        ok: false,
        status: 409,
        error: e instanceof Error ? e.message : "Conflict during removal.",
        code: "conflict",
      };
    }
    throw e;
  }
}

export type SoftRestoreArgs = {
  attendeeId: string;
  actorId: string;
  actorLabel: string;
  reason?: string;
};

export type SoftRestoreResult =
  | {
      ok: true;
      attendeeId: string;
      fullName: string;
      ticketToken: string;
      votingCredential: string;
      ticketRef: string;
      voidedBallotRetained: boolean;
      talentReviewPending: boolean;
    }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Restore the same attendee row. Issues a new QR; old QR stays invalid.
 * Does not un-void ballots or clear talent review flags.
 */
export async function softRestoreAttendee(args: SoftRestoreArgs): Promise<SoftRestoreResult> {
  return prisma.$transaction(async (tx) => {
    const attendee = await tx.attendee.findUnique({
      where: { id: args.attendeeId },
      include: {
        audienceVotes: { select: { id: true, voidedAt: true } },
        groupMemberships: {
          select: { group: { select: { needsMemberReview: true } } },
        },
      },
    });

    if (!attendee) {
      return { ok: false as const, status: 404, error: "Attendee not found.", code: "not_found" };
    }
    if (attendee.status !== TicketStatus.REMOVED) {
      return {
        ok: false as const,
        status: 409,
        error: "Only soft-removed attendees can be restored.",
        code: "invalid_status",
      };
    }

    const ticketToken = generateOpaqueToken(32);
    const votingCredential = generateVotingCredential();
    const votingCredentialHash = await hashVotingCredential(votingCredential);

    const updated = await tx.attendee.updateMany({
      where: { id: attendee.id, status: TicketStatus.REMOVED },
      data: {
        status: TicketStatus.ISSUED,
        ticketToken,
        votingCredentialHash,
        votingCredentialPlain: votingCredential,
        votingCredentialHint: votingCredential.slice(0, 2),
        issuedAt: attendee.issuedAt ?? new Date(),
        removedAt: null,
        removalReason: null,
        removedById: null,
        revokedAt: null,
      },
    });

    if (updated.count !== 1) {
      return {
        ok: false as const,
        status: 409,
        error: "Attendee changed concurrently. Retry restore.",
        code: "conflict",
      };
    }

    const voidedBallotRetained = attendee.audienceVotes.some((v) => v.voidedAt);
    const talentReviewPending = attendee.groupMemberships.some(
      (m) => m.group.needsMemberReview,
    );

    await tx.auditLog.create({
      data: {
        actorId: args.actorId,
        actorLabel: args.actorLabel,
        action: "attendee.soft_restore",
        entityType: "Attendee",
        entityId: attendee.id,
        detail: [
          args.reason ? `reason=${args.reason.trim()}` : null,
          `newTicketRef=${ticketStaffRef(ticketToken)}`,
          `partyId=${attendee.registrationPartyId}`,
          voidedBallotRetained ? "voidedBallotRetained" : "noVoidedBallot",
          talentReviewPending ? "talentReviewStillPending" : null,
          "noExtraVoteEntitlement",
        ]
          .filter(Boolean)
          .join("; "),
      },
    });

    return {
      ok: true as const,
      attendeeId: attendee.id,
      fullName: attendee.fullName,
      ticketToken,
      votingCredential,
      ticketRef: ticketStaffRef(ticketToken)!,
      voidedBallotRetained,
      talentReviewPending,
    };
  });
}

/** Active (non-voided) votes only — for tallies and public/private results. */
export function activeVoteWhere(): Prisma.AudienceVoteWhereInput {
  return { voidedAt: null };
}

export async function countActiveVotes(db: Db | typeof prisma = prisma): Promise<number> {
  return db.audienceVote.count({ where: activeVoteWhere() });
}
