"use client";

import { FormEvent, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

type Competition = {
  id: string;
  name: string;
  description: string | null;
  type: "INDIVIDUAL" | "TEAM";
  maxEntries: number | null;
  entryCount: number;
  isOpen: boolean;
};

export default function CompetitionsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [token, setToken] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/competitions")
      .then((r) => r.json())
      .then((d) => setCompetitions(d.competitions || []));
    const saved = localStorage.getItem("uilc_ticket_token");
    if (saved) setToken(saved);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const res = await fetch("/api/competitions/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        competitionId: selected,
        ticketToken: token,
        teamName,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not enter.");
      return;
    }
    setMessage(`Entered: ${data.competitionName}`);
    const refreshed = await fetch("/api/competitions").then((r) => r.json());
    setCompetitions(refreshed.competitions || []);
  }

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--gold-soft)]">Competitions</h1>
        <p className="mt-2 text-[var(--cream)]/80">
          Enter with your ticket token. Team events need a team name.
        </p>

        <div className="mt-6 space-y-3">
          {competitions.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                selected === c.id
                  ? "border-[var(--gold)] bg-[var(--gold)]/10"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{c.name}</p>
                  <p className="text-sm text-[var(--cream)]/70">{c.description}</p>
                </div>
                <span className="text-xs uppercase tracking-wide text-[var(--gold-soft)]">
                  {c.type}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--cream)]/60">
                {c.entryCount}
                {c.maxEntries != null ? ` / ${c.maxEntries}` : ""} entries
                {!c.isOpen ? " · closed" : ""}
              </p>
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
          <div>
            <label className="label" htmlFor="token">
              Ticket token
            </label>
            <textarea
              id="token"
              className="field min-h-24 font-mono text-sm"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="teamName">
              Team name (team events)
            </label>
            <input
              id="teamName"
              className="field"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>
          {error && <p className="text-[var(--berry-bright)]">{error}</p>}
          {message && <p className="text-[var(--gold)]">{message}</p>}
          <button className="btn btn-primary w-full" type="submit" disabled={!selected}>
            Enter selected competition
          </button>
        </form>
      </div>
    </main>
  );
}
