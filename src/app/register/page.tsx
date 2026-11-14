"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

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
    <main className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--gold-soft)]">Register</h1>
        <p className="mt-2 text-[var(--cream)]/80">
          Get your QR ticket instantly. Keep the voting code private.
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
            {error && <p className="text-[var(--berry-bright)]">{error}</p>}
            <button className="btn btn-primary w-full" disabled={loading} type="submit">
              {loading ? "Registering…" : "Get my ticket"}
            </button>
          </form>
        ) : (
          <div className="panel mt-8 space-y-4 p-5">
            <h2 className="brand-mark text-2xl text-[var(--gold)]">You&apos;re in, {result.fullName}!</h2>
            <p>{result.message}</p>
            {result.ticketToken && (
              <>
                <p className="text-sm text-[var(--cream)]/70">
                  Save your ticket link and voting code now — they are not emailed.
                </p>
                <p className="rounded-xl bg-black/20 p-3 font-mono text-sm break-all">
                  Voting code: <strong>{result.votingCredential}</strong>
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
    </main>
  );
}
