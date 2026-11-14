"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const TALENT_TYPES = [
  "Song / Vocal",
  "Dance",
  "Drama / Skit",
  "Instrumental",
  "Mixed / Variety",
  "Other",
];

const MAX_MEMBERS = 2;

type Person = {
  id: string;
  fullName: string;
  contactHint?: string | null;
};

export default function TalentShowRegisterPage() {
  const [leaderTicket, setLeaderTicket] = useState("");
  const [leader, setLeader] = useState<Person | null>(null);
  const [members, setMembers] = useState<Person[]>([]);
  const [groupName, setGroupName] = useState("");
  const [performanceTitle, setPerformanceTitle] = useState("");
  const [talentType, setTalentType] = useState(TALENT_TYPES[0]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("uilc_ticket_token") || "";
    setLeaderTicket(saved);
    if (!saved) return;
    fetch("/api/attendees/from-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: saved }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) return;
        const me = { id: d.id as string, fullName: d.fullName as string };
        setLeader(me);
        setMembers([me]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/attendees/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.attendees || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  function addMember(person: Person) {
    setError(null);
    if (members.some((m) => m.id === person.id)) return;
    if (members.length >= MAX_MEMBERS) {
      setError(`Groups are limited to ${MAX_MEMBERS} members.`);
      return;
    }
    setMembers((prev) => [...prev, person]);
    setQuery("");
    setResults([]);
  }

  function removeMember(id: string) {
    if (leader && id === leader.id) {
      setError("You (the group leader) stay on the list. Remove your partner instead.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!leader || !leaderTicket) {
      setError("Open your entry ticket on this phone first, then come back here.");
      return;
    }
    if (members.length < 1 || members.length > MAX_MEMBERS) {
      setError(`Choose 1–${MAX_MEMBERS} members (you count as one).`);
      return;
    }
    if (!members.some((m) => m.id === leader.id)) {
      setError("You must be included as a group member.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName,
          performanceTitle,
          talentType,
          leaderTicket,
          memberAttendeeIds: members.map((m) => m.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not register group.");
        return;
      }
      setMessage(
        `Group “${data.groupName}” submitted (${data.memberCount} of ${MAX_MEMBERS} max). Status: ${data.status} — awaiting organizer approval.`,
      );
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const slotsLeft = MAX_MEMBERS - members.length;

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--green)]">Sign up for the</p>
        <h1 className="brand-mark text-4xl text-[var(--red)] sm:text-5xl">
          Christmas Group Talent Show
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Register a group performance act of up to <strong>{MAX_MEMBERS} people</strong>.
          Search and select registered guests — tickets are linked automatically. You (the
          leader) count as one of the {MAX_MEMBERS}.
        </p>

        {!leader ? (
          <div className="panel mt-8 space-y-3 p-5">
            <p className="font-semibold text-[var(--red)]">Start from your entry ticket</p>
            <p className="text-sm text-[var(--ink-soft)]">
              Open your QR ticket on this phone first (from registration). We&apos;ll
              recognize you as the group leader — no need to paste ticket links.
            </p>
            <Link href="/ticket" className="btn btn-primary w-full">
              Open my entry ticket
            </Link>
            <Link href="/register" className="btn btn-secondary w-full">
              Register for a ticket
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <div className="rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 p-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--green)]">
                Group leader
              </p>
              <p className="font-extrabold text-[var(--ink)]">{leader.fullName}</p>
              <p className="text-xs text-[var(--ink-soft)]">
                Detected from your entry ticket on this device. You count as 1 of{" "}
                {MAX_MEMBERS} members.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="groupName">
                Group name *
              </label>
              <input
                id="groupName"
                className="field"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div>
              <label className="label" htmlFor="performanceTitle">
                Performance title *
              </label>
              <input
                id="performanceTitle"
                className="field"
                value={performanceTitle}
                onChange={(e) => setPerformanceTitle(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div>
              <label className="label" htmlFor="talentType">
                Talent type *
              </label>
              <select
                id="talentType"
                className="field"
                value={talentType}
                onChange={(e) => setTalentType(e.target.value)}
              >
                {TALENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="label">
                Members ({members.length}/{MAX_MEMBERS})
              </p>
              <ul className="mb-3 space-y-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--red)]/10 bg-white/80 px-3 py-2"
                  >
                    <div>
                      <p className="font-semibold">{m.fullName}</p>
                      {m.id === leader.id && (
                        <p className="text-xs text-[var(--green)]">Leader (you)</p>
                      )}
                      {m.contactHint && (
                        <p className="text-xs text-[var(--ink-soft)]">{m.contactHint}</p>
                      )}
                    </div>
                    {m.id !== leader.id && (
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                        onClick={() => removeMember(m.id)}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {slotsLeft > 0 ? (
                <div>
                  <label className="label" htmlFor="memberSearch">
                    Add {slotsLeft === 1 ? "one partner" : "members"} — search by name
                  </label>
                  <input
                    id="memberSearch"
                    className="field"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Type at least 2 letters"
                    autoComplete="off"
                  />
                  {searching && (
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">Searching…</p>
                  )}
                  {results.length > 0 && (
                    <ul className="mt-2 max-h-48 space-y-1 overflow-auto rounded-xl border border-[var(--red)]/10 bg-white p-2">
                      {results
                        .filter((r) => !members.some((m) => m.id === r.id))
                        .map((r) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--gold)]/15"
                              onClick={() => addMember(r)}
                            >
                              <span>
                                <span className="font-semibold">{r.fullName}</span>
                                {r.contactHint && (
                                  <span className="ml-2 text-xs text-[var(--ink-soft)]">
                                    {r.contactHint}
                                  </span>
                                )}
                              </span>
                              <span className="text-sm font-bold text-[var(--red)]">Add</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  Member limit reached ({MAX_MEMBERS}). Remove your partner to choose someone
                  else.
                </p>
              )}
            </div>

            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            {message && <p className="font-semibold text-[var(--green)]">{message}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Submitting…" : "Register group"}
            </button>
          </form>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
