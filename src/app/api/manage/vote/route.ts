import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { getPublicVotingGate } from "@/lib/voting-public";
import { castManagerAllocations } from "@/lib/vote-entitlements";
import { writeAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  managerToken: z.string().min(16).max(200),
  /** Must be true — client confirmation that allocations are final. */
  confirm: z.literal(true),
  allocations: z
    .array(
      z.object({
        groupId: z.string().min(1),
        votes: z.number().int().min(1).max(200),
      }),
    )
    .min(1)
    .max(30),
});

function unavailable() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    const gate = await getPublicVotingGate();
    if (!gate.visible) return unavailable();
    if (!gate.open) {
      return NextResponse.json({ error: "Voting is closed." }, { status: 403 });
    }

    const ip = clientIp(request);
    const limited = await rateLimit(`manage-vote:${ip}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid ballot. Confirm your allocation before submitting." },
        { status: 400 },
      );
    }

    const party = await prisma.registrationParty.findUnique({
      where: { managerToken: parsed.data.managerToken },
      select: { id: true, managerName: true },
    });
    if (!party) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 401 });
    }

    const event = await getEventConfig();

    try {
      const result = await castManagerAllocations({
        partyId: party.id,
        votingEnabledAfterCheckIn: event.votingEnabledAfterCheckIn,
        allocations: parsed.data.allocations,
      });

      await writeAudit({
        actorLabel: party.managerName,
        action: "audience_vote.manager_cast",
        entityType: "RegistrationParty",
        entityId: party.id,
        detail: `votes=${result.voteIds.length};by=MANAGER`,
      });

      return NextResponse.json({
        ok: true,
        cast: result.assigned.length,
        assigned: result.assigned,
        message: "Votes submitted. Submitted votes are final.",
      });
    } catch (e: unknown) {
      const status =
        typeof e === "object" && e && "status" in e
          ? Number((e as { status: number }).status)
          : 500;
      const message = e instanceof Error ? e.message : "Vote failed.";
      if (status >= 400 && status < 500) {
        return NextResponse.json({ error: message }, { status });
      }
      throw e;
    }
  } catch (err) {
    console.error("manage vote failed", err);
    return NextResponse.json({ error: "Vote failed." }, { status: 500 });
  }
}
