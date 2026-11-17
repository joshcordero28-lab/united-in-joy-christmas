"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CcfMark } from "@/components/CcfMark";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ManageMyTicketsLink } from "@/components/ManageMyTicketsLink";
import { SaveQrButton } from "@/components/SaveQrButton";
import { storeManagerToken } from "@/lib/manage-session";

type TicketResult = {
  mode: "ticket";
  fullName: string;
  status: string;
  ticketNumber: string;
  bookingRef: string;
  dateLabel: string;
  venueLabel: string;
  checkedInAt: string | null;
  qr: string | null;
  link: string | null;
  staffRef: string;
  votingCredential?: string | null;
};

type BookingAttendee = {
  id: string;
  fullName: string;
  status: string;
  ticketNumber: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  ticketToken: string | null;
  votingCredential?: string | null;
  link: string | null;
  qr: string | null;
};

type BookingResult = {
  mode: "booking";
  bookingRef: string;
  managerName: string;
  manageLink: string;
  dateLabel: string;
  venueLabel: string;
  totalAttendees: number;
  checkedInCount: number;
  attendees: BookingAttendee[];
};

function managerHashFromLink(manageLink: string): string {
  try {
    const u = new URL(manageLink, typeof window !== "undefined" ? window.location.origin : "http://local");
    return u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  } catch {
    return "";
  }
}

function ticketPageHref(link: string | null, votingCredential?: string | null, ticketToken?: string | null) {
  if (ticketToken) {
    return votingCredential
      ? `/ticket#${encodeURIComponent(ticketToken)}~${encodeURIComponent(votingCredential)}`
      : `/ticket#${encodeURIComponent(ticketToken)}`;
  }
  if (!link) return "/ticket";
  try {
    const u = new URL(link, typeof window !== "undefined" ? window.location.origin : "http://local");
    return `${u.pathname}${u.hash}`;
  } catch {
    return "/ticket";
  }
}

