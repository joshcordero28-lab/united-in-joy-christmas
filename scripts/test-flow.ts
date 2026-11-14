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

  // Ensure hidden before public checks (previous runs may have revealed voting)
  const orgJar: Jar = new Map();
  {
    const { res: oLogin } = await req("/api/auth/staff/login", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        username: process.env.ORGANIZER_USERNAME || "organizer",
        password: process.env.ORGANIZER_PASSWORD || "ChangeMeOrganizer!",
      }),
    });
    assert(oLogin.ok, "Organizer login for hide");
    await req("/api/organizer/voting", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ visibility: "HIDDEN", state: "CLOSED", resultsPublished: false }),
    });
  }

  {
    const res = await fetch(BASE);
    assert(res.ok, `Home not ok: ${res.status}`);
    const html = await res.text();
    assert(
      !/\b(King|Queen)\b|Audience Choice|Vote for Your Favorite|ballot/i.test(html),
      "Home must not mention voting/King/Queen",
    );
    pass("Home page loads without public voting copy");
  }

  const { res: voteHidden } = await req("/api/vote");
  assert(voteHidden.status === 404, `Vote API must 404 when hidden, got ${voteHidden.status}`);
  pass("Vote API blocked before reveal");

  const { res: votePage } = await req("/vote");
  assert(votePage.status === 404, `Vote page must 404 when hidden, got ${votePage.status}`);
  pass("Vote page blocked before reveal");

  const { res: voterLoginHidden } = await req("/api/auth/voter/login", {
    method: "POST",
    body: JSON.stringify({
      ticketToken: "x".repeat(32),
      votingCredential: "ABCDEFGHIJ",
    }),
  });
  assert(voterLoginHidden.status === 404, "Voter login blocked before reveal");
  pass("Voter login blocked before reveal");

  const { json: navHidden } = await req("/api/public/nav");
  assert(!("audienceChoice" in navHidden), "Nav must omit audienceChoice when hidden");
  pass("Public nav omits Audience Choice while hidden");

  const stamp = Date.now();
  const { res: r1, json: a } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Alex Talent ${stamp}`, phone: "555-0101" }),
  });
  assert(r1.ok, `Register A failed: ${JSON.stringify(a)}`);
  const tokenA = String(a.ticketToken);
  const codeA = String(a.votingCredential);

  const { json: b } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Blake Talent ${stamp}`, phone: "555-0102" }),
  });
  const tokenB = String(b.ticketToken);
  const codeB = String(b.votingCredential);
  pass("Attendees registered");

  const staffJar: Jar = new Map();
  await req("/api/auth/staff/login", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({
      username: process.env.STAFF_USERNAME || "checkin",
      password: process.env.STAFF_PASSWORD || "ChangeMeStaff!",
    }),
  });
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenA, method: "manual" }),
  });
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenB, method: "manual" }),
  });
  pass("Check-ins complete");

  const { res: g1, json: g1j } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicketToken: tokenA,
      groupName: `Joyful Voices ${stamp}`,
      performanceTitle: "Carol Medley",
      talentType: "Song / Vocal",
      memberTicketTokens: [tokenA, tokenB],
    }),
  });
  assert(g1.ok, `Group register failed: ${JSON.stringify(g1j)}`);
  const groupId = String(g1j.groupId);
  pass("Talent group registered");

  await req("/api/organizer/groups", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ groupId, action: "approve" }),
  });
  pass("Group approved");

  // Reveal but keep closed
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "REVEALED", state: "CLOSED" }),
  });
  const { res: voteClosedPage } = await req("/vote");
  assert(voteClosedPage.status === 200, "Vote page visible when revealed but closed");
  const { res: castWhileClosed } = await req("/api/vote", {
    method: "POST",
    body: JSON.stringify({ groupId }),
  });
  // May be 401 (no session) or 403 closed — not 404
  assert(castWhileClosed.status !== 404, "Revealed vote API must not 404");
  pass("Revealed-but-closed: page available, casting still gated");

  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ state: "OPEN" }),
  });
  pass("Voting opened");

  const { json: c } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Casey Unchecked ${stamp}` }),
  });
  const voterC: Jar = new Map();
  const { res: loginC } = await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterC,
    body: JSON.stringify({
      ticketToken: c.ticketToken,
      votingCredential: c.votingCredential,
    }),
  });
  assert(loginC.status === 403, "Unchecked-in voter rejected");
  pass("Unchecked-in voter rejected");

  const voterA: Jar = new Map();
  const { res: loginA } = await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ ticketToken: tokenA, votingCredential: codeA }),
  });
  assert(loginA.ok, "Voter A login");

  const { res: vote1 } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ groupId }),
  });
  assert(vote1.ok, "Vote cast");
  pass("Audience Choice vote cast");

  const { res: voteDup } = await req("/api/vote", {
    method: "POST",
    jar: voterA,
    body: JSON.stringify({ groupId }),
  });
  assert(voteDup.status === 409, "Duplicate vote rejected");
  pass("Duplicate vote rejected");

  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ state: "CLOSED" }),
  });
  pass("Voting closed after ballots");

  const { res: pub, json: pubJ } = await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ resultsPublished: true }),
  });
  assert(pub.ok, `Publish failed: ${JSON.stringify(pubJ)}`);
  pass("Results published");

  const { json: status } = await req("/api/organizer/voting", { jar: orgJar });
  assert(status.publicPhase === "closed_results_published", `phase=${status.publicPhase}`);
  assert(status.resultsLabel === "Audience Choice", "label");
  pass("Organizer phase closed_results_published");

  // Hide again — public blocked
  const { res: hideRes, json: hideJ } = await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "HIDDEN" }),
  });
  assert(hideRes.ok, `Hide failed: ${JSON.stringify(hideJ)}`);
  const { json: afterHide } = await req("/api/organizer/voting", { jar: orgJar });
  assert(afterHide.visibility === "HIDDEN", `visibility after hide=${afterHide.visibility}`);
  const { res: voteHiddenAgain } = await req("/api/vote");
  assert(
    voteHiddenAgain.status === 404,
    `Vote API 404 after hide, got ${voteHiddenAgain.status}`,
  );
  pass("Hiding again blocks public vote API");

  console.log(results.join("\n"));
  console.log("\nAll automated flow checks passed.");
}

main().catch((err) => {
  console.error("FLOW TEST FAILED:", err);
  process.exit(1);
});
