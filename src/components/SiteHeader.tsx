import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link href="/" className="brand-mark text-xl text-[var(--gold-soft)] sm:text-2xl">
        United in Love
      </Link>
      {!compact && (
        <nav className="flex flex-wrap items-center gap-2 text-sm sm:gap-3 sm:text-base">
          <Link className="rounded-full px-3 py-2 hover:bg-white/5" href="/register">
            Register
          </Link>
          <Link className="rounded-full px-3 py-2 hover:bg-white/5" href="/competitions">
            Competitions
          </Link>
          <Link className="rounded-full px-3 py-2 hover:bg-white/5" href="/vote">
            Vote
          </Link>
          <Link className="rounded-full px-3 py-2 hover:bg-white/5" href="/staff">
            Staff
          </Link>
        </nav>
      )}
    </header>
  );
}
