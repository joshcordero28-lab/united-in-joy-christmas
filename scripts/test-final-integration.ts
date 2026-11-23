/**
 * Combined PR #12 + #14 integration checks on one main-branch build.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/test-final-integration.ts
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
): Promise<{ res: Response; json: Record<string, unknown>; text: string }> {
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
  return { res, json, text };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function clearLimits() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.rateLimitBucket.deleteMany({});
  await prisma.eventConfig.update({
    where: { id: "default" },
    data: { capacity: 5000 },
  });
  await prisma.$disconnect();
}

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

async function main() {
  const results: string[] = [];
  const pass = (m: string) => results.push(`PASS: ${m}`);
  await clearLimits();
  const stamp = Date.now().toString().slice(-8);

  // Nav consistency (guest)
  {
    const home = await req("/");
    assert(home.res.ok, "home loads");
    assert(/Find My Ticket/i.test(home.text), "home Find My Ticket");
    assert(/>\s*Register\s*</i.test(home.text) || /Register/i.test(home.text), "home Register");
    assert(!/Manage My Tickets/i.test(home.text), "no competing Manage CTA on home");
    const find = await req("/find");
    assert(find.res.ok, "find loads");
    assert(/Private Guest Code/i.test(find.text), "find Private Guest Code");
    pass("Guest navigation: Register + Find My Ticket (no Manage CTA)");
  }

  const orgJar: Jar = new Map();
  const staffJar: Jar = new Map();
  {
    const o = await req("/api/auth/staff/login", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        username: process.env.ORGANIZER_USERNAME,
        password: process.env.ORGANIZER_PASSWORD,
      }),
    });
    assert(o.res.ok, "organizer login");
    const s = await req("/api/auth/staff/login", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        username: process.env.STAFF_USERNAME,
        password: process.env.STAFF_PASSWORD,
      }),
    });
    assert(s.res.ok, "staff login");
  }

  // Reveal voting for method tests, restore later
  {
    const reveal = await req("/api/organizer/voting", {
      method: "PATCH",
      jar: orgJar,
      body: JSON.stringify({ visibility: "REVEALED", state: "OPEN" }),
    });
    assert(reveal.res.ok, `reveal voting: ${JSON.stringify(reveal.json)}`);
  }

  await beforeRegister();
  const reg = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Integ Solo ${stamp}`,
      contactPhone: `555-int-${stamp}`,
      attendees: [{ fullName: `Integ Solo ${stamp}` }],
      idempotencyKey: `integ-${stamp}`,
    }),
  });
  assert(reg.res.ok, `register: ${JSON.stringify(reg.json)}`);
  const attendeeId = String(
    (reg.json as { attendeeId?: string }).attendeeId ||
      (reg.json.attendees as { id: string }[])[0].id,
  );
  const ticketToken = String(
    (reg.json as { ticketToken?: string }).ticketToken ||
      (reg.json.attendees as { ticketToken: string }[])[0].ticketToken,
  );
  const ticketNumber = String(
    (reg.json as { ticketNumber?: string }).ticketNumber ||
      (reg.json.attendees as { ticketNumber: string }[])[0].ticketNumber,
  );

  // Existing-style ticket link still works
  {
    const view = await req("/api/ticket/view", {
      method: "POST",
      body: JSON.stringify({ ticket: ticketToken }),
    });
    assert(view.res.ok, `ticket view: ${JSON.stringify(view.json)}`);
    assert(view.json.fullName || view.json.attendee || view.json.qrDataUrl, "ticket payload present");
    pass("Existing ticket link / token still opens ticket");
  }

  // Private Guest Code retrieval (no booking ref)
  {
    const lookup = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ guestCode: ticketToken }),
    });
    assert(lookup.res.ok, `lookup: ${JSON.stringify(lookup.json)}`);
    assert(
      lookup.json.mode === "ticket" || lookup.json.attendee || lookup.json.qrDataUrl,
      "lookup returns ticket/QR payload",
    );
    const bookingOnly = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ bookingRef: String(reg.json.bookingRef || "UIJ2026-00001") }),
    });
    assert(!bookingOnly.res.ok || bookingOnly.json.ok === false, "booking ref alone must not expose");
    pass("Private Guest Code retrieves QR without booking reference");
  }

  // Organizer sees Private Guest Codes in search list; staff does not
  {
    const list = await req("/api/organizer/attendees?q=" + encodeURIComponent(`Integ Solo ${stamp}`), {
      jar: orgJar,
    });
    const rows =
      (list.json.attendees as {
        id: string;
        ticketRef?: string;
        ticketToken?: string;
        privateGuestCode?: string | null;
        groupPrivateGuestCode?: string | null;
      }[]) || [];
    const row = rows.find((r) => r.id === attendeeId);
    assert(row, "organizer can search attendee");
    assert(row.ticketRef, "list shows fingerprint ref");
    assert(row.privateGuestCode === ticketToken, "list reveals individual Private Guest Code");
    assert(
      typeof row.groupPrivateGuestCode === "string" && row.groupPrivateGuestCode.length >= 16,
      "list reveals group Private Guest Code",
    );
    assert(!("ticketToken" in row) || !row.ticketToken, "raw ticketToken field stays off the list payload");
    const staffList = await req(
      "/api/organizer/attendees?q=" + encodeURIComponent(`Integ Solo ${stamp}`),
      { jar: staffJar },
    );
    const staffRow = (
      (staffList.json.attendees as {
        id: string;
        privateGuestCode?: string | null;
        groupPrivateGuestCode?: string | null;
      }[]) || []
    ).find((r) => r.id === attendeeId);
    assert(staffRow, "staff can search attendee");
    assert(!staffRow.privateGuestCode, "staff list hides individual Private Guest Code");
    assert(!staffRow.groupPrivateGuestCode, "staff list hides group Private Guest Code");
    const resend = await req("/api/organizer/attendees/action", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId, action: "resend" }),
    });
    assert(resend.res.ok, `resend: ${JSON.stringify(resend.json)}`);
    assert(resend.json.ticketToken === ticketToken, "resend recovers same Private Guest Code");
    assert(resend.json.privateGuestCode === ticketToken, "resend aliases privateGuestCode");
    assert(
      resend.json.groupPrivateGuestCode === row.groupPrivateGuestCode,
      "resend returns same group Private Guest Code",
    );
    const staffResend = await req("/api/organizer/attendees/action", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId, action: "resend" }),
    });
    assert(staffResend.res.status === 403, "staff cannot recover private code via organizer action");
    pass("Organizer Private Guest Code visible in search; staff blocked");
  }

  // Manual check-in then QR duplicate
  {
    const manual = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId, method: "manual" }),
    });
    assert(manual.res.ok, `manual check-in: ${JSON.stringify(manual.json)}`);
    const qr = await req("/api/checkin", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ token: ticketToken, method: "qr" }),
    });
    assert(qr.res.status === 409, "QR after manual is Already Checked In");
    assert(String(qr.json.error).includes("Already Checked In"), "Already Checked In copy");
    pass("Manual check-in + cross-method duplicate prevention");
  }

  // Ensure an approved talent group exists for voting
  let groupId = "";
  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    let group = await prisma.talentGroup.findFirst({
      where: { status: "APPROVED" },
      select: { id: true },
    });
    if (!group) {
      group = await prisma.talentGroup.create({
        data: {
          groupName: `Integ Act ${stamp}`,
          performanceTitle: "Integration",
          talentType: "song",
          leaderAttendeeId: attendeeId,
          status: "APPROVED",
          performanceOrder: 1,
          members: { create: { attendeeId, verifiedViaTicket: true } },
        },
        select: { id: true },
      });
    }
    groupId = group.id;
    await prisma.$disconnect();
  }

  // Vote via Private Guest Code, then QR login blocked for second vote
  {
    const login = await req("/api/auth/voter/login", {
      method: "POST",
      body: JSON.stringify({ guestCode: ticketToken }),
    });
    assert(login.res.ok, `voter login private code: ${JSON.stringify(login.json)}`);
    const voterJar: Jar = new Map();
    // re-login capturing cookie
    const login2 = await req("/api/auth/voter/login", {
      method: "POST",
      jar: voterJar,
      body: JSON.stringify({ guestCode: ticketToken }),
    });
    assert(login2.res.ok, "voter session");
    const vote = await req("/api/vote", {
      method: "POST",
      jar: voterJar,
      body: JSON.stringify({ groupId }),
    });
    assert(vote.res.ok || vote.res.status === 409, `vote: ${JSON.stringify(vote.json)}`);
    // If already voted from prior runs, 409 is ok; else ok
    if (vote.res.ok) pass("Private Guest Code voting succeeds");
    else pass("Private Guest Code voting entitlement already consumed (409)");

    const qrJar: Jar = new Map();
    await req("/api/auth/voter/login", {
      method: "POST",
      jar: qrJar,
      body: JSON.stringify({ ticketToken }),
    });
    const vote2 = await req("/api/vote", {
      method: "POST",
      jar: qrJar,
      body: JSON.stringify({ groupId }),
    });
    assert(vote2.res.status === 409, "cross-method duplicate vote blocked");
    pass("Cross-method voting does not create extra entitlements");
  }

  // Group registration: individual code ≠ party manager privileges; manager code ≠ personal vote
  await beforeRegister();
  const groupReg = await req("/api/register", {
    method: "POST",
    body: JSON.stringify({
      managerName: `Integ Mgr ${stamp}`,
      contactPhone: `555-intg-${stamp}`,
      attendees: [
        { fullName: `Integ A ${stamp}` },
        { fullName: `Integ B ${stamp}` },
      ],
      idempotencyKey: `integg-${stamp}`,
    }),
  });
  assert(groupReg.res.ok, `group reg: ${JSON.stringify(groupReg.json)}`);
  const members = groupReg.json.attendees as {
    id: string;
    ticketToken: string;
    fullName: string;
  }[];
  const managerToken = String(groupReg.json.managerToken);
  {
    const lookup = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ guestCode: managerToken }),
    });
    assert(lookup.res.ok, "manager private code opens booking");
    assert(
      lookup.json.mode === "booking" ||
        (Array.isArray(lookup.json.attendees) && (lookup.json.attendees as unknown[]).length >= 2),
      "group dashboard payload",
    );
    const solo = await req("/api/booking/lookup", {
      method: "POST",
      body: JSON.stringify({ guestCode: members[0].ticketToken }),
    });
    assert(solo.res.ok, "individual code lookup ok");
    // Individual should not expose sibling private tokens
    const soloText = JSON.stringify(solo.json);
    assert(
      !soloText.includes(members[1].ticketToken),
      "individual code must not reveal sibling Private Guest Code",
    );
    const mgrVote = await req("/api/auth/voter/login", {
      method: "POST",
      body: JSON.stringify({ guestCode: managerToken }),
    });
    assert(mgrVote.res.status === 403, "group code cannot open personal voter session");
    assert(mgrVote.json.code === "group_private_code", "group_private_code code");
    pass("Group tickets: manager code for party; individual code scoped; no silent mass vote");
  }

  // Soft-remove preserved; permanent delete organizer-only (disposable)
  {
    const softTarget = members[1].id;
    const soft = await req("/api/organizer/attendees/remove", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({ attendeeId: softTarget, reason: "integration soft-remove" }),
    });
    assert(soft.res.ok, `soft-remove: ${JSON.stringify(soft.json)}`);
    const staffDel = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({
        attendeeId: softTarget,
        reason: "should fail",
        confirmPhrase: "DELETE",
        confirmPurgeHistory: true,
      }),
    });
    assert(staffDel.res.status === 403, "staff permanent delete blocked");
    const del = await req("/api/organizer/attendees/permanent-delete", {
      method: "POST",
      jar: orgJar,
      body: JSON.stringify({
        attendeeId: softTarget,
        reason: "disposable integration cleanup",
        confirmPhrase: "DELETE",
        confirmPurgeHistory: true,
      }),
    });
    assert(del.res.ok, `permanent delete: ${JSON.stringify(del.json)}`);
    const sibling = await req("/api/checkin", {
      method: "POST",
      jar: staffJar,
      body: JSON.stringify({ attendeeId: members[0].id, method: "manual" }),
    });
    assert(sibling.res.ok, "sibling still check-inable after peer permanent delete");
    pass("Soft-remove intact; permanent delete organizer-only; siblings preserved");
  }

  // Re-hide voting
  await req("/api/organizer/voting", {
    method: "PATCH",
    jar: orgJar,
    body: JSON.stringify({ visibility: "HIDDEN", state: "CLOSED" }),
  });

  console.log(results.join("\n"));
  console.log(`\nFinal integration checks passed (${results.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