export default function FindTicketsPage() {
  const [guestCode, setGuestCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketResult | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [focusQrId, setFocusQrId] = useState<string | null>(null);

  const hasResult = Boolean(ticket || booking);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setTicket(null);
    setBooking(null);
    setFocusQrId(null);

    try {
      const res = await fetch("/api/booking/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestCode: guestCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not verify that private guest code.");
        return;
      }

      if (data.mode === "booking") {
        const result = data as BookingResult;
        setBooking(result);
        const hash = managerHashFromLink(result.manageLink);
        if (hash) {
          try {
            storeManagerToken(decodeURIComponent(hash));
          } catch {
            storeManagerToken(hash);
          }
        }
        if (result.attendees.length === 1 && result.attendees[0]?.qr) {
          setFocusQrId(result.attendees[0].id);
        }
      } else {
        const result = data as TicketResult;
        setTicket(result);
        if (result.link) {
          try {
            const u = new URL(result.link, window.location.origin);
            const hash = decodeURIComponent(u.hash.slice(1));
            const tokenPart = hash.split("~")[0];
            if (tokenPart) localStorage.setItem("uilc_ticket_token", tokenPart);
            if (result.votingCredential) {
              localStorage.setItem("uilc_voting_credential", result.votingCredential);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTicket(null);
    setBooking(null);
    setError(null);
    setFocusQrId(null);
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Already registered?</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">Find My Ticket</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Enter the private guest code from registration. One code is enough — no booking
          reference needed.
        </p>

        {!hasResult ? (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="guestCode">
                Private Guest Code
              </label>
              <textarea
                id="guestCode"
                className="field min-h-28 font-mono text-sm"
                placeholder="Paste your private guest code, ticket link, or booking link"
                value={guestCode}
                onChange={(e) => setGuestCode(e.target.value)}
                required
                autoComplete="off"
                autoFocus
              />
              <p className="mt-2 text-xs text-[var(--ink-soft)]">
                Use the code or link you received when you registered. Public reference
                numbers alone will not open a ticket.
              </p>
            </div>

            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Verifying…" : "View My QR Ticket"}
            </button>
            <p className="text-center text-sm text-[var(--ink-soft)]">
              Lost your code and ticket link? Ask an event organizer for help — they can
              re-send your existing ticket without creating a duplicate.
            </p>
          </form>
        ) : ticket ? (
          <div className="mt-8 space-y-4">
            <div className="ticket-shell animate-rise px-5 pb-5 pt-6 text-center">
              <div className="mb-3 flex justify-center">
                <CcfMark variant="red" />
              </div>
              <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--red)]">
                Your entry ticket
              </p>
              <h2 className="brand-mark mt-2 text-3xl text-[var(--red)]">UNITED IN JOY</h2>
              <p className="script-mark text-2xl text-[var(--green)]">Christmas 2026</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {ticket.dateLabel} · {ticket.venueLabel}
              </p>
              <p className="mt-5 text-xl font-extrabold">{ticket.fullName}</p>
              {ticket.qr ? (
                <>
                  <p className="mt-4 text-base font-extrabold text-[var(--red)]">
                    Show this QR at the door
                  </p>
                  <div className="mx-auto mt-3 inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ticket.qr} alt="Entry ticket QR" className="h-64 w-64" />
                  </div>
                </>
              ) : (
                <p className="mt-4 text-[var(--ink-soft)]">Ticket not valid for entry.</p>
              )}
              {ticket.checkedInAt && (
                <p className="mt-3 text-sm font-semibold text-[var(--green)]">
                  Checked in {new Date(ticket.checkedInAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="space-y-2">
              {ticket.qr && (
                <SaveQrButton
                  qrDataUrl={ticket.qr}
                  fileName={`united-in-joy-${ticket.fullName.replace(/\s+/g, "-").toLowerCase()}-qr.png`}
                />
              )}
              {ticket.link && <CopyLinkButton link={ticket.link} />}
              {ticket.link && (
                <Link
                  className="btn btn-secondary w-full"
                  href={ticketPageHref(ticket.link, ticket.votingCredential)}
                >
                  View QR Code
                </Link>
              )}
            </div>
            <button type="button" className="btn btn-secondary w-full" onClick={reset}>
              Look up another
            </button>
          </div>
        ) : booking ? (
          <div className="mt-8 space-y-4">
            <div className="panel animate-rise space-y-3 p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--red)]">
                Your group tickets
              </p>
              <p className="font-semibold text-[var(--green)]">Managed by {booking.managerName}</p>
              <p className="text-sm text-[var(--ink-soft)]">
                {booking.totalAttendees} ticket{booking.totalAttendees === 1 ? "" : "s"} ·{" "}
                {booking.checkedInCount} checked in · {booking.dateLabel}
              </p>
              <ManageMyTicketsLink
                className="btn btn-primary w-full"
                hrefOverride="/manage"
                label="Manage My Tickets"
              >
                Manage My Tickets
              </ManageMyTicketsLink>
            </div>
            <ul className="space-y-4">
              {booking.attendees.map((a) => {
                const showQr = focusQrId === a.id || booking.attendees.length === 1;
                return (
                  <li
                    key={a.id}
                    className="rounded-xl border border-[var(--red)]/10 bg-white/70 px-4 py-4 text-sm"
                  >
                    <p className="font-semibold text-base">{a.fullName}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {a.status}
                      {a.checkedIn ? " · checked in" : ""}
                    </p>
                    {showQr && a.qr ? (
                      <div className="mt-3 text-center">
                        <div className="mx-auto inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.qr}
                            alt={`Entry QR for ${a.fullName}`}
                            className="h-48 w-48"
                          />
                        </div>
                        <div className="mt-3 space-y-2">
                          <SaveQrButton
                            qrDataUrl={a.qr}
                            className="btn btn-secondary !min-h-10 w-full !text-sm"
                            fileName={`united-in-joy-${a.fullName.replace(/\s+/g, "-").toLowerCase()}-qr.png`}
                          />
                          {a.link && (
                            <Link
                              className="btn btn-primary !min-h-10 w-full !text-sm"
                              href={ticketPageHref(a.link, a.votingCredential, a.ticketToken)}
                            >
                              View QR Code
                            </Link>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary mt-3 !min-h-10 w-full !text-sm"
                        onClick={() => setFocusQrId(a.id)}
                        disabled={!a.qr && a.status !== "ISSUED"}
                      >
                        {a.qr || a.status === "ISSUED" ? "View QR Code" : "QR not available"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn-secondary w-full" onClick={reset}>
              Look up another
            </button>
          </div>
        ) : null}
      </div>
      <SiteFooter />
    </div>
  );
}
