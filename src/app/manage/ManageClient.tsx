"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CcfMark } from "@/components/CcfMark";
import {
  MANAGER_TOKEN_STORAGE_KEY,
  storeManagerToken,
} from "@/lib/manage-session";

type AttendeeRow = {
  id: string;
  fullName: string;
  status: string;
  ticketNumber: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  ticketToken: string | null;
  votingCredential?: string | null;
  link: string | null;
  qr: string | null;
};

type HistoryRow = {
  id: string;
  attendeeId: string;
  attendeeName: string;
  action: string;
  method: string | null;
  note: string | null;
  createdAt: string;
};

type VotingInfo = {
  open: boolean;
  resultsPublished: boolean;
  eligible: number;
  used: number;
  remaining: number;
  remainingAttendees: { id: string; fullName: string }[];
  usedVotes: {
    attendeeId: string;
    fullName: string;
    groupId: string;
    groupName: string;
    castBy: string;
  }[];
};

type GroupRow = {
  id: string;
  groupName: string;
  performanceTitle: string;
  talentType: string;
  performanceOrder: number | null;
};

type ManageState = {
  partyId: string;
  bookingRef: string;
  managerName: string;
  manageLink: string;
  dateLabel: string;
  venueLabel: string;
  registeredAt: string;
  totalAttendees: number;
  checkedInCount: number;
  attendees: AttendeeRow[];
  history: HistoryRow[];
  voting?: VotingInfo;
  groups?: GroupRow[];
};

function readManagerToken(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  }
  return localStorage.getItem(MANAGER_TOKEN_STORAGE_KEY) || "";
}

function extractTokenFromPaste(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed, "https://local.invalid");
    if (u.hash && (u.pathname.includes("/manage") || u.pathname.includes("/find"))) {
      return decodeURIComponent(u.hash.slice(1));
    }
  } catch {
    // fall through
  }
  const hashIdx = trimmed.indexOf("#");
  if (hashIdx >= 0 && trimmed.includes("/manage")) {
    try {
      return decodeURIComponent(trimmed.slice(hashIdx + 1));
    } catch {
      return trimmed.slice(hashIdx + 1);
    }
  }
  return trimmed;
}

