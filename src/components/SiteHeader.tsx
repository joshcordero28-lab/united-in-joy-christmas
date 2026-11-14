import { getPublicVotingGate } from "@/lib/voting-public";
import { SiteHeaderView } from "./SiteHeaderView";

/** Server header that hides Audience Choice until organizer reveal. */
export async function SiteHeader({
  compact = false,
  onRed = false,
}: {
  compact?: boolean;
  onRed?: boolean;
}) {
  let showAudienceChoice = false;
  try {
    showAudienceChoice = (await getPublicVotingGate()).visible;
  } catch {
    showAudienceChoice = false;
  }
  return (
    <SiteHeaderView
      compact={compact}
      onRed={onRed}
      showAudienceChoice={showAudienceChoice}
    />
  );
}
