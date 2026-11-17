import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffSession, requireStaff } from "@/lib/session";
import {
  permanentDeleteAttendee,
  previewPermanentDelete,
} from "@/lib/attendee-removal";

const previewSchema = z.object({
  attendeeId: z.string().min(1),
});

const deleteSchema = z.object({
  attendeeId: z.string().min(1),
  reason: z.string().min(3).max(500),
  confirmPhrase: z.string().min(1).max(32),
  confirmPurgeHistory: z.boolean().optional(),
});

/** GET?attendeeId= — organizer-only permanent-delete preview. */
export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json(
        { error: "Organizer login required for permanent deletion." },
        { status: 401 },
      );
    }

    const attendeeId = new URL(request.url).searchParams.get("attendeeId") || "";
    const parsed = previewSchema.safeParse({ attendeeId });
    if (!parsed.success) {
      return NextResponse.json({ error: "attendeeId required." }, { status: 400 });
    }

    const preview = await previewPermanentDelete(parsed.data.attendeeId);
    if (!preview) {
      return NextResponse.json({ error: "Attendee not found." }, { status: 404 });
    }

    return NextResponse.json({ preview });
  } catch (err) {
    console.error("permanent-delete preview failed", err);
    return NextResponse.json({ error: "Preview failed." }, { status: 500 });
  }
}

/** POST — organizer-only permanent delete (typed DELETE confirmation). */
export async function POST(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json(
        { error: "Organizer login required for permanent deletion." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "Provide attendeeId, a reason (3+ characters), and confirmPhrase.",
        },
        { status: 400 },
      );
    }

    const result = await permanentDeleteAttendee({
      attendeeId: parsed.data.attendeeId,
      reason: parsed.data.reason,
      confirmPhrase: parsed.data.confirmPhrase,
      confirmPurgeHistory: parsed.data.confirmPurgeHistory,
      actorId: session.staffId!,
      actorLabel: session.username || session.displayName || "organizer",
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
      partyId: result.partyId,
      partyMembersPreserved: result.partyMembersPreserved,
      historySnapshot: result.historySnapshot,
      message:
        "Attendee permanently deleted. Other party members and the registration party were preserved. Credentials are invalidated.",
    });
  } catch (err) {
    console.error("permanent delete failed", err);
    return NextResponse.json({ error: "Permanent deletion failed." }, { status: 500 });
  }
}
