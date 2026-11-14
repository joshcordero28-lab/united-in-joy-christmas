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

const schema = z.object({
  attendeeId: z.string().min(1),
  action: z.enum(["approve", "revoke", "reissue"]),
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

    const attendee = await prisma.attendee.findUnique({
      where: { id: parsed.data.attendeeId },
    });
    if (!attendee) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (attendee.status === "REMOVED") {
      return NextResponse.json(
        {
          error:
            "This attendee was soft-removed. Use Restore (not approve/revoke/reissue) to bring them back.",
        },
        { status: 409 },
      );
    }

    let votingCredential: string | null = null;
    let ticketToken: string | null = null;

    if (parsed.data.action === "approve") {
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
        },
      });
    } else if (parsed.data.action === "revoke") {
      await prisma.attendee.update({
        where: { id: attendee.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    } else if (parsed.data.action === "reissue") {
      ticketToken = generateOpaqueToken(32);
      votingCredential = generateVotingCredential();
      const votingCredentialHash = await hashVotingCredential(votingCredential);
      await prisma.attendee.update({
        where: { id: attendee.id },
        data: {
          ticketToken,
          votingCredentialHash,
          status: "ISSUED",
          issuedAt: new Date(),
          revokedAt: null,
        },
      });
    }

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: `attendee.${parsed.data.action}`,
      entityType: "Attendee",
      entityId: attendee.id,
    });

    return NextResponse.json({
      ok: true,
      ticketToken,
      votingCredential,
    });
  } catch (err) {
    console.error("attendee action failed", err);
    return NextResponse.json({ error: "Action failed." }, { status: 500 });
  }
}
