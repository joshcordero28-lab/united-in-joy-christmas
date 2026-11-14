import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { attendeeIsEligible } from "@/lib/vote-entitlements";

function maskContact(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.includes("@")) {
    const [user, domain] = v.split("@");
    if (!domain) return "***";
    return `${user.slice(0, 1)}***@${domain}`;
  }
  if (v.length <= 4) return "***";
  return `${"*".repeat(Math.max(v.length - 4, 2))}${v.slice(-4)}`;
}

export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }
    const isOrganizer = session.role === "ORGANIZER";

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const status = searchParams.get("status");
    const checkedIn = searchParams.get("checkedIn");
    const event = await getEventConfig();

    const attendees = await prisma.attendee.findMany({
      where: {
        AND: [
          q
            ? {
                OR: [
                  { fullName: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q, mode: "insensitive" } },
                  {
                    registrationParty: {
                      managerName: { contains: q, mode: "insensitive" },
                    },
                  },
                  {
                    registrationParty: {
                      contactEmail: { contains: q, mode: "insensitive" },
                    },
                  },
                  {
                    registrationParty: {
                      contactPhone: { contains: q, mode: "insensitive" },
                    },
                  },
                ],
              }
            : {},
          status ? { status: status as "ISSUED" | "PENDING" | "REVOKED" } : {},
          checkedIn === "true"
            ? { checkedInAt: { not: null } }
            : checkedIn === "false"
              ? { checkedInAt: null }
              : {},
        ],
      },
      orderBy: { registeredAt: "desc" },
      take: 200,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        status: true,
        registeredAt: true,
        issuedAt: true,
        checkedInAt: true,
        checkInMethod: true,
        registrationPartyId: true,
        registrationParty: {
          select: {
            id: true,
            managerName: true,
            contactPhone: true,
            contactEmail: true,
          },
        },
        audienceVotes: {
          select: {
            id: true,
            castBy: true,
            group: { select: { groupName: true } },
          },
        },
      },
    });

    // Aggregate party-level entitlement counts for organizer view
    const partyIds = [...new Set(attendees.map((a) => a.registrationPartyId))];
    const partyMembers = await prisma.attendee.findMany({
      where: { registrationPartyId: { in: partyIds } },
      select: {
        id: true,
        registrationPartyId: true,
        status: true,
        checkedInAt: true,
        audienceVotes: { select: { id: true } },
      },
    });

    const partyStats = new Map<
      string,
      { eligible: number; used: number; remaining: number; attendeeCount: number }
    >();
    for (const m of partyMembers) {
      const cur = partyStats.get(m.registrationPartyId) || {
        eligible: 0,
        used: 0,
        remaining: 0,
        attendeeCount: 0,
      };
      cur.attendeeCount += 1;
      const eligible = attendeeIsEligible(m, event.votingEnabledAfterCheckIn);
      if (eligible) {
        cur.eligible += 1;
        if (m.audienceVotes.length > 0) cur.used += 1;
        else cur.remaining += 1;
      }
      partyStats.set(m.registrationPartyId, cur);
    }

    return NextResponse.json({
      attendees: attendees.map((a) => {
        const stats = partyStats.get(a.registrationPartyId);
        const vote = a.audienceVotes[0];
        return {
          id: a.id,
          fullName: a.fullName,
          phone: isOrganizer ? a.phone : maskContact(a.phone),
          email: isOrganizer ? a.email : maskContact(a.email),
          status: a.status,
          registeredAt: a.registeredAt,
          issuedAt: a.issuedAt,
          checkedInAt: a.checkedInAt,
          checkInMethod: a.checkInMethod,
          partyId: a.registrationPartyId,
          managerName: a.registrationParty.managerName,
          managerPhone: isOrganizer
            ? a.registrationParty.contactPhone
            : maskContact(a.registrationParty.contactPhone),
          managerEmail: isOrganizer
            ? a.registrationParty.contactEmail
            : maskContact(a.registrationParty.contactEmail),
          partyEligible: stats?.eligible ?? 0,
          partyUsed: stats?.used ?? 0,
          partyRemaining: stats?.remaining ?? 0,
          partyAttendeeCount: stats?.attendeeCount ?? 1,
          voteCastBy: vote?.castBy ?? null,
          voteGroupName: vote?.group.groupName ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("attendees list failed", err);
    return NextResponse.json({ error: "Failed to list attendees." }, { status: 500 });
  }
}
