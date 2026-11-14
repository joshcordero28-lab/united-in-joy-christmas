"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

export default function TicketLookupPage() {
  const router = useRouter();
  const [token, setToken] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("uilc_ticket_token");
    if (saved) setToken(saved);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    router.push(`/ticket/${encodeURIComponent(token.trim())}`);
  }

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--gold-soft)]">Open ticket</h1>
        <p className="mt-2 text-[var(--cream)]/80">
          Paste your ticket token or open the link from registration.
        </p>
        <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
          <div>
            <label className="label" htmlFor="token">
              Ticket token
            </label>
            <textarea
              className="field min-h-28 font-mono text-sm"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary w-full" type="submit">
            Show ticket
          </button>
        </form>
      </div>
    </main>
  );
}
