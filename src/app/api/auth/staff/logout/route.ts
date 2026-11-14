import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export async function POST() {
  const session = await getStaffSession();
  if (session.isLoggedIn && session.staffId) {
    await writeAudit({
      actorId: session.staffId,
      actorLabel: session.username,
      action: "staff.logout",
    });
  }
  session.destroy();
  return NextResponse.json({ ok: true });
}
