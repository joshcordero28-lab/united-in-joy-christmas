"use client";

import { useEffect, useState } from "react";
import type { CapacitySnapshot } from "@/lib/capacity";

const POLL_MS = 20_000;

type Props = {
  initial: CapacitySnapshot;
};

export function GuestCounter({ initial }: Props) {
  const [snapshot, setSnapshot] = useState<CapacitySnapshot>(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refresh() {
      try {
        const res = await fetch("/api/public/guests", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<CapacitySnapshot>;
        if (
          cancelled ||
          typeof data.count !== "number" ||
          typeof data.capacity !== "number"
        ) {
          return;
        }
        const remaining =
          typeof data.remaining === "number"
            ? data.remaining
            : Math.max(0, data.capacity - data.count);
        setSnapshot({
          count: data.count,
          capacity: data.capacity,
          remaining,
          full: typeof data.full === "boolean" ? data.full : remaining === 0,
        });
      } catch {
        // Keep last good snapshot on transient network errors.
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await refresh();
        }
        if (!cancelled) schedule();
      }, POLL_MS);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refresh().then(() => {
          if (!cancelled) schedule();
        });
      }
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const { count, capacity, remaining, full } = snapshot;
  const pct = capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0;

  return (
    <div
      className="panel-on-red animate-rise-delay mt-6 w-full max-w-md px-4 py-4 sm:px-5"
      aria-live="polite"
    >
      <p className="text-sm font-extrabold tracking-wide text-[var(--red)] sm:text-base">
        Join the Celebration!
      </p>
      <p className="brand-mark mt-1 text-2xl leading-tight text-[var(--red-deep)] sm:text-3xl">
        {count}{" "}
        <span className="text-lg font-semibold text-[var(--ink-soft)] sm:text-xl">
          / {capacity} Guests Registered
        </span>
      </p>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        Celebrate Christmas together! Reserve your spot today!
      </p>

      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--cream-deep)] ring-1 ring-[var(--green)]/30"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={count}
        aria-label={`${count} of ${capacity} guests registered`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--green)] via-[var(--gold)] to-[var(--red)] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p
        className={`mt-2 text-sm font-extrabold ${
          full ? "text-[var(--red-deep)]" : "text-[var(--green-deep)]"
        }`}
      >
        {full ? "Fully Booked!" : `${remaining} spot${remaining === 1 ? "" : "s"} left`}
      </p>
    </div>
  );
}
