"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type AttendeeRow = {
  id: string;
  fullName: string;
  status: string;
  checkedIn: boolean;
  ticketToken: string | null;
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
  managerName: string;
  attendees: AttendeeRow[];
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
  return localStorage.getItem("uilc_manager_token") || "";
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
    localStorage.setItem("uilc_manager_token", managerToken);
    setState(data);
    setAlloc({});
    setConfirming(false);
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

  async function onPasteToken(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const cleaned = token.trim();
    if (cleaned) {
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
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Your registration</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">Manage attendees</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Private page for the person who registered the group. Each attendee has a
          separate entry ticket — scanning one does not check in the others.
        </p>

        {!state && (
          <form onSubmit={onPasteToken} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="managerToken">
                Private management link or code
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
              {loading ? "Opening…" : "Open registration"}
            </button>
          </form>
        )}

        {state && (
          <div className="mt-8 space-y-6">
            <p className="font-semibold text-[var(--green)]">
              Managed by {state.managerName}
            </p>
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            {message && <p className="font-semibold text-[var(--green)]">{message}</p>}

            <section className="panel p-5">
              <h2 className="brand-mark text-2xl text-[var(--red)]">Attendees & tickets</h2>
              <ul className="mt-4 space-y-3">
                {state.attendees.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-xl border border-[var(--red)]/10 bg-white/70 px-4 py-3"
                  >
                    <p className="font-semibold">{a.fullName}</p>
                    <p className="text-sm text-[var(--ink-soft)]">
                      {a.status}
                      {a.checkedIn ? " · checked in" : ""}
                    </p>
                    {a.ticketToken && (
                      <Link
                        className="mt-2 inline-flex text-sm font-extrabold text-[var(--red)] underline"
                        href={`/ticket#${encodeURIComponent(a.ticketToken)}`}
                      >
                        Open entry ticket
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {state.voting && (
              <section className="panel space-y-4 p-5">
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
      <SiteFooter />
    </div>
  );
}
