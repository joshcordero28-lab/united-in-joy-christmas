import { TicketStatus } from "@prisma/client";
import { prisma } from "./db";
import { isBookingRefInput, isTicketNumberInput, normalizeTicketNumber } from "./booking-ref";
import { parseAppTicketCredential } from "./tickets";

export type TicketVerifyOk = {
  ok: true;
  attendee: { id: string; fullName: string; status: "ISSUED" };
  /** Opaque bearer to use for subsequent talent APIs (always present on success). */
  ticketToken: string;
  /** Same registration party, ISSUED only — for selecting partners without rescanning. */
  partyAttendees: { id: string; fullName: string }[];
};

export type TicketVerifyErr = {
  ok: false;
  status: number;
  code:
    | "invalid"
    | "pending"
    | "revoked"
    | "removed"
    | "not_registered"
    | "needs_access"
    | "use_ticket_number_with_code";
  error: string;
  registerUrl: "/register";
  findUrl?: "/find";
};

/**
 * Validate a ticket credential against the attendee DB.
 * Accepts opaque ticket links/tokens, or a printed ticket number when paired
 * with the voting code (passed via options.votingCredential).
 * Does not check in, revoke, or touch voting entitlements.
 */
export async function verifyAttendeeTicket(
  rawTicket: string,
  options: { includeParty?: boolean; votingCredential?: string | null } = {},
): Promise<TicketVerifyOk | TicketVerifyErr> {
  const raw = (rawTicket || "").trim();

  // Human references are not opaque secrets — never unlock talent verify from a
  // number alone. Ticket number + voting code is allowed; booking ref alone is not.
  if (isBookingRefInput(raw)) {
    return {
      ok: false,
      status: 401,
      code: "needs_access",
      error:
        "A booking reference alone cannot verify a ticket. Use Find My Ticket with your Private Guest Code.",
      registerUrl: "/register",
      findUrl: "/find",
    };
  }

  let token = "";
  if (isTicketNumberInput(raw)) {
    const tn = normalizeTicketNumber(raw)!;
    const vote = (options.votingCredential || "").trim();
    if (vote.length < 4) {
      return {
        ok: false,
        status: 401,
        code: "use_ticket_number_with_code",
        error:
          "Ticket numbers need your voting code — or use Find My Ticket with your Private Guest Code.",
        registerUrl: "/register",
        findUrl: "/find",
      };
    }
    const { verifyVotingCredential } = await import("./crypto");
    const byNumber = await prisma.attendee.findUnique({
      where: { ticketNumber: tn },
      select: {
        id: true,
        fullName: true,
        status: true,
        ticketToken: true,
        votingCredentialHash: true,
        registrationPartyId: true,
      },
    });
    if (!byNumber) {
      return {
        ok: false,
        status: 404,
        code: "not_registered",
        error: "No registration found for this ticket. Register for the event first.",
        registerUrl: "/register",
      };
    }
    const voteOk = await verifyVotingCredential(vote, byNumber.votingCredentialHash);
    if (!voteOk) {
      return {
        ok: false,
        status: 401,
        code: "invalid",
        error: "Ticket number or voting code is incorrect.",
        registerUrl: "/register",
        findUrl: "/find",
      };
    }
    token = byNumber.ticketToken;
  } else {
    token = parseAppTicketCredential(raw);
    if (token.length < 16) {
      return {
        ok: false,
        status: 400,
        code: "invalid",
        error:
          "That does not look like an event ticket. Paste your ticket link, or use your ticket number with your voting code.",
        registerUrl: "/register",
        findUrl: "/find",
      };
    }
  }

  const attendee = await prisma.attendee.findUnique({
    where: { ticketToken: token },
    select: {
      id: true,
      fullName: true,
      status: true,
      ticketToken: true,
      registrationPartyId: true,
    },
  });

  if (!attendee) {
    return {
      ok: false,
      status: 404,
      code: "not_registered",
      error: "No registration found for this ticket. Register for the event first.",
      registerUrl: "/register",
    };
  }

  if (attendee.status === TicketStatus.PENDING) {
    return {
      ok: false,
      status: 403,
      code: "pending",
      error: "This ticket is still pending approval and cannot join the talent show yet.",
      registerUrl: "/register",
    };
  }

  if (attendee.status === TicketStatus.REVOKED) {
    return {
      ok: false,
      status: 403,
      code: "revoked",
      error: "This ticket has been cancelled and cannot join the talent show.",
      registerUrl: "/register",
    };
  }

  if (attendee.status === TicketStatus.REMOVED) {
    return {
      ok: false,
      status: 403,
      code: "removed",
      error: "This registration was removed and cannot join the talent show.",
      registerUrl: "/register",
    };
  }

  if (attendee.status !== TicketStatus.ISSUED) {
    return {
      ok: false,
      status: 403,
      code: "invalid",
      error: "This ticket is not eligible for talent-show registration.",
      registerUrl: "/register",
    };
  }

  let partyAttendees: { id: string; fullName: string }[] = [];
  if (options.includeParty) {
    const mates = await prisma.attendee.findMany({
      where: {
        registrationPartyId: attendee.registrationPartyId,
        status: TicketStatus.ISSUED,
        id: { not: attendee.id },
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      select: { id: true, fullName: true },
    });
    partyAttendees = mates;
  }

  return {
    ok: true,
    attendee: {
      id: attendee.id,
      fullName: attendee.fullName,
      status: "ISSUED",
    },
    ticketToken: attendee.ticketToken,
    partyAttendees,
  };
}
