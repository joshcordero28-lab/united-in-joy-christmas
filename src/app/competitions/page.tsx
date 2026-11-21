"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TicketVerifyPanel, VerifiedAttendee } from "@/components/TicketVerifyPanel";

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

type Partner =
  | { source: "party"; id: string; fullName: string }
  | { source: "ticket"; id: string; fullName: string; ticket: string };

export default function TalentShowRegisterPage() {
  const [savedTicket, setSavedTicket] = useState("");
  const [leaderTicket, setLeaderTicket] = useState("");
  const [leader, setLeader] = useState<VerifiedAttendee | null>(null);
  const [partyAttendees, setPartyAttendees] = useState<{ id: string; fullName: string }[]>([]);
  const [managerToken, setManagerToken] = useState("");
  const [selectedPartyIds, setSelectedPartyIds] = useState<string[]>([]);
  const [ticketPartners, setTicketPartners] = useState<Partner[]>([]);
  const [groupName, setGroupName] = useState("");
  const [performanceTitle, setPerformanceTitle] = useState("");
  const [talentType, setTalentType] = useState(TALENT_TYPES[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingPartner, setAddingPartner] = useState(false);

  useEffect(() => {
    setSavedTicket(localStorage.getItem("uilc_ticket_token") || "");
    setManagerToken(localStorage.getItem("uilc_manager_token") || "");
  }, []);

  async function loadPartyMates(leaderId: string) {
    const token = localStorage.getItem("uilc_manager_token") || "";
    setManagerToken(token);
    if (!token) {
      setPartyAttendees([]);
      return;
    }
    try {
      const res = await fetch("/api/manage/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerToken: token }),
      });
      if (!res.ok) {
        setPartyAttendees([]);
        return;
      }
      const data = await res.json();
      const mates = ((data.attendees as { id: string; fullName: string; status: string }[]) || [])
        .filter((a) => a.id !== leaderId && a.status === "ISSUED")
        .map((a) => ({ id: a.id, fullName: a.fullName }));
      setPartyAttendees(mates);
    } catch {
      setPartyAttendees([]);
    }
  }

  const partnerCount = selectedPartyIds.length + ticketPartners.length;
  const slotsLeft = MAX_PARTNERS - partnerCount;

  function togglePartyMember(id: string) {
    setError(null);
    setSelectedPartyIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + ticketPartners.length >= MAX_PARTNERS) {
        setError(`Groups are limited to ${MAX_MEMBERS} members (including you).`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function clearLeader() {
    setLeader(null);
    setLeaderTicket("");
    setPartyAttendees([]);
    setSelectedPartyIds([]);
    setTicketPartners([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!leader || !leaderTicket) {
      setError("Verify the group leader with an event ticket first.");
      return;
    }
    if (partnerCount > MAX_PARTNERS) {
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
          partnerAttendeeIds: selectedPartyIds,
          managerToken: selectedPartyIds.length > 0 ? managerToken || undefined : undefined,
          partnerTickets: ticketPartners
            .filter((p): p is Extract<Partner, { source: "ticket" }> => p.source === "ticket")
            .map((p) => p.ticket),
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
        <p className="mt-3 text-[var(--ink-soft)]">
          Let&apos;s celebrate unity beyond our DGroups! We encourage you to team up with
          members from different DGroups and create something special together. This is a
          wonderful opportunity to build new friendships, strengthen fellowship, and
          celebrate our unity in Christ!
        </p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Only registered event attendees can enter. Groups are up to{" "}
          <strong>{MAX_MEMBERS} people</strong> (existing talent-show limit — the leader
          counts as one). Event check-in is not required to register an act.
        </p>

        <div className="mt-8 space-y-4">
          <section className="panel space-y-3 p-5">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--green)]">
                Step 1
              </p>
              <h2 className="brand-mark text-2xl text-[var(--red)]">
                Verify your event registration
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Use the group leader’s entry QR: scan with your phone camera, upload a QR
                image, or type the private ticket code. This confirms registration only — it
                does not check anyone in at the door.
              </p>
            </div>
            <TicketVerifyPanel
              title="Leader ticket"
              hint="Camera scan · QR image upload · or private ticket code"
              initialTicket={savedTicket}
              verifiedLabel={leader?.fullName || null}
              onVerified={async ({ ticket, attendee }) => {
                setLeaderTicket(ticket);
                setLeader(attendee);
                setSelectedPartyIds([]);
                setTicketPartners([]);
                setError(null);
                localStorage.setItem("uilc_ticket_token", ticket);
                await loadPartyMates(attendee.id);
              }}
              onClear={clearLeader}
            />
            {!leader && (
              <p className="text-center text-sm text-[var(--ink-soft)]">
                Not registered for the event yet?{" "}
                <Link href="/register" className="font-semibold text-[var(--red)] underline">
                  Register first
                </Link>
              </p>
            )}
          </section>

          {leader && (
            <form onSubmit={onSubmit} className="panel space-y-4 p-5">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--green)]">
                  Step 2
                </p>
                <h2 className="brand-mark text-2xl text-[var(--red)]">Group details &amp; partners</h2>
              </div>
              <div className="rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--green)]">
                  Group leader (verified)
                </p>
                <p className="font-extrabold text-[var(--ink)]">{leader.fullName}</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  You count as 1 of {MAX_MEMBERS} · door check-in not required for this form
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

              <div className="space-y-3">
                <p className="label">Partners (optional, up to {MAX_PARTNERS})</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  Names alone are not enough — every partner must be a registered attendee.
                  People on your same registration can be selected below; others need their own
                  ticket verified.
                </p>

                {partyAttendees.length > 0 && (
                  <ul className="space-y-2">
                    {partyAttendees.map((p) => {
                      const checked = selectedPartyIds.includes(p.id);
                      const disabled = !checked && slotsLeft <= 0;
                      return (
                        <li key={p.id}>
                          <label
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                              checked
                                ? "border-[var(--green)] bg-[var(--green)]/5"
                                : "border-[var(--red)]/10"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => togglePartyMember(p.id)}
                            />
                            <span>
                              {p.fullName}
                              <span className="ml-1 text-xs text-[var(--ink-soft)]">
                                (same registration)
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {ticketPartners.length > 0 && (
                  <ul className="space-y-2">
                    {ticketPartners.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 px-3 py-2 text-sm"
                      >
                        <span className="font-semibold">{p.fullName}</span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[var(--red)] underline"
                          onClick={() =>
                            setTicketPartners((prev) => prev.filter((x) => x.id !== p.id))
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {slotsLeft > 0 && !addingPartner && (
                  <button
                    type="button"
                    className="btn btn-secondary w-full"
                    onClick={() => setAddingPartner(true)}
                  >
                    Verify another partner’s ticket
                  </button>
                )}

                {slotsLeft > 0 && addingPartner && (
                  <TicketVerifyPanel
                    title="Verify partner ticket"
                    hint="Scan or enter this partner’s own entry ticket."
                    onVerified={({ ticket, attendee }) => {
                      if (attendee.id === leader.id) {
                        setError("That is the leader’s ticket — choose a different partner.");
                        return;
                      }
                      if (
                        selectedPartyIds.includes(attendee.id) ||
                        ticketPartners.some((p) => p.id === attendee.id)
                      ) {
                        setError("That attendee is already in this group.");
                        return;
                      }
                      setTicketPartners((prev) => [
                        ...prev,
                        {
                          source: "ticket",
                          id: attendee.id,
                          fullName: attendee.fullName,
                          ticket,
                        },
                      ]);
                      setAddingPartner(false);
                      setError(null);
                    }}
                    onClear={() => setAddingPartner(false)}
                  />
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
      </div>
      <SiteFooter />
    </div>
  );
}
