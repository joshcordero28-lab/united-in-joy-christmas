"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type AttendeeResult = {
  id: string;
  fullName: string;
  status: string;
  ticketToken: string | null;
  votingCredential: string | null;
};

type RegisterResult = {
  partyId: string;
  managerName: string;
  managerToken: string | null;
  status: string;
  attendees: AttendeeResult[];
  message: string;
  /** Legacy solo fields */
  attendeeId?: string | null;
  fullName?: string;
  ticketToken?: string | null;
  votingCredential?: string | null;
};

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [extraNames, setExtraNames] = useState<string[]>([""]);

  function updateExtra(i: number, value: string) {
    setExtraNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  function addExtra() {
    if (extraNames.length >= 19) return;
    setExtraNames((prev) => [...prev, ""]);
  }

  function removeExtra(i: number) {
    setExtraNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const managerName = String(form.get("managerName") || "").trim();
    const extras = extraNames.map((n) => n.trim()).filter(Boolean);
    const attendees: { fullName: string }[] = [];
    if (includeSelf) attendees.push({ fullName: managerName });
    for (const fullName of extras) attendees.push({ fullName });

    if (attendees.length < 1) {
      setError("Add at least one attendee, or include yourself.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerName,
          phone: form.get("phone"),
          email: form.get("email"),
          notes: form.get("notes"),
          attendees,
          company: form.get("company"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed.");
        return;
      }
      setResult(data);
      if (data.managerToken) {
        localStorage.setItem("uilc_manager_token", data.managerToken);
      }
      const firstTicket = data.attendees?.find((a: AttendeeResult) => a.ticketToken);
      if (firstTicket?.ticketToken) {
        localStorage.setItem("uilc_ticket_token", firstTicket.ticketToken);
        localStorage.setItem("uilc_voting_credential", firstTicket.votingCredential || "");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Join us</p>
        <h1 className="brand-mark text-4xl text-[var(--red)] sm:text-5xl">Register</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Register yourself and anyone else you are bringing. Each person gets a separate
          entry ticket with a QR code for the door.
        </p>

        {!result ? (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="managerName">
                Your name (registration contact) *
              </label>
              <input className="field" id="managerName" name="managerName" required minLength={2} />
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

            <fieldset className="space-y-3 rounded-xl border border-[var(--red)]/10 p-3">
              <legend className="px-1 text-sm font-extrabold text-[var(--ink)]">
                Who needs a ticket?
              </legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={includeSelf}
                  onChange={(e) => setIncludeSelf(e.target.checked)}
                />
                <span>
                  Include me as an attendee
                  <span className="mt-0.5 block text-xs font-normal text-[var(--ink-soft)]">
                    Uncheck if you are only registering others and will not attend.
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                  Additional attendees
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
                    {extraNames.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-3"
                        onClick={() => removeExtra(i)}
                        aria-label="Remove attendee"
                      >
                        −
                      </button>
                    )}
                  </div>
                ))}
                {extraNames.length < 19 && (
                  <button type="button" className="btn btn-secondary !min-h-10" onClick={addExtra}>
                    Add another person
                  </button>
                )}
              </div>
            </fieldset>

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
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading ? "Registering…" : "Complete registration"}
            </button>
          </form>
        ) : (
          <div className="panel mt-8 space-y-4 p-5">
            <h2 className="brand-mark text-3xl text-[var(--red)]">
              You&apos;re in, {result.managerName}!
            </h2>
            <p className="text-[var(--ink-soft)]">{result.message}</p>

            {result.managerToken && (
              <>
                <p className="rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-3 text-sm">
                  <span className="font-extrabold text-[var(--red)]">Private management page</span>
                  <span className="mt-1 block text-xs font-normal text-[var(--ink-soft)]">
                    Keep this link private. It lets you open every ticket for this
                    registration. It is not a door ticket.
                  </span>
                </p>
                <Link
                  className="btn btn-secondary w-full"
                  href={`/manage#${encodeURIComponent(result.managerToken)}`}
                >
                  Open management page
                </Link>
              </>
            )}

            {result.attendees?.some((a) => a.ticketToken) && (
              <div className="space-y-3">
                <p className="text-sm font-extrabold text-[var(--red)]">Entry tickets</p>
                {result.attendees.map((a) =>
                  a.ticketToken ? (
                    <div
                      key={a.id}
                      className="rounded-xl border border-[var(--red)]/10 bg-white/70 p-3 text-sm"
                    >
                      <p className="font-semibold">{a.fullName}</p>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        Private guest code:{" "}
                        <strong className="font-mono tracking-wider text-[var(--red)]">
                          {a.votingCredential}
                        </strong>
                      </p>
                      <Link
                        className="mt-2 inline-flex font-extrabold text-[var(--red)] underline"
                        href={`/ticket#${encodeURIComponent(a.ticketToken)}`}
                      >
                        Open ticket
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
