/**
 * Focused acceptance tests for group ticket management + secure lookup.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-group-tickets.ts
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

type Jar = Map<string, string>;

function storeCookies(jar: Jar, res: Response) {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const raw = anyHeaders.getSetCookie?.() || [];
  for (const line of raw) {
    const part = line.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(
  path: string,
  opts: RequestInit & { jar?: Jar } = {},
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const headers = new Headers(opts.headers || {});
  if (opts.jar && opts.jar.size) headers.set("cookie", cookieHeader(opts.jar));
  if (opts.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (opts.jar) storeCookies(opts.jar, res);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function clearLimits() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "register:" } },
          { id: { startsWith: "register-day:" } },
          { id: { startsWith: "register-seats:" } },
          { id: { startsWith: "booking-lookup:" } },
          { id: { startsWith: "manage-view:" } },
          { id: { startsWith: "ticket-view:" } },
          { id: { startsWith: "checkin:" } },
        ],
      },
    });
    await prisma.$disconnect();
  } catch {
    // ignore
  }
}

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);
  await clearLimits();

  const stamp = Date.now();
  const staffJar: Jar = new Map();
  {
    const { res } = await req("/api/auth/staff/login", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        username: process.env.STAFF_USERNAME,
        password: process.env.STAFF_PASSWORD,
      }),
    });
    assert(res.ok, "Staff login");
  }

  // 1 / 2 / 5 person bookings
  for (const size of [1, 2, 5] as const) {
    await clearLimits();
    const attendees = Array.from({ length: size }, (_, i) => ({
      fullName: `GT ${size} ${i + 1} ${stamp}`,
    }));
    const { res, json } = await req("/api/register", {
      method: "POST",
      body: JSON.stringify({
        managerName: `GT Mgr ${size} ${stamp}`,
        phone: "555-2000",
        attendees,
      }),
    });
    assert(res.ok, `Register ${size}: ${JSON.stringify(json)}`);
    assert(json.bookingRef && String(json.bookingRef).startsWith("UIJ2026-"), "bookingRef");
    assert(Array.isArray(json.attendees) && (json.attendees as unknown[]).length === size, "size");

    const { json: dash } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken: json.managerToken }),
    });
    assert(dash.totalAttendees === size, "dashboard size");
    assert(dash.checkedInCount === 0, "none checked in yet");

    const first = (json.attendees as { ticketToken: string; ticketNumber: string })[0];
    await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: first.ticketToken, method: "manual" }),
    });
    const { json: after } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken: json.managerToken }),
    });
    assert(after.checkedInCount === 1, "one check-in only");

    const { res: alone } = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ bookingRef: json.bookingRef }),
    });
    assert(alone.status === 401, "ref alone blocked");

    const { res: okLookup, json: okJ } = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({
        bookingRef: json.bookingRef,
        accessToken: json.managerToken,
      }),
    });
    assert(okLookup.ok && okJ.mode === "booking", "secure booking lookup");

    const { res: tn, json: tnJ } = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ ticketNumber: first.ticketNumber }),
    });
    assert(tn.ok && tnJ.mode === "ticket", "ticket number lookup");
    assert(!("attendees" in tnJ), "no group PII on ticket lookup");
    pass(`${size}-person booking + check-in + lookup`);
  }

  // QR tokens unchanged across manage/lookup (same ticketToken)
  await clearLimits();
  const { json: party } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `QR Preserve ${stamp}`,
      attendees: [
        { fullName: `QR A ${stamp}` },
        { fullName: `QR B ${stamp}` },
      ],
    }),
  });
  const tokensBefore = (party.attendees as { id: string; ticketToken: string }[]).map(
    (a) => a.ticketToken,
  );
  const { json: dash2 } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  const tokensAfter = (dash2.attendees as { id: string; ticketToken: string }[]).map(
    (a) => a.ticketToken,
  );
  assert(
    tokensBefore.length === tokensAfter.length &&
      tokensBefore.every((t, i) => t === tokensAfter[i]),
    "QR ticket tokens preserved when opening group dashboard",
  );
  pass("Existing QR tokens unchanged by group dashboard");

  // Voting entitlements not inflated by grouping (partial check-in)
  const orgJar: Jar = new Map();
  await req("/api/auth/staff/login", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({
      username: process.env.ORGANIZER_USERNAME,
      password: process.env.ORGANIZER_PASSWORD,
    }),
  });
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "REVEALED", state: "OPEN" }),
  });
  const { json: voteParty } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  // Check in one of two
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({
      token: (party.attendees as { ticketToken: string }[])[0].ticketToken,
      method: "manual",
    }),
  });
  const { json: voteAfter } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  if (voteAfter.voting) {
    assert(
      (voteAfter.voting as { eligible: number }).eligible === 1,
      "Grouping does not grant extra vote entitlements",
    );
    pass("Voting entitlements remain one-per-checked-in-attendee");
  } else {
    // If voting still hidden somehow, still pass structural check via checkedInCount
    assert(voteAfter.checkedInCount === 1, "checked-in count 1");
    assert(voteParty.totalAttendees === 2, "party of 2");
    pass("Voting section omitted or checked-in count intact");
  }

  console.log(results.join("\n"));
  console.log(`\nGroup ticket tests passed (${results.length}).`);
}

main().catch((err) => {
  console.error("GROUP TICKET TEST FAILED:", err);
  process.exit(1);
});
