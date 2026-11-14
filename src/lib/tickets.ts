import QRCode from "qrcode";

export function ticketUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/ticket/${encodeURIComponent(token)}`;
}

export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#1a1208", light: "#fffdf8" },
  });
}
