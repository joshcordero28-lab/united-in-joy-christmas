import Link from "next/link";
import { CcfMark } from "./CcfMark";

export function SiteHeader({
  compact = false,
  onRed = false,
}: {
  compact?: boolean;
  onRed?: boolean;
}) {
  const link = onRed
    ? "rounded-full px-3 py-2 text-[var(--cream)]/90 hover:bg-white/10"
    : "rounded-full px-3 py-2 text-[var(--ink-soft)] hover:bg-[var(--red)]/5";
  const brand = onRed ? "text-[var(--gold-soft)]" : "text-[var(--red)]";

  return (
    <header className="relative z-10 mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <CcfMark variant={onRed ? "white" : "red"} />
        <Link href="/" className={`brand-mark text-xl sm:text-2xl ${brand}`}>
          United in Joy
        </Link>
      </div>
      {!compact && (
        <nav className="flex flex-wrap items-center gap-1 text-sm sm:gap-2 sm:text-base">
          <Link className={link} href="/register">
            Register
          </Link>
          <Link className={link} href="/competitions">
            Talent Show
          </Link>
          <Link className={link} href="/vote">
            Audience Choice
          </Link>
          <Link className={link} href="/staff">
            Staff
          </Link>
        </nav>
      )}
    </header>
  );
}
