import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { extractTicketToken } from "@/lib/tickets";

const MAX_MEMBERS = 2;

const registerSchema = z.object({
  groupName: z.string().trim().min(2).max(80),
  performanceTitle: z.string().trim().min(2).max(120),
  talentType: z.string().trim().min(2).max(80),
  /// Leader proves identity with their entry ticket (from device session / localStorage).
  leaderTicket: z.string().min(8).max(500),
  /// Selected member attendee ids — 1 or 2 total; leader must be included.
  memberAttendeeIds: z.array(z.string().min(1)).min(1).max(MAX_MEMBERS),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const forVoting = searchParams.get("forVoting") === "true";

  if (forVoting) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const groups = await prisma.talentGroup.findMany({
    where: status
      ? { status: status as "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" }
      : { status: "APPROVED" },
    orderBy: [{ performanceOrder: "asc" }, { createdAt: "asc" }],
    include: {
      leader: { select: { id: true, fullName: true } },
      members: {
        include: { attendee: { select: { id: true, fullName: true } } },
      },
    },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      groupName: g.groupName,
      performanceTitle: g.performanceTitle,
      talentType: g.talentType,
      status: g.status,
      performanceOrder: g.performanceOrder,
      leader: g.leader,
      members: g.members.map((m) => ({
        id: m.attendee.id,
        fullName: m.attendee.fullName,
      })),
    })),
    maxMembers: MAX_MEMBERS,
  });
}

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`group-register:${ip}`, 10, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid group registration.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const memberIds = Array.from(new Set(parsed.data.memberAttendeeIds));
    if (memberIds.length < 1 || memberIds.length > MAX_MEMBERS) {
      return NextResponse.json(
        { error: `A group must have 1–${MAX_MEMBERS} members.` },
        { status: 400 },
      );
    }

    const leaderToken = extractTicketToken(parsed.data.leaderTicket);
    if (leaderToken.length < 16) {
      return NextResponse.json(
        { error: "Open your entry ticket on this device first, then try again." },
        { status: 401 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const leader = await tx.attendee.findUnique({
        where: { ticketToken: leaderToken },
      });
      if (!leader || leader.status !== "ISSUED") {
        return {
          status: 401 as const,
          error: "Open your entry ticket on this device first, then try again.",
        };
      }
      if (!memberIds.includes(leader.id)) {
        return {
          status: 400 as const,
          error: "The group leader must be included as one of the members.",
        };
      }

      const attendees = await tx.attendee.findMany({
        where: { id: { in: memberIds }, status: "ISSUED" },
      });
      if (attendees.length !== memberIds.length) {
        return {
          status: 400 as const,
          error: "Every member must be a registered guest with an issued ticket.",
        };
      }

      const already = await tx.talentGroupMember.findMany({
        where: { attendeeId: { in: memberIds } },
        include: { group: { select: { groupName: true } } },
      });
      if (already.length > 0) {
        return {
          status: 409 as const,
          error: `Already in a group: ${already.map((m) => m.group.groupName).join(", ")}`,
        };
      }

      const group = await tx.talentGroup.create({
        data: {
          groupName: parsed.data.groupName,
          performanceTitle: parsed.data.performanceTitle,
          talentType: parsed.data.talentType,
          leaderAttendeeId: leader.id,
          status: "PENDING",
          members: {
            create: memberIds.map((attendeeId) => ({ attendeeId })),
          },
        },
        include: {
          members: { include: { attendee: { select: { fullName: true } } } },
        },
      });

      return { status: 200 as const, group, leaderName: leader.fullName };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await writeAudit({
      actorLabel: result.leaderName,
      action: "talent_group.register",
      entityType: "TalentGroup",
      entityId: result.group.id,
      detail: `${result.group.groupName} (${result.group.members.length} members)`,
    });

    return NextResponse.json({
      ok: true,
      groupId: result.group.id,
      status: result.group.status,
      groupName: result.group.groupName,
      memberCount: result.group.members.length,
      maxMembers: MAX_MEMBERS,
    });
  } catch (err) {
    console.error("group register failed", err);
    return NextResponse.json({ error: "Group registration failed." }, { status: 500 });
  }
}
