"use client";

import { FormEvent, useEffect, useState } from "react";
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

export default function TalentShowRegisterPage() {
  const [leaderToken, setLeaderToken] = useState("");
  const [groupName, setGroupName] = useState("");
  const [performanceTitle, setPerformanceTitle] = useState("");
  const [talentType, setTalentType] = useState(TALENT_TYPES[0]);
  const [memberTokens, setMemberTokens] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("uilc_ticket_token");
    if (saved) setLeaderToken(saved);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);
    const tokens = memberTokens
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tokens.includes(leaderToken.trim())) {
      tokens.unshift(leaderToken.trim());
    }
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaderTicketToken: leaderToken.trim(),
          groupName,
          performanceTitle,
          talentType,
          memberTicketTokens: tokens,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not register group.");
        return;
      }
      setMessage(
        `Group “${data.groupName}” submitted (${data.memberCount} members). Status: ${data.status} — awaiting organizer approval.`,
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
          Group leaders register the act for this group performance competition.
          Every member must already have an entry ticket — paste each member&apos;s
          ticket link. Organizers approve groups and set the performance order.
        </p>

        <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
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
            <label className="label" htmlFor="leaderToken">
              Group leader ticket link *
            </label>
            <textarea
              id="leaderToken"
              className="field min-h-20 text-sm"
              value={leaderToken}
              onChange={(e) => setLeaderToken(e.target.value)}
              placeholder="Paste your ticket link"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="memberTokens">
              Member ticket links * (one per line; include all performers)
            </label>
            <textarea
              id="memberTokens"
              className="field min-h-32 text-sm"
              value={memberTokens}
              onChange={(e) => setMemberTokens(e.target.value)}
              placeholder={"https://…/ticket/…\nhttps://…/ticket/…"}
              required
            />
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Your leader ticket is added automatically if it isn&apos;t already in the
              list.
            </p>
          </div>
          {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
          {message && <p className="font-semibold text-[var(--green)]">{message}</p>}
          <button className="btn btn-primary w-full" type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Register group"}
          </button>
        </form>
      </div>
      <SiteFooter />
    </div>
  );
}
