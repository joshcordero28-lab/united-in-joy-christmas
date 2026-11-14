import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { parseAppTicketCredential } from "@/lib/tickets";
import { TicketStatus } from "@prisma/client";

const MAX_MEMBERS = 3;

const registerSchema = z.object({
  groupName: z.string().trim().min(2).max(80),
  performanceTitle: z.string().trim().min(2).max(120),
  talentType: z.string().trim().min(2).max(80),
  /// Leader proves registration with their entry ticket (QR / link / opaque code).
  leaderTicket: z.string().min(8).max(500),
  /**
   * Partner tickets (QR / link / code). Each must resolve to a distinct ISSUED attendee.
   * Free-text names are not accepted.
   */
  partnerTickets: z.array(z.string().min(1).max(500)).max(MAX_MEMBERS - 1).default([]),
  /**
   * Partners selected from the leader’s registration party (same RegistrationParty).
   * Requires matching managerToken — ticket alone cannot list or enroll party mates by id.
   */
  partnerAttendeeIds: z.array(z.string().min(1).max(64)).max(MAX_MEMBERS - 1).default([]),
  managerToken: z.string().min(16).max(200).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forVoting = searchParams.get("forVoting") === "true";

  if (forVoting) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Public list: approved acts only — no attendee ids, contacts, or member rosters.
  const groups = await prisma.talentGroup.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ performanceOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      groupName: true,
      performanceTitle: true,
      talentType: true,
      status: true,
      performanceOrder: true,
    },
  });

  return NextResponse.json({
    groups,
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
        { error: "Invalid group registration. Every member needs a verified event ticket." },
        { status: 400 },
      );
    }

    // Reject free-text name bypass fields if a client sends them.
    if (
      body &&
      typeof body === "object" &&
      ("memberNames" in body || "partnerNames" in body || "names" in body)
    ) {
      return NextResponse.json(
        { error: "Members must be verified with event tickets, not typed names." },
        { status: 400 },
      );
    }

    const leaderToken = parseAppTicketCredential(parsed.data.leaderTicket);
    if (leaderToken.length < 16) {
      return NextResponse.json(
        {
          error: "Verify the group leader with a valid event ticket first.",
          registerUrl: "/register",
        },
        { status: 401 },
      );
    }

    const rawPartnerTokens = parsed.data.partnerTickets
      .map((t) => parseAppTicketCredential(t))
      .filter((t) => t.length >= 16);
    const partnerTokens = Array.from(new Set(rawPartnerTokens));
    if (rawPartnerTokens.length !== partnerTokens.length) {
      return NextResponse.json(
        { error: "The same attendee cannot appear twice in one entry." },
        { status: 400 },
      );
    }

    const rawPartnerAttendeeIds = parsed.data.partnerAttendeeIds;
    const partnerAttendeeIds = Array.from(new Set(rawPartnerAttendeeIds));
    if (rawPartnerAttendeeIds.length !== partnerAttendeeIds.length) {
      return NextResponse.json(
        { error: "The same attendee cannot appear twice in one entry." },
        { status: 400 },
      );
    }
    if (partnerAttendeeIds.length > 0 && !parsed.data.managerToken) {
      return NextResponse.json(
        {
          error:
            "Selecting partners from your registration requires the private management link.",
        },
        { status: 401 },
      );
    }

    if (partnerTokens.length + partnerAttendeeIds.length > MAX_MEMBERS - 1) {
      return NextResponse.json(
        { error: `Groups are limited to ${MAX_MEMBERS} members (including you).` },
        { status: 400 },
      );
    }
    if (partnerTokens.includes(leaderToken)) {
      return NextResponse.json(
        { error: "Do not add the leader’s ticket as a partner." },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const leader = await tx.attendee.findUnique({
        where: { ticketToken: leaderToken },
        select: {
          id: true,
          fullName: true,
          status: true,
          registrationPartyId: true,
        },
      });
      if (!leader) {
        return {
          status: 401 as const,
          error: "No registration found for the leader ticket. Register for the event first.",
          registerUrl: "/register" as const,
        };
      }
      if (leader.status === TicketStatus.PENDING) {
        return {
          status: 403 as const,
          error: "The leader ticket is still pending approval.",
          registerUrl: "/register" as const,
        };
      }
      if (leader.status === TicketStatus.REMOVED) {
        return {
          status: 403 as const,
          error: "This registration was removed and cannot lead a talent group.",
          registerUrl: "/register" as const,
        };
      }
      if (leader.status === TicketStatus.REVOKED) {
        return {
          status: 403 as const,
          error: "The leader ticket has been cancelled.",
          registerUrl: "/register" as const,
        };
      }
      if (leader.status !== TicketStatus.ISSUED) {
        return {
          status: 403 as const,
          error: "The leader ticket is not eligible.",
          registerUrl: "/register" as const,
        };
      }

      const partnersFromTickets =
        partnerTokens.length === 0
          ? []
          : await tx.attendee.findMany({
              where: { ticketToken: { in: partnerTokens } },
              select: {
                id: true,
                fullName: true,
                status: true,
                ticketToken: true,
              },
            });

      if (partnersFromTickets.length !== partnerTokens.length) {
        return {
          status: 400 as const,
          error: "Every partner ticket must match a registered attendee.",
          registerUrl: "/register" as const,
        };
      }
      for (const p of partnersFromTickets) {
        if (p.status !== TicketStatus.ISSUED) {
          return {
            status: 400 as const,
            error: `Partner “${p.fullName}” does not have an active issued ticket.`,
            registerUrl: "/register" as const,
          };
        }
      }

      let partnersFromParty: { id: string; fullName: string; status: TicketStatus }[] = [];
      if (partnerAttendeeIds.length > 0) {
        const managerToken = parsed.data.managerToken!;
        const party = await tx.registrationParty.findUnique({
          where: { managerToken },
          select: { id: true },
        });
        if (!party || party.id !== leader.registrationPartyId) {
          return {
            status: 401 as const,
            error:
              "Management credential does not match this leader’s registration. Verify partners with their tickets instead.",
          };
        }
        partnersFromParty = await tx.attendee.findMany({
          where: {
            id: { in: partnerAttendeeIds },
            registrationPartyId: leader.registrationPartyId,
          },
          select: { id: true, fullName: true, status: true },
        });
        if (partnersFromParty.length !== partnerAttendeeIds.length) {
          return {
            status: 400 as const,
            error:
              "Party partners must belong to the leader’s registration. Verify each person with their own ticket instead.",
          };
        }
      }
      for (const p of partnersFromParty) {
        if (p.status !== TicketStatus.ISSUED) {
          return {
            status: 400 as const,
            error: `“${p.fullName}” is not an active issued attendee.`,
            registerUrl: "/register" as const,
          };
        }
        if (p.id === leader.id) {
          return {
            status: 400 as const,
            error: "Do not add the leader again as a partner.",
          };
        }
      }

      const partnerIds = [
        ...partnersFromTickets.map((p) => p.id),
        ...partnersFromParty.map((p) => p.id),
      ];
      if (new Set(partnerIds).size !== partnerIds.length) {
        return {
          status: 400 as const,
          error: "The same attendee cannot appear twice in one entry.",
        };
      }
      if (partnerIds.includes(leader.id)) {
        return {
          status: 400 as const,
          error: "The same attendee cannot appear twice in one entry.",
        };
      }
      if (partnerIds.length > MAX_MEMBERS - 1) {
        return {
          status: 400 as const,
          error: `Groups are limited to ${MAX_MEMBERS} members (including you).`,
        };
      }

      const memberIds = [leader.id, ...partnerIds];

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

      const now = new Date();
      const group = await tx.talentGroup.create({
        data: {
          groupName: parsed.data.groupName,
          performanceTitle: parsed.data.performanceTitle,
          talentType: parsed.data.talentType,
          leaderAttendeeId: leader.id,
          status: "PENDING",
          members: {
            create: memberIds.map((attendeeId) => ({
              attendeeId,
              verifiedViaTicket: true,
              createdAt: now,
            })),
          },
        },
        include: {
          members: { include: { attendee: { select: { fullName: true } } } },
        },
      });

      return { status: 200 as const, group, leaderName: leader.fullName };
    });

    if (result.status !== 200) {
      return NextResponse.json(
        {
          error: result.error,
          ...("registerUrl" in result && result.registerUrl
            ? { registerUrl: result.registerUrl }
            : {}),
        },
        { status: result.status },
      );
    }

    await writeAudit({
      actorLabel: result.leaderName,
      action: "talent_group.register",
      entityType: "TalentGroup",
      entityId: result.group.id,
      detail: `members=${result.group.members.length};verified=ticket`,
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
