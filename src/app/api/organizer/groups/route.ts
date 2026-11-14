import { NextResponse } from "next/server";
import { z } from "zod";
import { GroupStatus, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

function memberFlags(attendee: {
  status: TicketStatus;
  id: string;
}, verifiedViaTicket: boolean) {
  const eligible = attendee.status === TicketStatus.ISSUED;
  const reasons: string[] = [];
  if (attendee.status === TicketStatus.REVOKED) reasons.push("cancelled");
  if (attendee.status === TicketStatus.REMOVED) reasons.push("removed");
  if (attendee.status === TicketStatus.PENDING) reasons.push("pending approval");
  if (!verifiedViaTicket) reasons.push("legacy — needs verification review");
  return {
    eligible,
    verifiedViaTicket,
    needsVerification: !verifiedViaTicket,
    ineligible: !eligible,
    flags: reasons,
  };
}

export async function GET() {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const groups = await prisma.talentGroup.findMany({
      orderBy: [{ performanceOrder: "asc" }, { createdAt: "asc" }],
      include: {
        leader: { select: { id: true, fullName: true, status: true } },
        members: {
          include: {
            attendee: { select: { id: true, fullName: true, status: true } },
          },
        },
        _count: { select: { votes: true } },
      },
    });

    return NextResponse.json({
      groups: groups.map((g) => {
        const members = g.members.map((m) => {
          const flags = memberFlags(m.attendee, m.verifiedViaTicket);
          return {
            id: m.attendee.id,
            fullName: m.attendee.fullName,
            status: m.attendee.status,
            isLeader: m.attendee.id === g.leaderAttendeeId,
            ...flags,
          };
        });
        return {
          id: g.id,
          groupName: g.groupName,
          performanceTitle: g.performanceTitle,
          talentType: g.talentType,
          status: g.status,
          performanceOrder: g.performanceOrder,
          rejectionNote: g.rejectionNote,
          leader: g.leader,
          members,
          hasIneligibleMembers: members.some((m) => m.ineligible),
          needsVerificationReview: members.some((m) => m.needsVerification),
          needsMemberReview: g.needsMemberReview,
          memberReviewNote: g.memberReviewNote,
          voteCountHidden: true,
        };
      }),
    });
  } catch (err) {
    console.error("organizer groups list failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}

const patchSchema = z.object({
  groupId: z.string().min(1),
  action: z.enum(["approve", "reject", "withdraw", "set_order", "clear_member_review"]),
  performanceOrder: z.number().int().min(1).max(999).optional(),
  rejectionNote: z.string().trim().max(300).optional(),
});

export async function PATCH(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const group = await prisma.talentGroup.findUnique({
      where: { id: parsed.data.groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }

    let status: GroupStatus | undefined;
    let performanceOrder = group.performanceOrder;
    let rejectionNote = group.rejectionNote;
    let clearMemberReview = false;

    if (parsed.data.action === "approve") {
      status = "APPROVED";
      if (performanceOrder == null) {
        const max = await prisma.talentGroup.aggregate({
          _max: { performanceOrder: true },
          where: { status: "APPROVED" },
        });
        performanceOrder = (max._max.performanceOrder || 0) + 1;
      }
      rejectionNote = null;
    } else if (parsed.data.action === "reject") {
      status = "REJECTED";
      rejectionNote = parsed.data.rejectionNote || "Rejected by organizer";
    } else if (parsed.data.action === "withdraw") {
      status = "WITHDRAWN";
    } else if (parsed.data.action === "set_order") {
      if (parsed.data.performanceOrder == null) {
        return NextResponse.json({ error: "performanceOrder required." }, { status: 400 });
      }
      performanceOrder = parsed.data.performanceOrder;
    } else if (parsed.data.action === "clear_member_review") {
      clearMemberReview = true;
    }

    const updated = await prisma.talentGroup.update({
      where: { id: group.id },
      data: {
        ...(status ? { status } : {}),
        performanceOrder,
        rejectionNote,
        ...(clearMemberReview
          ? { needsMemberReview: false, memberReviewNote: null }
          : {}),
      },
    });

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: `talent_group.${parsed.data.action}`,
      entityType: "TalentGroup",
      entityId: group.id,
      detail: `status=${updated.status}; order=${updated.performanceOrder}`,
    });

    return NextResponse.json({ ok: true, group: updated });
  } catch (err) {
    console.error("organizer group patch failed", err);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
