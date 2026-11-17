/**
 * Duplicate prevention, idempotent register, resend vs replace QR.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-duplicate-recovery.ts
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
        { id: { startsWith: "register-dup:" } },
        { id: { startsWith: "booking-lookup:" } },
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

  // 1. Register one guest
  const email = `dup.${stamp}@example.com`;
  const phone = `555${String(stamp).slice(-7)}`;
  const { res: r1, json: a } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Dup Guest ${stamp}`,
      email,
      phone,
      idempotencyKey: `key-a-${stamp}`,
    }),
  });
  assert(r1.ok, `Register 1: ${JSON.stringify(a)}`);
  const token1 = String(a.ticketToken);
  const ticketNumber1 = String(a.ticketNumber);
  const bookingRef1 = String(a.bookingRef);
  pass("Register one guest successfully");

  // 2. Duplicate warning
  const { res: r2, json: dup } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Dup Guest ${stamp}`,
      email,
      phone,
      idempotencyKey: `key-b-${stamp}`,
    }),
  });
  assert(r2.status === 409 && dup.code === "possible_duplicate", "Duplicate blocked");
  assert(!("managerToken" in dup) || !dup.managerToken, "No token leaked on duplicate");
  assert(!("ticketToken" in dup) || !dup.ticketToken, "No ticket leaked on duplicate");
  pass("Same guest registration shows duplicate warning");

  // 3. Same name, different contact → allowed
  const { res: r3, json: other } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Dup Guest ${stamp}`,
      email: `other.${stamp}@example.com`,
      phone: `556${String(stamp).slice(-7)}`,
      idempotencyKey: `key-c-${stamp}`,
    }),
  });
  assert(r3.ok, `Same name different contact: ${JSON.stringify(other)}`);
  pass("Two different people with the same name can register");

  // 4. Idempotent double-submit
  const { res: r4a, json: first } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Idem ${stamp}`,
      email: `idem.${stamp}@example.com`,
      phone: `557${String(stamp).slice(-7)}`,
      idempotencyKey: `idem-${stamp}`,
    }),
  });
  assert(r4a.ok, "Idempotent first submit");
  const { res: r4b, json: second } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Idem ${stamp}`,
      email: `idem.${stamp}@example.com`,
      phone: `557${String(stamp).slice(-7)}`,
      idempotencyKey: `idem-${stamp}`,
      confirmNewPerson: true,
    }),
  });
  assert(r4b.ok, "Idempotent retry ok");
  assert(second.partyId === first.partyId, "Same party returned for same idempotency key");
  assert(second.ticketToken === first.ticketToken, "Same ticket token replayed");
  pass("Repeated clicks with same idempotency key do not create duplicates");

  // 5–6. Recovery without original URL
  const { res: lookup, json: lookJ } = await req("/api/booking/lookup", {
    method: "POST",
    body: JSON.stringify({
      bookingRef: bookingRef1,
      accessToken: a.managerToken,
    }),
  });
  assert(lookup.ok && lookJ.mode === "booking", "Recover booking via ref + access");
  assert(lookJ.totalAttendees === 1, "Group dashboard for solo party");
  const { res: byTicket, json: tJ } = await req("/api/booking/lookup", {
    method: "POST",
    body: JSON.stringify({ ticket: token1 }),
  });
  assert(byTicket.ok && tJ.mode === "ticket", "Recover via opaque ticket");
  pass("Recover ticket without original registration URL");
  pass("Retrieve tickets for authorized booking");

  // Organizer login
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
    assert(res.ok, "Organizer login");
  }

  // 7. Resend — same QR
  const { res: resend, json: resendJ } = await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({ attendeeId: a.attendeeId, action: "resend" }),
  });
  assert(resend.ok, `Resend: ${JSON.stringify(resendJ)}`);
  assert(resendJ.ticketToken === token1, "Resend keeps same ticket token / QR");
  assert(resendJ.ticketNumber === ticketNumber1, "Resend keeps ticket number");
  assert(resendJ.qrRotated === false, "Resend does not rotate QR");
  pass("Re-send existing ticket without new attendee or QR");

  // Check-in then replace QR
  const staffJar: Jar = new Map();
  await req("/api/auth/staff/login", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({
      username: process.env.STAFF_USERNAME,
      password: process.env.STAFF_PASSWORD,
    }),
  });
  await req("/api/checkin", {
    method: "POST",
    jar: staffJar,
    body: JSON.stringify({ token: token1, method: "manual" }),
  });

  // 8. Replace QR — old rejected
  const { res: replace, json: repJ } = await req("/api/organizer/attendees/action", {
    method: "POST",
    jar: orgJar,
    body: JSON.stringify({
      attendeeId: a.attendeeId,
      action: "replace_qr",
      reason: "compromised QR for test",
    }),
  });
  assert(replace.ok, `Replace: ${JSON.stringify(repJ)}`);
  assert(repJ.ticketToken !== token1, "Replace rotates token");
  assert(repJ.ticketNumber === ticketNumber1, "Ticket number unchanged after replace");
  assert(repJ.qrRotated === true, "qrRotated flag");

  const { res: oldView } = await req("/api/ticket/view", {
    method: "POST",
    body: JSON.stringify({ ticket: token1 }),
  });
  assert(oldView.status === 404, "Old QR rejected after replace");

  const { json: after } = await req("/api/organizer/attendees?q=" + encodeURIComponent(ticketNumber1), {
    jar: orgJar,
  });
  const row = (after.attendees as { id: string; checkedInAt: string | null }[]).find(
    (x) => x.id === a.attendeeId,
  );
  assert(row && row.checkedInAt, "Check-in preserved after QR replace");
  pass("Replace QR invalidates old credential");
  pass("Check-in preserved after QR replace");

  // 9–10. No extra vote entitlement from resend/replace (one attendee row still)
  const { json: afterReplaceList } = await req(
    "/api/organizer/attendees?q=" + encodeURIComponent(bookingRef1),
    { jar: orgJar },
  );
  const partyRows = (
    afterReplaceList.attendees as { id: string; bookingRef?: string; ticketNumber: string }[]
  ).filter((x) => x.id === a.attendeeId || x.ticketNumber === ticketNumber1);
  assert(partyRows.length === 1, "Still a single attendee row after resend/replace");
  // Attendee count for the booking should remain 1 (no duplicate created)
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const partyCount = await prisma.attendee.count({
    where: { registrationParty: { bookingRef: bookingRef1 }, status: { not: "REMOVED" } },
  });
  await prisma.$disconnect();
  assert(partyCount === 1, `Expected 1 attendee on booking, got ${partyCount}`);
  pass("No additional voting eligibility created");
  pass("Existing check-in/voting rules unchanged");

  // 11. Audit logged
  const { json: audit } = await req("/api/organizer/audit", { jar: orgJar });
  const actions = (audit.logs as { action: string; entityId: string }[]).map((l) => l.action);
  assert(actions.includes("attendee.resend"), "Resend audited");
  assert(actions.includes("attendee.replace_qr"), "Replace audited");
  pass("Organizer actions are logged");

  // confirmNewPerson allows intentional second registration with same contact
  await clearLimits();
  const { res: force, json: forceJ } = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      fullName: `Forced Other ${stamp}`,
      email,
      phone,
      confirmNewPerson: true,
      idempotencyKey: `force-${stamp}`,
    }),
  });
  assert(force.ok, `confirmNewPerson continues: ${JSON.stringify(forceJ)}`);
  assert(forceJ.partyId !== a.partyId, "New party created when confirmed different person");
  pass("Someone-else continue path creates a new registration");

  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "HIDDEN", state: "CLOSED" }),
  });

  console.log(results.join("\n"));
  console.log(`\nDuplicate/recovery tests passed (${results.length}).`);
}

main().catch((err) => {
  console.error("DUPLICATE/RECOVERY TEST FAILED:", err);
  process.exit(1);
});
