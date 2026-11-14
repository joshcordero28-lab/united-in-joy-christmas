"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

type RegisterResult = {
  attendeeId: string;
  fullName: string;
  status: string;
  ticketToken: string | null;
  votingCredential: string | null;
  message: string;
};

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          phone: form.get("phone"),
          email: form.get("email"),
          notes: form.get("notes"),
          company: form.get("company"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed.");
        return;
      }
      setResult(data);
      if (data.ticketToken) {
        localStorage.setItem("uilc_ticket_token", data.ticketToken);
        localStorage.setItem("uilc_voting_credential", data.votingCredential || "");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <p className="script-mark text-2xl text-[var(--red)]">Join us</p>
        <h1 className="brand-mark text-4xl text-[var(--red)] sm:text-5xl">Register</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Get your entry ticket with a QR code for the door. Keep your private guest
          code with it.
        </p>

        {!result ? (
          <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
            <div>
              <label className="label" htmlFor="fullName">
                Full name *
              </label>
              <input className="field" id="fullName" name="fullName" required minLength={2} />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input className="field" id="phone" name="phone" inputMode="tel" />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input className="field" id="email" name="email" type="email" />
            </div>
            <div>
              <label className="label" htmlFor="notes">
                Notes (optional)
              </label>
              <textarea className="field min-h-24" id="notes" name="notes" />
            </div>
            {/* Honeypot — leave empty; hidden from people, filled by many bots */}
            <div
              aria-hidden="true"
              style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}
            >
              <label htmlFor="company">Company</label>
              <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading ? "Registering…" : "Get my entry ticket"}
            </button>
          </form>
        ) : (
          <div className="panel mt-8 space-y-4 p-5">
            <h2 className="brand-mark text-3xl text-[var(--red)]">
              You&apos;re in, {result.fullName}!
            </h2>
            <p className="text-[var(--ink-soft)]">{result.message}</p>
            {result.ticketToken && (
              <>
                <p className="text-sm font-extrabold text-[var(--red)]">
                  Next: open your QR and show it at the door.
                </p>
                <p className="text-sm text-[var(--ink-soft)]">
                  Save the ticket page on your phone. Tickets are not emailed.
                </p>
                <p className="rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-3 text-sm">
                  Private guest code:{" "}
                  <strong className="font-mono tracking-wider text-[var(--red)]">
                    {result.votingCredential}
                  </strong>
                  <span className="mt-1 block text-xs font-normal text-[var(--ink-soft)]">
                    Keep this with your ticket (you may need it later at the event).
                  </span>
                </p>
                <Link
                  className="btn btn-primary w-full"
                  href={`/ticket#${encodeURIComponent(result.ticketToken)}`}
                >
                  Open my entry ticket
                </Link>
              </>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
