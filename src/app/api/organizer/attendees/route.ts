import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER", "STAFF"]);
    } catch {
      return NextResponse.json({ error: "Staff login required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const status = searchParams.get("status");
    const checkedIn = searchParams.get("checkedIn");

    const attendees = await prisma.attendee.findMany({
      where: {
        AND: [
          q
            ? {
                OR: [
                  { fullName: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
          status ? { status: status as "ISSUED" | "PENDING" | "REVOKED" } : {},
          checkedIn === "true"
            ? { checkedInAt: { not: null } }
            : checkedIn === "false"
              ? { checkedInAt: null }
              : {},
        ],
      },
      orderBy: { registeredAt: "desc" },
      take: 200,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        status: true,
        registeredAt: true,
        issuedAt: true,
        checkedInAt: true,
        checkInMethod: true,
      },
    });

    return NextResponse.json({ attendees });
  } catch (err) {
    console.error("attendees list failed", err);
    return NextResponse.json({ error: "Failed to list attendees." }, { status: 500 });
  }
}
