"use client";

import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type VoteState = {
  voter: { id: string; fullName: string };
  talentVotingState: string;
  myVote: { groupId: string; createdAt: string } | null;
  groups: {
    id: string;
    groupName: string;
    performanceTitle: string;
    talentType: string;
    performanceOrder: number | null;
  }[];
  label: string;
  resultsLabel: string;
};

export default function VotePage() {
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
    setMessage("Your Audience Choice vote is locked in.");
    await refresh();
  }

  return (
    <div className="page-shell">
      <SiteHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Audience Choice</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">
          Vote for Your Favorite Group
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          One vote per checked-in attendee for one approved talent-show group. Totals
          stay hidden until the organizer reveals Audience Choice results.
        </p>

        {!loggedIn ? (
          <form onSubmit={login} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="ticketToken">
                Ticket token
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
              Enter voting
            </button>
          </form>
        ) : (
          state && (
            <div className="mt-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[var(--green)]">
                  Signed in as {state.voter.fullName}
                </p>
                <span className="text-xs font-extrabold uppercase tracking-wide text-[var(--red)]">
                  {state.talentVotingState}
                </span>
              </div>
              {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
              {message && <p className="font-semibold text-[var(--green)]">{message}</p>}

              {state.talentVotingState !== "OPEN" && (
                <p className="panel p-4 text-[var(--ink-soft)]">
                  Audience voting is not open right now.
                </p>
              )}

              {state.talentVotingState === "OPEN" && state.myVote && (
                <p className="panel p-4 font-semibold text-[var(--green)]">
                  Your vote is locked in. Thank you!
                </p>
              )}

              {state.talentVotingState === "OPEN" && !state.myVote && (
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
                    <p className="text-[var(--ink-soft)]">
                      No approved groups yet. Check back after organizers approve acts.
                    </p>
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
