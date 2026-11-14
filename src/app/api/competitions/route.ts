import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const competitions = await prisma.competition.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { entries: true } },
    },
  });

  return NextResponse.json({
    competitions: competitions.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      maxEntries: c.maxEntries,
      teamSizeMin: c.teamSizeMin,
      teamSizeMax: c.teamSizeMax,
      isOpen: c.isOpen,
      entryCount: c._count.entries,
    })),
  });
}
