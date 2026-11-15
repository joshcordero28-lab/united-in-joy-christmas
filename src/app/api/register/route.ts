import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import {
  generateOpaqueToken,
  generateVotingCredential,
  hashVotingCredential,
} from "@/lib/crypto";
import { clientIp, rateLimit, rateLimitConsume } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { TicketStatus } from "@prisma/client";

/** Hard cap per registration submission (also enforced in UI). */
const MAX_ATTENDEES_PER_REGISTRATION = 8;

const attendeeSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
});

const schema = z.object({
  /** Primary registrant / registration manager. */
  managerName: z.string().trim().min(2).max(80).optional(),
  /** Legacy solo field — used as manager name and sole attendee when `attendees` omitted. */
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  /**
   * Ticket holders only. Manager is an attendee only when listed here.
   * Omit for legacy solo registration (manager = sole attendee).
   */
  attendees: z.array(attendeeSchema).min(1).max(MAX_ATTENDEES_PER_REGISTRATION).optional(),
  /** Honeypot — must stay empty. */
  company: z.string().max(200).optional().or(z.literal("")),
});

function resolveNames(data: z.infer<typeof schema>): {
  managerName: string;
  attendeeNames: string[];
} | null {
  const managerName = (data.managerName || data.fullName || "").trim();
  if (managerName.length < 2) return null;

  if (data.attendees && data.attendees.length > 0) {
    return {
      managerName,
      attendeeNames: data.attendees.map((a) => a.fullName.trim()),
    };
  }

  // Legacy / solo: one attendee who is the manager.
  return { managerName, attendeeNames: [managerName] };
}

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`register:${ip}`, 5, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }
    const daily = await rateLimit(`register-day:${ip}`, 12, 24 * 60 * 60 * 1000);
    if (!daily.ok) {
      return NextResponse.json(
        { error: "Daily registration limit reached for this network. Try again tomorrow." },
        { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid registration details." }, { status: 400 });
    }
    if (parsed.data.company && parsed.data.company.trim() !== "") {
      return NextResponse.json({
        partyId: "ok",
        managerName: parsed.data.managerName || parsed.data.fullName,
        status: "ISSUED",
        managerToken: null,
        attendees: [],
        message: "Registration complete.",
      });
    }

    const resolved = resolveNames(parsed.data);
    if (!resolved) {
      return NextResponse.json({ error: "Invalid registration details." }, { status: 400 });
    }
    const { managerName, attendeeNames } = resolved;

    if (attendeeNames.length < 1) {
      return NextResponse.json(
        { error: "Add at least one attendee to receive a ticket." },
        { status: 400 },
      );
    }
    if (attendeeNames.length > MAX_ATTENDEES_PER_REGISTRATION) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ATTENDEES_PER_REGISTRATION} attendees per registration.` },
        { status: 400 },
      );
    }

    // Cap seats created per network per day (separate from request count).
    const seats = await rateLimitConsume(
      `register-seats:${ip}`,
      attendeeNames.length,
      24,
      24 * 60 * 60 * 1000,
    );
    if (!seats.ok) {
      return NextResponse.json(
        {
          error:
            "Daily ticket limit reached for this network. Try again tomorrow or register fewer people.",
        },
        { status: 429, headers: { "Retry-After": String(seats.retryAfterSeconds) } },
      );
    }

    const event = await getEventConfig();
    if (!event.registrationOpen) {
      return NextResponse.json({ error: "Registration is closed." }, { status: 403 });
    }

    const status = event.requireApproval ? TicketStatus.PENDING : TicketStatus.ISSUED;
    const managerToken = generateOpaqueToken(32);

    let created: {
      party: { id: string; managerName: string };
      attendeeRows: {
        id: string;
        fullName: string;
        status: TicketStatus;
        ticketToken: string | null;
        votingCredential: string | null;
      }[];
    };

    try {
      created = await prisma.$transaction(async (tx) => {
        // Serialize capacity checks against concurrent registrations.
        await tx.$executeRaw`SELECT id FROM "EventConfig" WHERE id = 'default' FOR UPDATE`;
        const cfg = await tx.eventConfig.findUnique({ where: { id: "default" } });
        const capacity = cfg?.capacity ?? event.capacity;
        const issuedCount = await tx.attendee.count({
          where: { status: { in: [TicketStatus.ISSUED, TicketStatus.PENDING] } },
        });
        if (issuedCount + attendeeNames.length > capacity) {
          throw Object.assign(
            new Error(
              `Not enough capacity for ${attendeeNames.length} attendee(s). ${Math.max(0, capacity - issuedCount)} spot(s) left.`,
            ),
            { status: 403 },
          );
        }

        const party = await tx.registrationParty.create({
          data: {
            managerName,
            contactPhone: parsed.data.phone || null,
            contactEmail: parsed.data.email || null,
            notes: parsed.data.notes || null,
            managerToken,
          },
        });

        const attendeeRows: {
          id: string;
          fullName: string;
          status: TicketStatus;
          ticketToken: string | null;
          votingCredential: string | null;
        }[] = [];

        for (let i = 0; i < attendeeNames.length; i++) {
          const fullName = attendeeNames[i];
          const ticketToken = generateOpaqueToken(32);
          const votingCredential = generateVotingCredential();
          const votingCredentialHash = await hashVotingCredential(votingCredential);
          const copyContact =
            fullName.toLowerCase() === managerName.toLowerCase() &&
            !attendeeRows.some((r) => r.fullName.toLowerCase() === managerName.toLowerCase());

          const attendee = await tx.attendee.create({
            data: {
              fullName,
              phone: copyContact ? parsed.data.phone || null : null,
              email: copyContact ? parsed.data.email || null : null,
              notes: null,
              ticketToken,
              votingCredentialHash,
              votingCredentialPlain:
                status === TicketStatus.ISSUED ? votingCredential : null,
              votingCredentialHint: null,
              status,
              issuedAt: status === TicketStatus.ISSUED ? new Date() : null,
              registrationPartyId: party.id,
            },
          });

          attendeeRows.push({
            id: attendee.id,
            fullName: attendee.fullName,
            status: attendee.status,
            ticketToken: status === TicketStatus.ISSUED ? ticketToken : null,
            votingCredential: status === TicketStatus.ISSUED ? votingCredential : null,
          });
        }

        return { party, attendeeRows };
      });
    } catch (e: unknown) {
      const statusCode =
        typeof e === "object" && e && "status" in e ? Number((e as { status: number }).status) : 0;
      if (statusCode === 403 && e instanceof Error) {
        return NextResponse.json({ error: e.message }, { status: 403 });
      }
      throw e;
    }

    await writeAudit({
      actorLabel: "guest",
      action: "party.register",
      entityType: "RegistrationParty",
      entityId: created.party.id,
      detail: `attendees=${created.attendeeRows.length};status=${status}`,
    });

    const primary = created.attendeeRows[0];

    return NextResponse.json({
      partyId: created.party.id,
      managerName: created.party.managerName,
      managerToken: status === TicketStatus.ISSUED ? managerToken : null,
      status,
      /** Solo / legacy clients — first attendee */
      attendeeId: primary?.id ?? null,
      fullName: primary?.fullName ?? managerName,
      ticketToken: primary?.ticketToken ?? null,
      votingCredential: primary?.votingCredential ?? null,
      attendees: created.attendeeRows,
      message:
        status === TicketStatus.PENDING
          ? "Registration received. Tickets will be issued after approval."
          : created.attendeeRows.length > 1
            ? "Registration complete. Save the private management link and each entry ticket."
            : "Registration complete. Save your ticket and private guest code.",
    });
  } catch (err) {
    console.error("register failed", err);
    return NextResponse.json({ error: "Registration failed." }, { status: 500 });
  }
}
