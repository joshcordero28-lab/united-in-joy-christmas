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
          Get your QR ticket instantly. Save your private guest code with your ticket.
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
            {error && <p className="font-semibold text-[var(--red)]">{error}</p>}
            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading ? "Registering…" : "Get my ticket"}
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
                <p className="text-sm text-[var(--ink-soft)]">
                  Save your ticket link and private guest code now — they are not emailed.
                </p>
                <p className="rounded-xl border border-[var(--gold)] bg-[var(--cream-deep)] p-3 font-mono text-sm">
                  Guest code: <strong className="text-[var(--red)]">{result.votingCredential}</strong>
                </p>
                <Link
                  className="btn btn-primary w-full"
                  href={`/ticket/${encodeURIComponent(result.ticketToken)}`}
                >
                  View QR ticket
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
