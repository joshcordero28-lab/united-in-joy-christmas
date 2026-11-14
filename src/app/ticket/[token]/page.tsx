import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { fingerprintToken } from "@/lib/crypto";
import { qrDataUrl, ticketUrl } from "@/lib/tickets";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { CcfMark } from "@/components/CcfMark";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const attendee = await prisma.attendee.findUnique({ where: { ticketToken: token } });
  if (!attendee) notFound();

  const event = await getEventConfig();
  const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
  const link = ticketUrl(baseUrl, token);
  const qr = attendee.status === "ISSUED" ? await qrDataUrl(link) : null;
  const staffRef = fingerprintToken(token).toUpperCase().slice(0, 8);

  return (
    <div className="page-shell">
      <SiteHeader compact />
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="relative">
          <div className="ticket-shell animate-rise px-5 pb-5 pt-6 text-center">
            <div className="mb-3 flex justify-center">
              <CcfMark variant="red" />
            </div>
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--red)]">
              Your entry ticket
            </p>
            <h1 className="brand-mark mt-2 text-3xl text-[var(--red)] sm:text-4xl">
              UNITED IN JOY
            </h1>
            <p className="script-mark text-2xl text-[var(--green)]">Christmas 2026</p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              {event.dateLabel} · {event.venueLabel}
            </p>
            <p className="mt-5 text-xl font-extrabold text-[var(--ink)]">{attendee.fullName}</p>

            {qr ? (
              <>
                <p className="mt-5 text-base font-extrabold text-[var(--red)]">
                  Show this QR at the door
                </p>
                <div className="mx-auto mt-3 inline-block rounded-2xl border-2 border-[var(--gold)] bg-white p-4 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qr}
                    alt="Entry ticket QR code — show at the door"
                    className="h-64 w-64 sm:h-72 sm:w-72"
                  />
                </div>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">
                  Save this page or share the ticket link — staff will scan the code.
                </p>
              </>
            ) : (
              <p className="mt-6 text-[var(--ink-soft)]">
                {attendee.status === "PENDING"
                  ? "Your registration is received. Your entry QR will appear after approval."
                  : "This ticket is not valid for entry."}
              </p>
            )}

            {attendee.checkedInAt && (
              <p className="mt-4 text-sm font-semibold text-[var(--green)]">
                Checked in {new Date(attendee.checkedInAt).toLocaleString()}
              </p>
            )}
          </div>

          <div className="ticket-stub relative">
            <span className="ticket-notch-left" aria-hidden />
            <span className="ticket-notch-right" aria-hidden />
            <p className="script-mark text-center text-2xl text-white">Chance to celebrate!</p>
            <p className="mt-1 text-center text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--gold-soft)]">
              Keep this for the door
            </p>
            <div className="mt-4 space-y-3">
              <CopyLinkButton link={link} />
              <details className="rounded-xl bg-black/15 px-3 py-2 text-left text-sm text-white/85">
                <summary className="cursor-pointer font-semibold text-[var(--gold-soft)]">
                  Staff backup reference
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-white/75">
                  If the QR won&apos;t scan, staff can look up reference{" "}
                  <span className="font-mono font-bold tracking-wider text-white">
                    {staffRef}
                  </span>
                  . Guests normally only need the QR above.
                </p>
              </details>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
