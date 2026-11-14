import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { getStaffSession, SessionConfigError } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    try {
      const limited = await rateLimit(`staff-login:${ip}`, 10, 60_000);
      if (!limited.ok) {
        return NextResponse.json(
          { error: "Too many login attempts." },
          { status: 429 },
        );
      }
    } catch (rateErr) {
      console.error("staff login rate limit failed", rateErr);
      // Continue — do not block login if the limiter is unavailable.
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

    let passwordOk = false;
    try {
      passwordOk = !!(
        account && (await verifyPassword(parsed.data.password, account.passwordHash))
      );
    } catch (verifyErr) {
      console.error("staff password verify failed", verifyErr);
      passwordOk = false;
    }

    if (!account || !passwordOk) {
      try {
        await writeAudit({
          actorLabel: parsed.data.username,
          action: "staff.login_failed",
          detail: `ip=${ip}`,
        });
      } catch {
        // ignore audit failures
      }
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    let session;
    try {
      session = await getStaffSession();
    } catch (sessionErr) {
      console.error("staff session init failed", sessionErr);
      if (sessionErr instanceof SessionConfigError) {
        return NextResponse.json({ error: sessionErr.message }, { status: 503 });
      }
      return NextResponse.json(
        {
          error:
            "Could not create a login session. Check SESSION_SECRET (32+ characters) in Cursor Secrets, then republish.",
        },
        { status: 503 },
      );
    }

    session.staffId = account.id;
    session.username = account.username;
    session.role = account.role;
    session.displayName = account.displayName;
    session.isLoggedIn = true;
    await session.save();

    try {
      await writeAudit({
        actorId: account.id,
        actorLabel: account.username,
        action: "staff.login",
        entityType: "StaffAccount",
        entityId: account.id,
      });
    } catch (auditErr) {
      console.error("staff login audit failed", auditErr);
    }

    return NextResponse.json({
      ok: true,
      role: account.role,
      displayName: account.displayName,
    });
  } catch (err) {
    console.error("staff login failed", err);
    if (err instanceof SessionConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        error:
          "Login failed on the server. Confirm SESSION_SECRET is at least 32 characters and ORGANIZER_*/STAFF_* secrets match what you type, then republish.",
      },
      { status: 500 },
    );
  }
}
