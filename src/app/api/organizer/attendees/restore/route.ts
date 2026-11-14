import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffSession, requireStaff } from "@/lib/session";
import { softRestoreAttendee } from "@/lib/attendee-removal";

const schema = z.object({
  attendeeId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

/** Organizer-only restore of a soft-removed attendee (same row, new QR). */
export async function POST(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "attendeeId required." }, { status: 400 });
    }

    const result = await softRestoreAttendee({
      attendeeId: parsed.data.attendeeId,
      actorId: session.staffId!,
      actorLabel: session.username || session.displayName || "organizer",
      reason: parsed.data.reason,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      attendeeId: result.attendeeId,
      fullName: result.fullName,
      ticketToken: result.ticketToken,
      votingCredential: result.votingCredential,
      ticketRef: result.ticketRef,
      voidedBallotRetained: result.voidedBallotRetained,
      talentReviewPending: result.talentReviewPending,
      message:
        "Attendee restored with a new QR. Prior QR remains invalid. Voided ballots and talent review flags were not auto-cleared.",
    });
  } catch (err) {
    console.error("attendee restore failed", err);
    return NextResponse.json({ error: "Restore failed." }, { status: 500 });
  }
}
