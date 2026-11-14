import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";

export async function GET() {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const event = await getEventConfig();
    const [registered, issued, pending, revoked, checkedIn, competitionCount, voteCount] =
      await Promise.all([
        prisma.attendee.count(),
        prisma.attendee.count({ where: { status: "ISSUED" } }),
        prisma.attendee.count({ where: { status: "PENDING" } }),
        prisma.attendee.count({ where: { status: "REVOKED" } }),
        prisma.attendee.count({ where: { checkedInAt: { not: null } } }),
        prisma.competitionEntry.count(),
        prisma.vote.count(),
      ]);

    const competitions = await prisma.competition.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { entries: true } } },
    });

    return NextResponse.json({
      event,
      counts: {
        registered,
        issued,
        pending,
        revoked,
        checkedIn,
        competitionEntries: competitionCount,
        votes: voteCount,
        capacity: event.capacity,
      },
      competitions: competitions.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        entryCount: c._count.entries,
        maxEntries: c.maxEntries,
        isOpen: c.isOpen,
      })),
      staff: {
        displayName: session.displayName,
        role: session.role,
      },
    });
  } catch (err) {
    console.error("dashboard failed", err);
    return NextResponse.json({ error: "Failed to load dashboard." }, { status: 500 });
  }
}
