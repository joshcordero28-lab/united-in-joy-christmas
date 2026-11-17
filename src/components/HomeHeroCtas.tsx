"use client";

import Link from "next/link";
import { ManageMyTicketsLink } from "@/components/ManageMyTicketsLink";

/** Hero CTAs — Register + Manage My Tickets (smart destination). */
export function HomeHeroCtas() {
  return (
    <div className="animate-rise-delay mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link href="/register" className="btn btn-primary cta-pulse">
        Register for a ticket
      </Link>
      <ManageMyTicketsLink className="btn btn-secondary">
        Manage My Tickets
      </ManageMyTicketsLink>
    </div>
  );
}
