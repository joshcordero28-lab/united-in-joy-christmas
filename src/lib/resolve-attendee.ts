import { prisma } from "@/lib/db";
import { normalizeTicketNumber } from "@/lib/booking-ref";
import { parseAppTicketCredential } from "@/lib/tickets";

export type AttendeeResolution =
  | { ok: true; attendeeId: string; ticketToken: string; ticketNumber: string }
  | { ok: false; reason: "invalid" | "not_found" };

/**
 * Resolve an attendee from either an opaque ticket link/token OR a printed
 * ticket number (UIJ2026-#####-NN). Booking refs alone are never resolved here
 * (ambiguous for groups). Callers must enforce their own authorization
 * (staff session, voting credential, manager token, etc.).
 */
export async function resolveAttendeeByCredential(
  raw: string,
): Promise<AttendeeResolution> {
  const input = (raw || "").trim();
  if (!input) return { ok: false, reason: "invalid" };

  const ticketNumber = normalizeTicketNumber(input);
  if (ticketNumber) {
    const row = await prisma.attendee.findUnique({
      where: { ticketNumber },
      select: { id: true, ticketToken: true, ticketNumber: true },
    });
    if (!row) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      attendeeId: row.id,
      ticketToken: row.ticketToken,
      ticketNumber: row.ticketNumber,
    };
  }

  const token = parseAppTicketCredential(input);
  if (token.length < 16) return { ok: false, reason: "invalid" };

  const row = await prisma.attendee.findUnique({
    where: { ticketToken: token },
    select: { id: true, ticketToken: true, ticketNumber: true },
  });
  if (!row) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    attendeeId: row.id,
    ticketToken: row.ticketToken,
    ticketNumber: row.ticketNumber,
  };
}
