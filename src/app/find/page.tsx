"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CcfMark } from "@/components/CcfMark";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ManageMyTicketsLink } from "@/components/ManageMyTicketsLink";
import { storeManagerToken } from "@/lib/manage-session";

type LookupMode = "booking" | "ticket";

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

export default function FindTicketsPage() {
  const [mode, setMode] = useState<LookupMode>("booking");
  const [bookingRef, setBookingRef] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketResult | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);

  const hasResult = Boolean(ticket || booking);

  const hint = useMemo(() => {
    if (mode === "booking") {
      return "Booking reference alone never opens tickets — you also need the private access code from your original booking link.";
    }
    return "Paste your private ticket link, or use a ticket number together with your booking access code. A ticket number alone cannot open a ticket.";
  }, [mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setTicket(null);
    setBooking(null);

    try {
      let body: Record<string, string>;
      if (mode === "booking") {
        body = {
          bookingRef: bookingRef.trim(),
          accessToken: accessToken.trim(),
        };
      } else {
        const q = ticketQuery.trim();
        if (/^UIJ2026-\d{5}-\d{2}$/i.test(q)) {
          // Sequential ticket numbers are not secrets — require booking access code.
          body = {
            ticketNumber: q,
            accessToken: accessToken.trim(),
          };
        } else {
          body = { ticket: q };
        }
      }

      const res = await fetch("/api/booking/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Lookup failed.");
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
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Retrieve</p>
        <h1 className="brand-mark text-4xl text-[var(--red)]">Find tickets</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Open a whole booking with your reference + access code, or reopen one ticket
          with its private link.
        </p>

        {!hasResult ? (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                  mode === "booking"
                    ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                    : "border-[var(--red)]/15 bg-white/70"
                }`}
                onClick={() => setMode("booking")}
                aria-pressed={mode === "booking"}
              >
                Whole booking
              </button>
              <button
                type="button"
                className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                  mode === "ticket"
                    ? "border-[var(--red)] bg-[var(--cream-deep)] text-[var(--red)]"
                    : "border-[var(--red)]/15 bg-white/70"
                }`}
                onClick={() => setMode("ticket")}
                aria-pressed={mode === "ticket"}
              >
                One ticket
              </button>
            </div>

            <p className="text-xs text-[var(--ink-soft)]">{hint}</p>

            {mode === "booking" ? (
              <>
                <div>
                  <label className="label" htmlFor="bookingRef">
                    Booking reference
                  </label>
                  <input
                    id="bookingRef"
                    className="field font-mono"
                    placeholder="UIJ2026-00042"
                    value={bookingRef}
                    onChange={(e) => setBookingRef(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="accessToken">
                    Private access code (from booking link)
                  </label>
                  <textarea
                    id="accessToken"
                    className="field min-h-24 font-mono text-sm"
                    placeholder="Paste the code or full /manage#… link"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="ticketQuery">
                    Private ticket link (or ticket number)
                  </label>
                  <textarea
                    id="ticketQuery"
                    className="field min-h-24 font-mono text-sm"
                    placeholder="Paste ticket link, or enter UIJ2026-00042-01"
                    value={ticketQuery}
                    onChange={(e) => setTicketQuery(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
                {/^UIJ2026-\d{5}-\d{2}$/i.test(ticketQuery.trim()) && (
                  <div>
                    <label className="label" htmlFor="ticketAccessToken">
                      Booking access code (required with ticket number)
                    </label>
                    <textarea
                      id="ticketAccessToken"
                      className="field min-h-24 font-mono text-sm"
                      placeholder="Paste the code or full /manage#… link"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      required
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            )}

            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Looking up…" : "Find tickets"}
            </button>
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
              <p className="mt-1 font-mono text-sm font-semibold text-[var(--red)]">
                {ticket.ticketNumber}
              </p>
              <p className="text-xs text-[var(--ink-soft)]">Booking {ticket.bookingRef}</p>
              {ticket.qr ? (
                <div className="mx-auto mt-4 inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ticket.qr} alt="Entry ticket QR" className="h-64 w-64" />
                </div>
              ) : (
                <p className="mt-4 text-[var(--ink-soft)]">Ticket not valid for entry.</p>
              )}
              {ticket.checkedInAt && (
                <p className="mt-3 text-sm font-semibold text-[var(--green)]">
                  Checked in {new Date(ticket.checkedInAt).toLocaleString()}
                </p>
              )}
            </div>
            {ticket.link && (
              <div className="space-y-2">
                <CopyLinkButton link={ticket.link} />
                <Link
                  className="btn btn-secondary w-full"
                  href={
                    ticket.votingCredential && ticket.link.includes("#")
                      ? `/ticket#${ticket.link.split("#")[1]}`
                      : ticket.link.includes("#")
                        ? `/ticket#${ticket.link.split("#")[1]}`
                        : "/ticket"
                  }
                >
                  Open ticket page
                </Link>
              </div>
            )}
            <button type="button" className="btn btn-secondary w-full" onClick={reset}>
              Look up another
            </button>
          </div>
        ) : booking ? (
          <div className="mt-8 space-y-4">
            <div className="panel animate-rise space-y-3 p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--red)]">
                Booking found
              </p>
              <p className="font-mono text-2xl font-extrabold">{booking.bookingRef}</p>
              <p className="font-semibold text-[var(--green)]">Managed by {booking.managerName}</p>
              <p className="text-sm text-[var(--ink-soft)]">
                {booking.totalAttendees} ticket{booking.totalAttendees === 1 ? "" : "s"} ·{" "}
                {booking.checkedInCount} checked in · {booking.dateLabel}
              </p>
              <ManageMyTicketsLink
                className="btn btn-primary w-full"
                hrefOverride="/manage"
                label="Manage My Tickets"
              />
              <p className="text-xs text-[var(--ink-soft)]">
                Access stays on this device — the booking code is not added to the page URL.
              </p>
            </div>
            <ul className="space-y-2">
              {booking.attendees.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--red)]/10 bg-white/70 px-4 py-3 text-sm"
                >
                  <p className="font-semibold">{a.fullName}</p>
                  <p className="font-mono text-xs text-[var(--red)]">{a.ticketNumber}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {a.status}
                    {a.checkedIn ? " · checked in" : ""}
                  </p>
                </li>
              ))}
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
