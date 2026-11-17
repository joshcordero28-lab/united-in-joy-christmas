"use client";

import Link from "next/link";

/**
 * Primary guest CTAs only — Register + Find My Ticket.
 * Group “My Tickets” opens after Find verifies a group Private Guest Code.
 * Vote appears in the header when Audience Choice is revealed.
 */
export function HomeHeroCtas() {
  return (
    <div className="animate-rise-delay mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link href="/register" className="btn btn-primary cta-pulse">
        Register
      </Link>
      <Link href="/find" className="btn btn-secondary">
        Find My Ticket
      </Link>
    </div>
  );
}
