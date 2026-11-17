/**
 * Private Guest Code voting — same entitlement as QR / link.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-private-code-voting.ts
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
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.rateLimitBucket.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "register:" } },
        { id: { startsWith: "register-day:" } },
        { id: { startsWith: "register-seats:" } },
        { id: { startsWith: "voter-login:" } },
        { id: { startsWith: "vote:" } },
      ],
    },
  });
  await prisma.$disconnect();
}

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);
  await clearLimits();
  const stamp = Date.now();

  const orgJar: Jar = new Map();
  const staffJar: Jar = new Map();
  {
    const { res } = await req("/api/auth/staff/login", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        username: process.env.ORGANIZER_USERNAME,
        password: process.env.ORGANIZER_PASSWORD,
      }),
    });
    assert(res.ok, "Organizer login");
  }
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

  // Ensure voting visible + open
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "REVEALED", state: "OPEN" }),
  });

  // Register party of 2 + a solo guest
  const { res: partyRes, json: party } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Vote Mgr ${stamp}`,
      phone: `91${String(stamp).slice(-8)}`,
      email: `votemgr.${stamp}@example.com`,
      attendees: [
        { fullName: `Vote A ${stamp}` },
        { fullName: `Vote B ${stamp}` },
      ],
      confirmNewPerson: true,
      idempotencyKey: `vote-party-${stamp}`,
    }),
  });
  assert(partyRes.ok, `Party register: ${JSON.stringify(party)}`);
  const attendees = party.attendees as {
    id: string;
    fullName: string;
    ticketToken: string;
    votingCredential: string;
  }[];
  assert(attendees.length === 2, "two attendees");

  const { res: soloRes, json: solo } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Vote Solo ${stamp}`,
      phone: `92${String(stamp).slice(-8)}`,
      email: `votesolo.${stamp}@example.com`,
      confirmNewPerson: true,
      idempotencyKey: `vote-solo-${stamp}`,
    }),
  });
  assert(soloRes.ok, `Solo register: ${JSON.stringify(solo)}`);

  // Check in all three
  for (const t of [...attendees.map((a) => a.ticketToken), String(solo.ticketToken)]) {
    const { res } = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: t, method: "manual" }),
    });
    assert(res.ok || res.status === 409, `check-in ${t.slice(0, 6)}`);
  }

  // Need an approved group on ballot
  const { json: dash } = await req("/api/organizer/dashboard", { jar: orgJar });
  let groupId = (dash.groups as { id: string; status: string }[] | undefined)?.find(
    (g) => g.status === "APPROVED",
  )?.id;
  if (!groupId) {
    // Register + approve a talent group using solo as leader
    const { res: gRes, json: g } = await req("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        groupName: `Vote Group ${stamp}`,
        performanceTitle: "Carol",
        talentType: "Singing",
        leaderTicket: solo.ticketToken,
      }),
    });
    assert(gRes.ok, `Group create: ${JSON.stringify(g)}`);
    const { json: dash2 } = await req("/api/organizer/dashboard", { jar: orgJar });
    const created = (dash2.groups as { id: string; groupName: string }[]).find((x) =>
      x.groupName.includes(`Vote Group ${stamp}`),
    );
    assert(created, "group on dashboard");
    await req("/api/organizer/groups", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ groupId: created!.id, action: "approve" }),
    });
    groupId = created!.id;
  }
  assert(groupId, "approved groupId");

  // 1. Vote with Private Guest Code (individual ticket token alone)
  const codeJar: Jar = new Map();
  {
    const { res, json } = await req("/api/auth/voter/login", {
      method: "POST",
      jar: codeJar,
      body: JSON.stringify({ guestCode: attendees[0].ticketToken }),
    });
    assert(res.ok, `Private code login: ${JSON.stringify(json)}`);
    const { res: vRes, json: vJ } = await req("/api/vote", {
      method: "POST",
      jar: codeJar,
      body: JSON.stringify({ groupId }),
    });
    assert(vRes.ok, `Vote via private code: ${JSON.stringify(vJ)}`);
  }
  pass("Guest can vote with a valid Private Guest Code");

  // 4. Same attendee cannot vote again via QR path (token + voting code)
  {
    const jar: Jar = new Map();
    const { res: login } = await req("/api/auth/voter/login", {
      method: "POST",
      jar,
      body: JSON.stringify({
        ticketToken: attendees[0].ticketToken,
        votingCredential: attendees[0].votingCredential,
      }),
    });
    assert(login.ok, "QR-style re-login after vote");
    const { res: again, json: againJ } = await req("/api/vote", {
      method: "POST",
      jar,
      body: JSON.stringify({ groupId }),
    });
    assert(again.status === 409, `Duplicate via QR blocked: ${JSON.stringify(againJ)}`);
  }
  pass("Guest who voted via private code cannot vote again using QR credentials");

  // 2. Second attendee votes via QR method
  {
    const jar: Jar = new Map();
    const { res: login, json: loginJ } = await req("/api/auth/voter/login", {
      method: "POST",
      jar,
      body: JSON.stringify({
        ticketToken: attendees[1].ticketToken,
        votingCredential: attendees[1].votingCredential,
      }),
    });
    assert(login.ok, `QR login B: ${JSON.stringify(loginJ)}`);
    const { res: vRes } = await req("/api/vote", {
      method: "POST",
      jar,
      body: JSON.stringify({ groupId }),
    });
    assert(vRes.ok, "Vote via QR");
  }
  pass("Guest can vote using the existing QR method");

  // 5. Same attendee cannot vote again via private code
  {
    const jar: Jar = new Map();
    await req("/api/auth/voter/login", {
      method: "POST",
      jar,
      body: JSON.stringify({ guestCode: attendees[1].ticketToken }),
    });
    const { res: again } = await req("/api/vote", {
      method: "POST",
      jar,
      body: JSON.stringify({ groupId }),
    });
    assert(again.status === 409, "Duplicate via private code blocked");
  }
  pass("Guest who voted via QR cannot vote again using a private code");

  // 3. Solo votes via voting link style (token alone as guestCode after QR capture)
  {
    const jar: Jar = new Map();
    const { res: login } = await req("/api/auth/voter/login", {
      method: "POST",
      jar,
      body: JSON.stringify({
        ticketToken: String(solo.ticketToken),
        votingCredential: String(solo.votingCredential),
      }),
    });
    assert(login.ok, "Link-style login");
    const { res: vRes } = await req("/api/vote", {
      method: "POST",
      jar,
      body: JSON.stringify({ groupId }),
    });
    assert(vRes.ok, "Vote via link credentials");
  }
  pass("Guest can vote using the existing voting link credentials");

  // 6. Group entitlements: 2 party + 1 solo = 3 votes from this suite on those attendees
  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const ids = [...attendees.map((a) => a.id), String(solo.attendeeId)];
    const votes = await prisma.audienceVote.count({
      where: { voterId: { in: ids }, voidedAt: null },
    });
    await prisma.$disconnect();
    assert(votes === 3, `Expected 3 votes for 3 attendees, got ${votes}`);
  }
  pass("Group booking preserves one entitlement per attendee");

  // 7–8. Group manager code cannot open personal voter session; invalid codes leak nothing
  {
    const { res, json } = await req("/api/auth/voter/login", {
      method: "POST",
      body: JSON.stringify({ guestCode: party.managerToken }),
    });
    assert(res.status === 403 && json.code === "group_private_code", "group code blocked");
    assert(!("attendeeId" in json) && !("fullName" in json), "no attendee PII on group code");
  }
  {
    const { res, json } = await req("/api/auth/voter/login", {
      method: "POST",
      body: JSON.stringify({ guestCode: "x".repeat(32) }),
    });
    assert(res.status === 401, "invalid code rejected");
    assert(!("attendees" in json) && !("ticketToken" in json), "no secrets on invalid");
  }
  pass("Unauthorized / invalid codes cannot vote or expose attendee data");

  // Cleanup voting visibility
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "HIDDEN", state: "CLOSED" }),
  });

  console.log(results.join("\n"));
  console.log(`\nPrivate-code voting tests passed (${results.length}).`);
}

main().catch((err) => {
  console.error("PRIVATE-CODE VOTING TEST FAILED:", err);
  process.exit(1);
});
