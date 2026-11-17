import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buildPartyDashboard } from "@/lib/party-dashboard";

const schema = z.object({
  managerToken: z.string().min(16).max(200),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`manage-view:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 400 });
    }

    const party = await prisma.registrationParty.findUnique({
      where: { managerToken: parsed.data.managerToken },
      select: { id: true },
    });

    if (!party) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 401 });
    }

    const dashboard = await buildPartyDashboard(party.id);
    if (!dashboard) {
      return NextResponse.json({ error: "Invalid management link." }, { status: 401 });
    }

    // Keep managerToken out of JSON when already proven via request body —
    // clients already hold it from the manage URL. Still return manageLink.
    const { managerToken: _mt, ...safe } = dashboard;
    void _mt;

    return NextResponse.json(safe);
  } catch (err) {
    console.error("manage view failed", err);
    return NextResponse.json({ error: "Could not load registration." }, { status: 500 });
  }
}
