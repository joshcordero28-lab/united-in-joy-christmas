import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";
import { getEventConfig } from "@/lib/event";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2).max(120).optional(),
  dateLabel: z.string().min(1).max(120).optional(),
  venueLabel: z.string().min(1).max(120).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
  registrationOpen: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  votingEnabledAfterCheckIn: z.boolean().optional(),
  allowSelfVote: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }
    const event = await getEventConfig();
    return NextResponse.json({ event });
  } catch (err) {
    console.error("config get failed", err);
    return NextResponse.json({ error: "Failed to load config." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
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
      return NextResponse.json({ error: "Invalid config." }, { status: 400 });
    }

    const event = await prisma.eventConfig.update({
      where: { id: "default" },
      data: parsed.data,
    });

    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "event.config_update",
      entityType: "EventConfig",
      entityId: "default",
      detail: JSON.stringify(parsed.data),
    });

    return NextResponse.json({ event });
  } catch (err) {
    console.error("config update failed", err);
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }
}
