/** Human-readable booking / ticket identifiers for United in Joy Christmas 2026. */

export const BOOKING_REF_PREFIX = "UIJ2026-";
const BOOKING_REF_RE = /^UIJ2026-\d{5}$/i;
const TICKET_NUMBER_RE = /^UIJ2026-\d{5}-\d{2}$/i;

/** Normalize user input to canonical booking ref (e.g. UIJ2026-00042). */
export function normalizeBookingRef(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return null;
  // Accept "UIJ2026-42", "uij2026-00042", or bare "00042" / "42"
  let candidate = raw;
  if (/^\d{1,5}$/.test(raw)) {
    candidate = `${BOOKING_REF_PREFIX}${raw.padStart(5, "0")}`;
  } else if (/^UIJ2026-\d{1,5}$/i.test(raw)) {
    const digits = raw.slice(BOOKING_REF_PREFIX.length);
    candidate = `${BOOKING_REF_PREFIX}${digits.padStart(5, "0")}`;
  }
  if (!BOOKING_REF_RE.test(candidate)) return null;
  return candidate;
}

/** Normalize ticket number (e.g. UIJ2026-00042-01). */
export function normalizeTicketNumber(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return null;
  if (!TICKET_NUMBER_RE.test(raw)) return null;
  return raw;
}

export function formatBookingRef(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99999) {
    throw new Error("Booking sequence out of range");
  }
  return `${BOOKING_REF_PREFIX}${String(sequence).padStart(5, "0")}`;
}

export function formatTicketNumber(bookingRef: string, indexWithinParty: number): string {
  const ref = normalizeBookingRef(bookingRef);
  if (!ref) throw new Error("Invalid booking ref");
  if (!Number.isInteger(indexWithinParty) || indexWithinParty < 1 || indexWithinParty > 99) {
    throw new Error("Ticket index out of range");
  }
  return `${ref}-${String(indexWithinParty).padStart(2, "0")}`;
}

/** Extract booking ref from a ticket number, if valid. */
export function bookingRefFromTicketNumber(ticketNumber: string): string | null {
  const tn = normalizeTicketNumber(ticketNumber);
  if (!tn) return null;
  return tn.slice(0, BOOKING_REF_PREFIX.length + 5);
}

/**
 * Next sequential booking ref. Call inside a transaction that already serializes
 * registrations (e.g. FOR UPDATE on EventConfig) so concurrent creates cannot collide.
 */
export async function nextBookingRef(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { $queryRaw: (...args: any[]) => Promise<unknown> },
): Promise<string> {
  const rows = (await tx.$queryRaw`
    SELECT "bookingRef" AS ref
    FROM "RegistrationParty"
    WHERE "bookingRef" ~ '^UIJ2026-[0-9]{5}$'
    ORDER BY "bookingRef" DESC
    LIMIT 1
  `) as { ref: string }[];

  const last = rows[0]?.ref;
  let next = 1;
  if (last) {
    const n = Number.parseInt(last.slice(BOOKING_REF_PREFIX.length), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  return formatBookingRef(next);
}
