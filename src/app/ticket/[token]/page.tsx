import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import { qrDataUrl, ticketUrl } from "@/lib/tickets";
import { SiteHeader } from "@/components/SiteHeader";
import { CopyLinkButton } from "@/components/CopyLinkButton";

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

  return (
    <main className="min-h-screen">
      <SiteHeader compact />
      <div className="mx-auto max-w-md px-4 py-8">
        <div className="panel animate-rise p-6 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--gold-soft)]/80">
            Admission ticket
          </p>
          <h1 className="brand-mark mt-2 text-3xl text-[var(--cream)]">{event.name}</h1>
          <p className="mt-1 text-[var(--cream)]/70">
            {event.dateLabel} · {event.venueLabel}
          </p>
          <p className="mt-6 text-xl font-semibold">{attendee.fullName}</p>
          <p className="mt-1 text-sm text-[var(--gold-soft)]">Status: {attendee.status}</p>

          {qr ? (
            <div className="mx-auto mt-6 inline-block rounded-2xl bg-[var(--cream)] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Ticket QR code" className="h-56 w-56" />
            </div>
          ) : (
            <p className="mt-6 text-[var(--cream)]/80">
              {attendee.status === "PENDING"
                ? "Awaiting organizer approval."
                : "This ticket is not valid for entry."}
            </p>
          )}

          {attendee.checkedInAt && (
            <p className="mt-4 text-sm text-[var(--gold)]">
              Checked in {new Date(attendee.checkedInAt).toLocaleString()}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <CopyLinkButton link={link} />
            <p className="text-xs text-[var(--cream)]/55 break-all">{link}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
