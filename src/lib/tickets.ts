import QRCode from "qrcode";

/** Separates ticket token from optional voting code inside the URL hash. */
export const TICKET_VOTE_SEP = "~";

export type TicketPayload = {
  token: string;
  votingCredential: string | null;
};

/**
 * Ticket links put the bearer token in the URL hash so it is not sent to the
 * server in the request path (avoids access-log / referrer leakage).
 * When `votingCredential` is provided, it is embedded so Audience Choice can
 * autofill after a QR scan: `#<token>~<votingCredential>`.
 */
export function ticketUrl(
  baseUrl: string,
  token: string,
  votingCredential?: string | null,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const vote = (votingCredential || "").trim();
  const hash = vote
    ? `${encodeURIComponent(token)}${TICKET_VOTE_SEP}${encodeURIComponent(vote)}`
    : encodeURIComponent(token);
  return `${base}/ticket#${hash}`;
}

/** Private registration-management link (hash credential — not a ticket QR). */
export function manageUrl(baseUrl: string, managerToken: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/manage#${encodeURIComponent(managerToken)}`;
}

/**
 * Split a raw ticket hash / QR payload into token + optional voting code.
 */
export function parseTicketPayload(input: string): TicketPayload {
  const raw = extractRawTicketFragment(input);
  if (!raw) return { token: "", votingCredential: null };

  const sep = raw.indexOf(TICKET_VOTE_SEP);
  if (sep < 0) {
    return { token: raw, votingCredential: null };
  }
  const token = raw.slice(0, sep);
  const vote = raw.slice(sep + TICKET_VOTE_SEP.length);
  return {
    token,
    votingCredential: vote ? vote.trim().toUpperCase() : null,
  };
}

function extractRawTicketFragment(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  try {
    const u = new URL(raw, "https://local.invalid");
    const path = u.pathname.replace(/\/$/, "");
    if (u.hash && (path.endsWith("/ticket") || path.includes("/ticket/"))) {
      return decodeHashFragment(u.hash.slice(1));
    }
    if (path.includes("/ticket/")) {
      const rest = path.split("/ticket/")[1] || "";
      return decodeHashFragment(rest);
    }
  } catch {
    // not a URL — fall through
  }

  const hashOnly = raw.startsWith("#") ? raw.slice(1) : "";
  if (hashOnly) {
    return decodeHashFragment(hashOnly);
  }

  const marker = "/ticket/";
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const rest = raw.slice(idx + marker.length).split(/[?#]/)[0] || "";
    return decodeHashFragment(rest);
  }

  const hashIdx = raw.indexOf("#");
  if (hashIdx >= 0 && raw.includes("/ticket")) {
    return decodeHashFragment(raw.slice(hashIdx + 1));
  }

  return decodeHashFragment(raw);
}

function decodeHashFragment(fragment: string): string {
  // Hash may be fully encodeURIComponent'd, or token~vote with only parts encoded.
  try {
    const once = decodeURIComponent(fragment);
    // If the whole payload was encoded, ~ becomes visible after one decode.
    if (once.includes(TICKET_VOTE_SEP) || once === fragment) return once;
    try {
      return decodeURIComponent(once);
    } catch {
      return once;
    }
  } catch {
    return fragment;
  }
}

/**
 * Parse an app ticket credential from QR text, hash link, legacy path, or opaque code.
 * Never fetches remote URLs. Absolute http(s) URLs must target this app's ticket route
 * (host matches APP_BASE_URL when set).
 */
export function parseAppTicketCredential(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  const looksAbsolute = /^https?:\/\//i.test(raw) || raw.startsWith("//");
  if (looksAbsolute) {
    try {
      const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      const base = (process.env.APP_BASE_URL || "").trim();
      if (base) {
        const allowed = new URL(base);
        if (u.host !== allowed.host) {
          return "";
        }
      }
      const path = u.pathname.replace(/\/$/, "");
      if (!(path.endsWith("/ticket") || path.includes("/ticket/"))) {
        return "";
      }
    } catch {
      return "";
    }
  }

  return extractTicketToken(raw);
}

/** Accept a full ticket URL (hash or legacy path) or the opaque ticket code itself. */
export function extractTicketToken(input: string): string {
  return parseTicketPayload(input).token;
}

/** Optional voting code embedded in a ticket QR / link. */
export function extractVotingCredentialFromTicket(input: string): string | null {
  return parseTicketPayload(input).votingCredential;
}

export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#2a1810", light: "#faf7f2" },
  });
}
