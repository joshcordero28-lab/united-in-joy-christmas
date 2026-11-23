import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import {
  generateOpaqueToken,
  generateVotingCredential,
  hashVotingCredential,
} from "@/lib/crypto";
import { ticketUrl, qrDataUrl } from "@/lib/tickets";
import { ticketStaffRef } from "@/lib/attendee-removal";
import { invalidateCapacityCache } from "@/lib/capacity";

const schema = z.object({
  attendeeId: z.string().min(1),
  /**
   * approve / revoke — unchanged.
   * resend — re-share existing ticket (same QR / ticket number / booking).
   * replace_qr — rotate QR + voting credential for compromise (same attendee row).
   * reissue — legacy alias for replace_qr (kept for older clients).
   */
  action: z.enum(["approve", "revoke", "resend", "replace_qr", "reissue"]),
  reason: z.string().trim().min(3).max(300).optional(),
});

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
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const action =
      parsed.data.action === "reissue" ? "replace_qr" : parsed.data.action;

    const attendee = await prisma.attendee.findUnique({
      where: { id: parsed.data.attendeeId },
      include: {
        registrationParty: {
          select: { bookingRef: true, id: true, managerToken: true },
        },
        audienceVotes: { select: { id: true, voidedAt: true } },
      },
    });
    if (!attendee) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (attendee.status === "REMOVED") {
      return NextResponse.json(
        {
          error:
            "This attendee was soft-removed. Use Restore (not approve/revoke/resend/replace) to bring them back.",
        },
        { status: 409 },
      );
    }

    let votingCredential: string | null = null;
    let ticketToken: string | null = null;
    let qrRotated = false;
    const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";

    if (action === "approve") {
      if (attendee.status !== "PENDING") {
        return NextResponse.json({ error: "Only pending tickets can be approved." }, { status: 409 });
      }
      votingCredential = generateVotingCredential();
      const votingCredentialHash = await hashVotingCredential(votingCredential);
      ticketToken = attendee.ticketToken;
      await prisma.attendee.update({
        where: { id: attendee.id },
        data: {
          status: "ISSUED",
          issuedAt: new Date(),
          votingCredentialHash,
          votingCredentialPlain: votingCredential,
        },
      });
      await writeAudit({
        actorId: session.staffId,
        actorLabel: session.username,
        action: "attendee.approve",
        entityType: "Attendee",
        entityId: attendee.id,
        detail: `ticketNumber=${attendee.ticketNumber}`,
      });
    } else if (action === "revoke") {
      await prisma.attendee.update({
        where: { id: attendee.id },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          votingCredentialPlain: null,
        },
      });
      await writeAudit({
        actorId: session.staffId,
        actorLabel: session.username,
        action: "attendee.revoke",
        entityType: "Attendee",
        entityId: attendee.id,
        detail: `ticketNumber=${attendee.ticketNumber}`,
      });
    } else if (action === "resend") {
      // Re-issue / re-send existing ticket: same attendee, same QR, same ticket number.
      if (attendee.status !== "ISSUED") {
        return NextResponse.json(
          { error: "Only issued tickets can be re-sent. Approve pending tickets first, or restore removed ones." },
          { status: 409 },
        );
      }
      ticketToken = attendee.ticketToken;
      votingCredential = attendee.votingCredentialPlain;
      await writeAudit({
        actorId: session.staffId,
        actorLabel: session.username,
        action: "attendee.resend",
        entityType: "Attendee",
        entityId: attendee.id,
        detail: [
          `ticketNumber=${attendee.ticketNumber}`,
          `bookingRef=${attendee.registrationParty.bookingRef}`,
          `ticketRef=${ticketStaffRef(attendee.ticketToken)}`,
          "qrUnchanged",
          "noNewVoteEntitlement",
        ].join("; "),
      });
    } else if (action === "replace_qr") {
      const reason = (parsed.data.reason || "").trim();
      if (reason.length < 3) {
        return NextResponse.json(
          {
            error:
              "Replacing a QR requires a reason (lost/compromised). This invalidates the previous QR.",
            code: "reason_required",
          },
          { status: 400 },
        );
      }
      const previousRef = ticketStaffRef(attendee.ticketToken);
      ticketToken = generateOpaqueToken(32);
      votingCredential = generateVotingCredential();
      const votingCredentialHash = await hashVotingCredential(votingCredential);
      await prisma.attendee.update({
        where: { id: attendee.id },
        data: {
          ticketToken,
          votingCredentialHash,
          votingCredentialPlain: votingCredential,
          status: "ISSUED",
          issuedAt: attendee.issuedAt ?? new Date(),
          revokedAt: null,
        },
      });
      qrRotated = true;
      await writeAudit({
        actorId: session.staffId,
        actorLabel: session.username,
        action: "attendee.replace_qr",
        entityType: "Attendee",
        entityId: attendee.id,
        detail: [
          `reason=${reason}`,
          `ticketNumber=${attendee.ticketNumber}`,
          `bookingRef=${attendee.registrationParty.bookingRef}`,
          `previousTicketRef=${previousRef}`,
          `newTicketRef=${ticketStaffRef(ticketToken)}`,
          "sameAttendeeRow",
          "checkInPreserved",
          "votesPreserved",
          "noExtraVoteEntitlement",
        ].join("; "),
      });
    }

    if (action === "revoke") {
      invalidateCapacityCache();
    }

    const link =
      ticketToken && (action === "resend" || action === "replace_qr" || action === "approve")
        ? ticketUrl(baseUrl, ticketToken, votingCredential)
        : null;
    const qr = link ? await qrDataUrl(link) : null;

    const hasActiveVote = attendee.audienceVotes.some((v) => !v.voidedAt);

    return NextResponse.json({
      ok: true,
      action,
      attendeeId: attendee.id,
      fullName: attendee.fullName,
      ticketNumber: attendee.ticketNumber,
      bookingRef: attendee.registrationParty.bookingRef,
      ticketToken,
      /** Same as ticketToken — the individual Private Guest Code for Find My Ticket. */
      privateGuestCode: ticketToken,
      /** Group Private Guest Code for the booking (unchanged by resend / replace_qr). */
      groupPrivateGuestCode: attendee.registrationParty.managerToken,
      votingCredential,
      ticketRef: ticketToken ? ticketStaffRef(ticketToken) : null,
      link,
      qr,
      qrRotated,
      checkedInAt: attendee.checkedInAt,
      hasActiveVote,
      message:
        action === "resend"
          ? "Existing ticket re-sent — same Private Guest Code and QR. No new attendee created."
          : action === "replace_qr"
            ? "QR replaced — previous QR is invalid. Same attendee, check-in, and votes preserved."
            : `Action ${action} complete.`,
    });
  } catch (err) {
    console.error("attendee action failed", err);
    return NextResponse.json({ error: "Action failed." }, { status: 500 });
  }
}
