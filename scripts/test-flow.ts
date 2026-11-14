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
  const note = (m: string) => results.push(`NOTE: ${m}`);

  // Health: home
  {
    const res = await fetch(BASE);
    assert(res.ok, `Home not ok: ${res.status}`);
    pass("Home page loads");
  }

  // Register guest A
  const { res: r1, json: a } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: "Alex Guest", phone: "555-0101", email: "alex@example.com" }),
  });
  assert(r1.ok, `Register A failed: ${JSON.stringify(a)}`);
  assert(a.ticketToken && a.votingCredential, "A missing ticket/credential");
  pass("Registration issues ticket + voting credential");

  const tokenA = String(a.ticketToken);
  const voteA = String(a.votingCredential);
  const idA = String(a.attendeeId);

  // Register guest B
  const { res: r2, json: b } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: "Blake Guest", phone: "555-0102" }),
  });
  assert(r2.ok, `Register B failed: ${JSON.stringify(b)}`);
  const tokenB = String(b.ticketToken);
  const voteB = String(b.votingCredential);
  const idB = String(b.attendeeId);
  pass("Second attendee registered");

  // Validate ticket
  const { res: vOk, json: vJson } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: tokenA }),
  });
  assert(vOk.ok && vJson.valid === true, "Valid ticket should validate");
  pass("Ticket validation accepts issued token");

  const { json: badJson } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: "this-is-not-a-real-ticket-token-xxxxx" }),
  });
  assert(badJson.valid === false, "Invalid token should fail");
  pass("Invalid ticket rejected");

  // Staff login + check-in
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

  const { res: cDup, json: cDupJ } = await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenA, method: "manual" }),
  });
  assert(cDup.status === 409, `Duplicate check-in should 409, got ${cDup.status} ${JSON.stringify(cDupJ)}`);
  pass("Duplicate check-in rejected");

  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenB, method: "manual" }),
  });
  pass("Check-in B");

  // Competition entry
  const comps = await req("/api/competitions");
  const list = (comps.json.competitions as { id: string; type: string }[]) || [];
  assert(list.length > 0, "No competitions seeded");
  const individual = list.find((c) => c.type === "INDIVIDUAL")!;
  const { res: e1, json: e1j } = await req("/api/competitions/enter", {
    method: "POST",
    body: JSON.stringify({ competitionId: individual.id, ticketToken: tokenA }),
  });
  assert(e1.ok, `Competition enter failed: ${JSON.stringify(e1j)}`);
  pass("Competition registration");

  const { res: eDup } = await req("/api/competitions/enter", {
    method: "POST",
    body: JSON.stringify({ competitionId: individual.id, ticketToken: tokenA }),
  });
  assert(eDup.status === 409, "Duplicate competition entry should 409");
  pass("Duplicate competition entry rejected");

  // Organizer opens voting
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

  for (const category of ["KING", "QUEEN"]) {
    const { res: openRes, json: openJ } = await req("/api/organizer/voting", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ category, state: "OPEN" }),
    });
    assert(openRes.ok, `Open ${category} failed: ${JSON.stringify(openJ)}`);
  }
  pass("Voting opened for KING and QUEEN");

  // Voter without check-in should fail — register C, don't check in
  const { json: c } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: "Casey Unchecked" }),
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
  assert(loginC.status === 403, `Unchecked-in voter should be blocked, got ${loginC.status} ${JSON.stringify(loginCJ)}`);
  pass("Unchecked-in voter rejected");

  // Vote as A
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
    body: JSON.stringify({ category: "KING", nomineeId: idB }),
  });
  assert(vote1.ok, `Vote failed: ${JSON.stringify(vote1j)}`);
  pass("Vote cast");

  const { res: voteDup, json: voteDupJ } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ category: "KING", nomineeId: idB }),
  });
  assert(voteDup.status === 409, `Duplicate vote should 409: ${JSON.stringify(voteDupJ)}`);
  pass("Duplicate vote rejected");

  // Self-vote disabled
  const { res: selfVote, json: selfJ } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ category: "QUEEN", nomineeId: idA }),
  });
  assert(selfVote.status === 403, `Self-vote should 403: ${JSON.stringify(selfJ)}`);
  pass("Self-vote rejected by default");

  // Revoke ticket and validate
  await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({ attendeeId: idA, action: "revoke" }),
  });
  const { json: revokedVal } = await req("/api/ticket/validate", {
    method: "POST",
    body: JSON.stringify({ token: tokenA }),
  });
  assert(revokedVal.valid === false, "Revoked ticket should be invalid");
  pass("Revoked ticket rejected");

  // Undo check-in audit path
  const { res: undoRes, json: undoJ } = await req("/api/checkin/undo", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ attendeeId: idB, note: "Test correction" }),
  });
  assert(undoRes.ok, `Undo failed: ${JSON.stringify(undoJ)}`);
  pass("Check-in undo / correction works");

  console.log(results.join("\n"));
  console.log("\nAll automated flow checks passed.");
}

main().catch((err) => {
  console.error("FLOW TEST FAILED:", err);
  process.exit(1);
});
