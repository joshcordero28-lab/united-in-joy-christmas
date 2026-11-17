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
  /** Path B: individual ticket number (e.g. UIJ2026-00042-01). */
  ticketNumber: z.string().min(8).max(40).optional(),
  /** Path B alt: opaque ticket token / ticket link. */
  ticket: z.string().min(8).max(500).optional(),
});

const GENERIC_BOOKING_ERROR = "Invalid booking reference or access code.";
const GENERIC_TICKET_ERROR = "Ticket not found.";

/**
 * Simplified ticket / booking lookup.
 * - Booking ref alone never returns group details or QRs.
 * - Booking ref + access token → full group dashboard.
 * - Ticket number / ticket token → that attendee only (no other PII).
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

    // --- Path A: booking ref + access token ---
    if (bookingRefRaw || accessToken) {
      if (!bookingRefRaw || !accessToken) {
        // Do not confirm whether the booking ref exists.
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
      if (!bookingRef || accessToken.length < 16) {
        return NextResponse.json({ error: GENERIC_BOOKING_ERROR }, { status: 401 });
      }

      const party = await prisma.registrationParty.findFirst({
        where: { bookingRef, managerToken: accessToken },
        select: { id: true },
      });

      if (!party) {
        // Uniform failure — prevents booking-ref / token enumeration.
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

    // --- Path B: individual ticket number ---
    if (ticketNumberRaw) {
      const ticketNumber = normalizeTicketNumber(ticketNumberRaw);
      if (!ticketNumber) {
        return NextResponse.json({ error: GENERIC_TICKET_ERROR }, { status: 404 });
      }

      const attendee = await prisma.attendee.findUnique({
        where: { ticketNumber },
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

    // --- Path B alt: opaque ticket / link ---
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

    return NextResponse.json(
      {
        error:
          "Provide a booking reference with access code, or an individual ticket number / ticket link.",
      },
      { status: 400 },
    );
  } catch (err) {
    console.error("booking lookup failed", err);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}

async function singleTicketPayload(attendee: {
  id: string;
  fullName: string;
  status: string;
  ticketNumber: string;
  ticketToken: string;
  votingCredentialPlain: string | null;
  checkedInAt: Date | null;
  registrationParty: { bookingRef: string };
}) {
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
