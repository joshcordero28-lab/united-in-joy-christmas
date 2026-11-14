import { notFound } from "next/navigation";
import { getPublicVotingGate } from "@/lib/voting-public";
import { VoteClient } from "./VoteClient";

export const dynamic = "force-dynamic";

/**
 * Public voting page is unavailable (404) until the organizer reveals voting.
 * No “coming soon” or voting teaser copy while hidden.
 */
export default async function VotePage() {
  const gate = await getPublicVotingGate();
  if (!gate.visible) notFound();

  return (
    <VoteClient
      initiallyOpen={gate.open}
      resultsPublished={gate.resultsPublished}
    />
  );
}
