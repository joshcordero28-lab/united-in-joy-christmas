import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(16).max(200).optional(),
  attendeeId: z.string().optional(),
  method: z.enum(["qr", "manual"]).default("manual"),
});

export async function POST(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const ip = clientIp(request);
    const limited = await rateLimit(`checkin:${session.staffId}:${ip}`, 60, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success || (!parsed.data.token && !parsed.data.attendeeId)) {
      return NextResponse.json({ error: "Provide a ticket token or attendee id." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const attendee = parsed.data.token
        ? await tx.attendee.findUnique({ where: { ticketToken: parsed.data.token } })
        : await tx.attendee.findUnique({ where: { id: parsed.data.attendeeId! } });

      if (!attendee) {
        return { status: 404 as const, error: "Ticket not found." };
      }
      if (attendee.status === "REVOKED") {
        return { status: 403 as const, error: "Ticket revoked.", attendee };
      }
      if (attendee.status === "PENDING") {
        return { status: 403 as const, error: "Ticket not yet issued.", attendee };
      }
      if (attendee.checkedInAt) {
        return {
          status: 409 as const,
          error: "Already checked in.",
          attendee,
          checkedInAt: attendee.checkedInAt,
        };
      }

      const updated = await tx.attendee.update({
        where: { id: attendee.id },
        data: {
          checkedInAt: new Date(),
          checkedInById: session.staffId,
          checkInMethod: parsed.data.method,
        },
      });

      await tx.checkInEvent.create({
        data: {
          attendeeId: attendee.id,
          action: "CHECK_IN",
          method: parsed.data.method,
          staffUserId: session.staffId,
        },
      });

      return { status: 200 as const, attendee: updated };
    });

    if (result.status !== 200) {
      await writeAudit({
        actorId: session.staffId,
        actorLabel: session.username,
        action: "checkin.rejected",
        entityType: "Attendee",
        entityId: result.attendee?.id,
        detail: result.error,
      });
      return NextResponse.json(
        {
          error: result.error,
          attendee: result.attendee
            ? {
                id: result.attendee.id,
                fullName: result.attendee.fullName,
                status: result.attendee.status,
                checkedInAt: result.attendee.checkedInAt,
              }
            : undefined,
        },
        { status: result.status },
      );
    }

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "checkin.success",
      entityType: "Attendee",
      entityId: result.attendee.id,
      detail: `method=${parsed.data.method}`,
    });

    return NextResponse.json({
      ok: true,
      attendee: {
        id: result.attendee.id,
        fullName: result.attendee.fullName,
        checkedInAt: result.attendee.checkedInAt,
      },
    });
  } catch (err) {
    console.error("checkin failed", err);
    return NextResponse.json({ error: "Check-in failed." }, { status: 500 });
  }
}
