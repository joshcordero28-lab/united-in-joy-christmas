import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import {
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
  /** Path A: booking reference (requires accessToken / managerToken). */
  bookingRef: z.string().min(3).max(40).optional(),
  /** Booking access token from the original private link (managerToken). */
  accessToken: z.string().min(16).max(200).optional(),
  /** Alias accepted for accessToken. */
  managerToken: z.string().min(16).max(200).optional(),
  /**
   * Human ticket number (e.g. UIJ2026-00042-01). Sequential / guessable —
   * NEVER sufficient alone. Requires booking accessToken for the same party.
   */
  ticketNumber: z.string().min(8).max(40).optional(),
  /** Opaque ticket token / ticket link (high entropy — bearer credential). */
  ticket: z.string().min(8).max(500).optional(),
});

const GENERIC_BOOKING_ERROR = "Invalid booking reference or access code.";
const GENERIC_TICKET_ERROR = "Ticket not found.";
const TICKET_NUMBER_NEEDS_ACCESS =
  "A ticket number alone cannot open a ticket. Paste your private ticket link, or enter the ticket number with your booking access code.";

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
 * Simplified ticket / booking lookup.
 * - Booking ref alone never returns group details or QRs.
 * - Booking ref + access token → full group dashboard.
 * - Ticket number alone never returns ticket secrets (numbers are guessable).
 * - Ticket number + booking access token → that attendee only.
 * - Opaque ticket token / link → that attendee only (bearer secret).
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

    const accessToken = extractManagerToken(
      parsed.data.accessToken || parsed.data.managerToken || "",
    );
    const bookingRefRaw = parsed.data.bookingRef?.trim() || "";
    const ticketNumberRaw = parsed.data.ticketNumber?.trim() || "";
    const ticketRaw = parsed.data.ticket?.trim() || "";

    // --- Path A: booking ref + access token (full group) ---
    if (bookingRefRaw) {
      if (!accessToken || accessToken.length < 16) {
        return NextResponse.json(
          {
            error: GENERIC_BOOKING_ERROR,
            needsAccess: true,
            hint: "Enter both your booking reference and the private access code from your booking link.",
          },
          { status: 401 },
        );
      }

      const bookingRef = normalizeBookingRef(bookingRefRaw);
      if (!bookingRef) {
        return NextResponse.json({ error: GENERIC_BOOKING_ERROR }, { status: 401 });
      }

      const party = await prisma.registrationParty.findFirst({
        where: { bookingRef, managerToken: accessToken },
        select: { id: true },
      });

      if (!party) {
        return NextResponse.json({ error: GENERIC_BOOKING_ERROR }, { status: 401 });
      }

      const dashboard = await buildPartyDashboard(party.id);
      if (!dashboard) {
        return NextResponse.json({ error: GENERIC_BOOKING_ERROR }, { status: 401 });
      }

      const { managerToken: _mt, ...safe } = dashboard;
      void _mt;

      return NextResponse.json({
        mode: "booking",
        ...safe,
      });
    }

    // --- Path B: human ticket number (requires booking access token) ---
    if (ticketNumberRaw) {
      const ticketNumber = normalizeTicketNumber(ticketNumberRaw);
      if (!ticketNumber) {
        // Do not confirm format vs existence differently from auth failures.
        return NextResponse.json(
          { error: TICKET_NUMBER_NEEDS_ACCESS, needsAccess: true },
          { status: 401 },
        );
      }

      if (!accessToken || accessToken.length < 16) {
        return NextResponse.json(
          { error: TICKET_NUMBER_NEEDS_ACCESS, needsAccess: true },
          { status: 401 },
        );
      }

      const party = await prisma.registrationParty.findFirst({
        where: { managerToken: accessToken },
        select: { id: true, bookingRef: true },
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
        select: {
          id: true,
          fullName: true,
          status: true,
          ticketNumber: true,
          ticketToken: true,
          votingCredentialPlain: true,
          checkedInAt: true,
          registrationParty: { select: { bookingRef: true } },
        },
      });

      if (!attendee) {
        // Uniform failure — wrong number on a valid booking, or cross-booking guess.
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 401 });
      }

      return NextResponse.json(await singleTicketPayload(attendee));
    }

    // --- Path C: opaque ticket token / link (bearer secret) ---
    if (ticketRaw) {
      const token = extractTicketToken(ticketRaw);
      if (token.length < 16) {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 404 });
      }

      const attendee = await prisma.attendee.findUnique({
        where: { ticketToken: token },
        select: {
          id: true,
          fullName: true,
          status: true,
          ticketNumber: true,
          ticketToken: true,
          votingCredentialPlain: true,
          checkedInAt: true,
          registrationParty: { select: { bookingRef: true } },
        },
      });

      if (!attendee || attendee.status === "REMOVED") {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 404 });
      }

      return NextResponse.json(await singleTicketPayload(attendee));
    }

    // Access token alone without booking ref / ticket — do not unlock anything.
    if (accessToken) {
      return NextResponse.json(
        {
          error: GENERIC_BOOKING_ERROR,
          needsAccess: true,
          hint: "Enter your booking reference with the access code, or paste a private ticket link.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        error:
          "Provide a booking reference with access code, a ticket link, or a ticket number with your booking access code.",
      },
      { status: 400 },
    );
  } catch (err) {
    console.error("booking lookup failed", err);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
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
