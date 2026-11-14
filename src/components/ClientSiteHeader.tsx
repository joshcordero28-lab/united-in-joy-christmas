"use client";

import { useEffect, useState } from "react";
import { SiteHeaderView } from "./SiteHeaderView";

/** Client pages load whether Audience Choice is revealed without teasing it when hidden. */
export function ClientSiteHeader({
  compact = false,
  onRed = false,
  forceAudienceChoice,
}: {
  compact?: boolean;
  onRed?: boolean;
  forceAudienceChoice?: boolean;
}) {
  const [show, setShow] = useState(Boolean(forceAudienceChoice));

  useEffect(() => {
    if (forceAudienceChoice) {
      setShow(true);
      return;
    }
    fetch("/api/public/nav")
      .then((r) => r.json())
      .then((d) => setShow(Boolean(d.audienceChoice)))
      .catch(() => setShow(false));
  }, [forceAudienceChoice]);

  return (
    <SiteHeaderView compact={compact} onRed={onRed} showAudienceChoice={show} />
  );
}
