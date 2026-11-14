import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Sparkles } from "@/components/Sparkles";
import { ScriptWatermark } from "@/components/ScriptWatermark";
import { OrnamentRow } from "@/components/OrnamentRow";
import { getEventConfig } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const event = await getEventConfig();

  return (
    <div className="page-shell">
      <div className="hero-red relative min-h-screen overflow-hidden">
        <ScriptWatermark />
        <Sparkles />
        <SiteHeader onRed />

        <section className="relative z-10 mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-5xl flex-col justify-center px-4 pb-12 pt-2">
          <OrnamentRow />
          <p className="animate-rise mb-3 text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--gold-soft)] sm:text-sm">
            Food · Games · Karaoke · Raffle · Fellowship
          </p>
          <p className="script-mark animate-rise text-3xl text-[var(--cream)] sm:text-4xl">
            Christmas
          </p>
          <h1 className="brand-mark animate-rise mt-1 max-w-4xl text-5xl leading-[0.95] text-[var(--cream)] sm:text-7xl md:text-8xl">
            UNITED IN JOY
          </h1>
          <p className="script-mark animate-rise-delay mt-1 text-3xl text-[var(--gold-bright)] sm:text-4xl">
            Christmas 2026
          </p>
          <p className="animate-rise-delay mt-4 max-w-xl text-2xl font-extrabold tracking-wide text-[var(--gold-bright)] sm:text-3xl">
            Win Exciting PRIZES!
          </p>
          <p className="animate-rise-delay mt-3 max-w-xl text-lg text-[var(--cream)]/90 sm:text-xl">
            A gathering of thanksgiving and celebration — get your QR ticket and join
            the Christmas Group Talent Show.
          </p>
          <div className="animate-rise-delay mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="btn btn-primary cta-pulse">
              Register for a ticket
            </Link>
            <Link href="/ticket" className="btn btn-secondary">
              Open my ticket
            </Link>
          </div>
          <p className="mt-8 text-sm text-[var(--cream)]/70">
            {event.dateLabel} · {event.venueLabel}
          </p>
        </section>
      </div>

      <section className="relative w-full overflow-hidden bg-[var(--cream)]">
        <Image
          src="/brand/united-in-joy-banner-v3.jpg"
          alt="United in Joy Christmas 2026 — Win Exciting PRIZES! A gathering of thanksgiving and celebration"
          width={1350}
          height={1080}
          className="mx-auto h-auto w-full max-w-5xl object-cover"
          priority
        />
      </section>

      <SiteFooter />
    </div>
  );
}
