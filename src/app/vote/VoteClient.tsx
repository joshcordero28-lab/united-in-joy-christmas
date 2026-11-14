"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type VoteState = {
  voter: { id: string; fullName: string };
  open: boolean;
  resultsPublished: boolean;
  myVote: { groupId: string; createdAt: string } | null;
  groups: {
    id: string;
    groupName: string;
    performanceTitle: string;
    talentType: string;
    performanceOrder: number | null;
  }[];
  results: { groupId: string; groupName: string; votes: number }[] | null;
  resultsLabel: string | null;
};

export function VoteClient({
  initiallyOpen,
  resultsPublished,
}: {
  initiallyOpen: boolean;
  resultsPublished: boolean;
}) {
  const [ticketToken, setTicketToken] = useState("");
  const [votingCredential, setVotingCredential] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [state, setState] = useState<VoteState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTicketToken(localStorage.getItem("uilc_ticket_token") || "");
    setVotingCredential(localStorage.getItem("uilc_voting_credential") || "");
    refresh();
  }, []);

  async function refresh() {
    const res = await fetch("/api/vote");
    if (res.status === 404) {
      // Visibility revoked mid-session
      window.location.href = "/";
      return;
    }
    if (res.ok) {
      setState(await res.json());
      setLoggedIn(true);
    } else {
      setLoggedIn(false);
      setState(null);
    }
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/voter/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketToken, votingCredential }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Login failed.");
      return;
    }
    await refresh();
  }

  async function cast(groupId: string) {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Vote failed.");
      return;
    }
    setMessage("Your vote is locked in. Thank you!");
    await refresh();
  }

  const open = state?.open ?? initiallyOpen;
  const published = state?.resultsPublished ?? resultsPublished;

  return (
    <div className="page-shell">
      <ClientSiteHeader forceAudienceChoice />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Audience Choice</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">
          Vote for Your Favorite Group
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          One vote per checked-in attendee for one approved performing group.
        </p>

        {!loggedIn ? (
          <form onSubmit={login} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="ticketToken">
                Ticket link
              </label>
              <textarea
                id="ticketToken"
                className="field min-h-24 font-mono text-sm"
                value={ticketToken}
                onChange={(e) => setTicketToken(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="votingCredential">
                Voting code
              </label>
              <input
                id="votingCredential"
                className="field tracking-widest"
                value={votingCredential}
                onChange={(e) => setVotingCredential(e.target.value)}
                required
              />
            </div>
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit">
              Continue
            </button>
          </form>
        ) : (
          state && (
            <div className="mt-8 space-y-6">
              <p className="font-semibold text-[var(--green)]">
                Signed in as {state.voter.fullName}
              </p>
              {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
              {message && <p className="font-semibold text-[var(--green)]">{message}</p>}

              {published && state.results && (
                <section className="panel p-5">
                  <h2 className="brand-mark text-2xl text-[var(--red)]">
                    {state.resultsLabel || "Audience Choice"}
                  </h2>
                  <ul className="mt-3 space-y-1">
                    {state.results.map((r) => (
                      <li key={r.groupId}>
                        {r.groupName}: {r.votes}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!open && !published && (
                <p className="panel p-4 text-[var(--ink-soft)]">
                  Voting is closed right now.
                </p>
              )}

              {open && state.myVote && (
                <p className="panel p-4 font-semibold text-[var(--green)]">
                  Your vote is locked in.
                </p>
              )}

              {open && !state.myVote && (
                <div className="space-y-3">
                  {state.groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full rounded-2xl border border-[var(--red)]/15 bg-white/80 px-4 py-4 text-left transition hover:border-[var(--gold)] hover:shadow-md"
                      onClick={() => cast(g.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {g.performanceOrder != null && (
                            <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--green)]">
                              Performance #{g.performanceOrder}
                            </p>
                          )}
                          <p className="brand-mark text-xl text-[var(--red)]">{g.groupName}</p>
                          <p className="text-sm text-[var(--ink)]">{g.performanceTitle}</p>
                          <p className="text-xs text-[var(--ink-soft)]">{g.talentType}</p>
                        </div>
                        <span className="btn btn-primary !min-h-10 !px-4 !text-sm">Vote</span>
                      </div>
                    </button>
                  ))}
                  {state.groups.length === 0 && (
                    <p className="text-[var(--ink-soft)]">No approved groups on the ballot yet.</p>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
