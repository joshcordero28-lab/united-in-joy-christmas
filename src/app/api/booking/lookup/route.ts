import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import {
  isBookingRefInput,
  isTicketNumberInput,
  normalizeBookingRef,
  normalizeTicketNumber,
} from "@/lib/booking-ref";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buildPartyDashboard } from "@/lib/party-dashboard";
import {
  extractManagerToken,
  extractTicketToken,
  qrDataUrl,
  ticketUrl,
} from "@/lib/tickets";
import { fingerprintToken } from "@/lib/crypto";

const schema = z.object({
  /**
   * Primary guest path: opaque private guest code, ticket link, or manage link.
   * One authorized credential is enough — no booking reference required.
   */
  guestCode: z.string().min(8).max(500).optional(),
  /** @deprecated Prefer guestCode — still accepted for older clients. */
  bookingRef: z.string().min(3).max(40).optional(),
  accessToken: z.string().min(16).max(200).optional(),
  managerToken: z.string().min(16).max(200).optional(),
  ticketNumber: z.string().min(8).max(40).optional(),
  ticket: z.string().min(8).max(500).optional(),
});

const GENERIC_CODE_ERROR = "Invalid private guest code.";
const GENERIC_TICKET_ERROR = "Ticket not found.";
const NOT_A_PRIVATE_CODE =
  "That looks like a public reference number, not a private guest code. Paste the private guest code or ticket link you received when you registered.";

type AttendeeTicketRow = {
  id: string;
  fullName: string;
  status: string;
  ticketNumber: string;
  ticketToken: string;
  votingCredentialPlain: string | null;
  checkedInAt: Date | null;
  registrationParty: { bookingRef: string };
};

