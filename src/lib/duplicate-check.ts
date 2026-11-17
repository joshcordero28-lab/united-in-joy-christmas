import { prisma } from "@/lib/db";
import {
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
} from "@/lib/normalize-contact";

export type DuplicateSignal =
  | "email"
  | "phone"
  | "email_and_name"
  | "phone_and_name";

export type DuplicateCheckResult = {
  possibleDuplicate: boolean;
  /** Present only when a match is found — never includes booking refs, tokens, or other guests' PII. */
  matchKind?: DuplicateSignal;
};

type ContactInput = {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  attendeeNames?: string[];
};

/**
 * Server-side likely-duplicate detection.
 * Name alone is never definitive. Email/phone matches (optionally reinforced by name) flag a warning.
 * Does not return any private booking or ticket material.
 */
export async function findPossibleDuplicate(
  input: ContactInput,
): Promise<DuplicateCheckResult> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const names = new Set<string>();
  const primary = normalizeFullName(input.fullName);
  if (primary.length >= 2) names.add(primary);
  for (const n of input.attendeeNames || []) {
    const nn = normalizeFullName(n);
    if (nn.length >= 2) names.add(nn);
  }

  if (!email && !phone) {
    return { possibleDuplicate: false };
  }

  let emailHit = false;
  let phoneHit = false;
  let nameReinforced = false;

  const consider = (row: {
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) => {
    const rowEmail = normalizeEmail(row.email);
    const rowPhone = normalizePhone(row.phone);
    const rowName = normalizeFullName(row.fullName);
    if (email && rowEmail && rowEmail === email) {
      emailHit = true;
      if (rowName && names.has(rowName)) nameReinforced = true;
    }
    if (phone && rowPhone && rowPhone === phone) {
      phoneHit = true;
      if (rowName && names.has(rowName)) nameReinforced = true;
    }
  };

  if (email) {
    const byEmailParties = await prisma.registrationParty.findMany({
      where: { contactEmail: { equals: email, mode: "insensitive" } },
      select: {
        managerName: true,
        contactEmail: true,
        contactPhone: true,
        attendees: {
          where: { status: { not: "REMOVED" } },
          select: { fullName: true, email: true, phone: true },
        },
      },
      take: 50,
    });
    for (const p of byEmailParties) {
      consider({
        fullName: p.managerName,
        email: p.contactEmail,
        phone: p.contactPhone,
      });
      for (const a of p.attendees) consider(a);
    }

    const byEmailAttendees = await prisma.attendee.findMany({
      where: {
        status: { not: "REMOVED" },
        email: { equals: email, mode: "insensitive" },
      },
      select: { fullName: true, email: true, phone: true },
      take: 50,
    });
    for (const a of byEmailAttendees) consider(a);
  }

  if (phone) {
    // Scan recent parties/attendees with phones and normalize (formatted storage).
    const partyPhones = await prisma.registrationParty.findMany({
      where: { contactPhone: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        managerName: true,
        contactEmail: true,
        contactPhone: true,
        attendees: {
          where: { status: { not: "REMOVED" } },
          select: { fullName: true, email: true, phone: true },
        },
      },
      take: 800,
    });
    for (const p of partyPhones) {
      consider({
        fullName: p.managerName,
        email: p.contactEmail,
        phone: p.contactPhone,
      });
      for (const a of p.attendees) consider(a);
    }

    const attendeePhones = await prisma.attendee.findMany({
      where: { status: { not: "REMOVED" }, phone: { not: null } },
      orderBy: { registeredAt: "desc" },
      select: { fullName: true, email: true, phone: true },
      take: 800,
    });
    for (const a of attendeePhones) consider(a);
  }

  if (!emailHit && !phoneHit) {
    return { possibleDuplicate: false };
  }

  if (emailHit && nameReinforced) {
    return { possibleDuplicate: true, matchKind: "email_and_name" };
  }
  if (phoneHit && nameReinforced) {
    return { possibleDuplicate: true, matchKind: "phone_and_name" };
  }
  if (emailHit) {
    return { possibleDuplicate: true, matchKind: "email" };
  }
  return { possibleDuplicate: true, matchKind: "phone" };
}
