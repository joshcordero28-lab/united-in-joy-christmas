"use client";

import { useEffect } from "react";

/** Persist the entry ticket on this device so /competitions and vote can recognize the guest. */
export function RememberTicketToken({ token }: { token: string }) {
  useEffect(() => {
    if (!token) return;
    try {
      localStorage.setItem("uilc_ticket_token", token);
    } catch {
      // Private mode / blocked storage — ticket page still works; competitions needs a re-open.
    }
  }, [token]);

  return null;
}
