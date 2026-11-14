"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

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
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--red)]">Open ticket</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
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
      <SiteFooter />
    </div>
  );
}
