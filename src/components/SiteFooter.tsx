import { CcfMark } from "./CcfMark";

export function SiteFooter({ onRed = false }: { onRed?: boolean }) {
  return (
    <footer
      className={`relative z-10 mx-auto mt-auto flex w-full max-w-5xl flex-col items-start justify-between gap-3 px-4 py-6 sm:flex-row sm:items-center ${
        onRed ? "text-[var(--cream)]/75" : "text-[var(--ink-soft)]"
      }`}
    >
      <CcfMark variant={onRed ? "white" : "red"} />
      <p className="text-sm">
        United in Joy Christmas 2026 · December 13, 2026
      </p>
    </footer>
  );
}
