import { getEventConfig } from "./event";

export type PublicVotingGate = {
  visible: boolean;
  open: boolean;
  resultsPublished: boolean;
};

/**
 * Server-side gate for attendee-facing voting. Default: fully hidden.
 * Does not expose raw config objects to callers that might leak into public JSON.
 */
export async function getPublicVotingGate(): Promise<PublicVotingGate> {
  const event = await getEventConfig();
  const visible = event.talentVotingVisibility === "REVEALED";
  return {
    visible,
    open: visible && event.talentVotingState === "OPEN",
    resultsPublished: visible && event.talentResultsPublished,
  };
}
