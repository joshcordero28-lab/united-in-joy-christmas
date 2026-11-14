import { TicketStatus } from "@prisma/client";
import { prisma } from "./db";
import { parseAppTicketCredential } from "./tickets";

export type TicketVerifyOk = {
  ok: true;
  attendee: { id: string; fullName: string; status: "ISSUED" };
  /** Same registration party, ISSUED only — for selecting partners without rescanning. */
  partyAttendees: { id: string; fullName: string }[];
};

export type TicketVerifyErr = {
  ok: false;
  status: number;
  code: "invalid" | "pending" | "revoked" | "removed" | "not_registered";
  error: string;
  registerUrl: "/register";
};

/**
 * Validate a ticket credential against the attendee DB.
 * Does not check in, revoke, or touch voting entitlements.
 */
export async function verifyAttendeeTicket(
  rawTicket: string,
  options: { includeParty?: boolean } = {},
): Promise<TicketVerifyOk | TicketVerifyErr> {
  const token = parseAppTicketCredential(rawTicket);
  if (token.length < 16) {
    return {
      ok: false,
      status: 400,
      code: "invalid",
      error: "That does not look like an event ticket. Register first, then try again.",
      registerUrl: "/register",
    };
  }

  const attendee = await prisma.attendee.findUnique({
    where: { ticketToken: token },
    select: {
      id: true,
      fullName: true,
      status: true,
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
    partyAttendees,
  };
}
