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
    const [
      registered,
      issued,
      pending,
      revoked,
      checkedIn,
      groupsPending,
      groupsApproved,
      voteCount,
    ] = await Promise.all([
      prisma.attendee.count(),
      prisma.attendee.count({ where: { status: "ISSUED" } }),
      prisma.attendee.count({ where: { status: "PENDING" } }),
      prisma.attendee.count({ where: { status: "REVOKED" } }),
      prisma.attendee.count({ where: { checkedInAt: { not: null } } }),
      prisma.talentGroup.count({ where: { status: "PENDING" } }),
      prisma.talentGroup.count({ where: { status: "APPROVED" } }),
      prisma.audienceVote.count(),
    ]);

    const groups = await prisma.talentGroup.findMany({
      orderBy: [{ performanceOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: { select: { members: true } },
        leader: { select: { fullName: true, status: true } },
        members: {
          include: {
            attendee: { select: { id: true, fullName: true, status: true } },
          },
        },
      },
    });

    return NextResponse.json({
      event,
      counts: {
        registered,
        issued,
        pending,
        revoked,
        checkedIn,
        groupsPending,
        groupsApproved,
        votes: voteCount,
        capacity: event.capacity,
      },
      groups: groups.map((g) => {
        const members = g.members.map((m) => ({
          id: m.attendee.id,
          fullName: m.attendee.fullName,
          status: m.attendee.status,
          verifiedViaTicket: m.verifiedViaTicket,
          ineligible: m.attendee.status !== "ISSUED",
          needsVerification: !m.verifiedViaTicket,
        }));
        return {
          id: g.id,
          groupName: g.groupName,
          performanceTitle: g.performanceTitle,
          talentType: g.talentType,
          status: g.status,
          performanceOrder: g.performanceOrder,
          memberCount: g._count.members,
          leaderName: g.leader.fullName,
          members,
          hasIneligibleMembers: members.some((m) => m.ineligible),
          needsVerificationReview: members.some((m) => m.needsVerification),
        };
      }),
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
