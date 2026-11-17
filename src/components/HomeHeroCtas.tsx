"use client";

import Link from "next/link";
import { ManageMyTicketsLink } from "@/components/ManageMyTicketsLink";

/** Hero CTAs — register or retrieve with a private guest code. */
export function HomeHeroCtas() {
  return (
    <div className="animate-rise-delay mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link href="/register" className="btn btn-primary cta-pulse">
        Register for the Event
      </Link>
      <Link href="/find" className="btn btn-secondary">
        Already Registered? Find My Ticket
      </Link>
      <ManageMyTicketsLink className="btn btn-secondary sm:basis-full lg:basis-auto">
        Manage My Tickets
      </ManageMyTicketsLink>
    </div>
  );
}
