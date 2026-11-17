"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { storeManagerToken } from "@/lib/manage-session";

type VoteMethod = "qr" | "link" | "code";

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
  const [method, setMethod] = useState<VoteMethod>("code");
  const [ticketToken, setTicketToken] = useState("");
  const [votingCredential, setVotingCredential] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [state, setState] = useState<VoteState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [groupHint, setGroupHint] = useState(false);
  const [scanning, setScanning] = useState(false);
  const html5Ref = useRef<{ stop: () => Promise<void> } | null>(null);
  const readerId = useRef(`vote-qr-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    setTicketToken(localStorage.getItem("uilc_ticket_token") || "");
    setVotingCredential(localStorage.getItem("uilc_voting_credential") || "");
    setGuestCode(localStorage.getItem("uilc_ticket_token") || "");
    refresh();
    return () => {
      html5Ref.current?.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only session restore
  }, []);

  async function refresh() {
    const res = await fetch("/api/vote");
    if (res.status === 404) {
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

  async function applyTicketScan(raw: string) {
    const { parseTicketPayload } = await import("@/lib/tickets");
    const payload = parseTicketPayload(raw);
    const extracted = payload.token || raw.trim();
    setTicketToken(extracted);
    setGuestCode(extracted);

    let voteCode = payload.votingCredential;
    if (!voteCode && extracted.length >= 16) {
      try {
        const res = await fetch("/api/ticket/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: extracted }),
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.votingCredential === "string" && data.votingCredential) {
            voteCode = data.votingCredential;
          }
        }
      } catch {
        // ignore
      }
    }

    if (voteCode) {
      setVotingCredential(voteCode);
      setMessage("Ticket and voting code captured from your QR. Tap Continue.");
    } else {
      setMessage("Ticket QR captured. Tap Continue to vote with this Private Guest Code.");
    }
    setError(null);
    setGroupHint(false);
  }

  async function toggleScan() {
    if (scanning) {
      await html5Ref.current?.stop().catch(() => undefined);
      html5Ref.current = null;
      setScanning(false);
      return;
    }
    setError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(readerId.current);
      html5Ref.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 220, height: 220 } },
        async (decoded) => {
          await scanner.stop().catch(() => undefined);
          html5Ref.current = null;
          setScanning(false);
          await applyTicketScan(decoded);
        },
        () => undefined,
      );
    } catch {
      setScanning(false);
      setError("Camera could not start. Upload a QR image or use another method.");
    }
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(`${readerId.current}-file`);
      const decoded = await scanner.scanFile(file, false);
      await applyTicketScan(decoded);
    } catch {
      setError("Could not read a ticket QR from that image.");
    }
  }

  async function loginWithPayload(body: Record<string, string>) {
    setError(null);
    setGroupHint(false);
    const res = await fetch("/api/auth/voter/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === "group_private_code") {
        setGroupHint(true);
        // Store so Manage My Tickets works on this device without putting code in the URL.
        const raw = (body.guestCode || body.ticketToken || "").trim();
        const { extractManagerToken } = await import("@/lib/tickets");
        const mgr = extractManagerToken(raw);
        if (mgr.length >= 16) storeManagerToken(mgr);
      }
      setError(data.error || "Login failed.");
      return;
    }
    if (typeof data.ticketToken === "string" && data.ticketToken) {
      localStorage.setItem("uilc_ticket_token", data.ticketToken);
    }
    if (votingCredential.trim()) {
      localStorage.setItem("uilc_voting_credential", votingCredential.trim());
    }
    setMessage(null);
    await refresh();
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    if (method === "code") {
      await loginWithPayload({ guestCode: guestCode.trim() });
      return;
    }
    // QR / link share the same backend validation.
    const raw = ticketToken.trim() || guestCode.trim();
    const payload: Record<string, string> = { ticketToken: raw };
    if (votingCredential.trim()) payload.votingCredential = votingCredential.trim();
    // Also accept opaque paste as guestCode when no separate voting code.
    if (!votingCredential.trim() && raw) {
      await loginWithPayload({ guestCode: raw });
      return;
    }
    await loginWithPayload(payload);
  }

  async function cast(groupId: string) {
    setError(null);
    setMessage(null);
    if (
      !window.confirm(
        "Submit this vote? Submitted votes are final and cannot be changed.",
      )
    ) {
      return;
    }
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        setError("Vote Already Submitted — this attendee’s vote is used.");
        await refresh();
        return;
      }
      setError(data.error || "Vote failed.");
      return;
    }
    setMessage("Your vote is locked in. Thank you!");
    await refresh();
  }

  const open = state?.open ?? initiallyOpen;
  const published = state?.resultsPublished ?? resultsPublished;

  const methodBtn = (id: VoteMethod, label: string) => (
    <button
      key={id}
      type="button"
      className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
        method === id
          ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
          : "border-[var(--red)]/15 bg-white/70"
      }`}
      onClick={() => {
        setMethod(id);
        setError(null);
        setGroupHint(false);
        setMessage(null);
      }}
      aria-pressed={method === id}
    >
      {label}
    </button>
  );

  return (
    <div className="page-shell">
      <ClientSiteHeader forceAudienceChoice />
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Audience Choice</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">
          Vote for Your Favorite Group
        </h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          One vote per checked-in attendee. QR, voting link, and Private Guest Code all use
          the same entitlement — switching methods cannot create extra votes.
        </p>

        {!loggedIn ? (
          <form onSubmit={login} className="panel mt-8 space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {methodBtn("qr", "Scan or Use QR Code")}
              {methodBtn("link", "Open Voting Link")}
              {methodBtn("code", "Enter Private Guest Code")}
            </div>

            {method === "qr" && (
              <div className="space-y-3">
                <p className="text-xs text-[var(--ink-soft)]">
                  Scan or upload the same entry QR shown at the door.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary !min-h-10 !text-sm"
                    onClick={toggleScan}
                  >
                    {scanning ? "Stop camera" : "Scan QR with camera"}
                  </button>
                  <label className="btn btn-secondary !min-h-10 !cursor-pointer !text-sm">
                    Upload QR image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onUpload(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
                <div id={readerId.current} className="overflow-hidden rounded-xl" />
                {(ticketToken || votingCredential) && (
                  <p className="text-xs font-semibold text-[var(--green)]">
                    Credential captured — tap Continue.
                  </p>
                )}
              </div>
            )}

            {method === "link" && (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="ticketToken">
                    Voting / ticket link
                  </label>
                  <textarea
                    id="ticketToken"
                    className="field min-h-24 font-mono text-sm"
                    value={ticketToken}
                    onChange={(e) => setTicketToken(e.target.value)}
                    placeholder="Paste your ticket or voting link"
                    required={method === "link"}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="votingCredential">
                    Voting code (if not in the link)
                  </label>
                  <input
                    id="votingCredential"
                    className="field tracking-widest"
                    value={votingCredential}
                    onChange={(e) => setVotingCredential(e.target.value)}
                    placeholder="Optional when the link includes it"
                  />
                </div>
              </div>
            )}

            {method === "code" && (
              <div>
                <label className="label" htmlFor="guestCode">
                  Vote Using Private Guest Code
                </label>
                <textarea
                  id="guestCode"
                  className="field min-h-28 font-mono text-sm"
                  value={guestCode}
                  onChange={(e) => setGuestCode(e.target.value)}
                  placeholder="Paste your individual Private Guest Code"
                  required={method === "code"}
                  autoComplete="off"
                />
                <p className="mt-2 text-xs text-[var(--ink-soft)]">
                  Use the individual code from your ticket — not a public booking reference.
                  A group code opens My Tickets for controlled group casting instead.
                </p>
              </div>
            )}

            {message && !error && (
              <p className="text-sm font-semibold text-[var(--green)]">{message}</p>
            )}
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            {groupHint && (
              <Link href="/manage" className="btn btn-secondary w-full">
                My Tickets — cast group votes
              </Link>
            )}
            <button className="btn btn-primary w-full" type="submit">
              Continue to Vote
            </button>
          </form>
        ) : (
          state && (
            <div className="mt-8 space-y-6">
              <p className="font-semibold text-[var(--green)]">
                Eligible attendee: {state.voter.fullName}
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
                  Vote Already Submitted — this attendee’s vote is locked in.
                </p>
              )}

              {open && !state.myVote && (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--ink-soft)]">
                    Select one approved talent show group. Your vote cannot be changed.
                  </p>
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
