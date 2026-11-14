import QRCode from "qrcode";

/**
 * Ticket links put the bearer token in the URL hash so it is not sent to the
 * server in the request path (avoids access-log / referrer leakage).
 */
export function ticketUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/ticket#${encodeURIComponent(token)}`;
}

/** Accept a full ticket URL (hash or legacy path) or the opaque ticket code itself. */
export function extractTicketToken(input: string): string {
  const raw = input.trim();
  if (!raw) return "";

  try {
    const u = new URL(raw, "https://local.invalid");
    const path = u.pathname.replace(/\/$/, "");
    if (u.hash && (path.endsWith("/ticket") || path.includes("/ticket/"))) {
      return decodeURIComponent(u.hash.slice(1));
    }
    if (path.includes("/ticket/")) {
      const rest = path.split("/ticket/")[1] || "";
      return decodeURIComponent(rest);
    }
  } catch {
    // not a URL — fall through
  }

  const hashOnly = raw.startsWith("#") ? raw.slice(1) : "";
  if (hashOnly) {
    try {
      return decodeURIComponent(hashOnly);
    } catch {
      return hashOnly;
    }
  }

  const marker = "/ticket/";
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const rest = raw.slice(idx + marker.length).split(/[?#]/)[0] || "";
    try {
      return decodeURIComponent(rest);
    } catch {
      return rest;
    }
  }

  const hashIdx = raw.indexOf("#");
  if (hashIdx >= 0 && raw.includes("/ticket")) {
    try {
      return decodeURIComponent(raw.slice(hashIdx + 1));
    } catch {
      return raw.slice(hashIdx + 1);
    }
  }

  return raw;
}

export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#2a1810", light: "#faf7f2" },
  });
}
