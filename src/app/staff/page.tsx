"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type StaffInfo = { role: string; displayName: string } | null;

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
    const { extractTicketToken } = await import("@/lib/tickets");
    const payload = { token: extractTicketToken(value) || value, method };

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
    setMessage(`Checked in: ${data.attendee.fullName}`);
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
          Scan entry QR codes, or paste a ticket link as backup. Duplicate check-ins
          are blocked.
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
                  Ticket link (backup if QR won&apos;t scan)
                </label>
                <textarea
                  id="token"
                  className="field min-h-28 font-mono text-sm"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
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

            {error && <p className="text-[var(--red)]">{error}</p>}
            {message && <p className="text-[var(--green)]">{message}</p>}
          </div>
        )}
      </div>
    <SiteFooter />
    </div>
  );
}
