"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Legacy path `/ticket/<token>` — move the bearer into the URL hash (not sent to
 * the server on subsequent navigations) then open the hash-based ticket page.
 */
export default function LegacyTicketRedirectPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  useEffect(() => {
    const raw = params?.token ? decodeURIComponent(params.token) : "";
    if (!raw) {
      router.replace("/ticket");
      return;
    }
    try {
      localStorage.setItem("uilc_ticket_token", raw);
    } catch {
      // ignore
    }
    router.replace(`/ticket#${encodeURIComponent(raw)}`);
  }, [params, router]);

  return (
    <div className="page-shell">
      <p className="p-8 text-[var(--ink-soft)]">Opening your ticket…</p>
    </div>
  );
}
