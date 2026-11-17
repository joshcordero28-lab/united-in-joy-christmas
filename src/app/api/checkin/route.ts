import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeTicketNumber } from "@/lib/booking-ref";
import { parseAppTicketCredential } from "@/lib/tickets";

const schema = z.object({
  /** Opaque ticket token or full ticket URL/QR payload. */
  token: z.string().min(8).max(500).optional(),
  /** Printed ticket number e.g. UIJ2026-00425-01 (staff-auth alternate to QR). */
  ticketNumber: z.string().min(8).max(40).optional(),
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
    const hasId = Boolean(parsed.success && parsed.data.attendeeId);
    const hasToken = Boolean(parsed.success && parsed.data.token);
    const hasNumber = Boolean(parsed.success && parsed.data.ticketNumber);
    if (!parsed.success || (!hasId && !hasToken && !hasNumber)) {
      return NextResponse.json(
        {
          error:
            "Provide a ticket QR/link, printed ticket number (UIJ2026-#####-NN), or attendee id.",
        },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let attendee = null;
      if (parsed.data.attendeeId) {
        attendee = await tx.attendee.findUnique({ where: { id: parsed.data.attendeeId } });
      } else if (parsed.data.ticketNumber) {
        const tn = normalizeTicketNumber(parsed.data.ticketNumber);
        if (!tn) {
          return {
            status: 400 as const,
            error: "Invalid ticket number. Use the printed form UIJ2026-#####-NN.",
          };
        }
        attendee = await tx.attendee.findUnique({ where: { ticketNumber: tn } });
      } else if (parsed.data.token) {
        const token = parseAppTicketCredential(parsed.data.token);
        if (token.length < 16) {
          // Staff may paste a ticket number into the token field — accept it.
          const tn = normalizeTicketNumber(parsed.data.token);
          if (tn) {
            attendee = await tx.attendee.findUnique({ where: { ticketNumber: tn } });
          } else {
            return { status: 400 as const, error: "Invalid ticket credential." };
          }
        } else {
          attendee = await tx.attendee.findUnique({ where: { ticketToken: token } });
        }
      }

      if (!attendee) {
        return { status: 404 as const, error: "Ticket not found." };
      }
      if (attendee.status === "REVOKED") {
        return { status: 403 as const, error: "Ticket revoked.", attendee };
      }
      if (attendee.status === "REMOVED") {
        return { status: 403 as const, error: "Ticket removed.", attendee };
      }
      if (attendee.status === "PENDING") {
        return { status: 403 as const, error: "Ticket not yet issued.", attendee };
      }
      if (attendee.status !== "ISSUED") {
        return { status: 403 as const, error: "Ticket not valid for check-in.", attendee };
      }
      if (attendee.checkedInAt) {
        return {
          status: 409 as const,
          error: "Already checked in.",
          attendee,
          checkedInAt: attendee.checkedInAt,
        };
      }

      // Atomic with soft-remove: only ISSUED + not yet checked in may succeed.
      const updatedRows = await tx.attendee.updateMany({
        where: {
          id: attendee.id,
          status: "ISSUED",
          checkedInAt: null,
        },
        data: {
          checkedInAt: new Date(),
          checkedInById: session.staffId,
          checkInMethod: parsed.data.method,
        },
      });
      if (updatedRows.count !== 1) {
        const latest = await tx.attendee.findUnique({ where: { id: attendee.id } });
        if (latest?.status === "REMOVED") {
          return { status: 403 as const, error: "Ticket removed.", attendee: latest };
        }
        if (latest?.checkedInAt) {
          return {
            status: 409 as const,
            error: "Already checked in.",
            attendee: latest,
            checkedInAt: latest.checkedInAt,
          };
        }
        return { status: 409 as const, error: "Check-in conflict. Retry.", attendee: latest || attendee };
      }

      const updated = await tx.attendee.findUniqueOrThrow({ where: { id: attendee.id } });

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
      detail: `method=${parsed.data.method};ticketNumber=${result.attendee.ticketNumber}`,
    });

    return NextResponse.json({
      ok: true,
      attendee: {
        id: result.attendee.id,
        fullName: result.attendee.fullName,
        ticketNumber: result.attendee.ticketNumber,
        checkedInAt: result.attendee.checkedInAt,
      },
    });
  } catch (err) {
    console.error("checkin failed", err);
    return NextResponse.json({ error: "Check-in failed." }, { status: 500 });
  }
}
