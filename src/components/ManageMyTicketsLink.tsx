"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { manageMyTicketsPath } from "@/lib/manage-session";

type Props = {
  children?: React.ReactNode;
  className?: string;
  /** Default label when children omitted. */
  label?: string;
  /** Force destination (e.g. confirmation already stored the token). */
  hrefOverride?: "/manage" | "/find";
  onClick?: () => void;
};

/**
 * Prominent entry to the group ticket dashboard.
 * Uses `/manage` only when a booking access token is already on this device;
 * otherwise sends guests to `/find`. Never puts tokens in the href.
 */
export function ManageMyTicketsLink({
  children,
  className,
  label = "Manage My Tickets",
  hrefOverride,
  onClick,
}: Props) {
  const [href, setHref] = useState<"/manage" | "/find">(hrefOverride || "/find");

  useEffect(() => {
    if (hrefOverride) {
      setHref(hrefOverride);
      return;
    }
    setHref(manageMyTicketsPath());
  }, [hrefOverride]);

  return (
    <Link className={className} href={href} onClick={onClick}>
      {children ?? label}
    </Link>
  );
}
