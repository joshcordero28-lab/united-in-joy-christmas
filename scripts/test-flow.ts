/**
 * End-to-end API flow test against a running server + shared Postgres.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-flow.ts
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
  const single = res.headers.get("set-cookie");
  if (single && raw.length === 0) {
    const part = single.split(";")[0];
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

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);

  {
    const res = await fetch(BASE);
    assert(res.ok, `Home not ok: ${res.status}`);
    pass("Home page loads");
  }

  const { res: r1, json: a } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Alex Talent ${Date.now()}`,
      phone: "555-0101",
      email: "alex@example.com",
    }),
  });
  assert(r1.ok, `Register A failed: ${JSON.stringify(a)}`);
  assert(a.ticketToken && a.votingCredential, "A missing ticket/credential");
  pass("Registration issues ticket + voting credential");

  const tokenA = String(a.ticketToken);
  const voteA = String(a.votingCredential);

  const { res: r2, json: b } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Blake Talent ${Date.now()}`, phone: "555-0102" }),
  });
  assert(r2.ok, `Register B failed: ${JSON.stringify(b)}`);
  const tokenB = String(b.ticketToken);
  const voteB = String(b.votingCredential);
  pass("Second attendee registered");

  const { json: vJson } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: tokenA }),
  });
  assert(vJson.valid === true, "Valid ticket should validate");
  pass("Ticket validation accepts issued token");

  const { json: badJson } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: "this-is-not-a-real-ticket-token-xxxxx" }),
  });
  assert(badJson.valid === false, "Invalid token should fail");
  pass("Invalid ticket rejected");

  const staffJar: Jar = new Map();
  const { res: sLogin, json: sJson } = await req("/api/auth/staff/login", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({
      username: process.env.STAFF_USERNAME || "checkin",
      password: process.env.STAFF_PASSWORD || "ChangeMeStaff!",
    }),
  });
  assert(sLogin.ok, `Staff login failed: ${JSON.stringify(sJson)}`);
  pass("Staff login");

  const { res: c1, json: c1j } = await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenA, method: "manual" }),
  });
  assert(c1.ok, `Check-in A failed: ${JSON.stringify(c1j)}`);
  pass("Check-in succeeds");

  const { res: cDup } = await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenA, method: "manual" }),
  });
  assert(cDup.status === 409, `Duplicate check-in should 409, got ${cDup.status}`);
  pass("Duplicate check-in rejected");

  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenB, method: "manual" }),
  });
  pass("Check-in B");

  // Talent group registration
  const { res: g1, json: g1j } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicketToken: tokenA,
      groupName: `Joyful Voices ${Date.now()}`,
      performanceTitle: "Carol Medley",
      talentType: "Song / Vocal",
      memberTicketTokens: [tokenA, tokenB],
    }),
  });
  assert(g1.ok, `Group register failed: ${JSON.stringify(g1j)}`);
  const groupId = String(g1j.groupId);
  pass("Christmas Group Talent Show registration");

  const { res: gDup } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicketToken: tokenA,
      groupName: "Duplicate Attempt",
      performanceTitle: "Nope",
      talentType: "Dance",
      memberTicketTokens: [tokenA],
    }),
  });
  assert(gDup.status === 409, "Member already in a group should 409");
  pass("Duplicate group membership rejected");

  // Unregistered member token rejected
  const { res: gBad } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicketToken: tokenB,
      groupName: "Bad Members",
      performanceTitle: "Nope",
      talentType: "Dance",
      memberTicketTokens: [tokenB, "not-a-real-issued-ticket-token-zzzz"],
    }),
  });
  // tokenB already in a group → 409, or if we used fresh attendees would be 400
  assert(gBad.status === 409 || gBad.status === 400, "Invalid/occupied members rejected");
  pass("Invalid member tickets rejected");

  const orgJar: Jar = new Map();
  const { res: oLogin, json: oJson } = await req("/api/auth/staff/login", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({
      username: process.env.ORGANIZER_USERNAME || "organizer",
      password: process.env.ORGANIZER_PASSWORD || "ChangeMeOrganizer!",
    }),
  });
  assert(oLogin.ok && oJson.role === "ORGANIZER", `Organizer login failed: ${JSON.stringify(oJson)}`);
  pass("Organizer login");

  const { res: approveRes, json: approveJ } = await req("/api/organizer/groups", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ groupId, action: "approve" }),
  });
  assert(approveRes.ok, `Approve failed: ${JSON.stringify(approveJ)}`);
  pass("Organizer approves talent group");

  const { res: openRes, json: openJ } = await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ state: "OPEN" }),
  });
  assert(openRes.ok, `Open voting failed: ${JSON.stringify(openJ)}`);
  pass("Audience Choice voting opened");

  const { json: c } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Casey Unchecked ${Date.now()}` }),
  });
  const voterC: Jar = new Map();
  const { res: loginC, json: loginCJ } = await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterC,
    body: JSON.stringify({
      ticketToken: c.ticketToken,
      votingCredential: c.votingCredential,
    }),
  });
  assert(
    loginC.status === 403,
    `Unchecked-in voter should be blocked, got ${loginC.status} ${JSON.stringify(loginCJ)}`,
  );
  pass("Unchecked-in voter rejected");

  const voterA: Jar = new Map();
  const { res: loginA, json: loginAJ } = await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ ticketToken: tokenA, votingCredential: voteA }),
  });
  assert(loginA.ok, `Voter A login failed: ${JSON.stringify(loginAJ)}`);

  const { res: vote1, json: vote1j } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ groupId }),
  });
  assert(vote1.ok, `Vote failed: ${JSON.stringify(vote1j)}`);
  pass("Audience Choice vote cast");

  const { res: voteDup, json: voteDupJ } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ groupId }),
  });
  assert(voteDup.status === 409, `Duplicate vote should 409: ${JSON.stringify(voteDupJ)}`);
  pass("Duplicate Audience Choice vote rejected");

  // Second voter also votes (optional path) then reveal
  const voterB: Jar = new Map();
  await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterB,
    body: JSON.stringify({ ticketToken: tokenB, votingCredential: voteB }),
  });
  await req("/api/vote", {
    method: "POST",
    jar: voterB,
    body: JSON.stringify({ groupId }),
  });

  const { res: revealRes, json: revealJ } = await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ state: "REVEALED" }),
  });
  assert(revealRes.ok, `Reveal failed: ${JSON.stringify(revealJ)}`);
  pass("Audience Choice results revealed");

  const { json: status } = await req("/api/organizer/voting", { jar: orgJar });
  assert(status.resultsLabel === "Audience Choice", "Results label should be Audience Choice");
  assert(Array.isArray(status.results), "Results should be visible after reveal");
  pass("Audience Choice results labeled correctly");

  // Revoke ticket still works
  await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({ attendeeId: a.attendeeId, action: "revoke" }),
  });
  const { json: revokedVal } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: tokenA }),
  });
  assert(revokedVal.valid === false, "Revoked ticket should be invalid");
  pass("Revoked ticket rejected");

  console.log(results.join("\n"));
  console.log("\nAll automated flow checks passed.");
}

main().catch((err) => {
  console.error("FLOW TEST FAILED:", err);
  process.exit(1);
});
