import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { extractTicketToken } from "@/lib/tickets";

const registerSchema = z.object({
  leaderTicketToken: z.string().min(8).max(500),
  groupName: z.string().trim().min(2).max(80),
  performanceTitle: z.string().trim().min(2).max(120),
  talentType: z.string().trim().min(2).max(80),
  /// Ticket links or opaque codes for all members (leader may be omitted and is added automatically).
  memberTicketTokens: z.array(z.string().min(8).max(500)).min(1).max(20),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const forVoting = searchParams.get("forVoting") === "true";

  // Ballot listing for attendees is only via /api/vote after reveal — never here.
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
      _count: { select: { votes: true } },
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
      // Vote totals only exposed when caller is organizer (separate endpoint) or revealed — omit here.
    })),
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

    const tokens = Array.from(
      new Set(
        [parsed.data.leaderTicketToken, ...parsed.data.memberTicketTokens]
          .map(extractTicketToken)
          .filter((t) => t.length >= 16),
      ),
    );
    if (tokens.length === 0) {
      return NextResponse.json(
        { error: "Provide valid ticket links for the leader and members." },
        { status: 400 },
      );
    }
    const leaderToken = extractTicketToken(parsed.data.leaderTicketToken);

    const result = await prisma.$transaction(async (tx) => {
      const attendees = await tx.attendee.findMany({
        where: { ticketToken: { in: tokens }, status: "ISSUED" },
      });
      if (attendees.length !== tokens.length) {
        return {
          status: 400 as const,
          error: "Every member must be a registered attendee with an issued ticket.",
        };
      }

      const byToken = Object.fromEntries(attendees.map((a) => [a.ticketToken, a]));
      const leader = byToken[leaderToken];
      if (!leader) {
        return { status: 401 as const, error: "Leader ticket invalid." };
      }

      // Reject if any member already in a group
      const already = await tx.talentGroupMember.findMany({
        where: { attendeeId: { in: attendees.map((a) => a.id) } },
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
            create: attendees.map((a) => ({ attendeeId: a.id })),
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
      detail: result.group.groupName,
    });

    return NextResponse.json({
      ok: true,
      groupId: result.group.id,
      status: result.group.status,
      groupName: result.group.groupName,
      memberCount: result.group.members.length,
    });
  } catch (err) {
    console.error("group register failed", err);
    return NextResponse.json({ error: "Group registration failed." }, { status: 500 });
  }
}
