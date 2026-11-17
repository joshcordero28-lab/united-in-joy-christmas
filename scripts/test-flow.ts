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

  // Clear registration rate-limit buckets so repeated local runs are not blocked.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "register:" } },
          { id: { startsWith: "register-day:" } },
          { id: { startsWith: "register-seats:" } },
          { id: { startsWith: "group-register:" } },
          { id: { startsWith: "ticket-verify:" } },
          { id: { startsWith: "from-ticket:" } },
          { id: { startsWith: "booking-lookup:" } },
          { id: { startsWith: "manage-view:" } },
          { id: { startsWith: "ticket-view:" } },
        ],
      },
    });
    await prisma.$disconnect();
  } catch {
    // ignore if DB unavailable — server tests will surface errors
  }

  // Ensure hidden before public checks (previous runs may have revealed voting)
  const orgJar: Jar = new Map();
  {
    const { res: oLogin } = await req("/api/auth/staff/login", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        username: process.env.ORGANIZER_USERNAME,
        password: process.env.ORGANIZER_PASSWORD,
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
    assert(/Manage My Tickets/i.test(html), "Home must show Manage My Tickets CTA");
    assert(/Register for a ticket/i.test(html), "Home must keep Register CTA");
    pass("Home page loads without public voting copy");
    pass("Home shows Manage My Tickets near Register");
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
  const idA = String(a.attendeeId);

  const { json: b } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Blake Talent ${stamp}`, phone: "555-0102" }),
  });
  const tokenB = String(b.ticketToken);
  const idB = String(b.attendeeId);

  const { json: cExtra } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Chris Talent ${stamp}`, phone: "555-0103" }),
  });
  const tokenC = String(cExtra.ticketToken);
  const idC = String(cExtra.attendeeId);
  pass("Attendees registered");

  const { json: fromTicket } = await req("/api/attendees/from-ticket", {
    method: "POST",
    body: JSON.stringify({ ticket: tokenA }),
  });
  assert(fromTicket.id === idA, "from-ticket resolves leader attendee id");
  assert(!("ticketToken" in fromTicket), "from-ticket must not return ticket tokens");
  pass("from-ticket resolves leader without exposing token");

  // --- Talent show ticket verification (before check-in) ---
  const { res: verifyOk, json: verifyJ } = await req("/api/tickets/verify", {
    method: "POST",
    body: JSON.stringify({ ticket: tokenA, includeParty: true }),
  });
  assert(verifyOk.ok, `Verify issued ticket failed: ${JSON.stringify(verifyJ)}`);
  assert(verifyJ.attendee && (verifyJ.attendee as { id: string }).id === idA, "verify returns attendee");
  assert(!("ticketToken" in (verifyJ.attendee as object)), "verify must not echo ticketToken");
  assert(!("phone" in (verifyJ.attendee as object)), "verify must not return phone");
  assert(
    !("partyAttendees" in verifyJ) ||
      !Array.isArray(verifyJ.partyAttendees) ||
      (verifyJ.partyAttendees as unknown[]).length === 0,
    "Ticket verify must not list other party members",
  );
  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const row = await prisma.attendee.findUnique({
      where: { id: idA },
      select: { checkedInAt: true },
    });
    assert(!row?.checkedInAt, "QR verification must not check the attendee in");
    const votes = await prisma.audienceVote.count({ where: { voterId: idA } });
    assert(votes === 0, "Verification must not create votes");
    await prisma.$disconnect();
  }
  pass("Valid issued ticket verifies without check-in or vote changes");

  const { res: verifyBad } = await req("/api/tickets/verify", {
    method: "POST",
    body: JSON.stringify({ ticket: "not-a-real-ticket-zzzz" }),
  });
  assert(verifyBad.status >= 400, "Invalid ticket rejected");
  pass("Invalid ticket rejected for talent verification");

  const { res: verifyEvil } = await req("/api/tickets/verify", {
    method: "POST",
    body: JSON.stringify({ ticket: "https://evil.example/phish#abcdef" }),
  });
  assert(verifyEvil.status >= 400, "Foreign QR URL must be rejected");
  pass("Arbitrary remote QR URLs are not accepted");

  const { res: gNoTicket } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      groupName: `No Ticket ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Dance",
      leaderTicket: "short",
      partnerTickets: [],
    }),
  });
  assert(gNoTicket.status === 401 || gNoTicket.status === 400, "Unregistered/invalid leader blocked");
  pass("Unregistered people cannot submit talent-show entries");

  const { res: gNames } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      groupName: `Name Bypass ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Dance",
      leaderTicket: tokenA,
      memberNames: ["Fake Person"],
      partnerNames: ["Also Fake"],
    }),
  });
  assert(gNames.status === 400, "Free-text name bypass must be rejected");
  pass("Free-text names cannot bypass attendee verification");

  const { res: searchAnon } = await req(
    `/api/attendees/search?q=${encodeURIComponent(`Blake Talent ${stamp}`)}`,
  );
  assert(searchAnon.status === 401, "Public attendee search must require staff login");
  pass("Attendee search is staff-only");

  const staffJar: Jar = new Map();
  await req("/api/auth/staff/login", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({
      username: process.env.STAFF_USERNAME,
      password: process.env.STAFF_PASSWORD,
    }),
  });

  const { json: searchJ } = await req(
    `/api/attendees/search?q=${encodeURIComponent(`Blake Talent ${stamp}`)}`,
    { jar: staffJar },
  );
  const found = (searchJ.attendees as { id: string; fullName: string; contactHint?: string }[]) || [];
  assert(
    found.some((p) => p.id === idB),
    `Staff search must find partner Blake: ${JSON.stringify(searchJ)}`,
  );
  assert(
    found.every((p) => !("ticketToken" in p)),
    "Search results must not include ticket tokens",
  );
  pass("Staff attendee search returns registered guests");
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
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: tokenC, method: "manual" }),
  });
  pass("Check-ins complete");

  // Reject more than 2 partners (3 total with leader)
  const { res: gBad } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: tokenA,
      groupName: `Too Many ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Song / Vocal",
      partnerTickets: [tokenB, tokenC, "extra-token-xxxxxxxx"],
    }),
  });
  assert(gBad.status === 400, "More than 2 partners must be rejected");
  pass("Max 3 members enforced server-side");

  // Party-managed partner selection (same registration)
  const { json: partyTalent } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Talent Lead ${stamp}`,
      attendees: [
        { fullName: `Talent Lead ${stamp}` },
        { fullName: `Talent Mate ${stamp}` },
      ],
    }),
  });
  const leadTok = String((partyTalent.attendees as { ticketToken: string }[])[0].ticketToken);
  const mateId = String((partyTalent.attendees as { id: string }[])[1].id);
  const partyMgr = String(partyTalent.managerToken);

  const { res: gDupIds } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: leadTok,
      groupName: `Dup Ids ${stamp}`,
      performanceTitle: "Dup",
      talentType: "Dance",
      partnerAttendeeIds: [mateId, mateId],
      managerToken: partyMgr,
    }),
  });
  assert(gDupIds.status === 400, "Duplicate partner attendee ids rejected");
  pass("Duplicate members within one entry rejected");

  const { res: gNoMgr } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: leadTok,
      groupName: `No Mgr ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Dance",
      partnerAttendeeIds: [mateId],
    }),
  });
  assert(gNoMgr.status === 401, "Party partner ids require manager token");

  const { res: gParty, json: gPartyJ } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: leadTok,
      groupName: `Party Act ${stamp}`,
      performanceTitle: "Together",
      talentType: "Mixed / Variety",
      partnerAttendeeIds: [mateId],
      managerToken: partyMgr,
      partnerTickets: [],
    }),
  });
  assert(gParty.ok, `Party partner select failed: ${JSON.stringify(gPartyJ)}`);
  assert(gPartyJ.memberCount === 2, "Leader + party mate");
  pass("Group-managed attendees can be selected without rescanning");

  // Foreign attendee id must not join via partnerAttendeeIds
  const { res: gHijack } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: leadTok,
      groupName: `Hijack ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Dance",
      partnerAttendeeIds: [idB],
      managerToken: partyMgr,
    }),
  });
  assert(gHijack.status === 400 || gHijack.status === 401 || gHijack.status === 409, "Cannot add attendees from another registration by id");
  pass("Direct API bypass with foreign attendee ids rejected");

  // Revoked ticket cannot verify / lead
  const { json: revReg } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Revoked Talent ${stamp}` }),
  });
  await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({ attendeeId: revReg.attendeeId, action: "revoke" }),
  });
  const { res: verifyRev } = await req("/api/tickets/verify", {
    method: "POST",
    body: JSON.stringify({ ticket: revReg.ticketToken }),
  });
  assert(verifyRev.status === 403, "Revoked ticket verification rejected");
  const { res: gRev } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: revReg.ticketToken,
      groupName: `Revoked Lead ${stamp}`,
      performanceTitle: "Nope",
      talentType: "Dance",
    }),
  });
  assert(
    gRev.status === 403 || gRev.status === 401,
    `Revoked ticket cannot lead a talent group (got ${gRev.status})`,
  );
  pass("Revoked / cancelled tickets rejected");

  const { res: g1, json: g1j } = await req("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      leaderTicket: tokenA,
      groupName: `Joyful Voices ${stamp}`,
      performanceTitle: "Carol Medley",
      talentType: "Song / Vocal",
      partnerTickets: [tokenB, tokenC],
    }),
  });
  assert(g1.ok, `Group register failed: ${JSON.stringify(g1j)}`);
  assert(g1j.memberCount === 3, `Expected 3 members, got ${g1j.memberCount}`);
  assert(g1j.maxMembers === 3, "maxMembers should be 3");
  const groupId = String(g1j.groupId);
  pass("Talent group registered via partner tickets (max 3)");

  // Organizer sees linked members + verification flags
  const { json: orgGroups } = await req("/api/organizer/groups", { jar: orgJar });
  const listed = ((orgGroups.groups as { id: string; members: { verifiedViaTicket: boolean }[] }[]) || []).find(
    (g) => g.id === groupId,
  );
  assert(listed && listed.members.length === 3, "Organizer groups list linked attendees");
  assert(
    listed!.members.every((m) => m.verifiedViaTicket === true),
    "New entries marked verifiedViaTicket",
  );
  pass("Organizer sees linked attendee verification status");
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

  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "register:" } },
          { id: { startsWith: "register-day:" } },
          { id: { startsWith: "register-seats:" } },
        ],
      },
    });
    await prisma.$disconnect();
  }
  const { res: regC, json: c } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Casey Unchecked ${stamp}` }),
  });
  assert(regC.ok, `Unchecked registrant failed: ${JSON.stringify(c)}`);
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
    `Unchecked-in voter rejected (got ${loginC.status}: ${JSON.stringify(loginCJ)})`,
  );
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

  // --- Registration parties & manager entitlements ---
  const { res: partyRes, json: party } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Jordan Manager ${stamp}`,
      phone: "555-0199",
      attendees: [
        { fullName: `Jordan Manager ${stamp}` },
        { fullName: `Sam Guest ${stamp}` },
        { fullName: `Riley Guest ${stamp}` },
        { fullName: `Casey Guest ${stamp}` },
        { fullName: `Avery Guest ${stamp}` },
      ],
    }),
  });
  assert(partyRes.ok, `Party register failed: ${JSON.stringify(party)}`);
  assert(Array.isArray(party.attendees) && party.attendees.length === 5, "Party must create 5 tickets");
  assert(typeof party.managerToken === "string" && party.managerToken.length >= 16, "managerToken required");
  assert(
    typeof party.bookingRef === "string" && /^UIJ2026-\d{5}$/.test(String(party.bookingRef)),
    `bookingRef required, got ${party.bookingRef}`,
  );
  const partyTokens = (party.attendees as {
    ticketToken: string;
    votingCredential: string;
    id: string;
    fullName: string;
    ticketNumber: string;
  }[]);
  const tokenSet = new Set(partyTokens.map((t) => t.ticketToken));
  assert(tokenSet.size === 5, "Each attendee needs a unique ticket");
  assert(!tokenSet.has(String(party.managerToken)), "Manager token must not equal a ticket");
  assert(
    partyTokens.every((t, i) => t.ticketNumber === `${party.bookingRef}-${String(i + 1).padStart(2, "0")}`),
    "Ticket numbers must follow bookingRef-NN",
  );
  pass("Group registration creates separate tickets + manager token");

  const { json: manageBeforeCheckin } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  // Voting already revealed/open in this phase — balance should appear
  assert(manageBeforeCheckin.voting, "Manage view should expose balance while voting revealed");
  assert(manageBeforeCheckin.voting.eligible === 0, "No check-ins yet → 0 eligible");
  assert(manageBeforeCheckin.voting.remaining === 0, "No check-ins → 0 remaining");
  pass("Unchecked party has zero voting entitlements");

  // Hide voting briefly to ensure manage page omits all ballot fields
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "HIDDEN", state: "CLOSED" }),
  });
  const { json: manageWhenHidden } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  assert(!("voting" in manageWhenHidden), "Manage page must omit voting while hidden");
  assert(!("groups" in manageWhenHidden), "Manage page must omit ballot groups while hidden");
  const { res: manageVoteHidden } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: party.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 1 }],
    }),
  });
  assert(manageVoteHidden.status === 404, "Manage vote API 404 while hidden");
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "REVEALED", state: "OPEN" }),
  });
  pass("Voting remains completely hidden on manage surfaces before reveal");

  // Partial check-in: 3 of 5
  for (const t of partyTokens.slice(0, 3)) {
    const { res: ci } = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: t.ticketToken, method: "manual" }),
    });
    assert(ci.ok, `Check-in failed for ${t.fullName}`);
  }
  // Re-check same ticket — no extra entitlement
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: partyTokens[0].ticketToken, method: "manual" }),
  });

  const { json: managePartial } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  assert(managePartial.voting.eligible === 3, `eligible expected 3 got ${managePartial.voting.eligible}`);
  assert(managePartial.voting.remaining === 3, "remaining should be 3 after partial check-in");
  pass("Partial group check-in grants only corresponding votes");

  // Over-allocate must fail completely (remaining is 3)
  const { res: overRes, json: overJ } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: party.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 4 }],
    }),
  });
  assert(overRes.status === 409, `Over-limit must 409, got ${overRes.status}: ${JSON.stringify(overJ)}`);
  const { json: afterOver } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  assert(afterOver.voting.used === 0, "Over-limit must not record partial votes");
  pass("Excessive allocation rejected with no partial recording");

  // Split: 2 votes now
  const { res: splitRes, json: splitJ } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: party.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 2 }],
    }),
  });
  assert(splitRes.ok, `Split vote failed: ${JSON.stringify(splitJ)}`);
  assert(splitJ.cast === 2, "Expected 2 manager votes");
  const { json: afterSplit } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: party.managerToken }),
  });
  assert(afterSplit.voting.used === 2 && afterSplit.voting.remaining === 1, "2 used / 1 remaining");
  pass("Partial manager voting leaves remaining balance");

  // Remaining attendee self-vote competes for last entitlement
  const lastEligible = (afterSplit.voting.remainingAttendees as { id: string }[])[0];
  const lastPerson = partyTokens.find((t) => t.id === lastEligible.id)!;
  const voterLast: Jar = new Map();
  const { res: loginLast } = await req("/api/auth/voter/login", {
    method: "POST",
    jar: voterLast,
    body: JSON.stringify({
      ticketToken: lastPerson.ticketToken,
      votingCredential: lastPerson.votingCredential,
    }),
  });
  assert(loginLast.ok, "Last eligible attendee voter login");
  const { res: selfLast } = await req("/api/vote", {
    method: "POST",
    jar: voterLast,
    body: JSON.stringify({ groupId }),
  });
  assert(selfLast.ok, "Self vote on remaining entitlement");

  const { res: mgrRace } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: party.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 1 }],
    }),
  });
  assert(mgrRace.status === 409, "Manager cannot reuse entitlement already cast by attendee");
  pass("Self and manager share the same entitlement");

  // Simultaneous-ish retries: replay same manager allocation after exhausted
  const { res: retryRes } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: party.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 1 }],
    }),
  });
  assert(retryRes.status === 409, "Retry after exhausted remaining must fail");
  pass("Retries do not create duplicate votes");

  // Ticket-only access must not unlock manage for other tickets
  const { res: badManage } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: partyTokens[1].ticketToken }),
  });
  assert(badManage.status === 401, "Ticket token must not open management page");
  pass("Ticket credential does not grant group management");

  // Manager-not-attendee registration
  const { json: mgrOnly } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Pat NonAttendee ${stamp}`,
      attendees: [{ fullName: `Only Guest ${stamp}` }],
    }),
  });
  assert(mgrOnly.attendees.length === 1, "Manager-only contact creates one attendee ticket");
  assert(
    (mgrOnly.attendees as { fullName: string }[])[0].fullName === `Only Guest ${stamp}`,
    "Sole ticket is the guest, not the manager",
  );
  pass("Manager not included unless listed as attendee");

  // Cancelled / revoked attendee: no unused entitlement
  const { json: revokeParty } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Revoke Case ${stamp}`,
      attendees: [
        { fullName: `Revoke Case ${stamp}` },
        { fullName: `Revoked Friend ${stamp}` },
      ],
    }),
  });
  const revokeFriend = (revokeParty.attendees as { id: string; ticketToken: string }[])[1];
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: (revokeParty.attendees as { ticketToken: string }[])[0].ticketToken, method: "manual" }),
  });
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: revokeFriend.ticketToken, method: "manual" }),
  });
  await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({ attendeeId: revokeFriend.id, action: "revoke" }),
  });
  const { json: revokeView } = await req("/api/manage/view", {
    method: "POST",
    body: JSON.stringify({ managerToken: revokeParty.managerToken }),
  });
  assert(revokeView.voting.eligible === 1, "Revoked attendee drops from eligible pool");
  pass("Revoked attendees receive no unused voting entitlement");

  // All-to-one-group path (fresh party, both checked in)
  const { json: allOne } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `AllOne ${stamp}`,
      attendees: [
        { fullName: `AllOne ${stamp}` },
        { fullName: `AllTwo ${stamp}` },
      ],
    }),
  });
  for (const t of allOne.attendees as { ticketToken: string }[]) {
    await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: t.ticketToken, method: "manual" }),
    });
  }
  const { res: allRes, json: allJ } = await req("/api/manage/vote", {
    method: "POST",
    body: JSON.stringify({
      managerToken: allOne.managerToken,
      confirm: true,
      allocations: [{ groupId, votes: 2 }],
    }),
  });
  assert(allRes.ok, `All-to-one failed: ${JSON.stringify(allJ)}`);
  assert(allJ.cast === 2, "All remaining votes to one group");
  pass("Manager can cast all available votes for one performing group");

  // Solo legacy still works
  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "register:" } },
          { id: { startsWith: "register-day:" } },
          { id: { startsWith: "register-seats:" } },
        ],
      },
    });
    await prisma.$disconnect();
  }
  const { res: soloRes, json: solo } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({ fullName: `Solo Legacy ${stamp}`, phone: "555-0000" }),
  });
  assert(soloRes.ok && solo.ticketToken && solo.managerToken, "Solo registration still works");
  assert(solo.attendees.length === 1, "Solo maps to party of one");
  assert(typeof solo.bookingRef === "string", "Solo registration includes bookingRef");
  pass("Existing individual registration shape continues to work");

  // --- Group ticket dashboard + secure lookup ---
  {
    const sizes = [1, 2, 5] as const;
    for (const size of sizes) {
      const attendees = Array.from({ length: size }, (_, i) => ({
        fullName: `Lookup ${size}p ${i + 1} ${stamp}`,
      }));
      const { res: gRes, json: g } = await req("/api/register", {
        method: "POST",
        body: JSON.stringify({
          managerName: `Lookup Mgr ${size} ${stamp}`,
          attendees,
        }),
      });
      assert(gRes.ok, `${size}-person register failed: ${JSON.stringify(g)}`);
      assert(g.attendees.length === size, `${size}-person party size`);
      assert(/^UIJ2026-\d{5}$/.test(String(g.bookingRef)), `${size}-person bookingRef`);

      const { res: dashRes, json: dash } = await req("/api/manage/view", {
        method: "POST",
        body: JSON.stringify({ managerToken: g.managerToken }),
      });
      assert(dashRes.ok, `${size}-person manage view`);
      assert(dash.bookingRef === g.bookingRef, "Dashboard bookingRef matches");
      assert(dash.totalAttendees === size, "Dashboard totalAttendees");
      assert(Array.isArray(dash.attendees) && dash.attendees.length === size, "Dashboard attendee cards");
      assert(
        (dash.attendees as { qr: string | null }[]).every((a) => typeof a.qr === "string" && a.qr.startsWith("data:")),
        `${size}-person dashboard includes QR images`,
      );

      const { res: fullLookup, json: fullJ } = await req("/api/booking/lookup", {
        method: "POST",
        body: JSON.stringify({
          bookingRef: g.bookingRef,
          accessToken: g.managerToken,
        }),
      });
      assert(fullLookup.ok && fullJ.mode === "booking", `${size}-person booking lookup`);
      assert(fullJ.totalAttendees === size, "Lookup returns full group");

      const first = (g.attendees as { ticketNumber: string; ticketToken: string; fullName: string })[0];
      const { res: oneRes, json: oneJ } = await req("/api/booking/lookup", {
        method: "POST",
        body: JSON.stringify({ ticketNumber: first.ticketNumber }),
      });
      assert(oneRes.ok && oneJ.mode === "ticket", "Ticket-number lookup");
      assert(oneJ.fullName === first.fullName, "Ticket lookup returns that attendee");
      assert(!("attendees" in oneJ), "Ticket lookup must not include group attendees");
      assert(!("managerToken" in oneJ) && !("manageLink" in oneJ), "Ticket lookup hides manage credentials");

      // Check-in still per QR; no cross-check-in
      const staffJarLocal = staffJar;
      const { res: ciOne } = await req("/api/checkin", {
        method: "POST",
        jar: staffJarLocal,
        body: JSON.stringify({ token: first.ticketToken, method: "manual" }),
      });
      assert(ciOne.ok, `${size}-person single check-in`);
      const { json: afterCi } = await req("/api/manage/view", {
        method: "POST",
        body: JSON.stringify({ managerToken: g.managerToken }),
      });
      assert(afterCi.checkedInCount === 1, "Only one attendee checked in");
      if (size > 1) {
        const others = (afterCi.attendees as { checkedIn: boolean }[]).filter((a) => a.checkedIn);
        assert(others.length === 1, "Grouping does not auto-check-in others");
      }
      pass(`${size}-person booking dashboard + lookup`);
    }

    // Security: booking ref alone must not expose group / QRs
    const { res: refOnly, json: refOnlyJ } = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ bookingRef: party.bookingRef }),
    });
    assert(refOnly.status === 401, "Booking ref alone rejected");
    assert(!("attendees" in refOnlyJ) && !("qr" in refOnlyJ), "Ref-only response has no tickets");
    pass("Booking ref alone does not expose group");

    const { res: badPair } = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({
        bookingRef: party.bookingRef,
        accessToken: "x".repeat(32),
      }),
    });
    assert(badPair.status === 401, "Wrong access token rejected");
    pass("Wrong booking access token rejected");

    // Existing party still loads after bookingRef migration fields
    const { res: existingDash, json: existingJ } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken: party.managerToken }),
    });
    assert(existingDash.ok, "Existing 5-person party dashboard loads");
    assert(existingJ.bookingRef === party.bookingRef, "Existing party bookingRef stable");
    assert(existingJ.totalAttendees === 5, "Existing party membership preserved");
    pass("Existing groups keep attendees + bookingRef");

    // Ticket view exposes booking metadata but not other guests
    const sample = partyTokens[0];
    const { res: tvRes, json: tv } = await req("/api/ticket/view", {
      method: "POST",
      body: JSON.stringify({ ticket: sample.ticketToken }),
    });
    assert(tvRes.ok, "Ticket view ok");
    assert(tv.bookingRef === party.bookingRef, "Ticket view shows bookingRef");
    assert(tv.partySize === 5, "Ticket view shows party size");
    assert(tv.ticketNumber === sample.ticketNumber, "Ticket view shows ticketNumber");
    assert(!("attendees" in tv), "Single ticket view has no group list");
    pass("Primary ticket page stays single-attendee with group hint");
  }

  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ state: "CLOSED" }),
  });
  pass("Voting closed after ballots");

  let { res: pub, json: pubJ } = await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ resultsPublished: true }),
  });
  if (!pub.ok && Array.isArray(pubJ.tied)) {
    ({ res: pub, json: pubJ } = await req("/api/organizer/voting", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ resultsPublished: true, resolveTieGroupId: groupId }),
    }));
  }
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
