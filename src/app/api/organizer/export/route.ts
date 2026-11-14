import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/session";

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request) {
  try {
    const session = await getStaffSession();
    try {
      requireStaff(session, ["ORGANIZER"]);
    } catch {
      return NextResponse.json({ error: "Organizer only." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "attendees";

    if (type === "attendees") {
      const rows = await prisma.attendee.findMany({ orderBy: { fullName: "asc" } });
      const header = [
        "id",
        "fullName",
        "phone",
        "email",
        "status",
        "registeredAt",
        "checkedInAt",
        "checkInMethod",
      ];
      const lines = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.id,
            r.fullName,
            r.phone,
            r.email,
            r.status,
            r.registeredAt.toISOString(),
            r.checkedInAt?.toISOString() || "",
            r.checkInMethod || "",
          ]
            .map(csvEscape)
            .join(","),
        ),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="attendees.csv"',
        },
      });
    }

    if (type === "competitions") {
      const rows = await prisma.competitionEntry.findMany({
        include: { competition: true, attendee: true },
        orderBy: { createdAt: "asc" },
      });
      const lines = [
        "competition,type,attendee,teamName,enteredAt",
        ...rows.map((r) =>
          [
            r.competition.name,
            r.competition.type,
            r.attendee.fullName,
            r.teamName || "",
            r.createdAt.toISOString(),
          ]
            .map(csvEscape)
            .join(","),
        ),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="competitions.csv"',
        },
      });
    }

    if (type === "audit") {
      const rows = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      const lines = [
        "createdAt,actor,action,entityType,entityId,detail",
        ...rows.map((r) =>
          [r.createdAt.toISOString(), r.actorLabel || "", r.action, r.entityType || "", r.entityId || "", r.detail || ""]
            .map(csvEscape)
            .join(","),
        ),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="audit.csv"',
        },
      });
    }

    return NextResponse.json({ error: "Unknown export type." }, { status: 400 });
  } catch (err) {
    console.error("export failed", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
