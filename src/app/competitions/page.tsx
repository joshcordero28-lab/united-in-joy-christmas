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

const MAX_MEMBERS = 3;
const MAX_PARTNERS = MAX_MEMBERS - 1;

type Person = {
  id: string;
  fullName: string;
};

export default function TalentShowRegisterPage() {
  const [leaderTicket, setLeaderTicket] = useState("");
  const [leader, setLeader] = useState<Person | null>(null);
  const [partnerTickets, setPartnerTickets] = useState<string[]>([""]);
  const [groupName, setGroupName] = useState("");
  const [performanceTitle, setPerformanceTitle] = useState("");
  const [talentType, setTalentType] = useState(TALENT_TYPES[0]);
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
        setLeader({ id: d.id as string, fullName: d.fullName as string });
      })
      .catch(() => undefined);
  }, []);

  function updatePartnerTicket(index: number, value: string) {
    setPartnerTickets((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function addPartnerSlot() {
    setError(null);
    setPartnerTickets((prev) => {
      if (prev.length >= MAX_PARTNERS) {
        setError(`Groups are limited to ${MAX_MEMBERS} members (including you).`);
        return prev;
      }
      return [...prev, ""];
    });
  }

  function removePartnerSlot(index: number) {
    setPartnerTickets((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!leader || !leaderTicket) {
      setError("Open your entry ticket on this phone first, then come back here.");
      return;
    }

    const partners = partnerTickets.map((t) => t.trim()).filter(Boolean);
    if (partners.length > MAX_PARTNERS) {
      setError(`Choose up to ${MAX_PARTNERS} partners (you count as one).`);
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
          partnerTickets: partners,
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
          Partners join by sharing their own entry ticket link — that proves consent. You
          (the leader) count as one of the {MAX_MEMBERS}.
        </p>

        {!leader ? (
          <div className="panel mt-8 space-y-3 p-5">
            <p className="font-semibold text-[var(--red)]">No password login here</p>
            <p className="text-sm text-[var(--ink-soft)]">
              Talent signup uses your <strong>entry ticket</strong> on this phone — not a
              staff username. Register (or open your ticket link), then return here. We&apos;ll
              recognize you as the group leader automatically.
            </p>
            <Link href="/ticket" className="btn btn-primary w-full">
              Open my entry ticket
            </Link>
            <Link href="/register" className="btn btn-secondary w-full">
              Register for a ticket
            </Link>
            <p className="text-center text-xs text-[var(--ink-soft)]">
              Organizer / check-in staff: use{" "}
              <Link href="/staff" className="font-semibold text-[var(--red)] underline">
                /staff
              </Link>{" "}
              instead.
            </p>
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
              <p className="label">Partners (optional, up to {MAX_PARTNERS})</p>
              <p className="mb-2 text-xs text-[var(--ink-soft)]">
                Ask each partner to open their ticket and share the ticket link with you.
                Paste those links below — we do not add people by name search alone.
              </p>
              <ul className="space-y-2">
                {partnerTickets.map((ticket, index) => (
                  <li key={index} className="flex gap-2">
                    <input
                      className="field flex-1"
                      value={ticket}
                      onChange={(e) => updatePartnerTicket(index, e.target.value)}
                      placeholder="Partner ticket link or code"
                      autoComplete="off"
                    />
                    {partnerTickets.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                        onClick={() => removePartnerSlot(index)}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {partnerTickets.length < MAX_PARTNERS && (
                <button
                  type="button"
                  className="btn btn-secondary mt-2 w-full"
                  onClick={addPartnerSlot}
                >
                  Add another partner ticket
                </button>
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
