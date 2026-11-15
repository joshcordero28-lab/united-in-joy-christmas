"use client";

import { FormEvent, useMemo, useState } from "react";
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
};

type Mode = "solo" | "group";

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [mode, setMode] = useState<Mode>("solo");
  const [managerName, setManagerName] = useState("");
  const [includeSelf, setIncludeSelf] = useState(true);
  const [extraNames, setExtraNames] = useState<string[]>([""]);

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
    // Server max is 8 attendees total (including the primary when attending).
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
    if (next === "solo") {
      setIncludeSelf(true);
      setExtraNames([""]);
    } else if (extraNames.every((n) => !n.trim())) {
      setExtraNames([""]);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = managerName.trim();
    const attendees = previewAttendees.map((fullName) => ({ fullName }));

    if (attendees.length < 1) {
      setError(
        mode === "solo"
          ? "Enter your name to get a ticket."
          : "Add at least one attendee, or include yourself as attending.",
      );
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerName: name,
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
          Get entry tickets with QR codes for the door. One person can register just
          themselves, or several people in one submission.
        </p>

        {!result ? (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
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
              {mode === "group" && (
                <p className="mt-2 text-xs text-[var(--ink-soft)]">
                  Contact details above are collected once for the registration manager. Each
                  listed person gets their own QR ticket.
                </p>
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
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading
                ? "Registering…"
                : mode === "solo"
                  ? "Get my entry ticket"
                  : `Complete registration (${previewAttendees.length})`}
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
                    Keep this link private. It opens every ticket for this registration. It is
                    not a door ticket — each person still uses their own QR at check-in.
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
                        href={
                          a.votingCredential
                            ? `/ticket#${encodeURIComponent(a.ticketToken!)}~${encodeURIComponent(a.votingCredential)}`
                            : `/ticket#${encodeURIComponent(a.ticketToken!)}`
                        }
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
