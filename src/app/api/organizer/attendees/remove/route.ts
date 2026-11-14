import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffSession, requireStaff } from "@/lib/session";
import {
  previewAttendeeRemoval,
  softRemoveAttendee,
} from "@/lib/attendee-removal";

const previewSchema = z.object({
  attendeeId: z.string().min(1),
});

const removeSchema = z.object({
  attendeeId: z.string().min(1),
  reason: z.string().min(3).max(500),
  confirmVoidBallot: z.boolean().optional(),
});

/** GET?attendeeId= — confirmation preview (staff + organizer). */
export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const attendeeId = new URL(request.url).searchParams.get("attendeeId") || "";
    const parsed = previewSchema.safeParse({ attendeeId });
    if (!parsed.success) {
      return NextResponse.json({ error: "attendeeId required." }, { status: 400 });
    }

    const preview = await previewAttendeeRemoval(parsed.data.attendeeId);
    if (!preview) {
      return NextResponse.json({ error: "Attendee not found." }, { status: 404 });
    }
    if (preview.status === "REMOVED") {
      return NextResponse.json({ error: "Attendee is already removed.", preview }, { status: 409 });
    }

    return NextResponse.json({ preview });
  } catch (err) {
    console.error("remove preview failed", err);
    return NextResponse.json({ error: "Preview failed." }, { status: 500 });
  }
}

/** Soft-remove attendee (staff + organizer). Organizer required if ballot exists. */
export async function POST(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const body = await request.json();
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide attendeeId and a reason (at least 3 characters)." },
        { status: 400 },
      );
    }

    const result = await softRemoveAttendee({
      attendeeId: parsed.data.attendeeId,
      reason: parsed.data.reason,
      actorId: session.staffId!,
      actorLabel: session.username || session.displayName || "staff",
      actorRole: session.role === "ORGANIZER" ? "ORGANIZER" : "STAFF",
      confirmVoidBallot: parsed.data.confirmVoidBallot,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          preview: result.preview,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      attendeeId: result.attendeeId,
      fullName: result.fullName,
      ticketRefBefore: result.ticketRefBefore,
      voidedVoteId: result.voidedVoteId,
      resultsCorrectionPending: result.resultsCorrectionPending,
      flaggedTalentGroupIds: result.flaggedTalentGroupIds,
      partyId: result.partyId,
      message:
        "Attendee soft-removed. Party registration and other attendees were preserved.",
    });
  } catch (err) {
    console.error("attendee remove failed", err);
    return NextResponse.json({ error: "Removal failed." }, { status: 500 });
  }
}
