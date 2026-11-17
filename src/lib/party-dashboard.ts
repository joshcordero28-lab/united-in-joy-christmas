import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { summarizePartyEntitlements } from "@/lib/vote-entitlements";
import { manageUrl, qrDataUrl, ticketUrl } from "@/lib/tickets";

export type PartyDashboardAttendee = {
  id: string;
  fullName: string;
  status: string;
  ticketNumber: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  ticketToken: string | null;
  votingCredential: string | null;
  link: string | null;
  qr: string | null;
};

export type PartyDashboardHistory = {
  id: string;
  attendeeId: string;
  attendeeName: string;
  action: string;
  method: string | null;
  note: string | null;
  createdAt: string;
};

export type PartyDashboard = {
  partyId: string;
  bookingRef: string;
  managerName: string;
  managerToken: string;
  manageLink: string;
  dateLabel: string;
  venueLabel: string;
  registeredAt: string;
  totalAttendees: number;
  checkedInCount: number;
  attendees: PartyDashboardAttendee[];
  history: PartyDashboardHistory[];
  voting?: Record<string, unknown>;
  groups?: unknown[];
};

/**
 * Full group ticket dashboard payload for a RegistrationParty.
 * Caller must already authenticate via managerToken (or equivalent).
 */
export async function buildPartyDashboard(
  partyId: string,
  options?: { includeQr?: boolean },
): Promise<PartyDashboard | null> {
  const includeQr = options?.includeQr !== false;
  const party = await prisma.registrationParty.findUnique({
    where: { id: partyId },
    include: {
      attendees: {
        orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          fullName: true,
          status: true,
          ticketNumber: true,
          ticketToken: true,
          votingCredentialPlain: true,
          checkedInAt: true,
          issuedAt: true,
          registeredAt: true,
        },
      },
    },
  });

  if (!party) return null;

  const event = await getEventConfig();
  const gate = await getPublicVotingGate();
  const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";

  const active = party.attendees.filter((a) => a.status !== "REMOVED");
  const checkedInCount = active.filter((a) => Boolean(a.checkedInAt)).length;

  const attendees: PartyDashboardAttendee[] = [];
  for (const a of active) {
    const voteCode = a.status === "ISSUED" ? a.votingCredentialPlain : null;
    const token = a.status === "ISSUED" ? a.ticketToken : null;
    const link = token ? ticketUrl(baseUrl, token, voteCode) : null;
    const qr = includeQr && link ? await qrDataUrl(link) : null;
    attendees.push({
      id: a.id,
      fullName: a.fullName,
      status: a.status,
      ticketNumber: a.ticketNumber,
      checkedIn: Boolean(a.checkedInAt),
      checkedInAt: a.checkedInAt?.toISOString() || null,
      ticketToken: token,
      votingCredential: voteCode,
      link,
      qr,
    });
  }

  const historyRows = await prisma.checkInEvent.findMany({
    where: { attendeeId: { in: party.attendees.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      attendeeId: true,
      action: true,
      method: true,
      note: true,
      createdAt: true,
      attendee: { select: { fullName: true } },
    },
  });

  const history: PartyDashboardHistory[] = historyRows.map((h) => ({
    id: h.id,
    attendeeId: h.attendeeId,
    attendeeName: h.attendee.fullName,
    action: h.action,
    method: h.method,
    note: h.note,
    createdAt: h.createdAt.toISOString(),
  }));

  const payload: PartyDashboard = {
    partyId: party.id,
    bookingRef: party.bookingRef,
    managerName: party.managerName,
    managerToken: party.managerToken,
    manageLink: manageUrl(baseUrl, party.managerToken),
    dateLabel: event.dateLabel,
    venueLabel: event.venueLabel,
    registeredAt: party.createdAt.toISOString(),
    totalAttendees: active.length,
    checkedInCount,
    attendees,
    history,
  };

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

  return payload;
}
