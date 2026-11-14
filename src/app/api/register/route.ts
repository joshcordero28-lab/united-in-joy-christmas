import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEventConfig } from "@/lib/event";
import {
  generateOpaqueToken,
  generateVotingCredential,
  hashVotingCredential,
} from "@/lib/crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { TicketStatus } from "@prisma/client";

const schema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  /** Honeypot — must stay empty. Bots that fill hidden fields are rejected. */
  company: z.string().max(200).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limited = await rateLimit(`register:${ip}`, 3, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
      );
    }
    const daily = await rateLimit(`register-day:${ip}`, 20, 24 * 60 * 60 * 1000);
    if (!daily.ok) {
      return NextResponse.json(
        { error: "Daily registration limit reached for this network. Try again tomorrow." },
        { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid registration details." }, { status: 400 });
    }
    if (parsed.data.company && parsed.data.company.trim() !== "") {
      // Silent success for bots — do not create an attendee.
      return NextResponse.json({
        attendeeId: "ok",
        fullName: parsed.data.fullName,
        status: "ISSUED",
        ticketToken: null,
        votingCredential: null,
        message: "Registration complete. Save your ticket and voting code.",
      });
    }

    const event = await getEventConfig();
    if (!event.registrationOpen) {
      return NextResponse.json({ error: "Registration is closed." }, { status: 403 });
    }

    const issuedCount = await prisma.attendee.count({
      where: { status: { in: [TicketStatus.ISSUED, TicketStatus.PENDING] } },
    });
    if (issuedCount >= event.capacity) {
      return NextResponse.json({ error: "Event is at capacity." }, { status: 403 });
    }

    const ticketToken = generateOpaqueToken(32);
    const votingCredential = generateVotingCredential();
    const votingCredentialHash = await hashVotingCredential(votingCredential);
    const status = event.requireApproval ? TicketStatus.PENDING : TicketStatus.ISSUED;

    const attendee = await prisma.attendee.create({
      data: {
        fullName: parsed.data.fullName,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        notes: parsed.data.notes || null,
        ticketToken,
        votingCredentialHash,
        votingCredentialHint: null,
        status,
        issuedAt: status === TicketStatus.ISSUED ? new Date() : null,
      },
    });

    await writeAudit({
      actorLabel: "guest",
      action: "attendee.register",
      entityType: "Attendee",
      entityId: attendee.id,
      detail: `status=${status}`,
    });

    return NextResponse.json({
      attendeeId: attendee.id,
      fullName: attendee.fullName,
      status: attendee.status,
      ticketToken: status === TicketStatus.ISSUED ? ticketToken : null,
      votingCredential: status === TicketStatus.ISSUED ? votingCredential : null,
      message:
        status === TicketStatus.PENDING
          ? "Registration received. Your ticket will be issued after approval."
          : "Registration complete. Save your ticket and voting code.",
    });
  } catch (err) {
    console.error("register failed", err);
    return NextResponse.json({ error: "Registration failed." }, { status: 500 });
  }
}
