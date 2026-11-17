"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isTicketNumberInput } from "@/lib/booking-ref";

export type VerifiedAttendee = {
  id: string;
  fullName: string;
  status: "ISSUED";
};

type VerifyResponse = {
  ok?: boolean;
  attendee?: VerifiedAttendee;
  ticketToken?: string;
  error?: string;
  code?: string;
  registerUrl?: string;
  findUrl?: string | null;
};

type Props = {
  title: string;
  hint?: string;
  initialTicket?: string;
  onVerified: (data: { ticket: string; attendee: VerifiedAttendee }) => void;
  onClear?: () => void;
  verifiedLabel?: string | null;
};

export function TicketVerifyPanel({
  title,
  hint,
  initialTicket = "",
  onVerified,
  onClear,
  verifiedLabel,
}: Props) {
  const [ticket, setTicket] = useState(initialTicket);
  const [votingCredential, setVotingCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [registerUrl, setRegisterUrl] = useState<string | null>(null);
  const [findUrl, setFindUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const html5Ref = useRef<{ stop: () => Promise<void> } | null>(null);
  const readerId = useRef(`qr-verify-${Math.random().toString(36).slice(2, 9)}`);
  const needsVoteCode = isTicketNumberInput(ticket);

  useEffect(() => {
    setTicket(initialTicket);
  }, [initialTicket]);

  useEffect(() => {
    return () => {
      html5Ref.current?.stop().catch(() => undefined);
    };
  }, []);

  async function verify(raw: string, voteCode?: string) {
    setLoading(true);
    setError(null);
    setRegisterUrl(null);
    setFindUrl(null);
    try {
      const payload: Record<string, string> = { ticket: raw };
      const vote = (voteCode || votingCredential || "").trim();
      if (vote) payload.votingCredential = vote;

      const res = await fetch("/api/tickets/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as VerifyResponse;
      if (!res.ok || !data.attendee) {
        setError(data.error || "Could not verify this ticket.");
        setRegisterUrl(data.registerUrl || "/register");
        if (data.findUrl) setFindUrl(data.findUrl);
        return;
      }
      // Prefer opaque token so follow-on APIs keep working after number+code verify.
      onVerified({
        ticket: data.ticketToken || raw,
        attendee: data.attendee,
      });
    } catch {
      setError("Network error during verification.");
    } finally {
      setLoading(false);
    }
  }

  async function onManual(e: FormEvent) {
    e.preventDefault();
    await verify(ticket, votingCredential);
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
          setTicket(decoded);
          await verify(decoded);
        },
        () => undefined,
      );
    } catch {
      setScanning(false);
      setError("Camera could not start. Upload a QR image or enter the ticket reference.");
    }
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(readerId.current + "-file");
      const decoded = await scanner.scanFile(file, false);
      setTicket(decoded);
      await verify(decoded);
    } catch {
      setError("Could not read a ticket QR from that image.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--red)]/15 bg-white/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold text-[var(--ink)]">{title}</p>
          {hint && <p className="text-xs text-[var(--ink-soft)]">{hint}</p>}
        </div>
        {verifiedLabel && (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--red)] underline"
            onClick={() => {
              onClear?.();
              setError(null);
            }}
          >
            Change
          </button>
        )}
      </div>

      {verifiedLabel ? (
        <p className="rounded-lg border border-[var(--green)]/30 bg-[var(--green)]/5 px-3 py-2 text-sm font-semibold text-[var(--green)]">
          Verified: {verifiedLabel}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary !min-h-10 !text-sm" onClick={toggleScan}>
              {scanning ? "Stop camera" : "Scan QR with camera"}
            </button>
            <label className="btn btn-secondary !min-h-10 !text-sm cursor-pointer">
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
          <form onSubmit={onManual} className="space-y-2">
            <label className="label" htmlFor={`${readerId.current}-manual`}>
              Ticket link or ticket number
            </label>
            <textarea
              id={`${readerId.current}-manual`}
              className="field min-h-20 font-mono text-sm"
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="Paste ticket link, or type UIJ2026-#####-NN"
              required
            />
            {needsVoteCode && (
              <div>
                <label className="label" htmlFor={`${readerId.current}-vote`}>
                  Voting code (required with ticket number)
                </label>
                <input
                  id={`${readerId.current}-vote`}
                  className="field font-mono"
                  value={votingCredential}
                  onChange={(e) => setVotingCredential(e.target.value.toUpperCase())}
                  placeholder="From your ticket stub"
                  autoComplete="one-time-code"
                  required
                />
              </div>
            )}
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Verifying…" : "Verify registration"}
            </button>
          </form>
        </>
      )}

      {error && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[var(--red)]">{error}</p>
          {findUrl && (
            <Link href={findUrl} className="btn btn-secondary !min-h-10 w-full !text-sm">
              Find My Ticket
            </Link>
          )}
          {registerUrl && (
            <Link href={registerUrl} className="btn btn-secondary !min-h-10 w-full !text-sm">
              Register for the event
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