/**
 * Ticket / booking lookup for guests.
 *
 * Authorized credentials (any one is enough):
 * - Opaque individual ticket token / ticket link → that attendee only
 * - Opaque group private guest code (managerToken) / manage link → full party
 *
 * Booking refs and ticket numbers are NOT private codes and never unlock alone.
 * Legacy: booking ref + managerToken still works for organizer-assisted flows.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`booking-lookup:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many lookup attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid lookup request." }, { status: 400 });
    }

    const guestCodeRaw = (parsed.data.guestCode || "").trim();
    const accessToken = extractManagerToken(
      parsed.data.accessToken || parsed.data.managerToken || "",
    );
    const bookingRefRaw = parsed.data.bookingRef?.trim() || "";
    const ticketNumberRaw = parsed.data.ticketNumber?.trim() || "";
    const ticketRaw = (parsed.data.ticket || "").trim();

    // --- Primary: single private guest code / link ---
    if (guestCodeRaw) {
      if (isBookingRefInput(guestCodeRaw) || isTicketNumberInput(guestCodeRaw)) {
        return NextResponse.json({ error: NOT_A_PRIVATE_CODE }, { status: 401 });
      }

      const asTicket = extractTicketToken(guestCodeRaw);
      if (asTicket.length >= 16) {
        const attendee = await findAttendeeByTicketToken(asTicket);
        if (attendee) {
          return NextResponse.json(await singleTicketPayload(attendee));
        }
      }

      const asManager = extractManagerToken(guestCodeRaw);
      if (asManager.length >= 16) {
        const partyDash = await partyDashboardForManagerToken(asManager);
        if (partyDash) return NextResponse.json(partyDash);
      }

      return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 401 });
    }

    // --- Legacy Path A: booking ref + access token (full group) ---
    if (bookingRefRaw) {
      if (!accessToken || accessToken.length < 16) {
        return NextResponse.json(
          {
            error: GENERIC_CODE_ERROR,
            needsAccess: true,
            hint: "Use your private guest code alone — a booking reference is not required.",
          },
          { status: 401 },
        );
      }

      const bookingRef = normalizeBookingRef(bookingRefRaw);
      if (!bookingRef) {
        return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 401 });
      }

      const party = await prisma.registrationParty.findFirst({
        where: { bookingRef, managerToken: accessToken },
        select: { id: true },
      });

      if (!party) {
        return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 401 });
      }

      return NextResponse.json(await partyDashboardForId(party.id));
    }

    // --- Legacy Path B: human ticket number + manager access ---
    if (ticketNumberRaw) {
      const ticketNumber = normalizeTicketNumber(ticketNumberRaw);
      if (!ticketNumber || !accessToken || accessToken.length < 16) {
        return NextResponse.json(
          {
            error: NOT_A_PRIVATE_CODE,
            needsAccess: true,
          },
          { status: 401 },
        );
      }

      const party = await prisma.registrationParty.findFirst({
        where: { managerToken: accessToken },
        select: { id: true },
      });
      if (!party) {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 401 });
      }

      const attendee = await prisma.attendee.findFirst({
        where: {
          ticketNumber,
          registrationPartyId: party.id,
          status: { not: "REMOVED" },
        },
        select: attendeeSelect,
      });

      if (!attendee) {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 401 });
      }

      return NextResponse.json(await singleTicketPayload(attendee));
    }

    // --- Path C: opaque ticket token / link ---
    if (ticketRaw) {
      if (isBookingRefInput(ticketRaw) || isTicketNumberInput(ticketRaw)) {
        return NextResponse.json({ error: NOT_A_PRIVATE_CODE }, { status: 401 });
      }
      const token = extractTicketToken(ticketRaw);
      if (token.length < 16) {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 404 });
      }

      const attendee = await findAttendeeByTicketToken(token);
      if (!attendee) {
        // Maybe they pasted a group private guest code into the ticket field.
        const asManager = extractManagerToken(ticketRaw);
        if (asManager.length >= 16) {
          const partyDash = await partyDashboardForManagerToken(asManager);
          if (partyDash) return NextResponse.json(partyDash);
        }
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 404 });
      }

      return NextResponse.json(await singleTicketPayload(attendee));
    }

    // --- Manager / private guest code alone (group) ---
    if (accessToken && accessToken.length >= 16) {
      const partyDash = await partyDashboardForManagerToken(accessToken);
      if (partyDash) return NextResponse.json(partyDash);
      return NextResponse.json({ error: GENERIC_CODE_ERROR }, { status: 401 });
    }

    return NextResponse.json(
      {
        error:
          "Enter your private guest code or paste your ticket / booking link.",
      },
      { status: 400 },
    );
  } catch (err) {
    console.error("booking lookup failed", err);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}

const attendeeSelect = {
  id: true,
  fullName: true,
  status: true,
  ticketNumber: true,
  ticketToken: true,
  votingCredentialPlain: true,
  checkedInAt: true,
  registrationParty: { select: { bookingRef: true } },
} as const;

async function findAttendeeByTicketToken(token: string) {
  const attendee = await prisma.attendee.findUnique({
    where: { ticketToken: token },
    select: attendeeSelect,
  });
  if (!attendee || attendee.status === "REMOVED") return null;
  return attendee;
}

async function partyDashboardForManagerToken(managerToken: string) {
  const party = await prisma.registrationParty.findFirst({
    where: { managerToken },
    select: { id: true },
  });
  if (!party) return null;
  return partyDashboardForId(party.id);
}

async function partyDashboardForId(partyId: string) {
  const dashboard = await buildPartyDashboard(partyId);
  if (!dashboard) return null;
  const { managerToken: _mt, ...safe } = dashboard;
  void _mt;
  return {
    mode: "booking" as const,
    ...safe,
  };
}

async function singleTicketPayload(attendee: AttendeeTicketRow) {
  const event = await getEventConfig();
  const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
  const voteCode = attendee.status === "ISSUED" ? attendee.votingCredentialPlain : null;
  const link =
    attendee.status === "ISSUED"
      ? ticketUrl(baseUrl, attendee.ticketToken, voteCode)
      : null;
  const qr = link ? await qrDataUrl(link) : null;
  const staffRef = fingerprintToken(attendee.ticketToken).toUpperCase().slice(0, 8);

  // Intentionally omit other attendees / manager contact / party tokens.
  return {
    mode: "ticket" as const,
    fullName: attendee.fullName,
    status: attendee.status,
    ticketNumber: attendee.ticketNumber,
    bookingRef: attendee.registrationParty.bookingRef,
    dateLabel: event.dateLabel,
    venueLabel: event.venueLabel,
    checkedInAt: attendee.checkedInAt?.toISOString() || null,
    qr,
    link,
    staffRef,
    votingCredential: voteCode,
  };
}
