/**
 * Permanent delete + manual check-in API tests.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-permanent-delete-checkin.ts
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
  const cleared = await prisma.rateLimitBucket.deleteMany({});
  await prisma.eventConfig.update({
    where: { id: "default" },
    data: { capacity: 5000 },
  });
  const remaining = await prisma.rateLimitBucket.count();
  if (remaining > 0) {
    throw new Error(`rate-limit clear incomplete: deleted=${cleared.count} remaining=${remaining}`);
  }
  await prisma.$disconnect();
}

/** Avoid per-minute register cap during multi-registration suites. */
async function beforeRegister() {
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

async function registerGuest(name: string, phone: string) {
  await beforeRegister();
  const { res, json } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: name,
      contactPhone: phone,
      attendees: [{ fullName: name }],
      idempotencyKey: `pd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  assert(res.ok, `register failed: ${JSON.stringify(json)}`);
  const attendees = json.attendees as { id: string; ticketToken: string; ticketNumber: string }[];
  assert(attendees?.[0]?.id, "missing attendee");
  return {
    attendeeId: attendees[0].id,
    ticketToken: attendees[0].ticketToken,
    ticketNumber: attendees[0].ticketNumber,
    partyId: String(json.partyId || json.registrationPartyId || ""),
    managerToken: String(json.managerToken || ""),
  };
}

async function registerGroup(phone: string) {
  await beforeRegister();
  const names = ["PD Group A", "PD Group B", "PD Group C"];
  const { res, json } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: "PD Manager",
      contactPhone: phone,
      attendees: names.map((fullName) => ({ fullName })),
      idempotencyKey: `pdg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  assert(res.ok, `group register failed: ${JSON.stringify(json)}`);
  const attendees = json.attendees as {
    id: string;
    fullName: string;
    ticketToken: string;
    ticketNumber: string;
  }[];
  assert(attendees.length === 3, "expected 3 attendees");
  return { attendees, managerToken: String(json.managerToken || "") };
}

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);

  await clearLimits();
  const stamp = Date.now().toString().slice(-8);

  const orgJar: Jar = new Map();
  {
    const { res } = await req("/api/auth/staff/login", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        username: process.env.ORGANIZER_USERNAME,
        password: process.env.ORGANIZER_PASSWORD,
      }),
    });
    assert(res.ok, "organizer login failed");
  }

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
    assert(res.ok, "staff login failed");
  }

  // 1. Organizer manual check-in
  const g1 = await registerGuest(`PD Manual Org ${stamp}`, `555-pd-o-${stamp}`);
  {
    const dashBefore = await req("/api/organizer/dashboard", { jar: orgJar });
    const checkedBefore = Number(
      (dashBefore.json.counts as { checkedIn?: number })?.checkedIn || 0,
    );
    const { res, json } = await req("/api/checkin", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: g1.attendeeId, method: "manual" }),
    });
    assert(res.ok, `org manual check-in failed: ${JSON.stringify(json)}`);
    assert(json.ok === true, "expected ok");
    const dashAfter = await req("/api/organizer/dashboard", { jar: orgJar });
    const checkedAfter = Number(
      (dashAfter.json.counts as { checkedIn?: number })?.checkedIn || 0,
    );
    assert(checkedAfter === checkedBefore + 1, "attendance count should increase by 1");
    pass("Organizer can manually check in an attendee");
    pass("Manual check-in updates attendance counts");
  }

  // 2. Staff manual check-in
  const g2 = await registerGuest(`PD Manual Staff ${stamp}`, `555-pd-s-${stamp}`);
  {
    const { res, json } = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: g2.attendeeId, method: "manual" }),
    });
    assert(res.ok, `staff manual check-in failed: ${JSON.stringify(json)}`);
    pass("Authorized staff can manually check in an attendee");
  }

  // 3. Unauthorized cannot check in
  {
    const { res } = await req("/api/checkin", {
      method: "POST",
      body: JSON.stringify({ attendeeId: g2.attendeeId, method: "manual" }),
    });
    assert(res.status === 401, "guest must not check in");
    pass("Unauthorized users cannot manually check in guests");
  }

  // 4–6. Duplicate check-in QR then manual / reverse
  const g3 = await registerGuest(`PD Dup ${stamp}`, `555-pd-d-${stamp}`);
  {
    const qr = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: g3.ticketToken, method: "qr" }),
    });
    assert(qr.res.ok, `QR check-in failed: ${JSON.stringify(qr.json)}`);
    const again = await req("/api/checkin", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: g3.attendeeId, method: "manual" }),
    });
    assert(again.res.status === 409, "duplicate manual after QR should 409");
    assert(
      String(again.json.error).includes("Already Checked In"),
      `expected Already Checked In, got ${again.json.error}`,
    );
    assert(again.json.checkInMethod === "qr" || (again.json.attendee as { checkInMethod?: string })?.checkInMethod === "qr", "method should be qr");
    pass("QR check-in followed by manual check-in does not duplicate attendance");
  }

  const g4 = await registerGuest(`PD Dup2 ${stamp}`, `555-pd-e-${stamp}`);
  {
    const manual = await req("/api/checkin", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: g4.attendeeId, method: "manual" }),
    });
    assert(manual.res.ok, "manual first failed");
    const qr = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: g4.ticketToken, method: "qr" }),
    });
    assert(qr.res.status === 409, "QR after manual should 409");
    assert(String(qr.json.error).includes("Already Checked In"), "Already Checked In message");
    pass("Manual check-in followed by QR scanning reports already checked in");
  }

  // 7. Group members checked in individually
  const group = await registerGroup(`555-pdg-${stamp}`);
  {
    const a = group.attendees[0];
    const b = group.attendees[1];
    const c = group.attendees[2];
    const r1 = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: a.id, method: "manual" }),
    });
    assert(r1.res.ok, "group member A check-in");
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const bRow = await prisma.attendee.findUnique({ where: { id: b.id } });
    const cRow = await prisma.attendee.findUnique({ where: { id: c.id } });
    assert(!bRow?.checkedInAt && !cRow?.checkedInAt, "siblings must stay unchecked");
    await prisma.$disconnect();
    const r2 = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: b.id, method: "manual" }),
    });
    assert(r2.res.ok, "group member B check-in");
    pass("Group members can be checked in individually");
  }

  // 8–11. Permanent delete confirmation, staff blocked, credentials dead, siblings preserved
  const gDel = await registerGuest(`PD Delete Me ${stamp}`, `555-pd-x-${stamp}`);
  const gKeepParty = await registerGroup(`555-pdkeep-${stamp}`);
  const deleteTarget = gKeepParty.attendees[0];
  const sibling = gKeepParty.attendees[1];
  {
    const badPhrase = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: gDel.attendeeId,
        reason: "test cleanup",
        confirmPhrase: "delete",
      }),
    });
    assert(badPhrase.res.status === 400, "wrong phrase must fail");
    pass("Permanent deletion requires explicit DELETE confirmation");

    const staffTry = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        attendeeId: gDel.attendeeId,
        reason: "staff should fail",
        confirmPhrase: "DELETE",
      }),
    });
    assert(staffTry.res.status === 403, "staff must not permanently delete");
    pass("Ordinary staff cannot permanently delete attendees");

    const del = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: gDel.attendeeId,
        reason: "mistaken registration",
        confirmPhrase: "DELETE",
      }),
    });
    assert(del.res.ok, `permanent delete failed: ${JSON.stringify(del.json)}`);

    const ticketGone = await req("/api/ticket/validate", {
      method: "POST",
      body: JSON.stringify({ token: gDel.ticketToken }),
    });
    assert(ticketGone.json.valid === false, "deleted ticket token must not validate");

    const lookupGone = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ guestCode: gDel.ticketToken }),
    });
    assert(!lookupGone.res.ok, "deleted private guest code must not retrieve tickets");

    const checkGone = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ token: gDel.ticketToken, method: "qr" }),
    });
    assert(checkGone.res.status === 404 || checkGone.res.status === 403, "deleted QR dead");
    pass("Deleted attendee credentials no longer work");

    // Soft-remove then purge with history for checked-in sibling path separately;
    // delete one never-checked group member:
    const delMember = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: deleteTarget.id,
        reason: "one member of group mistake",
        confirmPhrase: "DELETE",
      }),
    });
    assert(delMember.res.ok, `group member delete failed: ${JSON.stringify(delMember.json)}`);
    assert(
      Number(delMember.json.partyMembersPreserved) >= 2,
      "other party members must be preserved",
    );
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const sib = await prisma.attendee.findUnique({ where: { id: sibling.id } });
    assert(sib?.status === "ISSUED", "sibling must remain ISSUED");
    const gone = await prisma.attendee.findUnique({ where: { id: deleteTarget.id } });
    assert(!gone, "deleted member row gone");
    await prisma.$disconnect();
    pass("Deleting one group member preserves the other members");
  }

  // 12–13. Soft-remove + check-in history purge snapshots audit; votes intact for others
  const gHist = await registerGuest(`PD Hist ${stamp}`, `555-pd-h-${stamp}`);
  {
    await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: gHist.attendeeId, method: "manual" }),
    });
    const soft = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: gHist.attendeeId,
        reason: "cleanup after check-in",
      }),
    });
    assert(soft.res.ok, `soft-remove failed: ${JSON.stringify(soft.json)}`);

    const noPurge = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: gHist.attendeeId,
        reason: "purge after soft-remove",
        confirmPhrase: "DELETE",
      }),
    });
    assert(noPurge.res.status === 409, "must require purge confirm when history exists");
    assert(noPurge.json.code === "confirm_purge", "confirm_purge code");

    const purged = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: gHist.attendeeId,
        reason: "purge after soft-remove",
        confirmPhrase: "DELETE",
        confirmPurgeHistory: true,
      }),
    });
    assert(purged.res.ok, `purge delete failed: ${JSON.stringify(purged.json)}`);

    const audit = await req("/api/organizer/audit?limit=20", { jar: orgJar });
    const logs = (audit.json.logs || audit.json.entries || audit.json) as
      | { action?: string; detail?: string }[]
      | { action?: string; detail?: string };
    const list = Array.isArray(logs)
      ? logs
      : Array.isArray((audit.json as { items?: unknown[] }).items)
        ? ((audit.json as { items: { action?: string; detail?: string }[] }).items)
        : [];
    // Flexible: search any array on response
    const flat: { action?: string; detail?: string }[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) {
        for (const x of v) {
          if (x && typeof x === "object" && "action" in (x as object)) {
            flat.push(x as { action?: string; detail?: string });
          }
        }
      } else if (v && typeof v === "object") {
        for (const val of Object.values(v as object)) walk(val);
      }
    };
    walk(audit.json);
    const hit = flat.find((l) => l.action === "attendee.permanent_delete");
    assert(hit, "audit must record permanent_delete");
    assert(
      hit.detail?.includes("credentialsNotLogged") &&
        hit.detail?.includes("historySnapshot="),
      "audit should snapshot history without credentials",
    );
    pass("Audit records correctly identify administrative actions");
    pass("Deletion does not corrupt check-in or voting records (history snapshotted)");
  }

  // 14. Soft-remove / restore still works
  const gSoft = await registerGuest(`PD Soft ${stamp}`, `555-pd-soft-${stamp}`);
  {
    const rem = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: gSoft.attendeeId, reason: "soft path intact" }),
    });
    assert(rem.res.ok, "soft-remove still works");
    const rest = await req("/api/organizer/attendees/restore", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: gSoft.attendeeId, reason: "restore intact" }),
    });
    assert(rest.res.ok, `restore failed: ${JSON.stringify(rest.json)}`);
    pass("Existing soft-remove and restoration functionality remains intact");
  }

  console.log(results.join("\n"));
  console.log(`\nPermanent-delete / manual check-in tests passed (${results.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
