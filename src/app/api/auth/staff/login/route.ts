import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { getStaffSession } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`staff-login:${ip}`, 10, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many login attempts." },
        { status: 429 },
      );
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 400 });
    }

    const staffCount = await prisma.staffAccount.count();
    if (staffCount === 0) {
      return NextResponse.json(
        {
          error:
            "Staff accounts are not set up yet. Ensure ORGANIZER_* and STAFF_* secrets are set, then republish so seed can run.",
        },
        { status: 503 },
      );
    }

    const account = await prisma.staffAccount.findUnique({
      where: { username: parsed.data.username },
    });

    if (!account || !(await verifyPassword(parsed.data.password, account.passwordHash))) {
      await writeAudit({
        actorLabel: parsed.data.username,
        action: "staff.login_failed",
        detail: `ip=${ip}`,
      });
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    const session = await getStaffSession();
    session.staffId = account.id;
    session.username = account.username;
    session.role = account.role;
    session.displayName = account.displayName;
    session.isLoggedIn = true;
    await session.save();

    await writeAudit({
      actorId: account.id,
      actorLabel: account.username,
      action: "staff.login",
      entityType: "StaffAccount",
      entityId: account.id,
    });

    return NextResponse.json({
      ok: true,
      role: account.role,
      displayName: account.displayName,
    });
  } catch (err) {
    console.error("staff login failed", err);
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
