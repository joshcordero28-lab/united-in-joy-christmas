import { NextResponse } from "next/server";
import { getCapacitySnapshot } from "@/lib/capacity";

/**
 * Public guest occupancy — count + capacity only (no names / PII).
 * Short Cache-Control + in-memory TTL keep homepage polling light on the DB.
 */
export async function GET() {
  try {
    const snapshot = await getCapacitySnapshot();
    return NextResponse.json(
      {
        count: snapshot.count,
        capacity: snapshot.capacity,
        remaining: snapshot.remaining,
        full: snapshot.full,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=5, s-maxage=5",
        },
      },
    );
  } catch (err) {
    console.error("public guests failed", err);
    return NextResponse.json({ error: "Unable to load guest count." }, { status: 500 });
  }
}
