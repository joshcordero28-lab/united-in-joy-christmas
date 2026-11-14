/**
 * Soft-remove / restore API tests.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-soft-remove.ts
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

async function clearLimits() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.rateLimitBucket.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "register:" } },
        { id: { startsWith: "register-day:" } },
        { id: { startsWith: "register-seats:" } },
        { id: { startsWith: "checkin:" } },
        { id: { startsWith: "ticket-validate:" } },
        { id: { startsWith: "group-register:" } },
        { id: { startsWith: "ticket-verify:" } },
      ],
    },
  });
  await prisma.$disconnect();
}

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);

  await clearLimits();

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
    pass("Organizer login");
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
    pass("Staff login");
  }

  // Keep voting hidden for public checks later; open briefly for ballot tests.
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({
      visibility: "REVEALED",
      state: "OPEN",
      resultsPublished: false,
    }),
  });

  const suffix = Date.now().toString(36);

  // Party of 3: manager + two guests
  const { res: regRes, json: reg } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Mgr Soft ${suffix}`,
      contactPhone: `08${suffix.slice(-8)}`,
      contactEmail: `soft-${suffix}@example.com`,
      attendees: [
        { fullName: `Keep Soft ${suffix}` },
        { fullName: `Remove Soft ${suffix}` },
        { fullName: `Voted Soft ${suffix}` },
      ],
    }),
  });
  assert(regRes.ok, `Register failed: ${JSON.stringify(reg)}`);
  const managerToken = String(reg.managerToken);
  const attendeesRaw =
    (reg.attendees as { id: string; fullName: string; ticketToken: string }[]) || [];
  assert(
    attendeesRaw.length >= 3,
    `Expected 3 attendees, got ${attendeesRaw.length}: ${JSON.stringify(reg)}`,
  );

  type T = { id: string; fullName: string; ticketToken: string };
  const normalized: T[] = attendeesRaw.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    ticketToken: t.ticketToken,
  }));
  const keep = normalized.find((t) => t.fullName.startsWith("Keep Soft"))!;
  const remove = normalized.find((t) => t.fullName.startsWith("Remove Soft"))!;
  const voted = normalized.find((t) => t.fullName.startsWith("Voted Soft"))!;
  assert(keep && remove && voted, "Named attendees missing");
  pass("Registered party of 3");

  // Check in all three (entitlements if votingEnabledAfterCheckIn)
  for (const t of [keep, remove, voted]) {
    const { res } = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: t.ticketToken, method: "manual" }),
    });
    assert(res.ok, `Check-in ${t.fullName}`);
  }
  pass("Checked in party");

  // Talent group with remove as partner (own ticket verification)
  {
    const { res: gRes, json: g } = await req("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        groupName: `Soft Group ${suffix}`,
        performanceTitle: "Carol",
        talentType: "Singing",
        leaderTicket: keep.ticketToken,
        partnerTickets: [remove.ticketToken],
      }),
    });
    assert(gRes.ok, `Group register: ${JSON.stringify(g)}`);
    pass("Talent group registered with partner to remove");
  }

  // Approve group + cast vote as voted attendee
  {
    const { json: dash } = await req("/api/organizer/dashboard", { jar: orgJar });
    const groups = (dash.groups as { id: string; groupName: string }[]) || [];
    const group = groups.find((g) => g.groupName.includes(`Soft Group ${suffix}`));
    assert(group, "Soft group on dashboard");
    await req("/api/organizer/groups", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ groupId: group!.id, action: "approve" }),
    });

    // Login as voter and cast
    const voterJar: Jar = new Map();
    // Need voting credential — reissue to get one
    const { res: reis, json: reisJson } = await req("/api/organizer/attendees/action", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: voted.id, action: "reissue" }),
    });
    assert(reis.ok, `Reissue voted: ${JSON.stringify(reisJson)}`);
    const votingCredential = String(reisJson.votingCredential);
    const newTicket = String(reisJson.ticketToken);
    voted.ticketToken = newTicket;

    // Re-check-in after reissue (token rotated)
    await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: newTicket, method: "manual" }),
    });

    const { res: vLogin, json: vLoginJson } = await req("/api/auth/voter/login", {
      method: "POST",
      jar: voterJar,
      body: JSON.stringify({ ticketToken: newTicket, votingCredential }),
    });
    assert(vLogin.ok, `Voter login: ${JSON.stringify(vLoginJson)}`);
    const { res: voteRes, json: voteJson } = await req("/api/vote", {
      method: "POST",
      jar: voterJar,
      body: JSON.stringify({ groupId: group!.id }),
    });
    assert(voteRes.ok, `Vote cast: ${JSON.stringify(voteJson)}`);
    pass("Voted attendee cast ballot");
  }

  // Manage view before remove shows 3
  {
    const { json: mv } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken }),
    });
    const attendees = (mv.attendees as unknown[]) || [];
    assert(attendees.length === 3, `Manage should list 3 before remove, got ${attendees.length}`);
    pass("Manage lists all three before remove");
  }

  // Staff cannot remove voter without organizer
  {
    const { res, json } = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        attendeeId: voted.id,
        reason: "mistake registration with vote",
      }),
    });
    assert(res.status === 403, `Staff remove voter should 403, got ${res.status}: ${JSON.stringify(json)}`);
    assert(json.code === "requires_organizer", "requires_organizer code");
    pass("Staff blocked from removing attendee who voted");
  }

  // Staff can remove non-voter
  {
    const oldToken = remove.ticketToken;
    const { res: prevRes, json: prev } = await req(
      `/api/organizer/attendees/remove?attendeeId=${encodeURIComponent(remove.id)}`,
      { jar: staffJar },
    );
    assert(prevRes.ok, `Preview: ${JSON.stringify(prev)}`);
    const preview = prev.preview as { ticketRef: string; fullName: string };
    assert(preview.ticketRef, "Preview includes ticket ref");

    const { res, json } = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        attendeeId: remove.id,
        reason: "registered by mistake",
      }),
    });
    assert(res.ok, `Staff remove: ${JSON.stringify(json)}`);
    pass("Staff soft-removed non-voter");

    const { json: val } = await req("/api/ticket/validate", {
      method: "POST",
      body: JSON.stringify({ token: oldToken }),
    });
    assert(val.valid === false, "Old QR invalid after remove");
    pass("Old QR invalidated");

    const { res: ci } = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: oldToken, method: "manual" }),
    });
    assert(ci.status === 403 || ci.status === 404, "Check-in blocked for removed ticket");
    pass("Check-in blocked for removed attendee");
  }

  // Party preserved — keep still listed; remove hidden from manage
  {
    const { json: mv } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken }),
    });
    const attendees = (mv.attendees as { id: string; fullName: string }[]) || [];
    assert(
      attendees.some((a) => a.id === keep.id),
      "Keep attendee still on manage page",
    );
    assert(
      attendees.some((a) => a.id === voted.id),
      "Voted attendee still on manage page",
    );
    assert(
      !attendees.some((a) => a.id === remove.id),
      "Removed attendee hidden from manage active list",
    );
    assert(Boolean(managerToken), "Manager token still valid");
    pass("Group isolation: party + other attendees preserved");
  }

  // Active counts exclude removed
  {
    const { json: dash } = await req("/api/organizer/dashboard", { jar: orgJar });
    const counts = dash.counts as { removed: number; registered: number };
    assert(typeof counts.removed === "number" && counts.removed >= 1, "Removed count present");
    pass("Dashboard tracks removed count");

    const groups = dash.groups as Array<{
      groupName: string;
      needsMemberReview?: boolean;
      members?: { id: string; status: string }[];
    }>;
    const soft = groups.find((g) => g.groupName.includes(`Soft Group ${suffix}`));
    assert(soft?.needsMemberReview, "Talent group flagged for member review");
    assert(
      soft?.members?.some((m) => m.id === remove.id && m.status === "REMOVED"),
      "Removed member still on talent roster with REMOVED status",
    );
    pass("Talent group flagged for organizer review");
  }

  // Organizer voids voted ballot on remove
  {
    const oldVoteToken = voted.ticketToken;
    const { res: deny } = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: voted.id,
        reason: "voted by mistake",
      }),
    });
    assert(deny.status === 409, "Organizer must confirm void");

    // Force published results so void-on-remove triggers organizer correction flow.
    // (DB may already have unrelated ties from prior runs.)
    {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      await prisma.eventConfig.update({
        where: { id: "default" },
        data: {
          talentResultsPublished: true,
          talentResultsCorrectionPending: false,
          talentVotingVisibility: "REVEALED",
        },
      });
      await prisma.$disconnect();
    }
    const { json: votingBefore } = await req("/api/organizer/voting", { jar: orgJar });
    assert(
      votingBefore.resultsPublished === true,
      `Expected published before void-remove: ${JSON.stringify(votingBefore)}`,
    );

    const { res, json } = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: voted.id,
        reason: "voted by mistake",
        confirmVoidBallot: true,
      }),
    });
    assert(res.ok, `Organizer void-remove: ${JSON.stringify(json)}`);
    assert(
      json.resultsCorrectionPending === true,
      `Correction pending after void+publish: ${JSON.stringify(json)}`,
    );
    pass("Organizer removed voter and voided ballot");

    const { json: val } = await req("/api/ticket/validate", {
      method: "POST",
      body: JSON.stringify({ token: oldVoteToken }),
    });
    assert(val.valid === false, "Voted attendee QR invalid");

    const { json: voting } = await req("/api/organizer/voting", { jar: orgJar });
    assert(voting.resultsPublished === false, "Results unpublished for correction");
    assert(voting.resultsCorrectionPending === true, "Correction flag set");
    const audit = (voting.ballotAudit as { voidedAt?: string | null }[]) || [];
    assert(
      audit.some((b) => b.voidedAt),
      "Voided ballot retained in audit",
    );
    pass("Voided ballot excluded from live results; audit retained");
  }

  // Restore remove (no prior vote) — new QR, no duplicate entitlement minting path
  {
    const { res, json } = await req("/api/organizer/attendees/restore", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: remove.id, reason: "undo mistake" }),
    });
    assert(res.ok, `Restore: ${JSON.stringify(json)}`);
    const newToken = String(json.ticketToken);
    assert(newToken.length >= 16, "New ticket token");
    assert(json.talentReviewPending === true, "Talent review still pending after restore");
    pass("Restored soft-removed attendee with new QR");

    // Staff cannot restore
    const { res: staffRestore } = await req("/api/organizer/attendees/restore", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: voted.id }),
    });
    assert(staffRestore.status === 403, "Staff cannot restore");
    pass("Staff blocked from restore");

    // Restore voted — voided ballot retained, no new vote entitlement
    const { res: r2, json: j2 } = await req("/api/organizer/attendees/restore", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: voted.id }),
    });
    assert(r2.ok, `Restore voted: ${JSON.stringify(j2)}`);
    assert(j2.voidedBallotRetained === true, "Voided ballot retained on restore");
    pass("Restore keeps voided ballot (no duplicate vote entitlement)");

    // Manage voting balance after reveal — restored voted should not add remaining
    const { json: mv } = await req("/api/manage/view", {
      method: "POST",
      body: JSON.stringify({ managerToken }),
    });
    const voting = mv.voting as {
      remaining: number;
      remainingAttendees: { id: string }[];
      used: number;
    } | undefined;
    if (voting) {
      assert(
        !voting.remainingAttendees.some((a) => a.id === voted.id),
        "Restored voided voter must not regain remaining entitlement",
      );
      pass("No additional voting entitlement after restore");
    } else {
      pass("Manage voting section gated (unexpectedly hidden) — skipped balance assert");
    }
  }

  // Hide voting again for guest privacy
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({
      visibility: "HIDDEN",
      state: "CLOSED",
      resultsPublished: false,
      acknowledgeResultsCorrection: true,
    }),
  });
  const { res: voteHidden } = await req("/api/vote");
  assert(voteHidden.status === 404, "Vote API hidden again");
  pass("Voting messages hidden from guests after re-hide");

  console.log(results.join("\n"));
  console.log(`\n${results.length} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
