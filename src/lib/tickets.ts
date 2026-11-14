import QRCode from "qrcode";

export function ticketUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/ticket/${encodeURIComponent(token)}`;
}

/** Accept a full ticket URL or the opaque ticket code itself. */
export function extractTicketToken(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
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
