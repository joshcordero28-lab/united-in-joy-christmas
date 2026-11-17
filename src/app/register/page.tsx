"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ManageMyTicketsLink } from "@/components/ManageMyTicketsLink";
import { storeManagerToken } from "@/lib/manage-session";

type AttendeeResult = {
  id: string;
  fullName: string;
  status: string;
  ticketNumber?: string;
  ticketToken: string | null;
  votingCredential: string | null;
};

type RegisterResult = {
  partyId: string;
  bookingRef?: string;
  managerName: string;
  managerToken: string | null;
  status: string;
  attendees: AttendeeResult[];
  attendeeCount?: number;
  message: string;
};

type Mode = "solo" | "group";

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [mode, setMode] = useState<Mode>("solo");
  const [managerName, setManagerName] = useState("");
  const [includeSelf, setIncludeSelf] = useState(true);
  const [extraNames, setExtraNames] = useState<string[]>([""]);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const idempotencyKeyRef = useRef(newIdempotencyKey());
  const submittingRef = useRef(false);
  const lastPayloadRef = useRef<Record<string, unknown> | null>(null);

  const previewAttendees = useMemo(() => {
    const names: string[] = [];
    const me = managerName.trim();
    if (mode === "solo") {
      if (me) names.push(me);
      return names;
    }
    if (includeSelf && me) names.push(me);
    for (const n of extraNames.map((x) => x.trim()).filter(Boolean)) {
      names.push(n);
    }
    return names;
  }, [mode, managerName, includeSelf, extraNames]);

  function updateExtra(i: number, value: string) {
    setExtraNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  function addExtra() {
    const selfSlot = includeSelf ? 1 : 0;
    if (selfSlot + extraNames.filter((n) => n.trim()).length >= 8) return;
    if (extraNames.length >= 8) return;
    setExtraNames((prev) => [...prev, ""]);
  }

  function removeExtra(i: number) {
    setExtraNames((prev) => (prev.length <= 1 ? [""] : prev.filter((_, idx) => idx !== i)));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setDuplicatePrompt(false);
    if (next === "solo") {
      setIncludeSelf(true);
      setExtraNames([""]);
    } else if (extraNames.every((n) => !n.trim())) {
      setExtraNames([""]);
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select the text manually.");
    }
  }

  async function submitRegistration(opts: { confirmNewPerson?: boolean } = {}) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);

    const attendees = previewAttendees.map((fullName) => ({ fullName }));
    if (attendees.length < 1) {
      setError(
        mode === "solo"
          ? "Enter your name to get a ticket."
          : "Add at least one attendee, or include yourself as attending.",
      );
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    const form = document.getElementById("register-form") as HTMLFormElement | null;
    const fd = form ? new FormData(form) : new FormData();

    const payload = {
      managerName: managerName.trim(),
      phone: fd.get("phone") || "",
      email: fd.get("email") || "",
      notes: fd.get("notes") || "",
      attendees,
      company: fd.get("company") || "",
      idempotencyKey: idempotencyKeyRef.current,
      confirmNewPerson: Boolean(opts.confirmNewPerson),
    };
    lastPayloadRef.current = payload;

    try {
      // Soft probe (does not create tickets)
      if (!opts.confirmNewPerson) {
        const probe = await fetch("/api/register/check-duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const probeData = await probe.json();
        if (probe.ok && probeData.possibleDuplicate) {
          setDuplicatePrompt(true);
          setError(probeData.message || "It looks like you may already be registered.");
          setLoading(false);
          submittingRef.current = false;
          return;
        }
      }

      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "possible_duplicate") {
          setDuplicatePrompt(true);
          setError(
            data.error ||
              "It looks like you may already be registered for United in Joy Christmas 2026.",
          );
          return;
        }
        setError(data.error || "Registration failed.");
        // New key only when the request failed for a non-idempotent reason
        if (res.status >= 500) {
          idempotencyKeyRef.current = newIdempotencyKey();
        }
        return;
      }
      setDuplicatePrompt(false);
      setResult(data);
      if (data.managerToken) {
        storeManagerToken(data.managerToken);
      }
      const firstTicket = data.attendees?.find((a: AttendeeResult) => a.ticketToken);
      if (firstTicket?.ticketToken) {
        localStorage.setItem("uilc_ticket_token", firstTicket.ticketToken);
        localStorage.setItem("uilc_voting_credential", firstTicket.votingCredential || "");
      }
      // Next fresh registration gets a new key
      idempotencyKeyRef.current = newIdempotencyKey();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitRegistration();
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Join us</p>
        <h1 className="brand-mark text-4xl text-[var(--red)] sm:text-5xl">Register</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Get entry tickets with QR codes for the door. One person can register just
          themselves, or several people in one submission. Already registered?{" "}
          <ManageMyTicketsLink className="font-semibold text-[var(--red)] underline">
            Find My Tickets
          </ManageMyTicketsLink>
          .
        </p>

        {!result ? (
          <form id="register-form" onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <fieldset className="space-y-2">
              <legend className="label !mb-2">Who are you registering?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${
                    mode === "solo"
                      ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                      : "border-[var(--red)]/15 bg-white/70 text-[var(--ink)]"
                  }`}
                  onClick={() => switchMode("solo")}
                  aria-pressed={mode === "solo"}
                >
                  Register myself
                  <span className="mt-1 block text-xs font-normal text-[var(--ink-soft)]">
                    One ticket for you
                  </span>
                </button>
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${
                    mode === "group"
                      ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                      : "border-[var(--red)]/15 bg-white/70 text-[var(--ink)]"
                  }`}
                  onClick={() => switchMode("group")}
                  aria-pressed={mode === "group"}
                >
                  Register multiple people
                  <span className="mt-1 block text-xs font-normal text-[var(--ink-soft)]">
                    You manage tickets for a group
                  </span>
                </button>
              </div>
            </fieldset>

            <div>
              <label className="label" htmlFor="managerName">
                {mode === "solo" ? "Your full name *" : "Your name (registration contact) *"}
              </label>
              <input
                className="field"
                id="managerName"
                name="managerName"
                required
                minLength={2}
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input className="field" id="phone" name="phone" inputMode="tel" />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input className="field" id="email" name="email" type="email" />
            </div>

            {mode === "group" && (
              <fieldset className="space-y-3 rounded-xl border border-[var(--red)]/10 p-3">
                <legend className="px-1 text-sm font-extrabold text-[var(--ink)]">
                  Attendees who need tickets
                </legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={includeSelf}
                    onChange={(e) => setIncludeSelf(e.target.checked)}
                  />
                  <span>
                    I am also attending (include me as an attendee)
                    <span className="mt-0.5 block text-xs font-normal text-[var(--ink-soft)]">
                      Uncheck if you are only registering others and will not attend.
                    </span>
                  </span>
                </label>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                    Additional people
                  </p>
                  {extraNames.map((name, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="field"
                        placeholder="Full name"
                        value={name}
                        onChange={(e) => updateExtra(i, e.target.value)}
                        minLength={2}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-3"
                        onClick={() => removeExtra(i)}
                        aria-label="Remove attendee"
                      >
                        −
                      </button>
                    </div>
                  ))}
                  {extraNames.length < 19 && (
                    <button type="button" className="btn btn-secondary !min-h-10" onClick={addExtra}>
                      Add another person
                    </button>
                  )}
                </div>
              </fieldset>
            )}

            <div className="rounded-xl border border-[var(--gold)]/40 bg-[var(--cream-deep)] p-3 text-sm">
              <p className="font-extrabold text-[var(--red)]">
                Before you submit · {previewAttendees.length} ticket
                {previewAttendees.length === 1 ? "" : "s"}
              </p>
              {previewAttendees.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--ink-soft)]">No attendees listed yet.</p>
              ) : (
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--ink)]">
                  {previewAttendees.map((n, i) => (
                    <li key={`${n}-${i}`}>
                      {n}
                      {mode === "group" && includeSelf && i === 0 && n === managerName.trim()
                        ? " (you)"
                        : ""}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <label className="label" htmlFor="notes">
                Notes (optional)
              </label>
              <textarea className="field min-h-24" id="notes" name="notes" />
            </div>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "-10000px",
                top: "auto",
                width: 1,
                height: 1,
                overflow: "hidden",
              }}
            >
              <label htmlFor="company">Company</label>
              <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            {error && !duplicatePrompt && (
              <p className="font-semibold text-[var(--red)]">{error}</p>
            )}

            {duplicatePrompt && (
              <div className="space-y-3 rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-4">
                <p className="font-extrabold text-[var(--red)]">
                  It looks like you may already be registered for United in Joy Christmas 2026.
                </p>
                <p className="text-sm text-[var(--ink-soft)]">
                  Recover your existing tickets instead of creating a duplicate. We do not show
                  another person&apos;s booking details here.
                </p>
                <ManageMyTicketsLink className="btn btn-primary w-full">
                  Find My Existing Ticket
                </ManageMyTicketsLink>
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  disabled={loading}
                  onClick={() => void submitRegistration({ confirmNewPerson: true })}
                >
                  This Is Someone Else — Continue Registration
                </button>
              </div>
            )}

            {!duplicatePrompt && (
              <button className="btn btn-primary w-full" disabled={loading} type="submit">
                {loading
                  ? "Registering…"
                  : mode === "solo"
                    ? "Get my entry ticket"
                    : `Complete registration (${previewAttendees.length})`}
              </button>
            )}
          </form>
        ) : (
          <div className="panel mt-8 space-y-4 p-5">
            <h2 className="brand-mark text-3xl text-[var(--red)]">Registration Successful!</h2>
            <p className="text-[var(--ink-soft)]">{result.message}</p>

            {result.managerToken && (
              <div className="rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-4">
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--red)]">
                  Your Private Guest Code
                </p>
                <p className="mt-2 break-all font-mono text-sm font-semibold leading-relaxed">
                  {result.managerToken}
                </p>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  Save this code. Use Find My Ticket anytime to reopen your QR
                  {result.attendees.length > 1 ? " tickets" : " ticket"} — you do not need to
                  register again.
                </p>
                {(result.attendeeCount || result.attendees?.length || 0) > 1 && (
                  <p className="mt-2 text-sm font-semibold text-[var(--green)]">
                    {result.attendeeCount || result.attendees.length} attendees included — this
                    code opens the whole group.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-secondary mt-3 w-full"
                  onClick={() => copyText("code", result.managerToken!)}
                >
                  {copied === "code" ? "Copied!" : "Copy Private Guest Code"}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {result.attendees?.[0]?.ticketToken && (
                <Link
                  className="btn btn-primary w-full"
                  href={
                    result.attendees[0].votingCredential
                      ? `/ticket#${encodeURIComponent(result.attendees[0].ticketToken!)}~${encodeURIComponent(result.attendees[0].votingCredential!)}`
                      : `/ticket#${encodeURIComponent(result.attendees[0].ticketToken!)}`
                  }
                >
                  View QR Code
                </Link>
              )}
              {result.managerToken && result.attendees.length > 1 && (
                <ManageMyTicketsLink className="btn btn-secondary w-full" hrefOverride="/manage">
                  View All My Tickets
                </ManageMyTicketsLink>
              )}
              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={() => window.print()}
              >
                Download / Print Tickets
              </button>
              {result.managerToken && (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  onClick={() => {
                    const lines = [
                      `United in Joy Christmas 2026`,
                      `Private Guest Code: ${result.managerToken}`,
                      `Manager: ${result.managerName}`,
                      `Attendees: ${result.attendees?.length || 0}`,
                      ...(result.attendees || []).map((a) => `- ${a.fullName}`),
                      "",
                      "Retrieve tickets with Find My Ticket using your Private Guest Code. Do not register again.",
                    ];
                    void copyText("details", lines.join("\n"));
                  }}
                >
                  {copied === "details" ? "Copied!" : "Save Ticket Details"}
                </button>
              )}
            </div>

            {result.attendees?.some((a) => a.ticketToken) && (
              <div className="space-y-3 print:block">
                <p className="text-sm font-extrabold text-[var(--red)]">
                  {result.attendees.length > 1 ? "All entry tickets" : "Entry ticket"}
                </p>
                {result.attendees.map((a) =>
                  a.ticketToken ? (
                    <div
                      key={a.id}
                      className="rounded-xl border border-[var(--red)]/10 bg-white/70 p-3 text-sm"
                    >
                      <p className="font-semibold">{a.fullName}</p>
                      <Link
                        className="btn btn-primary mt-3 !min-h-10 w-full !text-sm"
                        href={
                          a.votingCredential
                            ? `/ticket#${encodeURIComponent(a.ticketToken!)}~${encodeURIComponent(a.votingCredential)}`
                            : `/ticket#${encodeURIComponent(a.ticketToken!)}`
                        }
                      >
                        View QR Code
                      </Link>
                    </div>
                  ) : (
                    <p key={a.id} className="text-sm text-[var(--ink-soft)]">
                      {a.fullName} — pending approval
                    </p>
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
