import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "./db";
import {
  assertRegistrationFitsCapacity,
  invalidateCapacityCache,
} from "./capacity";
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
    }).then((result) => {
      if (result.ok) invalidateCapacityCache();
      return result;
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
  try {
    const result = await prisma.$transaction(async (tx) => {
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

      // Serialize against concurrent registrations / restores.
      await tx.$executeRaw`SELECT id FROM "EventConfig" WHERE id = 'default' FOR UPDATE`;
      await assertRegistrationFitsCapacity(tx, 1);

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
    if (result.ok) invalidateCapacityCache();
    return result;
  } catch (e: unknown) {
    const status =
      typeof e === "object" && e && "status" in e ? Number((e as { status: number }).status) : 0;
    if (status === 403 && e instanceof Error) {
      return { ok: false, status: 403, error: e.message, code: "capacity" };
    }
    throw e;
  }
}

/** Active (non-voided) votes only — for tallies and public/private results. */
export function activeVoteWhere(): Prisma.AudienceVoteWhereInput {
  return { voidedAt: null };
}

export async function countActiveVotes(db: Db | typeof prisma = prisma): Promise<number> {
  return db.audienceVote.count({ where: activeVoteWhere() });
}

export type PermanentDeletePreview = {
  attendeeId: string;
  fullName: string;
  ticketNumber: string | null;
  ticketRef: string | null;
  status: TicketStatus;
  partyId: string;
  partyOtherMembers: { id: string; fullName: string; status: TicketStatus }[];
  checkedInAt: string | null;
  checkInMethod: string | null;
  checkInEventCount: number;
  hasActiveVote: boolean;
  voteGroupName: string | null;
  voidedVoteCount: number;
  talentGroups: { id: string; groupName: string; isLeader: boolean }[];
  isTalentLeader: boolean;
  hasLegacyVotes: boolean;
  competitionEntryCount: number;
  blockers: string[];
  requiresPurgeConfirm: boolean;
  /** Soft-remove first when an active ballot still exists. */
  requiresSoftRemoveFirst: boolean;
};

export async function previewPermanentDelete(
  attendeeId: string,
): Promise<PermanentDeletePreview | null> {
  const attendee = await prisma.attendee.findUnique({
    where: { id: attendeeId },
    select: {
      id: true,
      fullName: true,
      status: true,
      ticketToken: true,
      ticketNumber: true,
      registrationPartyId: true,
      checkedInAt: true,
      checkInMethod: true,
      audienceVotes: {
        select: {
          voidedAt: true,
          group: { select: { groupName: true } },
        },
      },
      checkInEvents: { select: { id: true } },
      competitionEntries: { select: { id: true } },
      groupMemberships: {
        select: {
          group: {
            select: { id: true, groupName: true, leaderAttendeeId: true },
          },
        },
      },
      legacyVotesCast: { select: { id: true }, take: 1 },
      legacyVotesReceived: { select: { id: true }, take: 1 },
      registrationParty: {
        select: {
          attendees: {
            where: { id: { not: attendeeId } },
            select: { id: true, fullName: true, status: true },
            orderBy: { registeredAt: "asc" },
          },
        },
      },
    },
  });
  if (!attendee) return null;

  const activeVote = attendee.audienceVotes.find((v) => !v.voidedAt) || null;
  const voidedVoteCount = attendee.audienceVotes.filter((v) => v.voidedAt).length;
  const talentGroups = attendee.groupMemberships.map((m) => ({
    id: m.group.id,
    groupName: m.group.groupName,
    isLeader: m.group.leaderAttendeeId === attendee.id,
  }));
  const isTalentLeader = talentGroups.some((g) => g.isLeader);
  const hasLegacyVotes =
    attendee.legacyVotesCast.length > 0 || attendee.legacyVotesReceived.length > 0;

  const blockers: string[] = [];
  if (activeVote) {
    blockers.push(
      "Active Audience Choice ballot — soft-remove (and void) first, then permanently delete.",
    );
  }
  if (isTalentLeader) {
    blockers.push(
      "Attendee leads a talent act — withdraw/reassign the group before permanent deletion.",
    );
  }
  if (hasLegacyVotes) {
    blockers.push(
      "Legacy King/Queen vote history references this attendee — physical delete is blocked.",
    );
  }

  const requiresPurgeConfirm =
    Boolean(attendee.checkedInAt) ||
    attendee.checkInEvents.length > 0 ||
    voidedVoteCount > 0 ||
    attendee.competitionEntries.length > 0;

  return {
    attendeeId: attendee.id,
    fullName: attendee.fullName,
    ticketNumber: attendee.ticketNumber,
    ticketRef: ticketStaffRef(attendee.ticketToken),
    status: attendee.status,
    partyId: attendee.registrationPartyId,
    partyOtherMembers: attendee.registrationParty.attendees,
    checkedInAt: attendee.checkedInAt?.toISOString() ?? null,
    checkInMethod: attendee.checkInMethod,
    checkInEventCount: attendee.checkInEvents.length,
    hasActiveVote: Boolean(activeVote),
    voteGroupName: activeVote?.group.groupName ?? null,
    voidedVoteCount,
    talentGroups,
    isTalentLeader,
    hasLegacyVotes,
    competitionEntryCount: attendee.competitionEntries.length,
    blockers,
    requiresPurgeConfirm,
    requiresSoftRemoveFirst: Boolean(activeVote),
  };
}

export type PermanentDeleteArgs = {
  attendeeId: string;
  reason: string;
  /** Must be exactly DELETE (case-sensitive). */
  confirmPhrase: string;
  /** Required when check-in / voided vote / competition history would be purged after audit snapshot. */
  confirmPurgeHistory?: boolean;
  actorId: string;
  actorLabel: string;
};

export type PermanentDeleteResult =
  | {
      ok: true;
      attendeeId: string;
      fullName: string;
      partyId: string;
      partyMembersPreserved: number;
      historySnapshot: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?:
        | "not_found"
        | "confirm_phrase"
        | "confirm_purge"
        | "blocked"
        | "conflict";
      preview?: PermanentDeletePreview;
    };

/**
 * Organizer-only permanent removal of one attendee row.
 * Snapshots non-sensitive history into AuditLog, then deletes the attendee.
 * Never deletes other RegistrationParty members or the party itself.
 * Does not log ticket tokens or voting credentials.
 */
export async function permanentDeleteAttendee(
  args: PermanentDeleteArgs,
): Promise<PermanentDeleteResult> {
  const reason = args.reason.trim();
  if (reason.length < 3) {
    return {
      ok: false,
      status: 400,
      error: "A deletion reason is required (at least 3 characters).",
    };
  }
  if (args.confirmPhrase !== "DELETE") {
    return {
      ok: false,
      status: 400,
      error: 'Type DELETE exactly to confirm permanent deletion.',
      code: "confirm_phrase",
    };
  }

  const preview = await previewPermanentDelete(args.attendeeId);
  if (!preview) {
    return { ok: false, status: 404, error: "Attendee not found.", code: "not_found" };
  }
  if (preview.blockers.length > 0) {
    return {
      ok: false,
      status: 409,
      error: preview.blockers.join(" "),
      code: "blocked",
      preview,
    };
  }
  if (preview.requiresPurgeConfirm && !args.confirmPurgeHistory) {
    return {
      ok: false,
      status: 409,
      error:
        "This attendee has check-in, voided ballot, or competition history. Confirm purge after audit snapshot to proceed.",
      code: "confirm_purge",
      preview,
    };
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
              groupId: true,
              castBy: true,
              createdAt: true,
              group: { select: { groupName: true } },
            },
          },
          checkInEvents: {
            select: {
              id: true,
              action: true,
              method: true,
              staffUserId: true,
              createdAt: true,
              note: true,
            },
          },
          competitionEntries: {
            select: { id: true, competitionId: true, teamName: true },
          },
          groupMemberships: { select: { id: true, groupId: true } },
          groupsLed: { select: { id: true } },
          legacyVotesCast: { select: { id: true }, take: 1 },
          legacyVotesReceived: { select: { id: true }, take: 1 },
        },
      });

      if (!attendee) {
        return { ok: false as const, status: 404, error: "Attendee not found.", code: "not_found" as const };
      }
      if (attendee.audienceVotes.some((v) => !v.voidedAt)) {
        return {
          ok: false as const,
          status: 409,
          error: "Active ballot still present. Soft-remove first.",
          code: "blocked" as const,
          preview,
        };
      }
      if (attendee.groupsLed.length > 0) {
        return {
          ok: false as const,
          status: 409,
          error: "Still listed as a talent group leader.",
          code: "blocked" as const,
          preview,
        };
      }
      if (attendee.legacyVotesCast.length || attendee.legacyVotesReceived.length) {
        return {
          ok: false as const,
          status: 409,
          error: "Legacy vote history blocks physical deletion.",
          code: "blocked" as const,
          preview,
        };
      }

      const partyOthers = await tx.attendee.count({
        where: {
          registrationPartyId: attendee.registrationPartyId,
          id: { not: attendee.id },
        },
      });

      const historySnapshot = {
        fullName: attendee.fullName,
        ticketNumber: attendee.ticketNumber,
        status: attendee.status,
        partyId: attendee.registrationPartyId,
        checkedInAt: attendee.checkedInAt?.toISOString() ?? null,
        checkInMethod: attendee.checkInMethod,
        checkInEvents: attendee.checkInEvents.map((e) => ({
          action: e.action,
          method: e.method,
          staffUserId: e.staffUserId,
          createdAt: e.createdAt.toISOString(),
          note: e.note,
        })),
        voidedVotes: attendee.audienceVotes.map((v) => ({
          id: v.id,
          groupName: v.group.groupName,
          castBy: v.castBy,
          voidedAt: v.voidedAt?.toISOString() ?? null,
          createdAt: v.createdAt.toISOString(),
        })),
        competitionEntries: attendee.competitionEntries,
        ticketRefFingerprint: ticketStaffRef(attendee.ticketToken),
      };

      // Detach Restrict memberships before delete (votes/check-ins cascade after snapshot).
      if (attendee.groupMemberships.length) {
        await tx.talentGroupMember.deleteMany({
          where: { attendeeId: attendee.id },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: args.actorId,
          actorLabel: args.actorLabel,
          action: "attendee.permanent_delete",
          entityType: "Attendee",
          entityId: attendee.id,
          detail: [
            `reason=${reason}`,
            `fullName=${attendee.fullName}`,
            `ticketNumber=${attendee.ticketNumber}`,
            `status=${attendee.status}`,
            `partyId=${attendee.registrationPartyId}`,
            `partyOthersPreserved=${partyOthers}`,
            `historySnapshot=${JSON.stringify(historySnapshot)}`,
            "credentialsNotLogged",
          ].join("; "),
        },
      });

      await tx.attendee.delete({ where: { id: attendee.id } });

      return {
        ok: true as const,
        attendeeId: attendee.id,
        fullName: attendee.fullName,
        partyId: attendee.registrationPartyId,
        partyMembersPreserved: partyOthers,
        historySnapshot: true,
      };
    }).then((result) => {
      if (result.ok) invalidateCapacityCache();
      return result;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return {
        ok: false,
        status: 409,
        error:
          "Database references still block deletion. Soft-remove, withdraw talent leadership, or contact support.",
        code: "blocked",
        preview,
      };
    }
    throw e;
  }
}
