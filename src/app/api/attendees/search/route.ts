import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getStaffSession, requireStaff } from "@/lib/session";

function maskContact(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.includes("@")) {
    const [user, domain] = v.split("@");
    if (!domain) return "***";
    const u = user.slice(0, 1) + "***";
    return `${u}@${domain}`;
  }
  if (v.length <= 4) return "***";
  return `${"*".repeat(Math.max(v.length - 4, 2))}${v.slice(-4)}`;
}

/**
 * Staff-only search of issued attendees (organizer tooling).
 * Does not expose ticket tokens.
 */
export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const ip = clientIp(request);
    const limited = await rateLimit(`attendee-search:${session.staffId}:${ip}`, 40, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many searches." }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (q.length < 2) {
      return NextResponse.json({ attendees: [] });
    }

    const attendees = await prisma.attendee.findMany({
      where: {
        status: "ISSUED",
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { fullName: "asc" },
      take: 12,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
      },
    });

    const busy = await prisma.talentGroupMember.findMany({
      where: { attendeeId: { in: attendees.map((a) => a.id) } },
      select: { attendeeId: true },
    });
    const busyIds = new Set(busy.map((b) => b.attendeeId));

    return NextResponse.json({
      attendees: attendees
        .filter((a) => !busyIds.has(a.id))
        .map((a) => ({
          id: a.id,
          fullName: a.fullName,
          contactHint: maskContact(a.email) || maskContact(a.phone),
        })),
    });
  } catch (err) {
    console.error("attendee search failed", err);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
