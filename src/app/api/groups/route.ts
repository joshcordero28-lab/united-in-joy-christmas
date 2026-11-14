import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { extractTicketToken } from "@/lib/tickets";

const MAX_MEMBERS = 3;

const registerSchema = z.object({
  groupName: z.string().trim().min(2).max(80),
  performanceTitle: z.string().trim().min(2).max(120),
  talentType: z.string().trim().min(2).max(80),
  /// Leader proves identity with their entry ticket (from device session / localStorage).
  leaderTicket: z.string().min(8).max(500),
  /**
   * Partner entry tickets (not attendee ids). Each partner must consent by sharing
   * their own ticket link/code. Leader is added automatically — do not include them here.
   */
  partnerTickets: z.array(z.string().min(8).max(500)).max(MAX_MEMBERS - 1).default([]),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forVoting = searchParams.get("forVoting") === "true";

  if (forVoting) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Public list is APPROVED only. Status filters / pending groups require staff
  // (use /api/organizer/groups). Never expose attendee ids on this public route.
  const groups = await prisma.talentGroup.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ performanceOrder: "asc" }, { createdAt: "asc" }],
    include: {
      leader: { select: { fullName: true } },
      members: {
        include: { attendee: { select: { fullName: true } } },
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
      leader: { fullName: g.leader.fullName },
      members: g.members.map((m) => ({
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

    const leaderToken = extractTicketToken(parsed.data.leaderTicket);
    if (leaderToken.length < 16) {
      return NextResponse.json(
        { error: "Open your entry ticket on this device first, then try again." },
        { status: 401 },
      );
    }

    const partnerTokens = Array.from(
      new Set(
        parsed.data.partnerTickets
          .map((t) => extractTicketToken(t))
          .filter((t) => t.length >= 16),
      ),
    );
    if (partnerTokens.length > MAX_MEMBERS - 1) {
      return NextResponse.json(
        { error: `Groups are limited to ${MAX_MEMBERS} members (including you).` },
        { status: 400 },
      );
    }
    if (partnerTokens.includes(leaderToken)) {
      return NextResponse.json(
        { error: "Do not add your own ticket as a partner." },
        { status: 400 },
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

      const partners =
        partnerTokens.length === 0
          ? []
          : await tx.attendee.findMany({
              where: { ticketToken: { in: partnerTokens }, status: "ISSUED" },
            });
      if (partners.length !== partnerTokens.length) {
        return {
          status: 400 as const,
          error: "Every partner must share a valid issued entry ticket.",
        };
      }

      const memberIds = [leader.id, ...partners.map((p) => p.id)];

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
