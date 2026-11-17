"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type StaffInfo = { role: string; displayName: string } | null;

type StaffAttendee = {
  id: string;
  fullName: string;
  status: string;
  ticketRef?: string | null;
  checkedInAt: string | null;
  managerName?: string;
  voteGroupName?: string | null;
};

export default function StaffPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [staff, setStaff] = useState<StaffInfo>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5Ref = useRef<{ stop: () => Promise<void> } | null>(null);
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null);
  const [removeQ, setRemoveQ] = useState("");
  const [removeHits, setRemoveHits] = useState<StaffAttendee[]>([]);

  useEffect(() => {
    return () => {
      html5Ref.current?.stop().catch(() => undefined);
    };
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
    setStaff({ role: data.role, displayName: data.displayName });
  }

  async function logout() {
    await fetch("/api/auth/staff/logout", { method: "POST" });
    setStaff(null);
  }

  async function checkIn(value: string, method: "qr" | "manual") {
    setError(null);
    setMessage(null);
    const raw = value.trim();
    const { normalizeTicketNumber } = await import("@/lib/booking-ref");
    const { extractTicketToken } = await import("@/lib/tickets");
    const ticketNumber = normalizeTicketNumber(raw);
    const payload = ticketNumber
      ? { ticketNumber, method }
      : { token: extractTicketToken(raw) || raw, method };

    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Check-in failed.");
      if (data.attendee?.id) setLastCheckedId(data.attendee.id);
      return;
    }
    const tn = data.attendee.ticketNumber ? ` · ${data.attendee.ticketNumber}` : "";
    setMessage(`Checked in: ${data.attendee.fullName}${tn}`);
    setLastCheckedId(data.attendee.id);
    setToken("");
  }

  async function undo() {
    if (!lastCheckedId) return;
    const note = prompt("Reason for undoing check-in?") || "Correction";
    const res = await fetch("/api/checkin/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: lastCheckedId, note }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Undo failed.");
      return;
    }
    setMessage(`Check-in undone for ${data.attendee.fullName}`);
  }

  async function searchForRemove() {
    setError(null);
    const res = await fetch(
      `/api/organizer/attendees?q=${encodeURIComponent(removeQ.trim())}`,
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Search failed.");
      return;
    }
    setRemoveHits((data.attendees || []).filter((a: StaffAttendee) => a.status !== "REMOVED"));
  }

  async function removeAttendee(a: StaffAttendee) {
    setError(null);
    setMessage(null);
    const previewRes = await fetch(
      `/api/organizer/attendees/remove?attendeeId=${encodeURIComponent(a.id)}`,
    );
    const previewData = await previewRes.json();
    if (!previewRes.ok) {
      setError(previewData.error || "Could not load removal preview.");
      return;
    }
    const preview = previewData.preview as {
      fullName: string;
      ticketRef: string | null;
      hasActiveVote: boolean;
      voteGroupName: string | null;
      requiresOrganizer: boolean;
    };
    if (preview.hasActiveVote || preview.requiresOrganizer) {
      setError(
        `“${preview.fullName}” has already voted (${preview.voteGroupName || "ballot on file"}). Ask an organizer to remove and void the ballot.`,
      );
      return;
    }
    const reason = prompt(
      `Remove attendee “${preview.fullName}”?\nTicket ref: ${preview.ticketRef || "n/a"}\n\nEnter a reason (required):`,
    );
    if (!reason || reason.trim().length < 3) {
      setError("Removal cancelled — reason required.");
      return;
    }
    if (
      !confirm(
        `Confirm soft-remove of ${preview.fullName} (ref ${preview.ticketRef || "n/a"})? Other party members stay registered.`,
      )
    ) {
      return;
    }
    const res = await fetch("/api/organizer/attendees/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: a.id, reason: reason.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Removal failed.");
      return;
    }
    setMessage(`Removed ${data.fullName}. Party registration preserved.`);
    setRemoveHits((prev) => prev.filter((x) => x.id !== a.id));
  }

  async function toggleScan() {
    if (scanning) {
      await html5Ref.current?.stop().catch(() => undefined);
      html5Ref.current = null;
      setScanning(false);
      return;
    }
    setScanning(true);
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode("qr-reader");
    html5Ref.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 240, height: 240 } },
      async (decoded) => {
        await scanner.stop().catch(() => undefined);
        html5Ref.current = null;
        setScanning(false);
        await checkIn(decoded, "qr");
      },
      () => undefined,
    );
  }

  return (
    <div className="page-shell staff-surface">
      <ClientSiteHeader />
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--red)]">Staff check-in</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Scan entry QR codes, or enter the printed ticket number (UIJ2026-#####-NN)
          or ticket link as backup. Duplicate check-ins are blocked.
        </p>

        {!staff ? (
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
                autoComplete="username"
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
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit">
              Sign in
            </button>
          </form>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p>
                {staff.displayName} · {staff.role}
              </p>
              <button type="button" className="btn btn-secondary" onClick={logout}>
                Log out
              </button>
            </div>

            {staff.role === "ORGANIZER" && (
              <Link href="/organizer" className="btn btn-secondary w-full">
                Open organizer dashboard
              </Link>
            )}

            <button type="button" className="btn btn-primary w-full" onClick={toggleScan}>
              {scanning ? "Stop camera" : "Scan QR with camera"}
            </button>
            <div id="qr-reader" ref={scannerRef} className="overflow-hidden rounded-2xl" />

            <form
              className="panel space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                checkIn(token, "manual");
              }}
            >
              <div>
                <label className="label" htmlFor="token">
                  Ticket number or ticket link (backup if QR won&apos;t scan)
                </label>
                <textarea
                  id="token"
                  className="field min-h-28 font-mono text-sm"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="UIJ2026-00425-01 or paste ticket link"
                  required
                />
              </div>
              <button className="btn btn-primary w-full" type="submit">
                Check in
              </button>
            </form>

            {lastCheckedId && (
              <button type="button" className="btn btn-danger w-full" onClick={undo}>
                Undo last / selected check-in
              </button>
            )}

            <div className="panel space-y-3 p-5">
              <h2 className="font-extrabold text-[var(--red)]">Remove attendee</h2>
              <p className="text-sm text-[var(--ink-soft)]">
                Soft-remove a mistaken registration. Ticket QR is invalidated; the group
                registration stays. If they already voted, ask an organizer.
              </p>
              <div className="flex gap-2">
                <input
                  className="field"
                  placeholder="Search name or contact"
                  value={removeQ}
                  onChange={(e) => setRemoveQ(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" onClick={searchForRemove}>
                  Search
                </button>
              </div>
              <ul className="space-y-2">
                {removeHits.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--red)]/10 p-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">{a.fullName}</p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {a.status}
                        {a.ticketRef ? ` · ref ${a.ticketRef}` : ""}
                        {a.managerName ? ` · mgr ${a.managerName}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger !min-h-10 !px-3 !text-sm"
                      onClick={() => removeAttendee(a)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="text-[var(--red)]">{error}</p>}
            {message && <p className="text-[var(--green)]">{message}</p>}
          </div>
        )}
      </div>
    <SiteFooter />
    </div>
  );
}