export function ManageClient() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<ManageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<"group" | "individual">("group");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async (managerToken: string) => {
    setError(null);
    const res = await fetch("/api/manage/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managerToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      setState(null);
      setError(data.error || "Could not open management page.");
      return;
    }
    storeManagerToken(managerToken);
    setState(data);
    setAlloc({});
    setConfirming(false);
    setFocusId(null);
    setViewMode(data.totalAttendees > 1 ? "group" : "individual");
  }, []);

  useEffect(() => {
    const t = readManagerToken();
    setToken(t);
    if (t) {
      load(t).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [load]);

  const allocatedTotal = useMemo(
    () => Object.values(alloc).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    [alloc],
  );

  const remaining = state?.voting?.remaining ?? 0;

  const visibleAttendees = useMemo(() => {
    if (!state) return [];
    if (viewMode === "individual" && focusId) {
      return state.attendees.filter((a) => a.id === focusId);
    }
    return state.attendees;
  }, [state, viewMode, focusId]);

  function setVotesForGroup(groupId: string, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setAlloc((prev) => {
      const next = { ...prev };
      if (n <= 0) delete next[groupId];
      else next[groupId] = n;
      return next;
    });
    setConfirming(false);
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not copy — select and copy manually.");
    }
  }

  function printTickets() {
    window.print();
  }

  async function onPasteToken(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const cleaned = extractTokenFromPaste(token);
    if (cleaned) {
      setToken(cleaned);
      window.location.hash = encodeURIComponent(cleaned);
      await load(cleaned);
    }
    setLoading(false);
  }

  async function submitVotes() {
    if (!state?.voting?.open || !token) return;
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const allocations = Object.entries(alloc)
        .filter(([, votes]) => votes > 0)
        .map(([groupId, votes]) => ({ groupId, votes }));
      const res = await fetch("/api/manage/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerToken: token, confirm: true, allocations }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Vote failed.");
        setConfirming(false);
        return;
      }
      setMessage(data.message || "Votes submitted.");
      await load(token);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="print:hidden">
        <ClientSiteHeader />
      </div>
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)] print:hidden">Your registration</p>
        <h1 className="brand-mark text-4xl text-[var(--red)] print:hidden">Group tickets</h1>
        <p className="mt-2 text-[var(--ink-soft)] print:hidden">
          Private booking page. Each attendee has a separate entry QR — scanning one never
          checks in the whole group.
        </p>

        {!state && (
          <form onSubmit={onPasteToken} className="panel mt-8 space-y-4 p-5 print:hidden">
            <div>
              <label className="label" htmlFor="managerToken">
                Private booking link or access code
              </label>
              <textarea
                id="managerToken"
                className="field min-h-24 font-mono text-sm"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Opening…" : "Open booking"}
            </button>
            <p className="text-center text-sm text-[var(--ink-soft)]">
              Have a booking reference?{" "}
              <Link href="/find" className="font-semibold text-[var(--red)] underline">
                Find tickets
              </Link>
            </p>
          </form>
        )}

        {state && (
          <div className="mt-8 space-y-6">
            <section className="panel space-y-3 p-5 animate-rise">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--red)]">
                    Booking reference
                  </p>
                  <p className="mt-1 font-mono text-2xl font-extrabold tracking-wide text-[var(--ink)]">
                    {state.bookingRef}
                  </p>
                  <p className="mt-2 font-semibold text-[var(--green)]">
                    Managed by {state.managerName}
                  </p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {state.dateLabel} · {state.venueLabel}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--gold)]/50 bg-[var(--cream-deep)] px-4 py-3 text-center">
                  <p className="text-2xl font-extrabold text-[var(--red)]">
                    {state.checkedInCount}/{state.totalAttendees}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                    checked in
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-4 !text-sm"
                  onClick={() => copyText("ref", state.bookingRef)}
                >
                  {copied === "ref" ? "Copied!" : "Copy reference"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-4 !text-sm"
                  onClick={() => copyText("link", state.manageLink)}
                >
                  {copied === "link" ? "Copied!" : "Share booking link"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary !min-h-10 !px-4 !text-sm"
                  onClick={printTickets}
                >
                  Print / save PDF
                </button>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-4 !text-sm"
                  onClick={() => setShowHistory((v) => !v)}
                >
                  {showHistory ? "Hide history" : "Booking history"}
                </button>
              </div>

              {state.totalAttendees > 1 && (
                <div className="flex flex-wrap gap-2 print:hidden">
                  <button
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                      viewMode === "group"
                        ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                        : "border-[var(--red)]/15 bg-white/70"
                    }`}
                    onClick={() => {
                      setViewMode("group");
                      setFocusId(null);
                    }}
                  >
                    All tickets
                  </button>
                  <button
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                      viewMode === "individual"
                        ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                        : "border-[var(--red)]/15 bg-white/70"
                    }`}
                    onClick={() => {
                      setViewMode("individual");
                      setFocusId(state.attendees[0]?.id ?? null);
                    }}
                  >
                    One at a time
                  </button>
                </div>
              )}
            </section>

            {error && <p className="font-semibold text-[var(--red)] print:hidden">{error}</p>}
            {message && <p className="font-semibold text-[var(--green)] print:hidden">{message}</p>}

            {showHistory && (
              <section className="panel p-5 print:hidden">
                <h2 className="brand-mark text-2xl text-[var(--red)]">Check-in history</h2>
                {state.history.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">No check-in events yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {state.history.map((h) => (
                      <li key={h.id} className="rounded-lg border border-[var(--red)]/10 px-3 py-2">
                        <span className="font-semibold">{h.attendeeName}</span> — {h.action}
                        {h.method ? ` (${h.method})` : ""}
                        <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-[var(--ink-soft)]">
                  Registered {new Date(state.registeredAt).toLocaleString()}
                </p>
              </section>
            )}

            <section className="space-y-4" id="group-tickets-print">
              <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <h2 className="brand-mark text-2xl text-[var(--red)]">
                  {viewMode === "individual" ? "Ticket" : "Attendee tickets"}
                </h2>
                {viewMode === "individual" && state.attendees.length > 1 && (
                  <select
                    className="field !min-h-10 !w-auto"
                    value={focusId || ""}
                    onChange={(e) => setFocusId(e.target.value)}
                    aria-label="Choose attendee"
                  >
                    {state.attendees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.fullName}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {visibleAttendees.map((a) => (
                <article
                  key={a.id}
                  className="ticket-print-card relative break-inside-avoid"
                  data-ticket-id={a.id}
                >
                  <div className="ticket-shell px-5 pb-5 pt-6 text-center">
                    <div className="mb-2 flex justify-center">
                      <CcfMark variant="red" />
                    </div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--red)]">
                      Entry ticket
                    </p>
                    <h3 className="brand-mark mt-1 text-2xl text-[var(--red)] sm:text-3xl">
                      UNITED IN JOY
                    </h3>
                    <p className="script-mark text-xl text-[var(--green)]">Christmas 2026</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {state.dateLabel} · {state.venueLabel}
                    </p>
                    <p className="mt-4 text-xl font-extrabold text-[var(--ink)]">{a.fullName}</p>
                    <p className="mt-1 font-mono text-sm font-semibold tracking-wide text-[var(--red)]">
                      {a.ticketNumber}
                    </p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {a.status}
                      {a.checkedIn ? " · checked in" : ""}
                    </p>

                    {a.qr ? (
                      <>
                        <p className="mt-4 text-sm font-extrabold text-[var(--red)]">
                          Show this QR at the door
                        </p>
                        <div className="mx-auto mt-2 inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-3 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.qr}
                            alt={`Entry QR for ${a.fullName}`}
                            className="h-52 w-52 sm:h-56 sm:w-56"
                          />
                        </div>
                      </>
                    ) : (
                      <p className="mt-4 text-sm text-[var(--ink-soft)]">
                        {a.status === "PENDING"
                          ? "QR will appear after approval."
                          : "This ticket is not valid for entry."}
                      </p>
                    )}

                    {a.checkedInAt && (
                      <p className="mt-3 text-sm font-semibold text-[var(--green)]">
                        Checked in {new Date(a.checkedInAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="ticket-stub relative print:hidden">
                    <span className="ticket-notch-left" aria-hidden />
                    <span className="ticket-notch-right" aria-hidden />
                    <div className="flex flex-wrap justify-center gap-2">
                      {a.link && (
                        <>
                          <Link
                            className="btn btn-primary !min-h-10 !px-4 !text-sm"
                            href={
                              a.votingCredential
                                ? `/ticket#${encodeURIComponent(a.ticketToken!)}~${encodeURIComponent(a.votingCredential)}`
                                : `/ticket#${encodeURIComponent(a.ticketToken!)}`
                            }
                          >
                            Open alone
                          </Link>
                          <button
                            type="button"
                            className="btn btn-secondary !min-h-10 !px-4 !text-sm"
                            onClick={() => copyText(`ticket-${a.id}`, a.link!)}
                          >
                            {copied === `ticket-${a.id}` ? "Copied!" : "Copy ticket link"}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-4 !text-sm"
                        onClick={() => {
                          setViewMode("individual");
                          setFocusId(a.id);
                          setTimeout(() => window.print(), 50);
                        }}
                      >
                        Print this
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>

            {state.voting && (
              <section className="panel space-y-4 p-5 print:hidden">
                <h2 className="brand-mark text-2xl text-[var(--red)]">Audience Choice</h2>
                <p className="text-sm text-[var(--ink-soft)]">
                  Eligible {state.voting.eligible} · used {state.voting.used} · remaining{" "}
                  {state.voting.remaining}
                </p>
                <p className="text-sm text-[var(--ink-soft)]">
                  Only checked-in, approved attendees create votes. You may cast remaining
                  votes for them here, or they can vote with their own ticket.
                </p>

                {state.voting.usedVotes.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {state.voting.usedVotes.map((v) => (
                      <li key={v.attendeeId}>
                        {v.fullName}: {v.groupName} (
                        {v.castBy === "MANAGER" ? "by manager" : "by attendee"})
                      </li>
                    ))}
                  </ul>
                )}

                {state.voting.open && state.voting.remaining > 0 && state.groups && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold">
                      Allocate remaining votes ({allocatedTotal}/{remaining} selected)
                    </p>
                    {state.groups.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--red)]/10 px-3 py-3"
                      >
                        <div>
                          <p className="font-semibold text-[var(--red)]">{g.groupName}</p>
                          <p className="text-xs text-[var(--ink-soft)]">{g.performanceTitle}</p>
                        </div>
                        <input
                          className="field !w-20 text-center"
                          type="number"
                          min={0}
                          max={remaining}
                          value={alloc[g.id] ?? 0}
                          onChange={(e) => setVotesForGroup(g.id, e.target.value)}
                          aria-label={`Votes for ${g.groupName}`}
                        />
                      </div>
                    ))}

                    {allocatedTotal > remaining && (
                      <p className="font-semibold text-[var(--red)]">
                        Too many votes selected ({allocatedTotal} &gt; {remaining}).
                      </p>
                    )}

                    {!confirming ? (
                      <button
                        type="button"
                        className="btn btn-primary w-full"
                        disabled={allocatedTotal < 1 || allocatedTotal > remaining}
                        onClick={() => setConfirming(true)}
                      >
                        Review allocation
                      </button>
                    ) : (
                      <div className="space-y-3 rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-4">
                        <p className="font-extrabold text-[var(--red)]">Confirm submission</p>
                        <p className="text-sm">
                          You are about to cast {allocatedTotal} vote
                          {allocatedTotal === 1 ? "" : "s"}. Submitted votes are final and
                          cannot be changed.
                        </p>
                        <ul className="text-sm">
                          {Object.entries(alloc)
                            .filter(([, n]) => n > 0)
                            .map(([groupId, n]) => {
                              const g = state.groups?.find((x) => x.id === groupId);
                              return (
                                <li key={groupId}>
                                  {g?.groupName || groupId}: {n}
                                </li>
                              );
                            })}
                        </ul>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={submitting}
                            onClick={submitVotes}
                          >
                            {submitting ? "Submitting…" : "Confirm & submit"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={submitting}
                            onClick={() => setConfirming(false)}
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {state.voting.open && state.voting.remaining === 0 && (
                  <p className="text-sm font-semibold text-[var(--green)]">
                    No remaining votes for this registration.
                  </p>
                )}

                {!state.voting.open && (
                  <p className="text-sm text-[var(--ink-soft)]">Voting is closed right now.</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}
