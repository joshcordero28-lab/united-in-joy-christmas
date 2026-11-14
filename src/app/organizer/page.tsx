"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type Dashboard = {
  event: {
    name: string;
    dateLabel: string;
    venueLabel: string;
    capacity: number;
    registrationOpen: boolean;
    requireApproval: boolean;
    talentVotingState?: string;
  };
  counts: {
    registered: number;
    issued: number;
    pending: number;
    revoked: number;
    checkedIn: number;
    groupsPending: number;
    groupsApproved: number;
    votes: number;
    capacity: number;
  };
  groups: {
    id: string;
    groupName: string;
    performanceTitle: string;
    talentType: string;
    status: string;
    performanceOrder: number | null;
    memberCount: number;
    leaderName: string;
    hasIneligibleMembers?: boolean;
    needsVerificationReview?: boolean;
    members?: {
      id: string;
      fullName: string;
      status: string;
      verifiedViaTicket?: boolean;
      ineligible?: boolean;
      needsVerification?: boolean;
    }[];
  }[];
};

type Attendee = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  checkedInAt: string | null;
  partyId?: string;
  managerName?: string;
  partyEligible?: number;
  partyUsed?: number;
  partyRemaining?: number;
  partyAttendeeCount?: number;
  voteCastBy?: string | null;
  voteGroupName?: string | null;
};

type VotingInfo = {
  visibility: "HIDDEN" | "REVEALED";
  talentVotingState: "CLOSED" | "OPEN";
  resultsPublished: boolean;
  resultsLabel: string;
  privateResults: { groupId: string; groupName: string; performanceTitle: string; votes: number }[];
  ties: null | { groupId: string; groupName: string; votes: number }[];
  voteCount: number;
  ballotAudit?: {
    id: string;
    attendeeName: string;
    groupName: string;
    castBy: string;
    managerName: string | null;
    createdAt: string;
  }[];
  publicPhase?: string;
  legacyKingQueenVoteCount?: number;
  note?: string;
};

