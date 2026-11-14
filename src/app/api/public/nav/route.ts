import { NextResponse } from "next/server";
import { getPublicVotingGate } from "@/lib/voting-public";

/**
 * Minimal public nav flags. When voting is hidden, audienceChoice is omitted
 * entirely (not sent as false) to avoid advertising the feature.
 */
export async function GET() {
  try {
    const gate = await getPublicVotingGate();
    if (gate.visible) {
      return NextResponse.json({ audienceChoice: true });
    }
    return NextResponse.json({});
  } catch {
    return NextResponse.json({});
  }
}
