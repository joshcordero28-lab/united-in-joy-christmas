"use client";

import { FormEvent, useEffect, useState } from "react";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { CcfMark } from "@/components/CcfMark";
import { extractTicketToken } from "@/lib/tickets";

type TicketView = {
  fullName: string;
  status: string;
  ticketNumber?: string;
  bookingRef?: string;
  partySize?: number;
  dateLabel: string;
  venueLabel: string;
  checkedInAt: string | null;
  qr: string | null;
  link: string;
  staffRef: string;
  votingCredential?: string | null;
};

function readRawFromLocation(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (hash) {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  }
  return localStorage.getItem("uilc_ticket_token") || "";
}

export function TicketClient() {
  const [token, setToken] = useState("");
  const [paste, setPaste] = useState("");
  const [view, setView] = useState<TicketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadTicket(raw: string) {
    const cleaned = extractTicketToken(raw);
    if (!cleaned || cleaned.length < 16) {
      setView(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ticket/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ticket not found.");
        setView(null);
        return;
      }
      const viewData = data as TicketView;
      try {
        localStorage.setItem("uilc_ticket_token", cleaned);
        if (viewData.votingCredential) {
          localStorage.setItem("uilc_voting_credential", viewData.votingCredential);
        }
      } catch {
        // ignore
      }
      setToken(cleaned);
      setView(viewData);
      // Prefer server link (may embed voting code for QR autofill).
      if (typeof window !== "undefined" && viewData.link) {
        try {
          const u = new URL(viewData.link);
          const next = `${u.pathname}${u.hash}`;
          if (`${window.location.pathname}${window.location.hash}` !== next) {
            window.history.replaceState(null, "", next);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      setError("Network error.");
      setView(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = readRawFromLocation();
    setPaste(initial);
    void loadTicket(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void loadTicket(paste);
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        {loading && !view ? (
          <p className="text-[var(--ink-soft)]">Loading ticket…</p>
        ) : view ? (
          <div className="relative">
            <div className="ticket-shell animate-rise px-5 pb-5 pt-6 text-center">
              <div className="mb-3 flex justify-center">
                <CcfMark variant="red" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--red)]">
                Your entry ticket
              </p>
              <h1 className="brand-mark mt-2 text-3xl text-[var(--red)] sm:text-4xl">
                UNITED IN JOY
              </h1>
              <p className="script-mark text-2xl text-[var(--green)]">Christmas 2026</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {view.dateLabel} · {view.venueLabel}
              </p>
              <p className="mt-5 text-xl font-extrabold text-[var(--ink)]">{view.fullName}</p>
              {view.ticketNumber && (
                <p className="mt-1 font-mono text-sm font-semibold tracking-wide text-[var(--red)]">
                  {view.ticketNumber}
                </p>
              )}
              {view.bookingRef && (
                <p className="text-xs text-[var(--ink-soft)]">Booking {view.bookingRef}</p>
              )}

              {view.partySize && view.partySize > 1 && (
                <div className="mx-auto mt-4 max-w-sm rounded-xl border border-[var(--gold)]/50 bg-[var(--cream-deep)] px-3 py-3 text-sm">
                  <p className="font-semibold text-[var(--red)]">
                    Part of a {view.partySize}-person booking
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    This page shows only your entry QR. Open the private booking link (or Find
                    tickets with your booking reference + access code) to see everyone.
                  </p>
                  <a
                    className="mt-2 inline-flex font-extrabold text-[var(--red)] underline"
                    href="/find"
                  >
                    Find group tickets
                  </a>
                </div>
              )}

              {view.qr ? (
                <>
                  <p className="mt-5 text-base font-extrabold text-[var(--red)]">
                    Show this QR at the door
                  </p>
                  <div className="mx-auto mt-3 inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-4 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={view.qr}
                      alt="Entry ticket QR code — show at the door"
                      className="h-64 w-64 sm:h-72 sm:w-72"
                    />
                  </div>
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    Save this page or share the ticket link — staff will scan the code.
                  </p>
                </>
              ) : (
                <p className="mt-6 text-[var(--ink-soft)]">
                  {view.status === "PENDING"
                    ? "Your registration is received. Your entry QR will appear after approval."
                    : "This ticket is not valid for entry."}
                </p>
              )}

              {view.checkedInAt && (
                <p className="mt-4 text-sm font-semibold text-[var(--green)]">
                  Checked in {new Date(view.checkedInAt).toLocaleString()}
                </p>
              )}
            </div>

            <div className="ticket-stub relative">
              <span className="ticket-notch-left" aria-hidden />
              <span className="ticket-notch-right" aria-hidden />
              <p className="script-mark text-center text-2xl text-white">Chance to celebrate!</p>
              <p className="mt-1 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--gold-soft)]">
                Keep this for the door
              </p>
              <div className="mt-4 space-y-3">
                <CopyLinkButton link={view.link} />
                <details className="rounded-xl bg-black/15 px-3 py-2 text-left text-sm text-white/85">
                  <summary className="cursor-pointer font-semibold text-[var(--gold-soft)]">
                    Staff backup reference
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-white/75">
                    If the QR won&apos;t scan, staff can look up reference{" "}
                    <span className="font-mono font-bold tracking-wider text-white">
                      {view.staffRef}
                    </span>
                    . Guests normally only need the QR above.
                  </p>
                </details>
              </div>
            </div>
            {token ? null : null}
          </div>
        ) : (
          <>
            <h1 className="brand-mark text-4xl text-[var(--red)]">Open my ticket</h1>
            <p className="mt-2 text-[var(--ink-soft)]">
              Use the link from registration, or paste it here to reopen your QR entry
              ticket. For a whole group booking, use Find tickets instead.
            </p>
            <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
              <div>
                <label className="label" htmlFor="ticketLink">
                  Ticket link
                </label>
                <textarea
                  className="field min-h-28 text-sm"
                  id="ticketLink"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Paste your ticket link from registration"
                  required
                />
              </div>
              {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
              <button className="btn btn-primary w-full" type="submit">
                Show my QR ticket
              </button>
              <p className="text-center text-sm text-[var(--ink-soft)]">
                Looking for every ticket in a booking?{" "}
                <a href="/find" className="font-semibold text-[var(--red)] underline">
                  Find tickets
                </a>
              </p>
            </form>
          </>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
