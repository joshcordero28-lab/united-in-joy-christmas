"use client";

import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

type VoteState = {
  voter: { id: string; fullName: string };
  allowSelfVote: boolean;
  kingVotingState: string;
  queenVotingState: string;
  myVotes: { category: string; nomineeId: string }[];
  nominees: { id: string; fullName: string }[];
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

  async function cast(category: "KING" | "QUEEN", nomineeId: string) {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, nomineeId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Vote failed.");
      return;
    }
    setMessage(`Vote recorded for ${category}.`);
    await refresh();
  }

  const votedKing = state?.myVotes.find((v) => v.category === "KING");
  const votedQueen = state?.myVotes.find((v) => v.category === "QUEEN");

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--gold-soft)]">King & Queen</h1>
        <p className="mt-2 text-[var(--cream)]/80">
          Vote once per category. Totals stay hidden until the organizer reveals them.
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
            {error && <p className="text-[var(--berry-bright)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit">
              Enter voting
            </button>
          </form>
        ) : (
          state && (
            <div className="mt-8 space-y-8">
              <p className="text-[var(--gold)]">Signed in as {state.voter.fullName}</p>
              {error && <p className="text-[var(--berry-bright)]">{error}</p>}
              {message && <p className="text-[var(--gold)]">{message}</p>}

              <CategoryBlock
                title="King of the Night"
                category="KING"
                open={state.kingVotingState === "OPEN"}
                stateLabel={state.kingVotingState}
                voted={Boolean(votedKing)}
                nominees={state.nominees.filter(
                  (n) => state.allowSelfVote || n.id !== state.voter.id,
                )}
                onVote={(id) => cast("KING", id)}
              />
              <CategoryBlock
                title="Queen of the Night"
                category="QUEEN"
                open={state.queenVotingState === "OPEN"}
                stateLabel={state.queenVotingState}
                voted={Boolean(votedQueen)}
                nominees={state.nominees.filter(
                  (n) => state.allowSelfVote || n.id !== state.voter.id,
                )}
                onVote={(id) => cast("QUEEN", id)}
              />
            </div>
          )
        )}
      </div>
    </main>
  );
}

function CategoryBlock({
  title,
  open,
  stateLabel,
  voted,
  nominees,
  onVote,
}: {
  title: string;
  category: string;
  open: boolean;
  stateLabel: string;
  voted: boolean;
  nominees: { id: string; fullName: string }[];
  onVote: (id: string) => void;
}) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="brand-mark text-2xl">{title}</h2>
        <span className="text-xs uppercase tracking-wide text-[var(--gold-soft)]">
          {stateLabel}
        </span>
      </div>
      {!open && <p className="text-[var(--cream)]/70">Voting is not open for this category.</p>}
      {open && voted && <p className="text-[var(--gold)]">Your vote is locked in.</p>}
      {open && !voted && (
        <div className="space-y-2">
          {nominees.map((n) => (
            <button
              key={n.id}
              type="button"
              className="btn btn-secondary w-full justify-between"
              onClick={() => onVote(n.id)}
            >
              <span>{n.fullName}</span>
              <span>Vote</span>
            </button>
          ))}
          {nominees.length === 0 && (
            <p className="text-[var(--cream)]/70">No checked-in nominees yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
