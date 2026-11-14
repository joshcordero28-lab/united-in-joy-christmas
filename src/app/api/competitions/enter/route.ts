import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  competitionId: z.string().min(1),
  ticketToken: z.string().min(16).max(200),
  teamName: z.string().trim().max(80).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`comp-enter:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid entry details." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const attendee = await tx.attendee.findUnique({
        where: { ticketToken: parsed.data.ticketToken },
      });
      if (!attendee || attendee.status !== "ISSUED") {
        return { status: 401 as const, error: "Valid issued ticket required." };
      }

      const competition = await tx.competition.findUnique({
        where: { id: parsed.data.competitionId },
        include: { _count: { select: { entries: true } } },
      });
      if (!competition || !competition.isOpen) {
        return { status: 403 as const, error: "Competition is not open." };
      }
      if (
        competition.maxEntries != null &&
        competition._count.entries >= competition.maxEntries
      ) {
        return { status: 403 as const, error: "Competition is full." };
      }
      if (competition.type === "TEAM" && !parsed.data.teamName) {
        return { status: 400 as const, error: "Team name required." };
      }

      const existing = await tx.competitionEntry.findUnique({
        where: {
          competitionId_attendeeId: {
            competitionId: competition.id,
            attendeeId: attendee.id,
          },
        },
      });
      if (existing) {
        return { status: 409 as const, error: "Already entered this competition." };
      }

      const entry = await tx.competitionEntry.create({
        data: {
          competitionId: competition.id,
          attendeeId: attendee.id,
          teamName: competition.type === "TEAM" ? parsed.data.teamName : null,
        },
      });

      return {
        status: 200 as const,
        entry,
        competitionName: competition.name,
        attendeeName: attendee.fullName,
        attendeeId: attendee.id,
      };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await writeAudit({
      actorLabel: result.attendeeName,
      action: "competition.enter",
      entityType: "CompetitionEntry",
      entityId: result.entry.id,
      detail: result.competitionName,
    });

    return NextResponse.json({
      ok: true,
      entryId: result.entry.id,
      competitionName: result.competitionName,
    });
  } catch (err) {
    console.error("competition enter failed", err);
    return NextResponse.json({ error: "Entry failed." }, { status: 500 });
  }
}
