import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkles } from "@/components/Sparkles";
import { getEventConfig } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const event = await getEventConfig();

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="hero-veil absolute inset-0" />
      <Sparkles />
      <SiteHeader />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-center px-4 pb-16 pt-6">
        <p className="animate-rise mb-3 text-sm uppercase tracking-[0.28em] text-[var(--gold-soft)]/80">
          Christmas gathering
        </p>
        <h1 className="brand-mark animate-rise max-w-3xl text-5xl leading-[1.05] text-[var(--cream)] sm:text-7xl">
          United in Love
          <span className="mt-2 block text-3xl text-[var(--gold)] sm:text-4xl">
            Christmas Party
          </span>
        </h1>
        <p className="animate-rise-delay mt-5 max-w-xl text-lg text-[var(--cream)]/85 sm:text-xl">
          One night of celebration — register for your QR ticket, join the fun, and crown
          King & Queen of the Night.
        </p>
        <div className="animate-rise-delay mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/register" className="btn btn-primary cta-pulse">
            Register for a ticket
          </Link>
          <Link href="/ticket" className="btn btn-secondary">
            Open my ticket
          </Link>
        </div>
        <p className="mt-8 text-sm text-[var(--cream)]/65">
          {event.dateLabel} · {event.venueLabel}
        </p>
      </section>
    </main>
  );
}
