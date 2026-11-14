import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  attendeeId: z.string().min(1),
  note: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const attendee = await prisma.$transaction(async (tx) => {
      const current = await tx.attendee.findUnique({ where: { id: parsed.data.attendeeId } });
      if (!current) return null;
      if (!current.checkedInAt) {
        throw new Error("NOT_CHECKED_IN");
      }

      const updated = await tx.attendee.update({
        where: { id: current.id },
        data: {
          checkedInAt: null,
          checkedInById: null,
          checkInMethod: null,
        },
      });

      await tx.checkInEvent.create({
        data: {
          attendeeId: current.id,
          action: "UNDO_CHECK_IN",
          method: "manual",
          staffUserId: session.staffId,
          note: parsed.data.note || "Correction",
        },
      });

      return updated;
    });

    if (!attendee) {
      return NextResponse.json({ error: "Attendee not found." }, { status: 404 });
    }

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "checkin.undo",
      entityType: "Attendee",
      entityId: attendee.id,
      detail: parsed.data.note || "Correction",
    });

    return NextResponse.json({
      ok: true,
      attendee: { id: attendee.id, fullName: attendee.fullName, checkedInAt: null },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_CHECKED_IN") {
      return NextResponse.json({ error: "Attendee is not checked in." }, { status: 409 });
    }
    console.error("undo checkin failed", err);
    return NextResponse.json({ error: "Undo failed." }, { status: 500 });
  }
}
