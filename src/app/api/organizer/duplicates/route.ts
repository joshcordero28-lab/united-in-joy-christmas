import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import {
  normalizeEmail,
  normalizeFullName,
  normalizePhone,
} from "@/lib/normalize-contact";

/**
 * Organizer review list of potential duplicate attendees (email/phone clusters).
 * Does not auto-merge or delete. Soft-removed rows are excluded from clusters.
 */
export async function GET() {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const attendees = await prisma.attendee.findMany({
      where: { status: { not: "REMOVED" } },
      orderBy: { registeredAt: "asc" },
      take: 2000,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
        ticketNumber: true,
        checkedInAt: true,
        registrationParty: {
          select: { id: true, bookingRef: true, managerName: true },
        },
        audienceVotes: { select: { id: true, voidedAt: true } },
      },
    });

    type ClusterMember = {
      id: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      status: string;
      ticketNumber: string;
      bookingRef: string;
      managerName: string;
      checkedIn: boolean;
      hasVote: boolean;
    };

    const byEmail = new Map<string, ClusterMember[]>();
    const byPhone = new Map<string, ClusterMember[]>();

    for (const a of attendees) {
      const member: ClusterMember = {
        id: a.id,
        fullName: a.fullName,
        email: a.email,
        phone: a.phone,
        status: a.status,
        ticketNumber: a.ticketNumber,
        bookingRef: a.registrationParty.bookingRef,
        managerName: a.registrationParty.managerName,
        checkedIn: Boolean(a.checkedInAt),
        hasVote: a.audienceVotes.some((v) => !v.voidedAt),
      };
      const em = normalizeEmail(a.email);
      const ph = normalizePhone(a.phone);
      if (em) {
        const list = byEmail.get(em) || [];
        list.push(member);
        byEmail.set(em, list);
      }
      if (ph) {
        const list = byPhone.get(ph) || [];
        list.push(member);
        byPhone.set(ph, list);
      }
    }

    const clusters: {
      key: string;
      kind: "email" | "phone";
      members: ClusterMember[];
    }[] = [];

    for (const [key, members] of byEmail) {
      const distinctParties = new Set(members.map((m) => m.bookingRef));
      // Only flag when the same email appears across distinct bookings.
      if (members.length >= 2 && distinctParties.size >= 2) {
        clusters.push({ key: `email:${key}`, kind: "email", members });
      }
    }
    for (const [key, members] of byPhone) {
      const distinctParties = new Set(members.map((m) => m.bookingRef));
      if (members.length >= 2 && distinctParties.size >= 2) {
        clusters.push({ key: `phone:${key}`, kind: "phone", members });
      }
    }

    return NextResponse.json({
      clusters,
      note: "Review only — do not auto-merge. Preserve check-in and votes when resolving duplicates manually.",
    });
  } catch (err) {
    console.error("duplicates list failed", err);
    return NextResponse.json({ error: "Failed to list duplicates." }, { status: 500 });
  }
}
