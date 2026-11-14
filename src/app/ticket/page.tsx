"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientSiteHeader } from "@/components/ClientSiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function TicketLookupPage() {
  const router = useRouter();
  const [value, setValue] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("uilc_ticket_token");
    if (saved) setValue(saved);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    // Accept full ticket URL or the opaque code from the link.
    const fromUrl = raw.includes("/ticket/")
      ? decodeURIComponent(raw.split("/ticket/")[1] || "")
      : raw;
    if (!fromUrl) return;
    try {
      localStorage.setItem("uilc_ticket_token", fromUrl);
    } catch {
      // Ignore storage failures; ticket page still opens.
    }
    router.push(`/ticket/${encodeURIComponent(fromUrl)}`);
  }

  return (
    <div className="page-shell">
      <ClientSiteHeader />
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
        <h1 className="brand-mark text-4xl text-[var(--red)]">Open my ticket</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Use the link from registration, or paste it here to reopen your QR entry
          ticket.
        </p>
        <form onSubmit={onSubmit} className="panel mt-8 space-y-4 p-5">
          <div>
            <label className="label" htmlFor="ticketLink">
              Ticket link
            </label>
            <textarea
              className="field min-h-28 text-sm"
              id="ticketLink"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste your ticket link from registration"
              required
            />
          </div>
          <button className="btn btn-primary w-full" type="submit">
            Show my QR ticket
          </button>
        </form>
      </div>
      <SiteFooter />
    </div>
  );
}
