import Image from "next/image";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Sparkles } from "@/components/Sparkles";
import { ScriptWatermark } from "@/components/ScriptWatermark";
import { OrnamentRow } from "@/components/OrnamentRow";
import { HomeHeroCtas } from "@/components/HomeHeroCtas";
import { GuestCounter } from "@/components/GuestCounter";
import { getCapacitySnapshot } from "@/lib/capacity";
import { getEventConfig } from "@/lib/event";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [event, guests] = await Promise.all([
    getEventConfig(),
    getCapacitySnapshot({ bypassCache: true }),
  ]);

  return (
    <div className="page-shell">
      <div className="hero-red relative min-h-screen overflow-hidden">
        <ScriptWatermark />
        <Sparkles />
        <SiteHeader onRed />

        <section className="relative z-10 mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-5xl flex-col justify-center px-4 pb-12 pt-2">
          <OrnamentRow />
          <p className="animate-rise mb-3 text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--gold-soft)] sm:text-sm">
            Food · Games · Worship · Raffle · Fellowship
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
          <p className="animate-rise-delay mt-4 max-w-2xl text-balance text-xl font-extrabold leading-snug tracking-wide text-[var(--gold-bright)] sm:max-w-3xl sm:text-2xl md:text-3xl">
            United in Worship, Grateful in Heart, Joyful in Christ!
          </p>
          <p className="animate-rise-delay mt-3 max-w-xl text-lg text-[var(--cream)]/90 sm:text-xl">
            A gathering of thanksgiving and celebration — get your QR ticket and join
            the Christmas Group Talent Show.
          </p>
          <HomeHeroCtas />
          <GuestCounter initial={guests} />
          <p className="mt-8 text-sm text-[var(--cream)]/70">
            {event.dateLabel} · {event.venueLabel}
          </p>
        </section>
      </div>

      <section className="relative w-full overflow-hidden bg-[var(--cream)]">
        <Image
          src="/brand/united-in-joy-flyer-2026.jpg"
          alt="You're Invited! United in Joy Christmas Celebration 2026 — worship, talent show, dinner & fellowship. December 13, 2026 after church service. Max 120 attendees."
          width={1672}
          height={941}
          className="mx-auto h-auto w-full max-w-5xl object-contain"
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
        />
      </section>

      <section className="relative w-full overflow-hidden bg-[var(--red)]">
        <Image
          src="/brand/ccf-committee-banner-v2.jpg"
          alt="A heart to serve for this Christmas Event 2026 — join a committee: Programs, Logistics, Prize Sponsors, Music, Kitchen, Ushers. Contact Joshua Rey Cordero."
          width={1350}
          height={1080}
          className="mx-auto h-auto w-full max-w-5xl object-cover"
        />
      </section>

      <SiteFooter />
    </div>
  );
}