export default function OrganizerPage() {
  const [authed, setAuthed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [q, setQ] = useState("");
  const [voting, setVoting] = useState<VotingInfo | null>(null);
  const [logs, setLogs] = useState<
    { id: string; createdAt: string; actorLabel: string | null; action: string; detail: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    const [dRes, aRes, vRes, lRes] = await Promise.all([
      fetch("/api/organizer/dashboard"),
      fetch("/api/organizer/attendees"),
      fetch("/api/organizer/voting"),
      fetch("/api/organizer/audit"),
    ]);
    if (dRes.status === 403 || dRes.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    setDash(await dRes.json());
    setAttendees((await aRes.json()).attendees || []);
    setVoting(await vRes.json());
    setLogs((await lRes.json()).logs || []);
  }

  useEffect(() => {
    loadAll().catch(() => setAuthed(false));
  }, []);

  async function login(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/staff/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Login failed.");
      return;
    }
    if (data.role !== "ORGANIZER") {
      setError("Organizer account required.");
      return;
    }
    await loadAll();
  }

  async function search() {
    const res = await fetch(`/api/organizer/attendees?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setAttendees(data.attendees || []);
  }

  async function attendeeAction(attendeeId: string, action: "approve" | "revoke" | "reissue") {
    setMessage(null);
    const res = await fetch("/api/organizer/attendees/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId, action }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Action failed.");
      return;
    }
    if (data.votingCredential) {
      setMessage(`New voting code for reissue/approve: ${data.votingCredential}`);
    } else {
      setMessage(`Action ${action} complete.`);
    }
    await loadAll();
  }

  async function groupAction(
    groupId: string,
    action: "approve" | "reject" | "withdraw" | "set_order",
    performanceOrder?: number,
  ) {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/organizer/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId,
        action,
        performanceOrder,
        rejectionNote: action === "reject" ? "Rejected by organizer" : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Group action failed.");
      return;
    }
    setMessage(`Group ${action} saved.`);
    await loadAll();
  }

  async function patchVoting(body: Record<string, unknown>, label: string) {
    setError(null);
    setMessage(null);
    let payload = { ...body };
    if (body.resultsPublished === true && voting?.ties && voting.ties.length > 1) {
      const resolveTieGroupId =
        prompt(
          `Audience Choice tie between: ${voting.ties.map((t) => t.groupName).join(", ")}. Enter group id:`,
        ) || undefined;
      if (!resolveTieGroupId) {
        setError("Publish cancelled — tie must be resolved.");
        return;
      }
      payload = { ...payload, resolveTieGroupId };
    }
    const res = await fetch("/api/organizer/voting", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.tied) {
        const winner = prompt(`Tied group ids: ${data.tied.join(", ")}. Paste winner group id:`);
        if (!winner) {
          setError(data.error);
          return;
        }
        const retry = await fetch("/api/organizer/voting", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, resolveTieGroupId: winner }),
        });
        const retryData = await retry.json();
        if (!retry.ok) {
          setError(retryData.error || "Update failed.");
          return;
        }
      } else {
        setError(data.error || "Update failed.");
        return;
      }
    }
    setMessage(label);
    await loadAll();
  }

  async function saveConfig(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/organizer/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateLabel: form.get("dateLabel"),
        venueLabel: form.get("venueLabel"),
        capacity: Number(form.get("capacity")),
        registrationOpen: form.get("registrationOpen") === "on",
        requireApproval: form.get("requireApproval") === "on",
      }),
    });
    if (!res.ok) {
      setError("Config update failed.");
      return;
    }
    setMessage("Event config saved.");
    await loadAll();
  }

  if (!authed) {
    return (
      <div className="page-shell staff-surface">
        <ClientSiteHeader />
        <div className="mx-auto max-w-lg px-4 py-8">
          <h1 className="brand-mark text-4xl text-[var(--red)]">Organizer</h1>
          <form onSubmit={login} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit">
              Sign in
            </button>
          </form>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="page-shell staff-surface">
      <ClientSiteHeader />
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="brand-mark text-4xl text-[var(--red)]">Dashboard</h1>
            <p className="text-[var(--ink-soft)]">{dash?.event.name}</p>
          </div>
          <Link href="/staff" className="btn btn-secondary">
            Check-in desk
          </Link>
        </div>

        {error && <p className="text-[var(--red)]">{error}</p>}
        {message && <p className="text-[var(--green)]">{message}</p>}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Registered", dash?.counts.registered],
            ["Checked in", dash?.counts.checkedIn],
            ["Groups pending", dash?.counts.groupsPending],
            ["Audience votes", dash?.counts.votes],
          ].map(([label, value]) => (
            <div key={String(label)} className="panel p-4">
              <p className="text-sm text-[var(--red)]">{label}</p>
              <p className="brand-mark text-3xl">{value ?? "—"}</p>
            </div>
          ))}
        </section>

        <section className="panel p-5">
          <h2 className="brand-mark text-2xl text-[var(--red)]">Event config</h2>
          <form onSubmit={saveConfig} className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Date label</label>
              <input className="field" name="dateLabel" defaultValue={dash?.event.dateLabel} />
            </div>
            <div>
              <label className="label">Venue label</label>
              <input className="field" name="venueLabel" defaultValue={dash?.event.venueLabel} />
            </div>
            <div>
              <label className="label">Capacity</label>
              <input
                className="field"
                name="capacity"
                type="number"
                defaultValue={dash?.event.capacity}
              />
            </div>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="registrationOpen"
                  defaultChecked={dash?.event.registrationOpen}
                />
                Registration open
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="requireApproval"
                  defaultChecked={dash?.event.requireApproval}
                />
                Require approval before ticket issue
              </label>
            </div>
            <button className="btn btn-primary md:col-span-2" type="submit">
              Save config
            </button>
          </form>
        </section>

        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="brand-mark text-2xl text-[var(--red)]">Attendees</h2>
            <div className="flex gap-2">
              <a className="btn btn-secondary" href="/api/organizer/export?type=attendees">
                CSV
              </a>
              <a className="btn btn-secondary" href="/api/organizer/export?type=groups">
                Groups CSV
              </a>
              <a className="btn btn-secondary" href="/api/organizer/export?type=audit">
                Audit CSV
              </a>
              <a className="btn btn-secondary" href="/api/organizer/export?type=votes">
                Votes CSV
              </a>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <input
              className="field"
              placeholder="Search name, phone, email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={search}>
              Search
            </button>
          </div>
          <div className="mt-4 max-h-96 space-y-2 overflow-auto">
            {attendees.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--red)]/10 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold">{a.fullName}</p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {a.status}
                    {a.checkedInAt ? " · checked in" : ""}
                    {a.email ? ` · ${a.email}` : ""}
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    Manager {a.managerName || "—"}
                    {a.partyAttendeeCount != null
                      ? ` · party of ${a.partyAttendeeCount}`
                      : ""}
                    {typeof a.partyEligible === "number"
                      ? ` · votes ${a.partyUsed ?? 0}/${a.partyEligible} used (${a.partyRemaining ?? 0} left)`
                      : ""}
                    {a.voteGroupName
                      ? ` · ballot: ${a.voteGroupName} (${a.voteCastBy === "MANAGER" ? "manager" : "self"})`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === "PENDING" && (
                    <button
                      type="button"
                      className="btn btn-primary !min-h-10 !px-3 !text-sm"
                      onClick={() => attendeeAction(a.id, "approve")}
                    >
                      Approve
                    </button>
                  )}
                  {a.status !== "REVOKED" && (
                    <button
                      type="button"
                      className="btn btn-danger !min-h-10 !px-3 !text-sm"
                      onClick={() => attendeeAction(a.id, "revoke")}
                    >
                      Revoke
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                    onClick={() => attendeeAction(a.id, "reissue")}
                  >
                    Reissue
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="brand-mark text-2xl text-[var(--red)]">
            Christmas Group Talent Show
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Approve groups and set performance order. Approved groups are the performing
            acts (and later, when you reveal Audience Choice, the ballot).
          </p>
          <div className="mt-4 space-y-3">
            {(dash?.groups || []).map((g) => (
              <div
                key={g.id}
                className="rounded-xl border border-[var(--red)]/10 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-[var(--ink)]">
                      {g.groupName}{" "}
                      <span className="text-sm font-normal text-[var(--ink-soft)]">
                        · {g.status}
                        {g.performanceOrder != null ? ` · #${g.performanceOrder}` : ""}
                      </span>
                    </p>
                    <p className="text-sm">{g.performanceTitle}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {g.talentType} · leader {g.leaderName} · {g.memberCount} members
                    </p>
                    {(g.hasIneligibleMembers || g.needsVerificationReview) && (
                      <p className="mt-1 text-xs font-semibold text-[var(--red)]">
                        {g.hasIneligibleMembers ? "Flagged: member cancelled/ineligible. " : ""}
                        {g.needsVerificationReview
                          ? "Legacy entry — ticket verification review recommended."
                          : ""}
                      </p>
                    )}
                    {g.members && g.members.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-[var(--ink-soft)]">
                        {g.members.map((m) => (
                          <li key={m.id}>
                            {m.fullName} · {m.status}
                            {m.verifiedViaTicket === false ? " · needs verification" : " · ticket-linked"}
                            {m.ineligible ? " · ineligible" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 font-mono text-[0.65rem] text-[var(--ink-soft)]">
                      {g.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.status !== "APPROVED" && (
                      <button
                        type="button"
                        className="btn btn-primary !min-h-10 !px-3 !text-sm"
                        onClick={() => groupAction(g.id, "approve")}
                      >
                        Approve
                      </button>
                    )}
                    {g.status === "PENDING" && (
                      <button
                        type="button"
                        className="btn btn-danger !min-h-10 !px-3 !text-sm"
                        onClick={() => groupAction(g.id, "reject")}
                      >
                        Reject
                      </button>
                    )}
                    {g.status === "APPROVED" && (
                      <button
                        type="button"
                        className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                        onClick={() => {
                          const order = Number(
                            prompt("Performance order number?", String(g.performanceOrder || 1)),
                          );
                          if (!Number.isFinite(order) || order < 1) return;
                          groupAction(g.id, "set_order", order);
                        }}
                      >
                        Set order
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(dash?.groups || []).length === 0 && (
              <p className="text-[var(--ink-soft)]">No groups registered yet.</p>
            )}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="brand-mark text-2xl text-[var(--red)]">Audience Choice (private)</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Voting stays off public pages until you reveal it. Phase:{" "}
            <strong>{voting?.publicPhase || "hidden"}</strong>. Votes cast:{" "}
            {voting?.voteCount ?? 0}.
            {voting?.note ? ` ${voting.note}` : ""}
          </p>
          {typeof voting?.legacyKingQueenVoteCount === "number" &&
            voting.legacyKingQueenVoteCount > 0 && (
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                Archived King/Queen history rows retained: {voting.legacyKingQueenVoteCount}.
              </p>
            )}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--red)]/10 p-3">
              <p className="text-sm font-extrabold text-[var(--red)]">Visibility</p>
              <p className="text-sm text-[var(--ink-soft)]">
                {voting?.visibility || "HIDDEN"} (default hidden)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                  onClick={() =>
                    patchVoting({ visibility: "REVEALED" }, "Voting revealed to attendees")
                  }
                >
                  Reveal to attendees
                </button>
                <button
                  type="button"
                  className="btn btn-danger !min-h-10 !px-3 !text-sm"
                  onClick={() =>
                    patchVoting(
                      { visibility: "HIDDEN", state: "CLOSED", resultsPublished: false },
                      "Voting hidden from public",
                    )
                  }
                >
                  Hide again
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--red)]/10 p-3">
              <p className="text-sm font-extrabold text-[var(--red)]">Voting status</p>
              <p className="text-sm text-[var(--ink-soft)]">{voting?.talentVotingState || "CLOSED"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary !min-h-10 !px-3 !text-sm"
                  onClick={() => patchVoting({ state: "OPEN" }, "Voting opened")}
                >
                  Open voting
                </button>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                  onClick={() => patchVoting({ state: "CLOSED" }, "Voting closed")}
                >
                  Close voting
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--red)]/10 p-3">
              <p className="text-sm font-extrabold text-[var(--red)]">Results</p>
              <p className="text-sm text-[var(--ink-soft)]">
                Published publicly: {voting?.resultsPublished ? "yes" : "no"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary !min-h-10 !px-3 !text-sm"
                  onClick={() =>
                    patchVoting({ resultsPublished: true }, "Audience Choice results published")
                  }
                >
                  Publish results
                </button>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-10 !px-3 !text-sm"
                  onClick={() =>
                    patchVoting({ resultsPublished: false }, "Public results unpublished")
                  }
                >
                  Unpublish
                </button>
              </div>
            </div>
          </div>
          {voting?.privateResults && voting.privateResults.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              <li className="font-extrabold text-[var(--green)]">
                Private tallies (organizer only)
              </li>
              {voting.privateResults.map((r) => (
                <li key={r.groupId}>
                  {r.groupName}: {r.votes}
                  <span className="ml-2 font-mono text-xs text-[var(--ink-soft)]">
                    {r.groupId}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {voting?.ballotAudit && voting.ballotAudit.length > 0 && (
            <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-[var(--red)]/10 p-3">
              <p className="text-sm font-extrabold text-[var(--green)]">
                Ballot audit (who cast each entitlement)
              </p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
                {voting.ballotAudit.map((b) => (
                  <li key={b.id}>
                    {b.attendeeName} → {b.groupName} ·{" "}
                    {b.castBy === "MANAGER"
                      ? `manager (${b.managerName || "—"})`
                      : "attendee self"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="brand-mark text-2xl text-[var(--red)]">Audit log</h2>
          <div className="mt-4 max-h-80 space-y-2 overflow-auto text-sm">
            {logs.map((l) => (
              <div key={l.id} className="border-b border-[var(--red)]/5 py-2">
                <p>
                  <span className="text-[var(--red)]">
                    {new Date(l.createdAt).toLocaleString()}
                  </span>{" "}
                  · {l.actorLabel || "system"} · {l.action}
                </p>
                {l.detail && <p className="text-[var(--ink-soft)]">{l.detail}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
